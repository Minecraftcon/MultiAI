const http = require("http");
const { WebSocketServer } = require("ws");
const { sendJSON, getChatWorkspace, getChatScratchDir, getChatArtifactsDir } = require("../utils");
const { getTaskServerTarget } = require("../../core/sandbox_manager");

/**
 * Handles HTTP requests for /api/pty/* by proxying to the supervised task daemon.
 */
async function handlePtyRoute(req, res) {
    let reqBody = "";
    try {
        for await (const chunk of req) reqBody += chunk;
    } catch (_) {}

    let parsedBody = {};
    try {
        parsedBody = reqBody ? JSON.parse(reqBody) : {};
    } catch (_) {}

    const chatId = req.headers["x-chat-id"] || parsedBody.chatId || parsedBody.chat_id || "";
    const wsContext = getChatWorkspace(chatId);
    const scratchDir = wsContext?.workspace?.scratchDir || getChatScratchDir(chatId);
    const artifactsDir = wsContext?.workspace?.artifactsDir || getChatArtifactsDir(chatId);

    if (parsedBody && typeof parsedBody === "object") {
        parsedBody.scratch_dir = scratchDir;
        parsedBody.artifacts_dir = artifactsDir;
        if (!parsedBody.cwd && wsContext?.project?.rootPath) {
            parsedBody.cwd = wsContext.project.rootPath;
        }
        reqBody = JSON.stringify(parsedBody);
    }

    const headers = { ...req.headers };
    if (reqBody) {
        headers["content-length"] = Buffer.byteLength(reqBody);
        delete headers["transfer-encoding"];
    }

    const target = getTaskServerTarget();
    const options = {
        ...target,
        path: req.url,
        method: req.method,
        headers
    };

    // Real-time Event-Stream proxy for streaming PTY terminal output
    if (req.url.startsWith("/api/pty/stream/")) {
        const proxyReq = http.request(options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "X-Accel-Buffering": "no"
            });
            if (res.socket) res.socket.setNoDelay(true);

            proxyRes.on("data", (chunk) => {
                res.write(chunk);
                if (typeof res.flush === "function") res.flush();
            });
            proxyRes.on("end", () => {
                res.end();
            });
        });

        proxyReq.on("error", (err) => {
            sendJSON(res, 502, { error: `PTY daemon unavailable: ${err.message}` });
        });

        if (reqBody) proxyReq.write(reqBody);
        proxyReq.end();
        return;
    }

    // Standard JSON proxy for /api/pty/spawn, input, resize, kill, list
    const proxyReq = http.request(options, (proxyRes) => {
        let resData = "";
        proxyRes.on("data", (chunk) => { resData += chunk; });
        proxyRes.on("end", () => {
            res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
            res.end(resData);
        });
    });

    proxyReq.on("error", (err) => {
        sendJSON(res, 502, { error: `Task daemon unreachable: ${err.message}` });
    });

    if (reqBody) proxyReq.write(reqBody);
    proxyReq.end();
}

/**
 * Dispatches an HTTP request to the task daemon (supports Unix socket or HTTP).
 */
function requestDaemon(path, method = "GET", body = null) {
    return new Promise((resolve, reject) => {
        const target = getTaskServerTarget();
        const payload = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
        const headers = {
            ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {})
        };

        const options = {
            ...target,
            path,
            method,
            headers
        };

        const req = http.request(options, (res) => {
            let resData = "";
            res.on("data", (chunk) => { resData += chunk; });
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(resData) });
                } catch (_) {
                    resolve({ status: res.statusCode, data: resData });
                }
            });
        });

        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

/**
 * Initializes WebSocket server for bi-directional low-latency interactive PTY terminal.
 */
