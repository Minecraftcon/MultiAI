/* =========================================================
   BUILD PROJECTS PANEL & MODAL MANAGEMENT (BUILD MODE)
   ========================================================= */
import { ACTIVE_BUILD_PROJECT_KEY, ACTIVE_BUILD_CHAT_KEY } from "../config.js";
import { state } from "../state/index.js";
import { escapeHTML, formatChatDate, wrapTablesForScroll } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { 
    saveCurrentChatState, 
    addBuildProjectOnDisk,
    removeBuildProjectFromDisk,
    saveBuildChatToDisk,
    initBuildChatWorkspace,
    generateChatId
} from "../services/storage.js";
import { closePanel } from "./gestures.js";
import { hideMobileActions } from "./context-menu.js";
import { bindInteractiveCodeBlocks, renderMermaidInElement, renderMath, bindAIImageCards } from "./renderer.js";
import { updateSendButtonState } from "./composer.js";
import { updateModelPickerDisplay } from "./model-picker.js";
import { setStartPageMode } from "./chatbox.js";
import { wrapHugeThoughts, renderSessionMessages } from "./chat-ui.js";

export const collapsedProjects = new Set();
export let activeMenuProjectId = null;
export let activeMenuProjectChatId = null;

let validateTimer = null;

/**
 * Renders the project tree and its chats for Build Mode.
 */
