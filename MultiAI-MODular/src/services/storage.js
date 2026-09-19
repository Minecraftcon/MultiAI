/* =========================================================
   LOCAL STORAGE & DISK CONVERSATION PERSISTENCE
   Manages $HOME/.MuktiAI/conversations/{Date}/chats/{id}/
   ========================================================= */
import { CHATS_STORAGE_KEY, ACTIVE_CHAT_KEY } from "../config.js";
import { state } from "../state.js";
import { syncActiveWorkspacePrompt } from "./system.js";

/**
 * Initializes/ensures the disk workspace for a chat session:
 * $HOME/.MuktiAI/conversations/{Date}/chats/{id}/
 *                                            /scratch
 *                                            /images
 */
export async function initChatWorkspace(chatId, createdAt) {
    if (!chatId) return null;
    let dateStr = null;
    if (createdAt) {
        const d = new Date(createdAt);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        dateStr = `${yyyy}-${mm}-${dd}`;
    }

    try {
        const res = await fetch("/api/chats/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, date: dateStr })
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.workspace) {
            if (state.chatSessions[chatId]) {
                state.chatSessions[chatId].workspace = data.workspace;
            }
            if (state.currentChatId === chatId) {
                syncActiveWorkspacePrompt(data.workspace);
            }
            return data.workspace;
        }
    } catch (e) {
        console.warn("[STORAGE] Could not initialize chat workspace on disk:", e.message);
    }
    return null;
}

export function loadStoredChats() {
    try {
        const raw = localStorage.getItem(CHATS_STORAGE_KEY);
        state.chatSessions = raw ? JSON.parse(raw) : {};
        for (const id in state.chatSessions) {
            const s = state.chatSessions[id];
            if (s && typeof s.chatHtml === "string" && s.chatHtml.includes("user-msg-actions")) {
                s.chatHtml = s.chatHtml.replace(/<div class="user-msg-actions">[\s\S]*?<\/div>/g, "");
            }
        }
    } catch (e) {
        state.chatSessions = {};
    }
    state.currentChatId = localStorage.getItem(ACTIVE_CHAT_KEY);

    // Sync active workspace prompt if current chat has workspace
    if (state.currentChatId && state.chatSessions[state.currentChatId]) {
        const sess = state.chatSessions[state.currentChatId];
        if (sess.workspace) {
            syncActiveWorkspacePrompt(sess.workspace);
        } else {
            initChatWorkspace(state.currentChatId, sess.createdAt);
        }
    }

    // Asynchronously fetch persistent chats from backend disk
    syncFromBackendDisk();
}

/**
 * Asynchronously synchronizes chats from $HOME/.MuktiAI/conversations/
 */
export async function syncFromBackendDisk() {
    try {
        const res = await fetch("/api/chats");
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.chats) && data.chats.length > 0) {
            let changed = false;
            for (const diskChat of data.chats) {
                if (!diskChat || !diskChat.id) continue;
                const existing = state.chatSessions[diskChat.id];
                if (!existing) {
                    state.chatSessions[diskChat.id] = diskChat;
                    changed = true;
                } else {
                    if (!existing.workspace && diskChat.workspace) {
                        existing.workspace = diskChat.workspace;
                        changed = true;
                    }
                    if ((diskChat.updatedAt || 0) > (existing.updatedAt || 0)) {
                        // CRITICAL: NEVER overwrite existing in-memory messages with undefined/empty!
                        if ((!diskChat.messages || diskChat.messages.length === 0) && (existing.messages && existing.messages.length > 0)) {
                            diskChat.messages = existing.messages;
                        }
                        if (existing.chatHtml && (!diskChat.chatHtml || !diskChat.chatHtml.trim())) {
                            diskChat.chatHtml = existing.chatHtml;
                        }
                        if (existing.title && (!diskChat.title || diskChat.title === "Conversation")) {
                            diskChat.title = existing.title;
                        }
                        state.chatSessions[diskChat.id] = diskChat;
                        changed = true;
                    } else if ((!existing.messages || existing.messages.length === 0) && diskChat.messages && diskChat.messages.length > 0) {
                        existing.messages = diskChat.messages;
                        changed = true;
                    }
                }
            }

            if (changed) {
                try {
                    localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(state.chatSessions));
                } catch (_) {}
                document.dispatchEvent(new CustomEvent("chatsUpdated"));
            }
        }
    } catch (err) {
        console.warn("[STORAGE] Backend chats sync error:", err.message);
    }
}

