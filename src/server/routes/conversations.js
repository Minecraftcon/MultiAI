const conversationsManager = require("../../core/conversations_manager");
const { sendJSON } = require("../utils");

async function handleConversationsRoute(req, res) {
    const reqUrl = req.url.split("?")[0];

    if (req.method === "GET" && reqUrl === "/api/chats") {
        try {
            const chats = await conversationsManager.listChats();
            return sendJSON(res, 200, { success: true, chats, source: "supabase" });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "GET" && reqUrl.startsWith("/api/chats/")) {
        const chatId = decodeURIComponent(reqUrl.slice("/api/chats/".length));
        if (!chatId) {
            return sendJSON(res, 400, { error: "Chat ID is required." });
        }
        try {
            const data = await conversationsManager.getChat(chatId);
            if (!data) {
                return sendJSON(res, 404, { error: `Chat '${chatId}' not found.` });
            }
            return sendJSON(res, 200, { success: true, ...data });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "POST" && reqUrl === "/api/chats/session") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const { chatId, date, projectName, workspacePath } = data;
            if (!chatId) {
                return sendJSON(res, 400, { error: "Parameter 'chatId' is required." });
            }
            const workspace = conversationsManager.ensureChatWorkspace(chatId, date, { projectName, workspacePath });
            return sendJSON(res, 200, { success: true, workspace });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "POST" && reqUrl === "/api/chats/save") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const chatSession = JSON.parse(body || "{}");
            if (!chatSession || !chatSession.id) {
                return sendJSON(res, 400, { error: "Valid chat session with 'id' is required." });
            }
            const workspace = await conversationsManager.saveChat(chatSession);
            return sendJSON(res, 200, { success: true, workspace });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "POST" && reqUrl === "/api/chats/append") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const { chatId, message } = data;
            if (!chatId || !message) {
                return sendJSON(res, 400, { error: "Parameters 'chatId' and 'message' are required." });
            }
            const workspace = await conversationsManager.appendChatMessage(chatId, message);
            return sendJSON(res, 200, { success: true, workspace });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "DELETE" && reqUrl === "/api/chats") {
        try {
            const deleted = await conversationsManager.deleteAllChats();
            return sendJSON(res, 200, { success: true, deleted });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "DELETE" && reqUrl.startsWith("/api/chats/")) {
        const chatId = decodeURIComponent(reqUrl.slice("/api/chats/".length));
        if (!chatId) {
            return sendJSON(res, 400, { error: "Chat ID is required." });
        }
        try {
            const deleted = await conversationsManager.deleteChat(chatId);
            return sendJSON(res, 200, { success: true, deleted });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "GET" && reqUrl === "/api/artifacts/list") {
        try {
            const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
            const chatId = urlObj.searchParams.get("chatId");
            if (!chatId) {
                return sendJSON(res, 400, { error: "Parameter 'chatId' is required." });
            }
            const { getChatArtifactsDir } = require("../utils");
            const artifactsDir = getChatArtifactsDir(chatId);
            const catalogPath = require("path").join(artifactsDir, "artifacts.json");
            let artifacts = [];
            if (require("fs").existsSync(catalogPath)) {
                try {
                    const catalog = JSON.parse(require("fs").readFileSync(catalogPath, "utf-8"));
                    artifacts = Array.isArray(catalog.artifacts) ? catalog.artifacts : [];
                } catch (_) {}
            }
            return sendJSON(res, 200, { success: true, artifacts });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    res.writeHead(404);
    res.end();
}

module.exports = {
    handleConversationsRoute
};