export function renderProjectList(filterQuery = "") {
    const projectList = document.getElementById("projectList");
    if (!projectList) return;

    const projects = state.buildProjects || [];

    if (projects.length === 0) {
        projectList.innerHTML = `
            <div class="project-empty-state">
                <div class="project-empty-icon">
                    <i data-lucide="folder-code"></i>
                </div>
                <div class="project-empty-title">No Projects Added</div>
                <p class="project-empty-desc">Choose a directory on your system to start building with contextual AI workspace.</p>
                <button type="button" id="emptyAddProjectBtn" class="project-empty-btn">
                    <i data-lucide="folder-plus"></i>
                    <span>Add Project Directory</span>
                </button>
            </div>
        `;
        const emptyBtn = projectList.querySelector("#emptyAddProjectBtn");
        if (emptyBtn) {
            emptyBtn.addEventListener("click", () => openAddProjectModal());
        }
        renderIcons(projectList);
        return;
    }

    projectList.innerHTML = "";

    projects.forEach(project => {
        let chats = Array.isArray(project.chats) ? [...project.chats] : [];
        if (filterQuery) {
            chats = chats.filter(c => (c.title || "").toLowerCase().includes(filterQuery.toLowerCase()));
        }
        chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        const isCollapsed = collapsedProjects.has(project.id);
        const displayName = project.name || (project.rootPath ? project.rootPath.split("/").filter(Boolean).pop() : "Project");

        const group = document.createElement("div");
        group.className = `project-group ${isCollapsed ? "is-collapsed" : ""}`;
        group.dataset.projectId = project.id;

        group.innerHTML = `
            <div class="project-header" role="button" tabindex="0" title="${escapeHTML(project.rootPath || '')}">
                <button type="button" class="project-collapse-btn" aria-label="Toggle project chats">
                    <i data-lucide="chevron-down" class="project-chevron"></i>
                </button>
                <i data-lucide="folder" class="project-folder-icon"></i>
                <div class="project-info">
                    <span class="project-name">${escapeHTML(displayName)}</span>
                    <span class="project-path">${escapeHTML(project.rootPath || '')}</span>
                </div>
                <div class="project-actions">
                    <button type="button" class="project-action-btn project-add-chat-btn" title="New chat in this project" aria-label="New chat in this project">
                        <i data-lucide="plus"></i>
                    </button>
                    <button type="button" class="project-action-btn project-more-btn" title="Project options" aria-label="Project options">
                        <i data-lucide="more-horizontal"></i>
                    </button>
                </div>
            </div>
            <div class="project-chats-container"></div>
        `;

        const header = group.querySelector(".project-header");
        header.addEventListener("click", (e) => {
            if (e.target.closest(".project-action-btn")) return;
            if (collapsedProjects.has(project.id)) {
                collapsedProjects.delete(project.id);
                group.classList.remove("is-collapsed");
            } else {
                collapsedProjects.add(project.id);
                group.classList.add("is-collapsed");
            }
        });

        const addChatBtn = group.querySelector(".project-add-chat-btn");
        if (addChatBtn) {
            addChatBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                startFreshBuildChat(project.id);
            });
        }

        const moreBtn = group.querySelector(".project-more-btn");
        if (moreBtn) {
            moreBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                showProjectMenu(project.id, moreBtn);
            });
        }

        const chatsContainer = group.querySelector(".project-chats-container");
        if (chats.length === 0) {
            const noChats = document.createElement("div");
            noChats.className = "project-no-chats";
            noChats.innerHTML = `
                <span>No chats yet</span>
                <button type="button" class="project-inline-new-chat">+ New Chat</button>
            `;
            const inlineNew = noChats.querySelector(".project-inline-new-chat");
            if (inlineNew) {
                inlineNew.addEventListener("click", (e) => {
                    e.stopPropagation();
                    startFreshBuildChat(project.id);
                });
            }
            chatsContainer.appendChild(noChats);
        } else {
            chats.forEach(chat => {
                const isActive = chat.id === state.currentChatId;
                const dateStr = formatChatDate(chat.updatedAt || chat.createdAt);

                const item = document.createElement("div");
                item.className = `project-chat-item ${isActive ? "active" : ""}`;
                item.dataset.projectId = project.id;
                item.dataset.chatId = chat.id;
                item.setAttribute("role", "button");
                item.setAttribute("tabindex", "0");

                item.innerHTML = `
                    <i data-lucide="message-square" class="project-chat-icon"></i>
                    <span class="project-chat-title">${escapeHTML(chat.title || "Build Task")}</span>
                    ${dateStr ? `<span class="project-chat-date">${escapeHTML(dateStr)}</span>` : ""}
                    <button type="button" class="project-chat-more-btn" title="Options" aria-label="Conversation options">
                        <i data-lucide="more-horizontal"></i>
                    </button>
                `;

                item.addEventListener("click", (e) => {
                    if (e.target.closest(".project-chat-more-btn")) return;
                    if (chat.id !== state.currentChatId) {
                        switchToBuildChat(project.id, chat.id);
                    }
                    closePanel(true);
                });

                const chatMoreBtn = item.querySelector(".project-chat-more-btn");

                // Right-click → context menu
                item.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showBuildChatMenu(project.id, chat.id, chatMoreBtn || item);
                });

                // Long-press → context menu
                let _lpTimer = null;
                item.addEventListener("pointerdown", (e) => {
                    if (e.target.closest(".project-chat-more-btn")) return;
                    _lpTimer = setTimeout(() => {
                        _lpTimer = null;
                        showBuildChatMenu(project.id, chat.id, chatMoreBtn || item);
                    }, 500);
                });
                item.addEventListener("pointerup",    () => { clearTimeout(_lpTimer); _lpTimer = null; });
                item.addEventListener("pointercancel",() => { clearTimeout(_lpTimer); _lpTimer = null; });
                item.addEventListener("pointermove",  () => { clearTimeout(_lpTimer); _lpTimer = null; });

                if (chatMoreBtn) {
                    chatMoreBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        showBuildChatMenu(project.id, chat.id, chatMoreBtn);
                    });
                }

                chatsContainer.appendChild(item);
            });
        }

        projectList.appendChild(group);
    });

    renderIcons(projectList);
}

/**
 * Activates a specific build chat session inside a project.
 */
