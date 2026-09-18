// Persistent Chat & Workspace Manager
// Manages $HOME/.MuktiAI/conversations/{Date}/chats/{id}/
// Storage format: meta.json + messages.jsonl with scratch/ and images/ subdirectories

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
 *                                            /meta.json
 *                                            /messages.jsonl
 *                                            /scratch
 *                                            /images
 */
function ensureChatWorkspace(chatId, dateStr) {
    if (!chatId || typeof chatId !== "string") {
        throw new Error("Chat ID is required to ensure chat workspace.");
    }

    const existingDate = findChatDateDir(chatId);
    const date = existingDate || (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : formatDate());

    const convRoot = getConversationsRoot();
    const dateDir = path.join(convRoot, date);
    const chatsDir = path.join(dateDir, "chats");
    const chatDir = path.join(chatsDir, chatId);
    const scratchDir = path.join(chatDir, "scratch");
    const imagesDir = path.join(chatDir, "images");
    const metaFile = path.join(chatDir, "meta.json");
    const messagesFile = path.join(chatDir, "messages.jsonl");
    const legacyChatFile = path.join(chatDir, "chat.json");

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
        `- Scratchsheet Directory ($SCRATCH): ${scratchDir}`,
        `- Images Directory: ${imagesDir}`,
        `- SCRATCHPAD & TEMPORARY FILE GUIDELINES:`,
        `  1. You have a dedicated scratchsheet directory (${scratchDir}) for this conversation accessible via '$SCRATCH'.`,
        `  2. For non-relevant, temporary scripts, one-off test files, mock data, scratchpad notes, or benchmarks, write them using '$SCRATCH/<filename>' (or the full path ${scratchDir}/<filename>). Paths starting with '$SCRATCH/' automatically resolve to this directory.`,
        `  3. In run_task, you can directly use '$SCRATCH/<filename>' or '$SCRATCH_DIR/<filename>' in terminal commands.`,
        `  4. Regular relative paths resolve normally against the project workspace.`
    ].join("\n");

    return {
        storageRoot: getStorageRoot(),
        dateStr: date,
        chatId,
        chatDir,
        scratchDir,
        imagesDir,
        metaFile,
        messagesFile,
        chatFile: legacyChatFile,
        workspacePrompt
    };
}

/**
 * Persists chat session into meta.json and messages.jsonl.
 * Seamlessly handles full chat writes.
 */
function saveChat(chatSession) {
    if (!chatSession || !chatSession.id) {
        throw new Error("Invalid chat session object.");
    }
    const existingDate = findChatDateDir(chatId);
    const dateStr = chatSession.createdAt ? formatDate(chatSession.createdAt) : (existingDate || formatDate());
    const ws = ensureChatWorkspace(chatId, dateStr);

    let existingMeta = {};
    if (fs.existsSync(ws.metaFile)) {
        try { existingMeta = JSON.parse(fs.readFileSync(ws.metaFile, "utf8")); } catch (_) {}
    }

    const messages = Array.isArray(chatSession.messages) ? chatSession.messages : [];
    const hasMeaningfulMessages = messages.some(m => m.role !== "system");

    // 1. Write metadata to meta.json
    const metaPayload = {
        id: chatId,
        title: chatSession.title || existingMeta.title || "Conversation",
        model: chatSession.model || existingMeta.model || "gemini-2.5-flash",
        createdAt: chatSession.createdAt || existingMeta.createdAt || Date.now(),
        updatedAt: chatSession.updatedAt || Date.now(),
        chatHtml: chatSession.chatHtml || existingMeta.chatHtml || "",
        workspace: {
            chatDir: ws.chatDir,
            scratchDir: ws.scratchDir,
            imagesDir: ws.imagesDir,
            dateStr: ws.dateStr
        },
        messageCount: hasMeaningfulMessages ? messages.length : (existingMeta.messageCount || messages.length),
        savedAt: Date.now()
    };
    fs.writeFileSync(ws.metaFile, JSON.stringify(metaPayload, null, 2), "utf8");

    // 2. Write messages line-by-line to messages.jsonl ONLY if meaningful messages were provided,
    // OR if messages.jsonl does not exist yet. NEVER erase existing messages with an empty payload!
    if (hasMeaningfulMessages) {
        const lines = messages.map(m => JSON.stringify(m)).join("\n");
        fs.writeFileSync(ws.messagesFile, lines + "\n", "utf8");
    } else if (!fs.existsSync(ws.messagesFile)) {
        const lines = messages.map(m => JSON.stringify(m)).join("\n");
        fs.writeFileSync(ws.messagesFile, lines ? lines + "\n" : "", "utf8");
    }

    // Clean up legacy chat.json if migrated
    if (fs.existsSync(ws.chatFile)) {
        try { fs.unlinkSync(ws.chatFile); } catch (_) {}
    }

    return ws;
}

/**
 * Appends a single message to messages.jsonl (O(1) append-only write).
 */
