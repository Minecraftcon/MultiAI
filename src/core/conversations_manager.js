// Persistent Chat & Build Workspace Manager
// Manages:
//   Chat Mode:  $HOME/.MultiAI/chat/conversations/{Date}/chats/{id}/
//   Build Mode: $HOME/.MultiAI/build/projects/{projectId}/chats/{id}/
// Storage format: meta.json + messages.jsonl with scratch/, artifacts/, and images/ subdirectories

const fs = require("fs");
const path = require("path");
const os = require("os");
const { getConfig } = require("./config_manager");
const {
    readJsonFile,
    writeJsonFile,
    readMessages,
    appendMessage,
    safelyWriteMessages
} = require("./jsonl_session_store");
const { createBuildProjectsManager } = require("./build_projects_manager");

let migrationDone = false;

function resolveHome(p) {
    if (!p || typeof p !== "string") return "";
    if (p.startsWith("~/") || p === "~") {
        return path.join(os.homedir(), p.slice(1));
    }
    return path.resolve(p);
}

/**
 * Safely migrates legacy ~/.MuktiAI to ~/.MultiAI/chat/conversations/
 */
function checkAndMigrateLegacyStorage() {
    if (migrationDone) return;
    migrationDone = true;

    try {
        const legacyDir = resolveHome("~/.MuktiAI");
        const newDir = resolveHome("~/.MultiAI");

        if (fs.existsSync(legacyDir)) {
            const legacyConv = path.join(legacyDir, "conversations");
            const newChatConv = path.join(newDir, "chat", "conversations");

            if (fs.existsSync(legacyConv)) {
                if (!fs.existsSync(newChatConv)) {
                    fs.mkdirSync(newChatConv, { recursive: true });
                }
                const items = fs.readdirSync(legacyConv);
                for (const item of items) {
                    const src = path.join(legacyConv, item);
                    const dest = path.join(newChatConv, item);
                    if (!fs.existsSync(dest)) {
                        fs.cpSync(src, dest, { recursive: true });
                        console.log(`[CONVERSATIONS] Migrated legacy ${item} to ${dest}`);
                    }
                }
            }
        }
    } catch (err) {
        console.warn("[CONVERSATIONS] Legacy migration warning:", err.message);
    }
}