export async function switchToBuildChat(projectId, chatId) {
    hideMobileActions();
    hideProjectMenu();
    const chatItemMenu = document.getElementById("chatItemMenu");
    if (chatItemMenu) chatItemMenu.style.display = "none";

    if (state.currentChatId && state.currentChatId !== chatId && state.chatSessions[state.currentChatId]) {
        saveCurrentChatState();
    }

    state.currentProjectId = projectId;
    state.currentChatId = chatId;
    try {
        localStorage.setItem(ACTIVE_BUILD_PROJECT_KEY, projectId);
        localStorage.setItem(ACTIVE_BUILD_CHAT_KEY, chatId);
    } catch (_) {}

    try {
        const res = await fetch(`/api/build/projects/${encodeURIComponent(projectId)}/chats/${encodeURIComponent(chatId)}`);
        if (res.ok) {
            const data = await res.json();
            if (data.session) {
                state.chatSessions[chatId] = data.session;
            }
        }
    } catch (e) {
        console.warn("[BUILD] Failed to fetch chat session:", e);
    }

    const session = state.chatSessions[chatId] || { id: chatId, projectId, mode: "build", messages: [] };
    const chat = document.getElementById("chat");
    const modelSelect = document.getElementById("modelSelect");

    await initBuildChatWorkspace(projectId, chatId);

    state.messages = (session.messages && session.messages.length > 0)
        ? structuredClone(session.messages)
        : [{ role: "system", content: state.activeSystemPrompt }];

    if (state.messages[0]?.role === "system") {
        state.messages[0].content = state.activeSystemPrompt;
    }

    if (session.model && modelSelect) {
        modelSelect.value = session.model;
        updateModelPickerDisplay();
    }

    if (chat) {
        chat.innerHTML = "";
        renderSessionMessages(session, chat);

        bindInteractiveCodeBlocks(chat);
        renderMermaidInElement(chat);
        wrapTablesForScroll(chat);
        renderIcons(chat);
        renderMath(chat);
        bindAIImageCards(chat, true);
        wrapHugeThoughts(chat);
        chat.scrollTop = chat.scrollHeight;
    }

    const hasUserMsg = Boolean(session.messages && session.messages.some(m => m.role === "user"));
    setStartPageMode(!hasUserMsg);
    updateSendButtonState(false);
    renderProjectList();
}

/**
 * Creates and switches to a fresh chat within a project workspace.
 */
export async function startFreshBuildChat(projectId) {
    hideMobileActions();
    hideProjectMenu();
    const chatItemMenu = document.getElementById("chatItemMenu");
    if (chatItemMenu) chatItemMenu.style.display = "none";

    if (state.currentChatId && state.chatSessions[state.currentChatId]) {
        saveCurrentChatState();
    }

    const project = state.buildProjects?.find(p => p.id === projectId);
    if (!project) return;

    const chatId = generateChatId();
    state.currentProjectId = projectId;
    state.currentChatId = chatId;
    try {
        localStorage.setItem(ACTIVE_BUILD_PROJECT_KEY, projectId);
        localStorage.setItem(ACTIVE_BUILD_CHAT_KEY, chatId);
    } catch (_) {}

    const modelSelect = document.getElementById("modelSelect");
    const defaultModel = state.config?.General?.DefaultStartupLLM || "gemini-2.5-flash";

    const workspace = await initBuildChatWorkspace(projectId, chatId);

    const newSession = {
        id: chatId,
        projectId: projectId,
        mode: "build",
        title: "Build in " + (project.name || "project"),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: modelSelect ? modelSelect.value : defaultModel,
        messages: [{ role: "system", content: state.activeSystemPrompt }],
        chatHtml: "",
        workspace
    };

    state.chatSessions[chatId] = newSession;
    state.messages = [{ role: "system", content: state.activeSystemPrompt }];

    await saveBuildChatToDisk(projectId, newSession);

    const chat = document.getElementById("chat");
    const input = document.getElementById("input");
    if (chat) chat.innerHTML = "";
    updateSendButtonState(false);
    renderProjectList();
    setStartPageMode(true);
    if (input) {
        input.value = "";
        input.placeholder = `Build task in ${project.name}...`;
        input.focus();
    }
    closePanel(true);
}

/**
 * Shows the project context menu (Copy Path, New Chat, Remove).
 */
export function showProjectMenu(projectId, targetBtn) {
    activeMenuProjectId = projectId;
    const menu = document.getElementById("projectItemMenu");
    if (!menu) return;

    const rect = targetBtn.getBoundingClientRect();
    menu.style.display = "flex";
    menu.style.position = "fixed";
    renderIcons(menu);

    const mw = menu.offsetWidth || 150;
    const mh = menu.offsetHeight || 100;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const GAP = 6;

    let left = rect.right - mw;
    let top = rect.bottom + GAP;

    if (left + mw > vw - GAP) left = vw - mw - GAP;
    if (left < GAP) left = GAP;
    if (top + mh > vh - GAP) top = rect.top - mh - GAP;
    if (top < GAP) top = GAP;

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
}

/**
 * Hides the project context menu.
 */
export function hideProjectMenu() {
    activeMenuProjectId = null;
    activeMenuProjectChatId = null;
    const menu = document.getElementById("projectItemMenu");
    if (menu) menu.style.display = "none";
}

/**
 * Resets build-panel menu state — called by hideChatItemMenu in chat-history-list
 * so the shared chatItemMenu doesn't carry stale build-chat context.
 */
