/* =========================================================
   BUILD AGENT SERVER-SENT EVENTS & DETACHED JOB ROUTER
   Handles /api/build/agent/* endpoints with safe client detach.
   ========================================================= */
const { sendJSON } = require("../utils");
const { 
    startAgentJob, 
    getAgentJob, 
    stopAgentJob, 
    subscribeAgentJob,
    answerAgentQuestion 
} = require("../../core/build_agent_runner");

async function handleBuildAgentRoute(req, res) {
    const reqUrl = req.url.split("?")[0];

    // 1. POST /api/agent/start or /api/build/agent/start - Launch background job
    if (req.method === "POST" && (reqUrl === "/api/agent/start" || reqUrl === "/api/build/agent/start")) {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const { projectId = null, chatId, userText, userContent = null, model, provider } = data;

            if (!chatId) {
                return sendJSON(res, 400, { error: "Missing required field: chatId" });
            }

            const job = startAgentJob({ projectId, chatId, userText, userContent, model, provider });
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

    // 2. GET /api/agent/status/:chatId or /api/build/agent/status/:chatId
    if (req.method === "GET" && (reqUrl.startsWith("/api/agent/status/") || reqUrl.startsWith("/api/build/agent/status/"))) {
        const chatId = decodeURIComponent(reqUrl.replace(/^\/api\/(?:build\/)?agent\/status\//, "")).trim();
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

    // 3. GET /api/agent/stream/:chatId or /api/build/agent/stream/:chatId
    if (req.method === "GET" && (reqUrl.startsWith("/api/agent/stream/") || reqUrl.startsWith("/api/build/agent/stream/"))) {
        const chatId = decodeURIComponent(reqUrl.replace(/^\/api\/(?:build\/)?agent\/stream\//, "")).trim();
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

        // Replay all events that occurred so far in this run (thoughts, tool_starts, tool_completes)
        if (Array.isArray(job.events) && job.events.length > 0) {
            for (const ev of job.events) {
                res.write(`data: ${JSON.stringify(ev)}\n\n`);
            }
        }

        // If job already concluded, finalize the stream immediately
        if (!job.isRunning) {
            res.write("data: [DONE]\n\n");
            res.end();
            return;
        }

        // If there is an active pending questionnaire waiting for human answer, emit it immediately
        if (job.pendingQuestion) {
            res.write(`data: ${JSON.stringify({ type: "question_prompt", ...job.pendingQuestion })}\n\n`);
        }

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

    // 4. POST /api/agent/stop or /api/build/agent/stop - Cancel background job
    if (req.method === "POST" && (reqUrl === "/api/agent/stop" || reqUrl === "/api/build/agent/stop")) {
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

    // 5. POST /api/agent/answer or /api/build/agent/answer - Submit human answer to pending questionnaire
    if (req.method === "POST" && (reqUrl === "/api/agent/answer" || reqUrl === "/api/build/agent/answer")) {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const { chatId, answers, status = "answered" } = data;

            if (!chatId) {
                return sendJSON(res, 400, { error: "Missing required field: chatId" });
            }

            const answered = answerAgentQuestion(chatId, {
                status: status || "answered",
                answers: Array.isArray(answers) ? answers : (answers ? [answers] : [])
            });

            return sendJSON(res, 200, { success: answered, status: answered ? "delivered" : "not_found" });
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
