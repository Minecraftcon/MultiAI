// Persistent Chat & Workspace Manager
// Manages $HOME/.MuktiAI/conversations/{Date}/chats/{id}/ with scratch and images subdirectories

const fs = require("fs");
const path = require("path");
const os = require("os");
const { getConfig } = require("./config_manager");

function resolveHome(p) {
    if (!p || typeof p !== "string") return "";
    if (p.startsWith("~/") || p === "~") {
        return path.join(os.homedir(), p.slice(1));
    }
    return path.resolve(p);
}

function getStorageRoot() {
    const cfg = getConfig();
    const raw = cfg.General?.StorageDir || "~/.MuktiAI";
    const resolved = resolveHome(raw);
    try {
        if (!fs.existsSync(resolved)) {
            fs.mkdirSync(resolved, { recursive: true });
        }
    } catch (err) {
        console.warn(`[CONVERSATIONS] Could not create storage root ${resolved}:`, err.message);
    }
    return resolved;
}

function getConversationsRoot() {
    const root = path.join(getStorageRoot(), "conversations");
    try {
        if (!fs.existsSync(root)) {
            fs.mkdirSync(root, { recursive: true });
        }
    } catch (_) {}
    return root;
}

function formatDate(timestamp = Date.now()) {
    const d = new Date(timestamp);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Searches across date directories to find where an existing chatId is stored.
 */
function findChatDateDir(chatId) {
    if (!chatId) return null;
    const convRoot = getConversationsRoot();
    if (!fs.existsSync(convRoot)) return null;

    try {
        const dates = fs.readdirSync(convRoot);
        for (const dateFolder of dates) {
            const datePath = path.join(convRoot, dateFolder);
            if (!fs.statSync(datePath).isDirectory()) continue;

            const chatsPath = path.join(datePath, "chats");
            if (!fs.existsSync(chatsPath)) continue;

            const targetChatPath = path.join(chatsPath, chatId);
            if (fs.existsSync(targetChatPath) && fs.statSync(targetChatPath).isDirectory()) {
                return dateFolder;
            }
        }
    } catch (e) {
        console.warn("[CONVERSATIONS] Error searching date directories:", e.message);
    }
    return null;
}

/**
 * Auto-creates the required hierarchy:
 * $HOME/.MuktiAI/conversations/{Date}/chats/{id}/
 *                                            /scratch
 *                                            /images
 */
function ensureChatWorkspace(chatId, dateStr) {
    if (!chatId || typeof chatId !== "string") {
        throw new Error("Chat ID is required to ensure chat workspace.");
    }

    // Use existing date folder if chat already exists on disk, otherwise provided or today
    const existingDate = findChatDateDir(chatId);
    const date = existingDate || (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : formatDate());

    const convRoot = getConversationsRoot();
    const dateDir = path.join(convRoot, date);
    const chatsDir = path.join(dateDir, "chats");
    const chatDir = path.join(chatsDir, chatId);
    const scratchDir = path.join(chatDir, "scratch");
    const imagesDir = path.join(chatDir, "images");
    const chatFile = path.join(chatDir, "chat.json");

    try {
        if (!fs.existsSync(scratchDir)) {
            fs.mkdirSync(scratchDir, { recursive: true });
        }
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }
    } catch (err) {
        console.error(`[CONVERSATIONS] Error creating directories for chat ${chatId}:`, err.message);
    }

    const workspacePrompt = [
        `[SCRATCHPAD & CONVERSATION WORKSPACE]:`,
        `- Active Chat ID: ${chatId}`,
        `- Conversation Root: ${chatDir}`,
        `- Scratchsheet Directory: ${scratchDir}`,
        `- Images Directory: ${imagesDir}`,
        `- Scratchpad Instructions: You have a dedicated scratchsheet directory (${scratchDir}) for this conversation. Always use it when writing temporary scripts, data files, analysis notes, code snippets, or intermediate tool outputs.`
    ].join("\n");

    return {
        storageRoot: getStorageRoot(),
        dateStr: date,
        chatId,
        chatDir,
        scratchDir,
        imagesDir,
        chatFile,
        workspacePrompt
    };
}

/**
 * Persists a full chat session object to {chatDir}/chat.json
 */