export function resetBuildChatMenuState() {
    activeMenuProjectId = null;
    activeMenuProjectChatId = null;
}

/**
 * Opens options menu for a chat item within a project.
 */
export function showBuildChatMenu(projectId, chatId, targetBtn) {
    activeMenuProjectId = projectId;
    activeMenuProjectChatId = chatId;

    const menu = document.getElementById("chatItemMenu");
    if (!menu) return;

    const rect = targetBtn.getBoundingClientRect();
    menu.style.display = "flex";
    menu.style.position = "fixed";
    renderIcons(menu);

    const mw = menu.offsetWidth || 150;
    const mh = menu.offsetHeight || 100;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const GAP = 6;

    let left = rect.right - mw;
    let top = rect.bottom + GAP;

    if (left + mw > vw - GAP) left = vw - mw - GAP;
    if (left < GAP) left = GAP;
    if (top + mh > vh - GAP) top = rect.top - mh - GAP;
    if (top < GAP) top = GAP;

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
}

/**
 * Opens the "Add Project Directory" modal.
 */
export function openAddProjectModal() {
    const backdrop = document.getElementById("projectModalBackdrop");
    const modal = document.getElementById("projectModal");
    const pathInput = document.getElementById("projectPathInput");
    const nameInput = document.getElementById("projectNameInput");
    const statusEl = document.getElementById("projectPathStatus");
    const confirmBtn = document.getElementById("projectModalConfirmBtn");
    const suggestionsList = document.getElementById("projectSuggestionsList");

    if (!modal) return;

    if (backdrop) backdrop.style.display = "block";
    modal.style.display = "flex";
    if (pathInput) pathInput.value = "";
    if (nameInput) nameInput.value = "";
    if (statusEl) {
        statusEl.textContent = "";
        statusEl.className = "project-path-status";
    }
    if (confirmBtn) confirmBtn.disabled = true;

    fetch("/api/fs/validate-dir")
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (suggestionsList && data && Array.isArray(data.suggestions)) {
                suggestionsList.innerHTML = "";
                data.suggestions.forEach(s => {
                    const sPath = typeof s === "string" ? s : (s.path || "");
                    const sName = typeof s === "string" ? (s.split("/").filter(Boolean).pop() || s) : (s.name || s.path);
                    const chip = document.createElement("button");
                    chip.type = "button";
                    chip.className = "project-suggestion-chip";
                    chip.innerHTML = `<i data-lucide="folder"></i><span>${escapeHTML(sName)}</span>`;
                    chip.title = sPath;
                    chip.addEventListener("click", () => {
                        if (pathInput) {
                            pathInput.value = sPath;
                            validateDirectoryInput(sPath);
                        }
                    });
                    suggestionsList.appendChild(chip);
                });
                renderIcons(suggestionsList);
            }
        })
        .catch(() => {});

    setTimeout(() => pathInput?.focus(), 50);
}

/**
 * Closes the "Add Project Directory" modal.
 */
export function closeAddProjectModal() {
    const backdrop = document.getElementById("projectModalBackdrop");
    const modal = document.getElementById("projectModal");
    if (backdrop) backdrop.style.display = "none";
    if (modal) modal.style.display = "none";
}

/**
 * Validates a directory path via backend API for project creation.
 */