function initPtyWebSocket(server) {
    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
        const parsedUrl = new URL(request.url, "http://localhost");
        if (parsedUrl.pathname === "/ws/pty" || parsedUrl.pathname.startsWith("/ws/pty/")) {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit("connection", ws, request);
            });
        }
    });

    wss.on("connection", async (ws, request) => {
        const parsedUrl = new URL(request.url, "http://localhost");
        const queryPtyId = parsedUrl.searchParams.get("id") || parsedUrl.searchParams.get("pty_id");
        let activePtyId = queryPtyId || "";
        let streamReq = null;

        const attachStream = (ptyId) => {
            if (streamReq) {
                try { streamReq.destroy(); } catch (_) {}
            }

            const target = getTaskServerTarget();
            const options = {
                ...target,
                path: `/api/pty/stream/${encodeURIComponent(ptyId)}`,
                method: "GET"
            };

            streamReq = http.request(options, (res) => {
                let buffer = "";
                res.on("data", (chunk) => {
                    buffer += chunk.toString("utf8");
                    const lines = buffer.split("\n\n");
                    buffer = lines.pop() || "";

                    for (const ev of lines) {
                        const trimmed = ev.trim();
                        if (!trimmed.startsWith("data:")) continue;
                        const jsonStr = trimmed.slice(5).trim();
                        if (!jsonStr) continue;

                        try {
                            const data = JSON.parse(jsonStr);
                            if (ws.readyState === ws.OPEN) {
                                ws.send(JSON.stringify(data));
                            }
                        } catch (_) {}
                    }
                });

                res.on("end", () => {
                    if (ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({ type: "exit", note: "PTY stream closed" }));
                    }
                });
            });

            streamReq.on("error", (err) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: "error", error: err.message }));
                }
            });

            streamReq.end();
        };

        // If ptyId was provided in query string, attach immediately
        if (activePtyId) {
            attachStream(activePtyId);
        }

        ws.on("message", async (rawMessage) => {
            let parsed = null;
            const strMsg = typeof rawMessage === "string" ? rawMessage : rawMessage.toString("utf8");

            try {
                parsed = JSON.parse(strMsg);
            } catch (_) {
                // Raw keystroke / terminal input sent directly
                if (activePtyId) {
                    await requestDaemon(`/api/pty/input/${encodeURIComponent(activePtyId)}`, "POST", { input: strMsg });
                }
                return;
            }

            if (!parsed || typeof parsed !== "object") return;

            const action = parsed.action || parsed.type;

            // 1. Spawn a new PTY session
            if (action === "spawn") {
                try {
                    const res = await requestDaemon("/api/pty/spawn", "POST", {
                        shell: parsed.shell,
                        command: parsed.command,
                        cwd: parsed.cwd,
                        cols: parsed.cols || 80,
                        rows: parsed.rows || 24,
                        scratchDir: parsed.scratchDir,
                        artifactsDir: parsed.artifactsDir
                    });

                    if (res.data?.pty_id) {
                        activePtyId = res.data.pty_id;
                        ws.send(JSON.stringify({ type: "spawned", ...res.data }));
                        attachStream(activePtyId);
                    } else {
                        ws.send(JSON.stringify({ type: "error", error: res.data?.error || "Failed to spawn PTY" }));
                    }
                } catch (err) {
                    ws.send(JSON.stringify({ type: "error", error: err.message }));
                }
                return;
            }

            // 2. Attach to existing PTY
            if (action === "attach") {
                const targetId = parsed.id || parsed.pty_id || parsed.ptyId;
                if (targetId) {
                    activePtyId = targetId;
                    attachStream(activePtyId);
                }
                return;
            }

            // 3. User terminal input / keystroke
            if (action === "input" || action === "data") {
                const targetId = parsed.pty_id || parsed.id || activePtyId;
                const inputData = parsed.input !== undefined ? parsed.input : (parsed.data !== undefined ? parsed.data : "");
                if (targetId && inputData) {
                    await requestDaemon(`/api/pty/input/${encodeURIComponent(targetId)}`, "POST", { input: inputData });
                }
                return;
            }

            // 4. Terminal window resize
            if (action === "resize") {
                const targetId = parsed.pty_id || parsed.id || activePtyId;
                if (targetId && parsed.cols && parsed.rows) {
                    await requestDaemon(`/api/pty/resize/${encodeURIComponent(targetId)}`, "POST", {
                        cols: parsed.cols,
                        rows: parsed.rows
                    });
                }
                return;
            }

            // 5. Kill session
            if (action === "kill") {
                const targetId = parsed.pty_id || parsed.id || activePtyId;
                if (targetId) {
                    await requestDaemon(`/api/pty/kill/${encodeURIComponent(targetId)}`, "POST");
                }
                return;
            }
        });

        ws.on("close", () => {
            if (streamReq) {
                try { streamReq.destroy(); } catch (_) {}
            }
        });
    });

    return wss;
}

module.exports = {
    handlePtyRoute,
    initPtyWebSocket
};
