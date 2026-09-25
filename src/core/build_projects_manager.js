// Build Mode Projects Manager
// Handles Build Mode project registrations and project-scoped chats under $HOME/.MultiAI/build/projects/

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
    readJsonFile,
    writeJsonFile,
    readMessages,
    safelyWriteMessages
} = require("./jsonl_session_store");

/**
 * Creates BuildProjectsManager bound to storage resolution helpers.
 */
function createBuildProjectsManager(getBuildProjectsRoot, resolveHome) {
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

        const existingProject = readJsonFile(projectFile, {});
        const project = {
            id: projectId,
            name: customName || existingProject.name || path.basename(resolved) || "Project",
            rootPath: resolved,
            createdAt: existingProject.createdAt || Date.now(),
            updatedAt: Date.now()
        };

        writeJsonFile(projectFile, project);
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
                let project = readJsonFile(projectFile, null);

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
        const project = readJsonFile(projectFile, {});

        const chatsDir = path.join(projectDir, "chats");
        const chatDir = path.join(chatsDir, chatId);
        const scratchDir = path.join(chatDir, "scratch");
        const artifactsDir = path.join(chatDir, "artifacts");
        const imagesDir = path.join(chatDir, "images");
        const metaFile = path.join(chatDir, "meta.json");
        const messagesFile = path.join(chatDir, "messages.jsonl");

        try {
            if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
            if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
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
            `- Conversation Artifacts Directory ($ARTIFACTS): ${artifactsDir}`,
            `- Images Directory: ${imagesDir}`,
            `- BUILD MODE GUIDELINES:`,
            `  1. You are operating directly within the user's project directory (${rootPath}).`,
            `  2. Execute tasks, modify files, and run commands relative to this project root.`,
            `  3. Use '$SCRATCH/<filename>' for temporary scratch notes or one-off tests.`,
            `  4. Use '$ARTIFACTS/<filename>' for persistent milestone archives and state snapshots.`
        ].join("\n");

        return {
            projectId,
            projectName: project.name || projectId,
            projectRoot: rootPath,
            chatId,
            chatDir,
            scratchDir,
            artifactsDir,
            imagesDir,
            metaFile,
            messagesFile,
            contextFile: path.join(chatDir, "context.json"),
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
                let meta = readJsonFile(metaFile, null);

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
                const meta = readJsonFile(ws.metaFile, {});
                const messages = readMessages(ws.messagesFile);
                let compactionState = meta.compactionState || null;
                if (ws.contextFile && fs.existsSync(ws.contextFile)) {
                    compactionState = readJsonFile(ws.contextFile, null);
                }

                const session = {
                    ...meta,
                    id: chatId,
                    projectId,
                    mode: "build",
                    messages,
                    compactionState
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

        const existingMeta = readJsonFile(ws.metaFile, {});
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
            compactionState: chatSession.compactionState || existingMeta.compactionState || null,
            workspace: {
                chatDir: ws.chatDir,
                scratchDir: ws.scratchDir,
                imagesDir: ws.imagesDir,
                projectRoot: ws.projectRoot
            },
            messageCount: hasMeaningfulMessages ? messages.length : (existingMeta.messageCount || messages.length),
            savedAt: Date.now()
        };

        const actualMsgCount = safelyWriteMessages(ws.messagesFile, messages, hasMeaningfulMessages);
        metaPayload.messageCount = Math.max(actualMsgCount || 0, existingMeta.messageCount || 0, messages.length);
        writeJsonFile(ws.metaFile, metaPayload);

        if (chatSession.compactionState) {
            try {
                writeJsonFile(ws.contextFile, chatSession.compactionState);
            } catch (_) {}
        }

        // Touch project.json timestamp so active project is updated
        try {
            const projectFile = path.join(getBuildProjectsRoot(), projectId, "project.json");
            const p = readJsonFile(projectFile, null);
            if (p) {
                p.updatedAt = Date.now();
                writeJsonFile(projectFile, p);
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

    return {
        generateProjectId,
        addProject,
        listProjects,
        removeProject,
        ensureProjectChatWorkspace,
        listProjectChats,
        getProjectChat,
        saveProjectChat,
        deleteProjectChat
    };
}

module.exports = {
    createBuildProjectsManager
};