export async function validateDirectoryInput(pathStr) {
    const statusEl = document.getElementById("projectPathStatus");
    const confirmBtn = document.getElementById("projectModalConfirmBtn");
    const nameInput = document.getElementById("projectNameInput");

    const trimmed = (pathStr || "").trim();
    if (!trimmed) {
        if (statusEl) {
            statusEl.textContent = "";
            statusEl.className = "project-path-status";
        }
        if (confirmBtn) confirmBtn.disabled = true;
        return;
    }

    try {
        const res = await fetch(`/api/fs/validate-dir?path=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        if (data.valid) {
            const normalized = data.resolvedPath || data.normalizedPath || trimmed;
            if (statusEl) {
                statusEl.textContent = `✓ Valid directory (${normalized})`;
                statusEl.className = "project-path-status valid";
            }
            if (confirmBtn) confirmBtn.disabled = false;
            if (nameInput && !nameInput.value.trim() && (data.name || data.basename)) {
                nameInput.placeholder = data.name || data.basename;
            }
        } else {
            if (statusEl) {
                statusEl.textContent = data.error || "Directory does not exist";
                statusEl.className = "project-path-status invalid";
            }
            if (confirmBtn) confirmBtn.disabled = true;
        }
    } catch (e) {
        if (statusEl) {
            statusEl.textContent = "Error checking directory";
            statusEl.className = "project-path-status invalid";
        }
        if (confirmBtn) confirmBtn.disabled = true;
    }
}

/**
 * Initializes modal input debouncing and event listeners for Build Projects.
 */
export function initBuildProjectsListeners() {
    const addProjectBtn = document.getElementById("addProjectBtn");
    const panelAddProjectHeaderBtn = document.getElementById("panelAddProjectHeaderBtn");
    const projectModalCloseBtn = document.getElementById("projectModalCloseBtn");
    const projectModalCancelBtn = document.getElementById("projectModalCancelBtn");
    const projectModalBackdrop = document.getElementById("projectModalBackdrop");
    const projectPathInput = document.getElementById("projectPathInput");
    const projectNameInput = document.getElementById("projectNameInput");
    const projectModalConfirmBtn = document.getElementById("projectModalConfirmBtn");
    const projectCopyPathBtn = document.getElementById("projectCopyPathBtn");
    const projectNewChatMenuBtn = document.getElementById("projectNewChatMenuBtn");
    const projectRemoveBtn = document.getElementById("projectRemoveBtn");

    if (addProjectBtn) {
        addProjectBtn.addEventListener("click", () => openAddProjectModal());
    }

    if (panelAddProjectHeaderBtn) {
        panelAddProjectHeaderBtn.addEventListener("click", () => openAddProjectModal());
    }

    if (projectModalCloseBtn) projectModalCloseBtn.addEventListener("click", closeAddProjectModal);
    if (projectModalCancelBtn) projectModalCancelBtn.addEventListener("click", closeAddProjectModal);
    if (projectModalBackdrop) projectModalBackdrop.addEventListener("click", closeAddProjectModal);

    if (projectPathInput) {
        projectPathInput.addEventListener("input", () => {
            clearTimeout(validateTimer);
            validateTimer = setTimeout(() => {
                validateDirectoryInput(projectPathInput.value);
            }, 250);
        });

        projectPathInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && projectModalConfirmBtn && !projectModalConfirmBtn.disabled) {
                e.preventDefault();
                projectModalConfirmBtn.click();
            } else if (e.key === "Escape") {
                e.preventDefault();
                closeAddProjectModal();
            }
        });
    }

    if (projectModalConfirmBtn) {
        projectModalConfirmBtn.addEventListener("click", async () => {
            const pathVal = projectPathInput?.value.trim();
            const nameVal = projectNameInput?.value.trim();
            if (!pathVal) return;

            projectModalConfirmBtn.disabled = true;
            try {
                const project = await addBuildProjectOnDisk(pathVal, nameVal);
                closeAddProjectModal();
                if (project && project.id) {
                    collapsedProjects.delete(project.id);
                    renderProjectList();
                    startFreshBuildChat(project.id);
                }
            } catch (err) {
                const statusEl = document.getElementById("projectPathStatus");
                if (statusEl) {
                    statusEl.textContent = err.message || "Failed to add project";
                    statusEl.className = "project-path-status invalid";
                }
                projectModalConfirmBtn.disabled = false;
            }
        });
    }

    if (projectCopyPathBtn) {
        projectCopyPathBtn.addEventListener("click", () => {
            const project = state.buildProjects?.find(p => p.id === activeMenuProjectId);
            if (project?.rootPath) {
                navigator.clipboard?.writeText(project.rootPath).catch(() => {});
            }
            hideProjectMenu();
        });
    }

    if (projectNewChatMenuBtn) {
        projectNewChatMenuBtn.addEventListener("click", () => {
            const pid = activeMenuProjectId;
            hideProjectMenu();
            if (pid) startFreshBuildChat(pid);
        });
    }

    if (projectRemoveBtn) {
        projectRemoveBtn.addEventListener("click", () => {
            const pid = activeMenuProjectId;
            hideProjectMenu();
            const project = state.buildProjects?.find(p => p.id === pid);
            if (project && window.confirm(`Remove project "${project.name || project.rootPath}" from MultiAI?`)) {
                removeBuildProjectFromDisk(pid);
            }
        });
    }
}
