// Persistent Chat & Build Workspace Manager
// Manages:
//   Chat Mode:  $HOME/.MultiAI/chat/conversations/{Date}/chats/{id}/
//   Build Mode: $HOME/.MultiAI/build/projects/{projectId}/chats/{id}/
// Storage format: meta.json + messages.jsonl with scratch/, artifacts/, and images/ subdirectories
// Cloud persistence: Mirrored to Supabase when configured

const fs = require("fs");
const path = require("path");
const os = require("os");
const configManager = require("./config_manager");
const {
    readJsonFile,
    writeJsonFile,
    readMessages,
    appendMessage,
    safelyWriteMessages
} = require("./jsonl_session_store");
const { createBuildProjectsManager } = require("./build_projects_manager");
const supabaseStorage = require("./supabase_storage");

let migrationDone = false;

function getUserHome() {
    return configManager.getUserHome();
}

function resolveHome(p) {
    if (!p || typeof p !== "string") return "";
    if (p.startsWith("~/") || p === "~") {
        return path.join(getUserHome(), p.slice(1));
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
    let raw = process.env.STORAGE_DIR;
    if (!raw) {
        try {
            const cfg = configManager.getConfig();
            raw = cfg?.General?.StorageDir;
        } catch (_) {}
    }
    raw = raw || "~/.MultiAI";
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

    let workdir = process.env.MULTIAI_WORKSPACE_DIR || "/tmp/workspace";
    try {
        const { getChatWorkdir } = require("../server/routes/cloud_tools");
        workdir = getChatWorkdir(chatId) || workdir;
    } catch (_) {}

    // Workspace Scratchpad (./scratch)
    const scratchDir = path.join(workdir, "scratch");
    const artifactsDir = path.join(chatDir, "artifacts");
    const imagesDir = path.join(chatDir, "images");
    const metaFile = path.join(chatDir, "meta.json");
    const messagesFile = path.join(chatDir, "messages.jsonl");
    const contextFile = path.join(chatDir, "context.json");
    const legacyChatFile = path.join(chatDir, "chat.json");

    try {
        if (!fs.existsSync(workdir)) fs.mkdirSync(workdir, { recursive: true });
        if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
        if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

        // Auto-add scratch/ to .gitignore if in a git repository
        const gitDir = path.join(workdir, ".git");
        const gitignoreFile = path.join(workdir, ".gitignore");
        if (fs.existsSync(gitDir)) {
            const ignoreContent = fs.existsSync(gitignoreFile) ? fs.readFileSync(gitignoreFile, "utf8") : "";
            if (!/^\s*scratch\/?\s*$/m.test(ignoreContent)) {
                fs.appendFileSync(gitignoreFile, (ignoreContent && !ignoreContent.endsWith("\n") ? "\n" : "") + "scratch/\n");
            }
        }
    } catch (err) {
        console.error(`[CONVERSATIONS] Error creating directories for chat ${chatId}:`, err.message);
    }

    const workspacePrompt = [
        `[WORKSPACE, SCRATCH & CLOUD PATH ARCHITECTURE]:`,
        `- Active Chat ID: ${chatId}`,
        `- Active Execution Workspace (CWD): ${workdir}`,
        `- Workspace Scratch Directory (./scratch): ${scratchDir}`,
        `- Session Artifacts Directory ($ARTIFACTS): ${artifactsDir}`,
        `- Images Directory: ${imagesDir}`,
        `- User Uploads Directory: /tmp/user/files`,
        `- CLOUD PATH GUIDELINES:`,
        `  1. WORKSPACE SCRATCHPAD (./scratch):`,
        `     - Your scratchpad lives directly in the workspace at './scratch' (also accessible via '$SCRATCH').`,
        `     - Write one-off test scripts, prototypes, temporary data, or scratch notes to './scratch/<filename>' or '$SCRATCH/<filename>'.`,
        `     - In terminal commands ('run_task'), you execute with 'pwd=${workdir}'. You can directly run 'python3 scratch/script.py' or 'ls scratch/'.`,
        `  2. PERSISTENT ARTIFACTS ($ARTIFACTS):`,
        `     - Write milestone briefs, task lists, architecture specs, or permanent documents into '$ARTIFACTS/<filename>'.`,
        `  3. USER UPLOADS:`,
        `     - Files uploaded via the cloud UI arrive in '/tmp/user/files'. Check '/tmp/user/files' directly when asked about user-uploaded documents.`,
        `  4. STORAGE DUAL-NATURE:`,
        `     - Conversation messages, turn histories, and session metadata are persistently mirrored on disk and Supabase if configured.`,
        `     - Working files, user projects, and './scratch' live directly in '${workdir}'.`,
        `  5. SERVER APPLICATION ISOLATION:`,
        `     - MultiAI server source code is isolated. Do NOT modify server files or configs unless explicitly requested.`
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

    // Mirror to Supabase if configured
    if (supabaseStorage && typeof supabaseStorage.saveChat === "function") {
        supabaseStorage.saveChat({
            id: chatId,
            title: chatSession.title || metaPayload.title,
            type: chatSession.type || "chat",
            projectId: chatSession.projectId || null,
            date: ws.dateStr,
            createdAt: chatSession.createdAt || new Date().toISOString(),
            updatedAt: chatSession.updatedAt || new Date().toISOString(),
            meta: metaPayload,
            messages
        }).catch(() => {});
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

    // Mirror to Supabase if configured
    if (supabaseStorage && typeof supabaseStorage.appendChatMessage === "function") {
        supabaseStorage.appendChatMessage(chatId, message).catch(() => {});
    }

    return ws;
}

/**
 * Loads a single chat session by ID.
 * Exclusively loads fresh from Supabase cloud storage.
 */
async function getChat(chatId) {
    if (!chatId) return null;

    // 1. Primary: Load fresh directly from Supabase Cloud
    if (supabaseStorage && typeof supabaseStorage.getChat === "function") {
        try {
            const cloudSession = await supabaseStorage.getChat(chatId);
            if (cloudSession) {
                const ws = ensureChatWorkspace(chatId, cloudSession.date);
                // Materialize chat session to local disk workspace so ./scratch & $ARTIFACTS exist for runtime
                try {
                    saveChat(cloudSession);
                } catch (_) {}
                return {
                    session: cloudSession,
                    workspace: ws,
                    source: "supabase"
                };
            }
        } catch (err) {
            console.warn(`[CONVERSATIONS] Error retrieving chat ${chatId} from Supabase:`, err.message);
        }
    }

    // 2. Offline fallback (only used if Supabase is unconfigured)
    return getChatFromDisk(chatId);
}

/**
 * Fallback to read chat from disk only when cloud storage is completely unavailable.
 */
function getChatFromDisk(chatId) {
    const found = findChatDateDir(chatId);
    if (found) {
        const ws = ensureChatWorkspace(chatId, found.dateFolder);

        if (fs.existsSync(ws.messagesFile) || fs.existsSync(ws.metaFile)) {
            try {
                const meta = readJsonFile(ws.metaFile, {});
                const messages = readMessages(ws.messagesFile);

                let compactionState = meta.compactionState || null;
                if (ws.contextFile && fs.existsSync(ws.contextFile)) {
                    compactionState = readJsonFile(ws.contextFile, null);
                }

                if (Array.isArray(messages) && messages.length > 0) {
                    return {
                        session: {
                            ...meta,
                            id: chatId,
                            messages,
                            compactionState
                        },
                        workspace: ws
                    };
                }
            } catch (e) {
                console.error(`[CONVERSATIONS] Error reading JSONL chat ${chatId}:`, e.message);
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
            }
        }
    }

    const altDir = path.join(getStorageRoot(), "chats", chatId);
    if (fs.existsSync(altDir)) {
        const metaPath = path.join(altDir, "meta.json");
        const msgPath = path.join(altDir, "messages.jsonl");
        if (fs.existsSync(metaPath) || fs.existsSync(msgPath)) {
            try {
                const meta = readJsonFile(metaPath, {});
                const messages = fs.existsSync(msgPath) ? readMessages(msgPath) : [];
                if (Array.isArray(messages) && messages.length > 0) {
                    const ws = ensureChatWorkspace(chatId);
                    return {
                        session: { ...meta, id: chatId, messages },
                        workspace: ws
                    };
                }
            } catch (_) {}
        }
    }

    if (found) {
        const ws = ensureChatWorkspace(chatId, found.dateFolder);
        const meta = readJsonFile(ws.metaFile, {});
        return {
            session: { ...meta, id: chatId, messages: [] },
            workspace: ws
        };
    }

    return null;
}

/**
 * Lists all chats.
 * Exclusively loads fresh from Supabase cloud storage.
 */
async function listChats() {
    // 1. Primary: Load fresh directly from Supabase Cloud
    if (supabaseStorage && typeof supabaseStorage.listChats === "function") {
        try {
            const cloudChats = await supabaseStorage.listChats();
            if (Array.isArray(cloudChats)) {
                cloudChats.sort((a, b) => {
                    const timeA = Number(a.updatedAt || a.createdAt) || 0;
                    const timeB = Number(b.updatedAt || b.createdAt) || 0;
                    return timeB - timeA;
                });
                return cloudChats;
            }
        } catch (err) {
            console.warn("[CONVERSATIONS] Error listing chats from Supabase:", err.message);
        }
    }

    // 2. Offline fallback (only used if Supabase credentials are not configured)
    return listChatsFromDisk();
}

/**
 * Fallback to list chats from disk only when cloud storage is completely unavailable.
 */
function listChatsFromDisk() {
    const convRoots = [
        getConversationsRoot(),
        path.join(getStorageRoot(), "conversations")
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
            console.error("[CONVERSATIONS] Error listing chats from disk:", err.message);
        }
    }

    results.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return results;
}

/**
 * Deletes a chat directory and its files.
 */
async function deleteChat(chatId) {
    let deleted = false;
    if (supabaseStorage && typeof supabaseStorage.deleteChat === "function") {
        try {
            const cloudDeleted = await supabaseStorage.deleteChat(chatId);
            if (cloudDeleted) deleted = true;
        } catch (_) {}
    }

    const diskDeleted = deleteChatFromDisk(chatId);
    if (diskDeleted) deleted = true;

    return deleted;
}

function deleteChatFromDisk(chatId) {
    let deleted = false;
    const found = findChatDateDir(chatId);
    if (found) {
        const targetChatPath = path.join(found.convRoot, found.dateFolder, "chats", chatId);
        try {
            if (fs.existsSync(targetChatPath)) {
                fs.rmSync(targetChatPath, { recursive: true, force: true });
                deleted = true;
            }
        } catch (err) {
            console.error(`[CONVERSATIONS] Error deleting disk chat ${chatId}:`, err.message);
        }
    }

    const altDir = path.join(getStorageRoot(), "chats", chatId);
    if (fs.existsSync(altDir)) {
        try {
            fs.rmSync(altDir, { recursive: true, force: true });
            deleted = true;
        } catch (_) {}
    }
    return deleted;
}

/**
 * Deletes all chats.
 */
async function deleteAllChats() {
    let deleted = false;
    if (supabaseStorage && typeof supabaseStorage.deleteAllChats === "function") {
        try {
            await supabaseStorage.deleteAllChats();
            deleted = true;
        } catch (_) {}
    }

    deleteAllChatsFromDisk();
    return deleted;
}

function deleteAllChatsFromDisk() {
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
        console.error("[CONVERSATIONS] Error deleting all chats from disk:", err.message);
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
    findProjectForChat: buildProjects.findProjectForChat,
    // Storage primitives
    safelyWriteMessages,
    readMessages,
    appendMessage
};
