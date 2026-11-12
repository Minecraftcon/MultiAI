// MultiAI Cloud Conversations & Workspace Manager
// Storage model: 100% Supabase Cloud Persistence (chats, messages, artifacts).
// Ephemeral scratchpad: /tmp/multiai_cloud/{scratch, artifacts, images}

const fs = require("fs");
const path = require("path");
const os = require("os");
const supabaseStorage = require("./supabase_storage");
const { createBuildProjectsManager } = require("./build_projects_manager");

function getStorageRoot() {
    const raw = process.env.STORAGE_DIR || path.join(os.tmpdir(), "multiai_cloud");
    if (!fs.existsSync(raw)) {
        try { fs.mkdirSync(raw, { recursive: true }); } catch (_) {}
    }
    return raw;
}

function getConversationsRoot() {
    const chatRoot = path.join(getStorageRoot(), "chat", "conversations");
    if (!fs.existsSync(chatRoot)) {
        try { fs.mkdirSync(chatRoot, { recursive: true }); } catch (_) {}
    }
    return chatRoot;
}

function getBuildProjectsRoot() {
    const buildRoot = path.join(getStorageRoot(), "build", "projects");
    if (!fs.existsSync(buildRoot)) {
        try { fs.mkdirSync(buildRoot, { recursive: true }); } catch (_) {}
    }
    return buildRoot;
}

function formatDate(timestamp = Date.now()) {
    const d = new Date(timestamp);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

const buildProjects = createBuildProjectsManager({
    getBuildProjectsRoot,
    formatDate
});

/**
 * Creates ephemeral scratch workspace in /tmp/multiai_cloud/chats/{id}/
 */
function ensureChatWorkspace(chatId, dateStr) {
    if (!chatId || typeof chatId !== "string") {
        throw new Error("Chat ID is required to ensure chat workspace.");
    }

    const date = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : formatDate();
    const chatDir = path.join(getStorageRoot(), "chats", chatId);
    const scratchDir = path.join(chatDir, "scratch");
    const artifactsDir = path.join(chatDir, "artifacts");
    const imagesDir = path.join(chatDir, "images");

    try {
        if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
        if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    } catch (_) {}

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
        workspacePrompt
    };
}

/**
 * Persists chat session directly to Supabase.
 */
async function saveChat(chatSession) {
    if (!chatSession || !chatSession.id) {
        throw new Error("Invalid chat session object.");
    }
    const chatId = chatSession.id;
    const ws = ensureChatWorkspace(chatId, chatSession.date);

    await supabaseStorage.saveChat({
        id: chatId,
        title: chatSession.title || "Conversation",
        type: chatSession.type || "chat",
        projectId: chatSession.projectId || null,
        date: ws.dateStr,
        createdAt: chatSession.createdAt || new Date().toISOString(),
        updatedAt: chatSession.updatedAt || new Date().toISOString(),
        meta: {
            title: chatSession.title || "Conversation",
            model: chatSession.model || "gemini-2.5-flash",
            createdAt: chatSession.createdAt || Date.now(),
            updatedAt: Date.now(),
            compactionState: chatSession.compactionState || null,
            ...(chatSession.meta || {})
        },
        messages: Array.isArray(chatSession.messages) ? chatSession.messages : []
    });

    return ws;
}

/**
 * Appends a message directly to Supabase.
 */
async function appendChatMessage(chatId, message) {
    if (!chatId || !message) {
        throw new Error("Chat ID and message object are required.");
    }
    const ws = ensureChatWorkspace(chatId);
    await supabaseStorage.appendChatMessage(chatId, message);
    return ws;
}

/**
 * Reads chat session from Supabase.
 */
async function getChat(chatId) {
    if (!chatId) return null;
    const cloudSession = await supabaseStorage.getChat(chatId);
    if (!cloudSession) return null;

    const ws = ensureChatWorkspace(chatId, cloudSession.date);
    return {
        session: cloudSession,
        workspace: ws,
        source: "supabase"
    };
}

/**
 * Lists all chats directly from Supabase.
 */
async function listChats() {
    const list = await supabaseStorage.listChats();
    return list || [];
}

/**
 * Deletes a chat from Supabase and cleans ephemeral local scratch if present.
 */
async function deleteChat(chatId) {
    if (!chatId) return false;
    const chatDir = path.join(getStorageRoot(), "chats", chatId);
    if (fs.existsSync(chatDir)) {
        try { fs.rmSync(chatDir, { recursive: true, force: true }); } catch (_) {}
    }
    return await supabaseStorage.deleteChat(chatId);
}

/**
 * Deletes all chats from Supabase.
 */
async function deleteAllChats() {
    return await supabaseStorage.deleteAllChats();
}

/**
 * Saves chat image buffer to ephemeral images dir and syncs to Supabase artifacts.
 */
async function saveChatImage(chatId, filename, buffer) {
    if (!chatId || !filename || !buffer) return null;
    const ws = ensureChatWorkspace(chatId);
    const dest = path.join(ws.imagesDir, filename);
    try {
        fs.writeFileSync(dest, buffer);
        await supabaseStorage.saveArtifact({
            chatId,
            filePath: `images/${filename}`,
            fileType: "image",
            contentBase64: buffer.toString("base64"),
            sizeBytes: buffer.length
        });
        return dest;
    } catch (err) {
        console.error(`[CONVERSATIONS] Error saving image ${filename}:`, err.message);
        return null;
    }
}

module.exports = {
    getStorageRoot,
    getConversationsRoot,
    getBuildProjectsRoot,
    formatDate,
    ensureChatWorkspace,
    saveChat,
    appendChatMessage,
    getChat,
    listChats,
    deleteChat,
    deleteAllChats,
    saveChatImage,
    supabaseStorage,
    // Build Mode delegated
    generateProjectId: buildProjects.generateProjectId,
    addProject: buildProjects.addProject,
    listProjects: buildProjects.listProjects,
    removeProject: buildProjects.removeProject,
    ensureProjectChatWorkspace: buildProjects.ensureProjectChatWorkspace,
    listProjectChats: buildProjects.listProjectChats,
    getProjectChat: buildProjects.getProjectChat,
    saveProjectChat: buildProjects.saveProjectChat,
    deleteProjectChat: buildProjects.deleteProjectChat
};
