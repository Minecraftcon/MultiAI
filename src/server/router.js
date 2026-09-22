const { handleStatic } = require("./routes/static");
const { handleSystemInfo, handleConfig, handleModels, handleKoboldBaseUrl, handleKoboldProbe } = require("./routes/config");
const { handleMedia, handleImageGenerate, handleImageStatus } = require("./routes/media");
const { handleFilesRoute } = require("./routes/files");
const { handleTaskRoute } = require("./routes/tasks");
const { handleSearchRoute } = require("./routes/search");
const { handleDeepSearchRoute } = require("./routes/deepsearch");
const { handleChat, handleAgentStream } = require("./routes/chat");
const { handleConversationsRoute } = require("./routes/conversations");
const { sendJSON } = require("./utils");

async function routeRequest(req, res) {
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Range, Authorization, X-Chat-ID"
        });
        return res.end();
    }

    const reqUrl = req.url.split("?")[0];

    // System info & config
    if ((req.method === "GET" || req.method === "HEAD") && reqUrl === "/api/system-info") {
        return handleSystemInfo(req, res);
    }
    if (reqUrl === "/api/config") {
        return handleConfig(req, res);
    }
    if ((req.method === "GET" || req.method === "HEAD") && reqUrl === "/api/models") {
        return handleModels(req, res);
    }
    if (req.method === "GET" && reqUrl === "/api/kobold/base_url") {
        return handleKoboldBaseUrl(req, res);
    }
    if (req.method === "POST" && reqUrl === "/api/kobold/probe") {
        return handleKoboldProbe(req, res);
    }

    // Media & Image Generation
    if ((req.method === "GET" || req.method === "HEAD") && req.url.startsWith("/api/media")) {
        return handleMedia(req, res);
    }
    if (req.method === "POST" && reqUrl === "/api/image/generate") {
        return handleImageGenerate(req, res);
    }
    if (req.method === "GET" && req.url.startsWith("/api/image/status/")) {
        return handleImageStatus(req, res);
    }

    // Filesystem routes
    if (req.method === "POST" && (reqUrl.startsWith("/api/file/") || reqUrl === "/api/code/grep")) {
        return handleFilesRoute(req, res);
    }

    // Tasks & Python direct execution
    if (req.url.startsWith("/api/task/") || reqUrl === "/api/python/run") {
        return handleTaskRoute(req, res);
    }

    // Web Search & Fetch
    if (req.method === "POST" && (reqUrl === "/api/search" || reqUrl === "/api/fetch")) {
        return handleSearchRoute(req, res);
    }

    // DeepSearch
    if (req.url.startsWith("/api/deepsearch/")) {
        return handleDeepSearchRoute(req, res);
    }

    // Chat & Agent streaming
    if (req.method === "POST" && reqUrl === "/api/chat") {
        return handleChat(req, res);
    }
    if (req.method === "POST" && reqUrl === "/api/agent/stream") {
        return handleAgentStream(req, res);
    }

    // Persistent Chat & Workspace Endpoints
    if (reqUrl.startsWith("/api/chats")) {
        return handleConversationsRoute(req, res);
    }

    // Static assets
    if (req.method === "GET" || req.method === "HEAD") {
        return handleStatic(req, res);
    }

    res.writeHead(404);
    res.end("Not found");
}

module.exports = {
    routeRequest
};