export function saveStoredChats() {
    if (state.config?.General?.RecordChatHistory === false) return;
    try {
        localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(state.chatSessions));
        if (state.currentChatId) {
            localStorage.setItem(ACTIVE_CHAT_KEY, state.currentChatId);
        } else {
            localStorage.removeItem(ACTIVE_CHAT_KEY);
        }
    } catch (e) {
        console.warn("Storage write error:", e);
    }

    // Persist current chat to backend disk (~/.MultiAI/)
    if (state.currentChatId && state.chatSessions[state.currentChatId]) {
        const session = state.chatSessions[state.currentChatId];
        const projectId = session.projectId || (state.appMode === "build" ? state.currentProjectId : null);
        if (projectId) {
            saveBuildChatToDisk(projectId, session);
        } else {
            persistChatToDisk(session);
        }
    }
}

/**
 * Persists chat object to {chatDir}/chat.json on disk
 */
export async function persistChatToDisk(session) {
    if (!session || !session.id) return;
    try {
        const res = await fetch("/api/chats/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(session)
        });
        if (res.ok) {
            const data = await res.json();
            if (data.workspace && !session.workspace) {
                session.workspace = data.workspace;
                if (state.currentChatId === session.id) {
                    syncActiveWorkspacePrompt(data.workspace);
                }
            }
        }
    } catch (e) {
        console.warn("[STORAGE] Failed to persist chat to disk:", e.message);
    }
}

/**
 * Appends a single message turn to {chatDir}/messages.jsonl
 */
export async function appendChatMessageToDisk(chatId, message) {
    if (!chatId || !message) return;
    try {
        await fetch("/api/chats/append", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, message })
        });
    } catch (e) {
        console.warn("[STORAGE] Failed to append message to disk:", e.message);
    }
}

export function generateChatId() {
    return "chat_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
}

export function createNewChatSession(initialUserText = "") {
    const modelSelect = document.getElementById("modelSelect");
    const chat = document.getElementById("chat");

    const id = generateChatId();
    const raw = (initialUserText || "").trim();
    const title = raw ? (raw.slice(0, 34) + (raw.length > 34 ? "..." : "")) : "Conversation";
    const defaultModel = state.config?.General?.DefaultStartupLLM || "gemini-2.5-flash";

    const isBuild = state.appMode === "build" && Boolean(state.currentProjectId);
    const projectId = isBuild ? state.currentProjectId : undefined;

    state.chatSessions[id] = {
        id,
        projectId,
        mode: isBuild ? "build" : "chat",
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: modelSelect ? modelSelect.value : defaultModel,
        messages: [...state.messages],
        chatHtml: chat ? chat.innerHTML : ""
    };
    state.currentChatId = id;

    if (isBuild) {
        initBuildChatWorkspace(projectId, id);
        saveBuildChatToDisk(projectId, state.chatSessions[id]);
    } else {
        // Auto-create workspace directories on disk and prompt AI
        initChatWorkspace(id, Date.now());
        if (state.config?.General?.RecordChatHistory !== false) {
            saveStoredChats();
        }
    }
    return id;
}

export function saveCurrentChatState() {
    if (!state.currentChatId || !state.chatSessions[state.currentChatId]) return;

    const chat = document.getElementById("chat");
    const modelSelect = document.getElementById("modelSelect");

    // If any user message is currently being edited, restore its text before saving HTML
    if (chat) {
        chat.querySelectorAll(".message.user.is-editing").forEach(el => {
            const editContainer = el.querySelector(".user-edit-container");
            if (editContainer) editContainer.remove();
            const textEl = el.querySelector(".msg-bubble-text");
            if (textEl) textEl.style.display = "";
            el.classList.remove("is-editing");
        });
    }

    const session = state.chatSessions[state.currentChatId];
    if (chat) {
        const currentHtml = chat.innerHTML;
        if (currentHtml && currentHtml.trim()) {
            session.chatHtml = currentHtml;
        }
    }
    
    // Protect against overwriting real message history with empty/system-only arrays
    const sessionHasReal = session.messages && session.messages.some(m => m.role !== "system");
    const stateHasReal = state.messages && state.messages.some(m => m.role !== "system");

    if (sessionHasReal) {
        state.messages = JSON.parse(JSON.stringify(session.messages));
    } else if (stateHasReal) {
        session.messages = JSON.parse(JSON.stringify(state.messages));
    }

    session.updatedAt = Date.now();
    if (modelSelect) session.model = modelSelect.value;

    if (!session.title || session.title === "Conversation") {
        const firstUserMsg = session.messages && session.messages.find(m => m.role === "user");
        if (firstUserMsg && typeof firstUserMsg.content === "string") {
            const rawTitle = firstUserMsg.content.trim();
            session.title = rawTitle.slice(0, 34) + (rawTitle.length > 34 ? "…" : "");
        }
    }

    saveStoredChats();
}

