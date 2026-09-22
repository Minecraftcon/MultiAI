const http = require("http");
const fs = require("fs");
const path = require("path");
const { sendJSON, postJSON } = require("../utils");
const conversationsManager = require("../../core/conversations_manager");
const { imageGenTasks } = require("./media");

async function handleTaskRoute(req, res) {
    // Intercept image generation background tasks if queried via task APIs
    if (req.url.startsWith("/api/task/stdout/")) {
        const taskId = decodeURIComponent(req.url.replace("/api/task/stdout/", "")).trim();
        if (taskId.startsWith("gen_") && imageGenTasks.has(taskId)) {
            const task = imageGenTasks.get(taskId);
            if (task.status === "completed") {
                return sendJSON(res, 200, {
                    task_id: taskId,
                    status: "completed",
                    done: true,
                    output: task.result?.markdown || `![${task.prompt}](${task.result?.url})`,
                    url: task.result?.url,
                    result: task.result
                });
            } else if (task.status === "failed") {
                return sendJSON(res, 200, {
                    task_id: taskId,
                    status: "failed",
                    done: true,
                    error: task.error,
                    output: `Image generation failed: ${task.error}`
                });
            } else {
                const elapsed = ((Date.now() - task.created_at) / 1000).toFixed(1);
                return sendJSON(res, 200, {
                    task_id: taskId,
                    status: "running",
                    done: false,
                    output: `Image generation in progress in background (${elapsed}s elapsed)...`
                });
            }
        }
    }

    if (req.url.startsWith("/api/task/status/")) {
        const taskId = decodeURIComponent(req.url.replace("/api/task/status/", "")).trim();
        if (taskId.startsWith("gen_") && imageGenTasks.has(taskId)) {
            const task = imageGenTasks.get(taskId);
            return sendJSON(res, 200, {
                task_id: taskId,
                status: task.status,
                running: task.status === "running",
                created_at: task.created_at,
                result: task.result,
                error: task.error
            });
        }
    }

    // Direct Python Execution Engine route: /api/python/run
    if (req.method === "POST" && req.url === "/api/python/run") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const args = JSON.parse(body || "{}");
            const result = await postJSON(5000, "/api/python/run", args, 35000);
            return sendJSON(res, 200, result);
        } catch (error) {
            return sendJSON(res, 500, { error: error.message });
        }
    }

    // Proxy terminal tasks to the supervised Python backend with large-output scratch logging
    if (req.url.startsWith("/api/task/")) {
        let reqBody = "";
        try {
            for await (const chunk of req) reqBody += chunk;
        } catch (_) {}

        let parsedBody = {};
        try {
            parsedBody = reqBody ? JSON.parse(reqBody) : {};
        } catch (_) {}

        const chatId = req.headers["x-chat-id"] || parsedBody.chatId || parsedBody.chat_id || "";
        let scratchDir = "";
        let artifactsDir = "";
        if (chatId) {
            try {
                const ws = conversationsManager.ensureChatWorkspace(chatId);
                scratchDir = ws.scratchDir;
                artifactsDir = ws.artifactsDir;
            } catch (_) {}
        }
        if (!scratchDir) {
            scratchDir = path.join(conversationsManager.getStorageRoot(), "scratch");
        }
        if (!fs.existsSync(scratchDir)) {
            fs.mkdirSync(scratchDir, { recursive: true });
        }
        if (!artifactsDir) {
            artifactsDir = path.join(conversationsManager.getStorageRoot(), "artifacts");
        }
        if (!fs.existsSync(artifactsDir)) {
            fs.mkdirSync(artifactsDir, { recursive: true });
        }

        if (parsedBody && typeof parsedBody === "object") {
            parsedBody.scratch_dir = scratchDir;
            parsedBody.artifacts_dir = artifactsDir;
            reqBody = JSON.stringify(parsedBody);
        }

        const headers = { ...req.headers };
        if (reqBody) {
            headers["content-length"] = Buffer.byteLength(reqBody);
        }

        const options = {
            hostname: "127.0.0.1",
            port: 5000,
            path: req.url,
            method: req.method,
            headers
        };

        const startTime = Date.now();
        const proxyReq = http.request(options, (proxyRes) => {
            let resData = "";
            proxyRes.on("data", (chunk) => { resData += chunk; });
            proxyRes.on("end", () => {
                let json;
                try {
                    json = JSON.parse(resData);
                } catch (_) {}

                if (json && typeof json === "object") {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    json.ran_for = json.elapsed_seconds ? String(json.elapsed_seconds) : elapsed;

                    const combinedOutput = (json.stdout || "") + (json.stderr ? "\n" + json.stderr : "");
                    const lines = combinedOutput.split("\n");
                    const isLarge = lines.length > 100 || Buffer.byteLength(combinedOutput) > 2048;

                    if (isLarge) {
                        try {
                            const chatId = req.headers["x-chat-id"] || parsedBody.chatId || "";
                            let scratchDir = "";
                            if (chatId) {
                                try {
                                    scratchDir = conversationsManager.ensureChatWorkspace(chatId).scratchDir;
                                } catch (_) {}
                            }
                            if (!scratchDir) {
                                scratchDir = path.join(conversationsManager.getStorageRoot(), "scratch");
                            }
                            if (!fs.existsSync(scratchDir)) {
                                fs.mkdirSync(scratchDir, { recursive: true });
                            }

                            const taskName = parsedBody.task_name || parsedBody.name || "";
                            const cleanName = taskName 
                                ? taskName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 30) 
                                : "task";
                            const logFileName = `${cleanName}-${json.task_id || Date.now().toString(36)}.log`;
                            const logFilePath = path.join(scratchDir, logFileName);

                            fs.writeFileSync(logFilePath, combinedOutput, "utf8");

                            json.is_large_output = true;
                            json.scratch_log_path = `scratch/${logFileName}`;
                            json.truncated_lines = lines.slice(-100).join("\n");
                        } catch (err) {
                            console.warn("[TASK LOG SAVE ERROR]", err.message);
                        }
                    }
                    return sendJSON(res, proxyRes.statusCode, json);
                }

                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                res.end(resData);
            });
        });

        proxyReq.on("error", (e) => {
            console.error(`[PROXY ERROR] Python server unreachable: ${e.message}`);
            sendJSON(res, 500, { error: "Python backend is not responding." });
        });

        if (reqBody) {
            proxyReq.write(reqBody);
        }
        proxyReq.end();
    }
}

module.exports = {
    handleTaskRoute
};