function getStorageRoot() {
    checkAndMigrateLegacyStorage();
    const cfg = getConfig();
    const raw = cfg.General?.StorageDir || "~/.MultiAI";
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

/**
 * Storage root for Chat Mode conversations ($HOME/.MultiAI/chat/conversations/)
 */
function getConversationsRoot() {
    const chatRoot = path.join(getStorageRoot(), "chat", "conversations");
    try {
        if (!fs.existsSync(chatRoot)) {
            fs.mkdirSync(chatRoot, { recursive: true });
        }
    } catch (_) {}
    return chatRoot;
}

/**
 * Storage root for Build Mode projects ($HOME/.MultiAI/build/projects/)
 */
function getBuildProjectsRoot() {
    const buildRoot = path.join(getStorageRoot(), "build", "projects");
    try {
        if (!fs.existsSync(buildRoot)) {
            fs.mkdirSync(buildRoot, { recursive: true });
        }
    } catch (_) {}
    return buildRoot;
}

function formatDate(timestamp = Date.now()) {
    const d = new Date(timestamp);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

// Instantiate Build Projects Manager bound to storage resolvers
const buildProjects = createBuildProjectsManager(getBuildProjectsRoot, resolveHome);

/* =========================================================
   CHAT MODE OPERATIONS ($HOME/.MultiAI/chat/conversations/)
   ========================================================= */

/**
 * Searches across date directories to find where an existing chatId is stored.
 */
function findChatDateDir(chatId) {
    if (!chatId) return null;
    const convRoots = [
        getConversationsRoot(),
        path.join(getStorageRoot(), "conversations"), // fallback for intermediate runs
        path.join(resolveHome("~/.MuktiAI"), "conversations") // legacy fallback
    ];

    for (const convRoot of convRoots) {
        if (!fs.existsSync(convRoot)) continue;
        try {
            const dates = fs.readdirSync(convRoot);
            for (const dateFolder of dates) {
                const datePath = path.join(convRoot, dateFolder);
                if (!fs.statSync(datePath).isDirectory()) continue;

                const chatsPath = path.join(datePath, "chats");
                if (!fs.existsSync(chatsPath)) continue;

                const targetChatPath = path.join(chatsPath, chatId);
                if (fs.existsSync(targetChatPath) && fs.statSync(targetChatPath).isDirectory()) {
                    return { dateFolder, convRoot };
                }
            }
        } catch (e) {
            console.warn("[CONVERSATIONS] Error searching date directories:", e.message);
        }
    }
    return null;
}

/**
 * Auto-creates the required hierarchy:
 * $HOME/.MultiAI/chat/conversations/{Date}/chats/{id}/
 *                                             /meta.json
 *                                             /messages.jsonl
 *                                             /scratch
 *                                             /artifacts
 *                                             /images
 */
function ensureChatWorkspace(chatId, dateStr) {
    if (!chatId || typeof chatId !== "string") {
        throw new Error("Chat ID is required to ensure chat workspace.");
    }

    const found = findChatDateDir(chatId);
    const date = found ? found.dateFolder : (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : formatDate());
    const convRoot = found ? found.convRoot : getConversationsRoot();

    const dateDir = path.join(convRoot, date);
    const chatsDir = path.join(dateDir, "chats");
    const chatDir = path.join(chatsDir, chatId);
    const scratchDir = path.join(chatDir, "scratch");
    const artifactsDir = path.join(chatDir, "artifacts");
    const imagesDir = path.join(chatDir, "images");
    const metaFile = path.join(chatDir, "meta.json");
    const messagesFile = path.join(chatDir, "messages.jsonl");
    const contextFile = path.join(chatDir, "context.json");
    const legacyChatFile = path.join(chatDir, "chat.json");

    try {
        if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
        if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    } catch (err) {
        console.error(`[CONVERSATIONS] Error creating directories for chat ${chatId}:`, err.message);
    }

    const workspacePrompt = [
        `[SCRATCHPAD, ARTIFACTS & WORKSPACE]:`,
        `- Active Chat ID: ${chatId}`,
        `- Conversation Root: ${chatDir}`,
        `- Scratch Directory ($SCRATCH): ${scratchDir}`,
        `- Artifacts Directory ($ARTIFACTS): ${artifactsDir}`,
        `- Images Directory: ${imagesDir}`,
        `- STORAGE & WORKSPACE GUIDELINES:`,
        `  1. You have a dedicated scratch directory (${scratchDir}) accessible via '$SCRATCH/<filename>' for temporary test scripts, scratch notes, working logs, or one-off benchmarks.`,
        `  2. You have a dedicated artifacts directory (${artifactsDir}) accessible via '$ARTIFACTS/<filename>' for persistent milestone archives, architecture briefs, and state snapshots.`,
        `  3. In run_task, you can directly reference '$SCRATCH' or '$ARTIFACTS' (or '$SCRATCH_DIR', '$ARTIFACTS_DIR') in terminal commands.`,
        `  4. Regular relative paths resolve normally against the project workspace.`
    ].join("\n");

    return {
        storageRoot: getStorageRoot(),
        dateStr: date,
        chatId,
        chatDir,
        scratchDir,
        artifactsDir,
        imagesDir,
        metaFile,
        messagesFile,
        contextFile,
        chatFile: legacyChatFile,
        workspacePrompt
    };
}

/**
 * Persists chat session into meta.json and messages.jsonl.
 */
function saveChat(chatSession) {
    if (!chatSession || !chatSession.id) {
        throw new Error("Invalid chat session object.");
    }
    const chatId = chatSession.id;
    const found = findChatDateDir(chatId);
    const dateStr = chatSession.createdAt ? formatDate(chatSession.createdAt) : (found?.dateFolder || formatDate());
    const ws = ensureChatWorkspace(chatId, dateStr);

    const existingMeta = readJsonFile(ws.metaFile, {});
    const messages = Array.isArray(chatSession.messages) ? chatSession.messages : [];
    const hasMeaningfulMessages = messages.some(m => m.role !== "system");

    // 1. Safely write messages without truncating existing disk history
    const actualMsgCount = safelyWriteMessages(ws.messagesFile, messages, hasMeaningfulMessages);

    // 2. Write metadata to meta.json
    const metaPayload = {
        id: chatId,
        mode: "chat",
        title: chatSession.title || existingMeta.title || "Conversation",
        model: chatSession.model || existingMeta.model || "gemini-2.5-flash",
        createdAt: chatSession.createdAt || existingMeta.createdAt || Date.now(),
        updatedAt: chatSession.updatedAt || Date.now(),
        chatHtml: chatSession.chatHtml || existingMeta.chatHtml || "",
        compactionState: chatSession.compactionState || existingMeta.compactionState || null,
        workspace: {
            chatDir: ws.chatDir,
            scratchDir: ws.scratchDir,
            imagesDir: ws.imagesDir,
            dateStr: ws.dateStr
        },
        messageCount: Math.max(actualMsgCount || 0, existingMeta.messageCount || 0, messages.length),
        savedAt: Date.now()
    };
    writeJsonFile(ws.metaFile, metaPayload);

    // 3. Persist separate compaction context state to context.json
    if (chatSession.compactionState) {
        try {
            writeJsonFile(ws.contextFile, chatSession.compactionState);
        } catch (_) {}
    }

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
    appendMessage(ws.messagesFile, message);

    try {
        let meta = readJsonFile(ws.metaFile, null);
        if (!meta) {
            meta = {
                id: chatId,
                mode: "chat",
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
        writeJsonFile(ws.metaFile, meta);
    } catch (e) {
        console.warn(`[CONVERSATIONS] Could not update meta.json on append for ${chatId}:`, e.message);
    }

    return ws;
}

/**
 * Loads a single chat session by ID.
 */
function getChat(chatId) {
    const found = findChatDateDir(chatId);
    if (!found) return null;

    const ws = ensureChatWorkspace(chatId, found.dateFolder);

    if (fs.existsSync(ws.messagesFile) || fs.existsSync(ws.metaFile)) {
        try {
            const meta = readJsonFile(ws.metaFile, {});
            const messages = readMessages(ws.messagesFile);

            let compactionState = meta.compactionState || null;
            if (ws.contextFile && fs.existsSync(ws.contextFile)) {
                compactionState = readJsonFile(ws.contextFile, null);
            }

            const session = {
                ...meta,
                id: chatId,
                messages,
                compactionState
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

    if (fs.existsSync(ws.chatFile)) {
        try {
            const raw = fs.readFileSync(ws.chatFile, "utf8");
            const session = JSON.parse(raw);
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
 * Lists all chats across all date directories for Chat mode.
 */
function listChats() {
    const convRoots = [
        getConversationsRoot(),
        path.join(getStorageRoot(), "conversations") // include legacy if present
    ];

    const results = [];
    const seenIds = new Set();

    for (const convRoot of convRoots) {
        if (!fs.existsSync(convRoot)) continue;
        try {
            const dateFolders = fs.readdirSync(convRoot);
            for (const dateFolder of dateFolders) {
                const datePath = path.join(convRoot, dateFolder);
                if (!fs.statSync(datePath).isDirectory()) continue;

                const chatsPath = path.join(datePath, "chats");
                if (!fs.existsSync(chatsPath) || !fs.statSync(chatsPath).isDirectory()) continue;

                const chatDirs = fs.readdirSync(chatsPath);
                for (const cId of chatDirs) {
                    if (seenIds.has(cId)) continue;
                    seenIds.add(cId);

                    const targetDir = path.join(chatsPath, cId);
                    if (!fs.statSync(targetDir).isDirectory()) continue;

                    const metaPath = path.join(targetDir, "meta.json");
                    const legacyPath = path.join(targetDir, "chat.json");

                    if (fs.existsSync(metaPath)) {
                        try {
                            const meta = readJsonFile(metaPath, null);
                            if (meta) {
                                meta.mode = "chat";
                                const msgFile = path.join(targetDir, "messages.jsonl");
                                if (fs.existsSync(msgFile) && (meta.messageCount === undefined || meta.messageCount === null)) {
                                    try {
                                        const lines = fs.readFileSync(msgFile, "utf8").split("\n").map(l => l.trim()).filter(Boolean);
                                        meta.messageCount = lines.length;
                                    } catch (_) {}
                                }
                                results.push(meta);
                                continue;
                            }
                        } catch (_) {}
                    }

                    if (fs.existsSync(legacyPath)) {
                        try {
                            const parsed = readJsonFile(legacyPath, null);
                            if (parsed) {
                                parsed.mode = "chat";
                                results.push(parsed);
                                continue;
                            }
                        } catch (_) {}
                    }

                    results.push({
                        id: cId,
                        mode: "chat",
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
    }

    results.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return results;
}

/**
 * Deletes a chat directory and its files.
 */
function deleteChat(chatId) {
    const found = findChatDateDir(chatId);
    if (!found) return false;

    const targetChatPath = path.join(found.convRoot, found.dateFolder, "chats", chatId);
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
 * Deletes all chats from disk under $HOME/.MultiAI/chat/conversations/
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
    resolveHome,
    getStorageRoot,
    getConversationsRoot,
    getBuildProjectsRoot,
    formatDate,
    // Chat Mode
    ensureChatWorkspace,
    saveChat,
    appendChatMessage,
    getChat,
    listChats,
    deleteChat,
    deleteAllChats,
    saveChatImage,
    // Build Mode (delegated to build_projects_manager)
    generateProjectId: buildProjects.generateProjectId,
    addProject: buildProjects.addProject,
    listProjects: buildProjects.listProjects,
    removeProject: buildProjects.removeProject,
    ensureProjectChatWorkspace: buildProjects.ensureProjectChatWorkspace,
    listProjectChats: buildProjects.listProjectChats,
    getProjectChat: buildProjects.getProjectChat,
    saveProjectChat: buildProjects.saveProjectChat,
    deleteProjectChat: buildProjects.deleteProjectChat,
    // Storage primitives
    safelyWriteMessages,
    readMessages,
    appendMessage
};