function saveChat(chatSession) {
    if (!chatSession || !chatSession.id) {
        throw new Error("Invalid chat session object.");
    }
    const chatId = chatSession.id;
    const dateStr = chatSession.createdAt ? formatDate(chatSession.createdAt) : formatDate();
    const ws = ensureChatWorkspace(chatId, dateStr);

    const payload = {
        ...chatSession,
        workspace: {
            chatDir: ws.chatDir,
            scratchDir: ws.scratchDir,
            imagesDir: ws.imagesDir,
            dateStr: ws.dateStr
        },
        savedAt: Date.now()
    };

    fs.writeFileSync(ws.chatFile, JSON.stringify(payload, null, 2), "utf8");
    return ws;
}

/**
 * Loads a single chat session by ID.
 */
function getChat(chatId) {
    const existingDate = findChatDateDir(chatId);
    if (!existingDate) return null;

    const ws = ensureChatWorkspace(chatId, existingDate);
    if (!fs.existsSync(ws.chatFile)) return null;

    try {
        const raw = fs.readFileSync(ws.chatFile, "utf8");
        const session = JSON.parse(raw);
        return {
            session,
            workspace: ws
        };
    } catch (e) {
        console.error(`[CONVERSATIONS] Error reading chat ${chatId}:`, e.message);
        return null;
    }
}

/**
 * Lists all chats across all date directories.
 */
function listChats() {
    const convRoot = getConversationsRoot();
    if (!fs.existsSync(convRoot)) return [];

    const results = [];
    try {
        const dateFolders = fs.readdirSync(convRoot);
        for (const dateFolder of dateFolders) {
            const datePath = path.join(convRoot, dateFolder);
            if (!fs.statSync(datePath).isDirectory()) continue;

            const chatsPath = path.join(datePath, "chats");
            if (!fs.existsSync(chatsPath) || !fs.statSync(chatsPath).isDirectory()) continue;

            const chatDirs = fs.readdirSync(chatsPath);
            for (const cId of chatDirs) {
                const targetDir = path.join(chatsPath, cId);
                if (!fs.statSync(targetDir).isDirectory()) continue;

                const jsonPath = path.join(targetDir, "chat.json");
                if (fs.existsSync(jsonPath)) {
                    try {
                        const raw = fs.readFileSync(jsonPath, "utf8");
                        const parsed = JSON.parse(raw);
                        results.push(parsed);
                    } catch (_) {}
                } else {
                    // Minimal stub if folder exists without chat.json yet
                    results.push({
                        id: cId,
                        title: "Conversation",
                        createdAt: fs.statSync(targetDir).birthtimeMs || Date.now(),
                        updatedAt: fs.statSync(targetDir).mtimeMs || Date.now(),
                        workspace: {
                            chatDir: targetDir,
                            scratchDir: path.join(targetDir, "scratch"),
                            imagesDir: path.join(targetDir, "images"),
                            dateStr: dateFolder
                        }
                    });
                }
            }
        }
    } catch (err) {
        console.error("[CONVERSATIONS] Error listing chats:", err.message);
    }

    // Sort newest updated first
    results.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return results;
}

/**
 * Deletes a chat directory and its files.
 */
function deleteChat(chatId) {
    const existingDate = findChatDateDir(chatId);
    if (!existingDate) return false;

    const convRoot = getConversationsRoot();
    const targetChatPath = path.join(convRoot, existingDate, "chats", chatId);

    try {
        if (fs.existsSync(targetChatPath)) {
            fs.rmSync(targetChatPath, { recursive: true, force: true });
            return true;
        }
    } catch (err) {
        console.error(`[CONVERSATIONS] Error deleting chat ${chatId}:`, err.message);
    }
    return false;
}

/**
 * Saves or copies an image buffer to the chat's images directory.
 */
function saveChatImage(chatId, filename, buffer) {
    if (!chatId || !filename || !buffer) return null;
    const ws = ensureChatWorkspace(chatId);
    const dest = path.join(ws.imagesDir, filename);
    try {
        fs.writeFileSync(dest, buffer);
        return dest;
    } catch (err) {
        console.error(`[CONVERSATIONS] Error saving image to chat ${chatId}:`, err.message);
        return null;
    }
}

module.exports = {
    getStorageRoot,
    getConversationsRoot,
    formatDate,
    ensureChatWorkspace,
    saveChat,
    getChat,
    listChats,
    deleteChat,
    saveChatImage
};
