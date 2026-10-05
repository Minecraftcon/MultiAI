/* =========================================================
   BUILD AGENT SERVER-SENT EVENTS & DETACHED JOB ROUTER
   Handles /api/build/agent/* endpoints with safe client detach.
   ========================================================= */
const { sendJSON } = require("../utils");
const { 
    startAgentJob, 
    getAgentJob, 
    stopAgentJob, 
    subscribeAgentJob 
} = require("../../core/build_agent_runner");

async function handleBuildAgentRoute(req, res) {
    const reqUrl = req.url.split("?")[0];

    // 1. POST /api/build/agent/start - Launch or trigger background job
    if (req.method === "POST" && reqUrl === "/api/build/agent/start") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const { projectId, chatId, userText, model, provider } = data;

            if (!projectId || !chatId) {
                return sendJSON(res, 400, { error: "Missing required fields: projectId, chatId" });
            }

            const job = startAgentJob({ projectId, chatId, userText, model, provider });
            return sendJSON(res, 200, {
                status: "started",
                chatId: job.chatId,
                projectId: job.projectId,
                isRunning: job.isRunning,
                startedAt: job.startedAt
            });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    // 2. GET /api/build/agent/status/:chatId - Check if background job is running
    if (req.method === "GET" && reqUrl.startsWith("/api/build/agent/status/")) {
        const chatId = decodeURIComponent(reqUrl.replace("/api/build/agent/status/", "")).trim();
        const job = getAgentJob(chatId);
        if (!job) {
            return sendJSON(res, 200, { isRunning: false, status: "idle" });
        }
        return sendJSON(res, 200, {
            isRunning: job.isRunning,
            chatId: job.chatId,
            projectId: job.projectId,
            todos: job.todos || [],
            startedAt: job.startedAt,
            lastUpdated: job.lastUpdated,
            error: job.error
        });
    }

    // 3. GET /api/build/agent/stream/:chatId - Server-Sent Events stream (disconnect-safe)
    if (req.method === "GET" && reqUrl.startsWith("/api/build/agent/stream/")) {
        const chatId = decodeURIComponent(reqUrl.replace("/api/build/agent/stream/", "")).trim();
        const job = getAgentJob(chatId);

        if (!job) {
            return sendJSON(res, 404, { error: "No agent job found for this chat" });
        }

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*"
        });

        // Send initial connection state
        res.write(`data: ${JSON.stringify({ type: "connected", isRunning: job.isRunning, todos: job.todos })}\n\n`);

        const unsubscribe = subscribeAgentJob(chatId, (event) => {
            if (res.writableEnded || res.destroyed) return;
            try {
                res.write(`data: ${JSON.stringify(event)}\n\n`);
                if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
                    res.write("data: [DONE]\n\n");
                    res.end();
                }
            } catch (_) {}
        });

        // When the browser closes, disconnects, or tab navigates away:
        // Safely detach the listener without killing the server job!
        req.on("close", () => {
            if (typeof unsubscribe === "function") {
                unsubscribe();
            }
        });

        return;
    }

    // 4. POST /api/build/agent/stop - Cancel background job
    if (req.method === "POST" && reqUrl === "/api/build/agent/stop") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const chatId = data.chatId;

            const stopped = stopAgentJob(chatId);
            return sendJSON(res, 200, { status: "stopped", success: stopped });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    res.writeHead(404);
    res.end();
}

module.exports = {
    handleBuildAgentRoute
};
