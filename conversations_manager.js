// Persistent Chat & Build Workspace Manager
// Manages:
//   Chat Mode:  $HOME/.MultiAI/chat/conversations/{Date}/chats/{id}/
//   Build Mode: $HOME/.MultiAI/build/projects/{projectId}/chats/{id}/
// Storage format: meta.json + messages.jsonl with scratch/ and images/ subdirectories

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { getConfig } = require("./config_manager");

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
 */
function saveChat(chatSession) {
    if (!chatSession || !chatSession.id) {
        throw new Error("Invalid chat session object.");
    }
    const chatId = chatSession.id;
    const found = findChatDateDir(chatId);
    const dateStr = chatSession.createdAt ? formatDate(chatSession.createdAt) : (found?.dateFolder || formatDate());
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
        mode: "chat",
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

    // 2. Write messages line-by-line to messages.jsonl
    if (hasMeaningfulMessages) {
        const lines = messages.map(m => JSON.stringify(m)).join("\n");
        fs.writeFileSync(ws.messagesFile, lines + "\n", "utf8");
    } else if (!fs.existsSync(ws.messagesFile)) {
        const lines = messages.map(m => JSON.stringify(m)).join("\n");
        fs.writeFileSync(ws.messagesFile, lines ? lines + "\n" : "", "utf8");
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
    const line = JSON.stringify(message) + "\n";
    fs.appendFileSync(ws.messagesFile, line, "utf8");

    try {
        let meta = {};
        if (fs.existsSync(ws.metaFile)) {
            meta = JSON.parse(fs.readFileSync(ws.metaFile, "utf8"));
        } else {
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
        fs.writeFileSync(ws.metaFile, JSON.stringify(meta, null, 2), "utf8");
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
                            const raw = fs.readFileSync(metaPath, "utf8");
                            const meta = JSON.parse(raw);
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
                        } catch (_) {}
                    }

                    if (fs.existsSync(legacyPath)) {
                        try {
                            const raw = fs.readFileSync(legacyPath, "utf8");
                            const parsed = JSON.parse(raw);
                            parsed.mode = "chat";
                            results.push(parsed);
                            continue;
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

/* =========================================================
   BUILD MODE OPERATIONS ($HOME/.MultiAI/build/projects/)
   ========================================================= */

/**
 * Generates a clean URL/filesystem-safe ID for a project.
 */
function generateProjectId(folderPath) {
    const baseName = path.basename(folderPath).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
    const hash = crypto.createHash("md5").update(folderPath).digest("hex").slice(0, 6);
    return `${baseName}-${hash}`;
}

/**
 * Registers a chosen directory as a Build Project.
 */
function addProject(folderPath, customName = "") {
    if (!folderPath || typeof folderPath !== "string") {
        throw new Error("Folder path is required to register a project.");
    }

    const resolved = resolveHome(folderPath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Directory does not exist: ${folderPath}`);
    }
    if (!fs.statSync(resolved).isDirectory()) {
        throw new Error(`Path is not a directory: ${folderPath}`);
    }

    const projectsRoot = getBuildProjectsRoot();
    const projectId = generateProjectId(resolved);
    const projectDir = path.join(projectsRoot, projectId);
    const projectFile = path.join(projectDir, "project.json");
    const chatsDir = path.join(projectDir, "chats");

    if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true });
    }
    if (!fs.existsSync(chatsDir)) {
        fs.mkdirSync(chatsDir, { recursive: true });
    }

    let project = {};
    if (fs.existsSync(projectFile)) {
        try { project = JSON.parse(fs.readFileSync(projectFile, "utf8")); } catch (_) {}
    }

    project = {
        id: projectId,
        name: customName || project.name || path.basename(resolved) || "Project",
        rootPath: resolved,
        createdAt: project.createdAt || Date.now(),
        updatedAt: Date.now()
    };

    fs.writeFileSync(projectFile, JSON.stringify(project, null, 2), "utf8");
    return { ...project, chats: listProjectChats(projectId) };
}

/**
 * Lists all registered Build Projects and their nested chats.
 */
function listProjects() {
    const projectsRoot = getBuildProjectsRoot();
    if (!fs.existsSync(projectsRoot)) return [];

    const results = [];
    try {
        const pDirs = fs.readdirSync(projectsRoot);
        for (const pId of pDirs) {
            const pDir = path.join(projectsRoot, pId);
            if (!fs.statSync(pDir).isDirectory()) continue;

            const projectFile = path.join(pDir, "project.json");
            let project = null;
            if (fs.existsSync(projectFile)) {
                try {
                    project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
                } catch (_) {}
            }

            if (!project) {
                project = {
                    id: pId,
                    name: pId,
                    rootPath: "",
                    createdAt: fs.statSync(pDir).birthtimeMs || Date.now(),
                    updatedAt: fs.statSync(pDir).mtimeMs || Date.now()
                };
            }

            // Check if rootPath still exists on disk
            project.existsOnDisk = project.rootPath ? fs.existsSync(project.rootPath) : false;
            project.chats = listProjectChats(pId);
            results.push(project);
        }
    } catch (err) {
        console.error("[BUILD] Error listing projects:", err.message);
    }

    results.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return results;
}

/**
 * Removes a project from Build Mode (preserves user code on disk).
 */
function removeProject(projectId) {
    if (!projectId) return false;
    const projectDir = path.join(getBuildProjectsRoot(), projectId);
    try {
        if (fs.existsSync(projectDir)) {
            fs.rmSync(projectDir, { recursive: true, force: true });
            return true;
        }
    } catch (err) {
        console.error(`[BUILD] Error removing project ${projectId}:`, err.message);
    }
    return false;
}

/**
 * Sets up workspace directories for a chat inside a project.
 */
function ensureProjectChatWorkspace(projectId, chatId) {
    if (!projectId || !chatId) {
        throw new Error("Project ID and Chat ID are required.");
    }

    const projectsRoot = getBuildProjectsRoot();
    const projectDir = path.join(projectsRoot, projectId);
    const projectFile = path.join(projectDir, "project.json");
    let project = {};
    if (fs.existsSync(projectFile)) {
        try { project = JSON.parse(fs.readFileSync(projectFile, "utf8")); } catch (_) {}
    }

    const chatsDir = path.join(projectDir, "chats");
    const chatDir = path.join(chatsDir, chatId);
    const scratchDir = path.join(chatDir, "scratch");
    const imagesDir = path.join(chatDir, "images");
    const metaFile = path.join(chatDir, "meta.json");
    const messagesFile = path.join(chatDir, "messages.jsonl");

    try {
        if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    } catch (err) {
        console.error(`[BUILD] Error creating workspace for project chat ${chatId}:`, err.message);
    }

    const rootPath = project.rootPath || "";
    const workspacePrompt = [
        `[BUILD WORKSPACE - PROJECT CONTEXT]:`,
        `- Mode: State-Based Builder`,
        `- Active Project: ${project.name || projectId}`,
        `- Project Root Directory: ${rootPath}`,
        `- Conversation Scratch Directory ($SCRATCH): ${scratchDir}`,
        `- Images Directory: ${imagesDir}`,
        `- BUILD MODE GUIDELINES:`,
        `  1. You are operating directly within the user's project directory (${rootPath}).`,
        `  2. Execute tasks, modify files, and run commands relative to this project root.`,
        `  3. Use '$SCRATCH/<filename>' for temporary scratch notes or execution artifacts.`
    ].join("\n");

    return {
        projectId,
        projectName: project.name || projectId,
        projectRoot: rootPath,
        chatId,
        chatDir,
        scratchDir,
        imagesDir,
        metaFile,
        messagesFile,
        workspacePrompt
    };
}

/**
 * Lists all chats for a specific project.
 */
function listProjectChats(projectId) {
    if (!projectId) return [];
    const chatsDir = path.join(getBuildProjectsRoot(), projectId, "chats");
    if (!fs.existsSync(chatsDir)) return [];

    const results = [];
    try {
        const cDirs = fs.readdirSync(chatsDir);
        for (const cId of cDirs) {
            const targetDir = path.join(chatsDir, cId);
            if (!fs.statSync(targetDir).isDirectory()) continue;

            const metaFile = path.join(targetDir, "meta.json");
            let meta = null;
            if (fs.existsSync(metaFile)) {
                try { meta = JSON.parse(fs.readFileSync(metaFile, "utf8")); } catch (_) {}
            }

            if (!meta) {
                meta = {
                    id: cId,
                    projectId,
                    mode: "build",
                    title: "Build Task",
                    createdAt: fs.statSync(targetDir).birthtimeMs || Date.now(),
                    updatedAt: fs.statSync(targetDir).mtimeMs || Date.now()
                };
            }
            meta.projectId = projectId;
            meta.mode = "build";
            results.push(meta);
        }
    } catch (err) {
        console.error(`[BUILD] Error listing chats for project ${projectId}:`, err.message);
    }

    results.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return results;
}

/**
 * Loads a single build chat session for a project.
 */
function getProjectChat(projectId, chatId) {
    if (!projectId || !chatId) return null;
    const ws = ensureProjectChatWorkspace(projectId, chatId);

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
                projectId,
                mode: "build",
                messages
            };

            return {
                session,
                workspace: ws
            };
        } catch (e) {
            console.error(`[BUILD] Error reading project chat ${chatId}:`, e.message);
            return null;
        }
    }
    return null;
}

/**
 * Persists a build chat session into a project.
 */
function saveProjectChat(projectId, chatSession) {
    if (!projectId || !chatSession || !chatSession.id) {
        throw new Error("Project ID and valid chat session with 'id' are required.");
    }
    const chatId = chatSession.id;
    const ws = ensureProjectChatWorkspace(projectId, chatId);

    let existingMeta = {};
    if (fs.existsSync(ws.metaFile)) {
        try { existingMeta = JSON.parse(fs.readFileSync(ws.metaFile, "utf8")); } catch (_) {}
    }

    const messages = Array.isArray(chatSession.messages) ? chatSession.messages : [];
    const hasMeaningfulMessages = messages.some(m => m.role !== "system");

    const metaPayload = {
        id: chatId,
        projectId,
        mode: "build",
        title: chatSession.title || existingMeta.title || "Build Task",
        model: chatSession.model || existingMeta.model || "gemini-2.5-flash",
        createdAt: chatSession.createdAt || existingMeta.createdAt || Date.now(),
        updatedAt: chatSession.updatedAt || Date.now(),
        chatHtml: chatSession.chatHtml || existingMeta.chatHtml || "",
        workspace: {
            chatDir: ws.chatDir,
            scratchDir: ws.scratchDir,
            imagesDir: ws.imagesDir,
            projectRoot: ws.projectRoot
        },
        messageCount: hasMeaningfulMessages ? messages.length : (existingMeta.messageCount || messages.length),
        savedAt: Date.now()
    };
    fs.writeFileSync(ws.metaFile, JSON.stringify(metaPayload, null, 2), "utf8");

    if (hasMeaningfulMessages) {
        const lines = messages.map(m => JSON.stringify(m)).join("\n");
        fs.writeFileSync(ws.messagesFile, lines + "\n", "utf8");
    } else if (!fs.existsSync(ws.messagesFile)) {
        const lines = messages.map(m => JSON.stringify(m)).join("\n");
        fs.writeFileSync(ws.messagesFile, lines ? lines + "\n" : "", "utf8");
    }

    // Touch project.json timestamp so active project is updated
    try {
        const projectFile = path.join(getBuildProjectsRoot(), projectId, "project.json");
        if (fs.existsSync(projectFile)) {
            const p = JSON.parse(fs.readFileSync(projectFile, "utf8"));
            p.updatedAt = Date.now();
            fs.writeFileSync(projectFile, JSON.stringify(p, null, 2), "utf8");
        }
    } catch (_) {}

    return ws;
}

/**
 * Deletes a build chat from a project.
 */
function deleteProjectChat(projectId, chatId) {
    if (!projectId || !chatId) return false;
    const chatDir = path.join(getBuildProjectsRoot(), projectId, "chats", chatId);
    try {
        if (fs.existsSync(chatDir)) {
            fs.rmSync(chatDir, { recursive: true, force: true });
            return true;
        }
    } catch (err) {
        console.error(`[BUILD] Error deleting project chat ${chatId}:`, err.message);
    }
    return false;
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
    // Build Mode (Projects)
    addProject,
    listProjects,
    removeProject,
    ensureProjectChatWorkspace,
    listProjectChats,
    getProjectChat,
    saveProjectChat,
    deleteProjectChat
};