/* =========================================================
   BUILD MODE: PROJECTS & NESTED CHATS STORAGE
   ========================================================= */

/**
 * Synchronizes registered Build Projects from backend disk.
 */
export async function syncBuildProjectsFromDisk() {
    try {
        const res = await fetch("/api/build/projects");
        if (!res.ok) return [];
        const data = await res.json();
        if (Array.isArray(data.projects)) {
            state.buildProjects = data.projects;
            document.dispatchEvent(new CustomEvent("projectsUpdated"));
            return data.projects;
        }
    } catch (err) {
        console.warn("[STORAGE] Build projects sync error:", err.message);
    }
    return state.buildProjects || [];
}

/**
 * Registers a new project directory on disk.
 */
export async function addBuildProjectOnDisk(folderPath, customName = "") {
    try {
        const res = await fetch("/api/build/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: folderPath, name: customName })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "Failed to add project");
        }
        if (data.project) {
            const idx = state.buildProjects.findIndex(p => p.id === data.project.id);
            if (idx >= 0) {
                state.buildProjects[idx] = data.project;
            } else {
                state.buildProjects.unshift(data.project);
            }
            state.currentProjectId = data.project.id;
            document.dispatchEvent(new CustomEvent("projectsUpdated"));
            return data.project;
        }
    } catch (err) {
        console.error("[STORAGE] Error adding project:", err);
        throw err;
    }
}

/**
 * Removes a project registration from disk.
 */
export async function removeBuildProjectFromDisk(projectId) {
    try {
        const res = await fetch(`/api/build/projects/${encodeURIComponent(projectId)}`, {
            method: "DELETE"
        });
        if (res.ok) {
            state.buildProjects = state.buildProjects.filter(p => p.id !== projectId);
            if (state.currentProjectId === projectId) {
                state.currentProjectId = null;
            }
            document.dispatchEvent(new CustomEvent("projectsUpdated"));
            return true;
        }
    } catch (err) {
        console.error("[STORAGE] Error deleting project:", err);
    }
    return false;
}

/**
 * Creates or updates a build chat nested inside a project.
 */
export async function saveBuildChatToDisk(projectId, chatSession) {
    if (!projectId || !chatSession || !chatSession.id) return;
    try {
        const res = await fetch(`/api/build/projects/${encodeURIComponent(projectId)}/chats/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(chatSession)
        });
        if (res.ok) {
            const data = await res.json();
            // Update in-memory project nested chats
            const project = state.buildProjects.find(p => p.id === projectId);
            if (project) {
                if (!project.chats) project.chats = [];
                const idx = project.chats.findIndex(c => c.id === chatSession.id);
                const chatMeta = {
                    id: chatSession.id,
                    projectId,
                    mode: "build",
                    title: chatSession.title || "Build Task",
                    model: chatSession.model,
                    updatedAt: Date.now()
                };
                if (idx >= 0) {
                    project.chats[idx] = { ...project.chats[idx], ...chatMeta };
                } else {
                    project.chats.unshift(chatMeta);
                }
                document.dispatchEvent(new CustomEvent("projectsUpdated"));
            }
            return data.workspace;
        }
    } catch (err) {
        console.warn("[STORAGE] Error saving build chat:", err.message);
    }
}

/**
 * Initializes workspace for a build chat in a project.
 */
export async function initBuildChatWorkspace(projectId, chatId) {
    if (!projectId || !chatId) return null;
    try {
        const res = await fetch(`/api/build/projects/${encodeURIComponent(projectId)}/chats/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.workspace) {
                syncActiveWorkspacePrompt(data.workspace);
                return data.workspace;
            }
        }
    } catch (err) {
        console.warn("[STORAGE] Error initializing build chat workspace:", err.message);
    }
    return null;
}