function appendChatMessage(chatId, message) {
    if (!chatId || !message) {
        throw new Error("Chat ID and message object are required.");
    }
    const ws = ensureChatWorkspace(chatId);
    
    // Append JSON line
    const line = JSON.stringify(message) + "\n";
    fs.appendFileSync(ws.messagesFile, line, "utf8");

    // Update meta.json timestamp and count
    try {
        let meta = {};
        if (fs.existsSync(ws.metaFile)) {
            meta = JSON.parse(fs.readFileSync(ws.metaFile, "utf8"));
        } else {
            meta = {
                id: chatId,
                title: "Conversation",
                createdAt: Date.now(),
                workspace: {
                    chatDir: ws.chatDir,
                    scratchDir: ws.scratchDir,
                    imagesDir: ws.imagesDir,
                    dateStr: ws.dateStr
                }
            };
        }
        meta.updatedAt = Date.now();
        meta.messageCount = (meta.messageCount || 0) + 1;
        fs.writeFileSync(ws.metaFile, JSON.stringify(meta, null, 2), "utf8");
    } catch (e) {
        console.warn(`[CONVERSATIONS] Could not update meta.json on append for ${chatId}:`, e.message);
    }

    return ws;
}

/**
 * Loads a single chat session by ID.
 * Reads meta.json and parses messages.jsonl line-by-line.
 * Backward-compatible with legacy chat.json.
 */
function getChat(chatId) {
    const existingDate = findChatDateDir(chatId);
    if (!existingDate) return null;

    const ws = ensureChatWorkspace(chatId, existingDate);

    // 1. Check for modern JSONL storage
    if (fs.existsSync(ws.messagesFile) || fs.existsSync(ws.metaFile)) {
        try {
            let meta = {};
            if (fs.existsSync(ws.metaFile)) {
                meta = JSON.parse(fs.readFileSync(ws.metaFile, "utf8"));
            }

            let messages = [];
            if (fs.existsSync(ws.messagesFile)) {
                const raw = fs.readFileSync(ws.messagesFile, "utf8");
                messages = raw
                    .split("\n")
                    .map(l => l.trim())
                    .filter(Boolean)
                    .map(l => {
                        try { return JSON.parse(l); } catch (_) { return null; }
                    })
                    .filter(Boolean);
            }

            const session = {
                ...meta,
                id: chatId,
                messages
            };

            return {
                session,
                workspace: ws
            };
        } catch (e) {
            console.error(`[CONVERSATIONS] Error reading JSONL chat ${chatId}:`, e.message);
            return null;
        }
    }

    // 2. Fallback to legacy chat.json & auto-migrate to JSONL
    if (fs.existsSync(ws.chatFile)) {
        try {
            const raw = fs.readFileSync(ws.chatFile, "utf8");
            const session = JSON.parse(raw);
            // Auto-migrate to JSONL
            saveChat(session);
            return {
                session,
                workspace: ws
            };
        } catch (e) {
            console.error(`[CONVERSATIONS] Error reading legacy chat ${chatId}:`, e.message);
            return null;
        }
    }

    return null;
}

/**
 * Lists all chats across all date directories.
 * Reads lightweight meta.json (O(1) per chat without reading full messages history).
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

                const metaPath = path.join(targetDir, "meta.json");
                const legacyPath = path.join(targetDir, "chat.json");

                if (fs.existsSync(metaPath)) {
                    try {
                        const raw = fs.readFileSync(metaPath, "utf8");
                        const meta = JSON.parse(raw);
                        const msgFile = path.join(targetDir, "messages.jsonl");
                        if (fs.existsSync(msgFile) && (meta.messageCount === undefined || meta.messageCount === null)) {
                            try {
                                const lines = fs.readFileSync(msgFile, "utf8").split("\n").map(l => l.trim()).filter(Boolean);
                                meta.messageCount = lines.length;
                            } catch (_) {}
                        }
                        results.push(meta);
                        continue;
                    } catch (_) {}
                }

                if (fs.existsSync(legacyPath)) {
                    try {
                        const raw = fs.readFileSync(legacyPath, "utf8");
                        const parsed = JSON.parse(raw);
                        results.push(parsed);
                        continue;
                    } catch (_) {}
                }

                // Stub if folder exists without meta/json yet
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
 * Deletes all chats from disk under $HOME/.MuktiAI/conversations/
 */
function deleteAllChats() {
    const convRoot = getConversationsRoot();
    if (!fs.existsSync(convRoot)) return true;

    try {
        const dates = fs.readdirSync(convRoot);
        for (const dateFolder of dates) {
            const datePath = path.join(convRoot, dateFolder);
            if (fs.existsSync(datePath) && fs.statSync(datePath).isDirectory()) {
                fs.rmSync(datePath, { recursive: true, force: true });
            }
        }
        return true;
    } catch (err) {
        console.error("[CONVERSATIONS] Error deleting all chats:", err.message);
        return false;
    }
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
    appendChatMessage,
    getChat,
    listChats,
    deleteChat,
    deleteAllChats,
    saveChatImage
};
