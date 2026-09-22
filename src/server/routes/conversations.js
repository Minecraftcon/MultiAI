const conversationsManager = require("../../core/conversations_manager");
const { sendJSON } = require("../utils");

async function handleConversationsRoute(req, res) {
    const reqUrl = req.url.split("?")[0];

    if (req.method === "GET" && reqUrl === "/api/chats") {
        try {
            const chats = conversationsManager.listChats();
            return sendJSON(res, 200, { success: true, chats });
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
            const data = conversationsManager.getChat(chatId);
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
            const { chatId, date } = data;
            if (!chatId) {
                return sendJSON(res, 400, { error: "Parameter 'chatId' is required." });
            }
            const workspace = conversationsManager.ensureChatWorkspace(chatId, date);
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
            const workspace = conversationsManager.saveChat(chatSession);
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
            const workspace = conversationsManager.appendChatMessage(chatId, message);
            return sendJSON(res, 200, { success: true, workspace });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    if (req.method === "DELETE" && reqUrl === "/api/chats") {
        try {
            const deleted = conversationsManager.deleteAllChats();
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
            const deleted = conversationsManager.deleteChat(chatId);
            return sendJSON(res, 200, { success: true, deleted });
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
