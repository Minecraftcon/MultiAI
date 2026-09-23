/* =========================================================
   SIDE PANEL & CHAT HISTORY COMPONENT (DUCK.AI INSPIRED)
   ========================================================= */
import { CHATS_STORAGE_KEY, ACTIVE_CHAT_KEY, ACTIVE_BUILD_PROJECT_KEY, ACTIVE_BUILD_CHAT_KEY } from "../config.js";
import { state, setDeepSearchActive } from "../state/index.js";
import { escapeHTML, formatChatDate, wrapTablesForScroll } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { 
    saveStoredChats, 
    saveCurrentChatState, 
    initChatWorkspace,
    syncBuildProjectsFromDisk,
    addBuildProjectOnDisk,
    removeBuildProjectFromDisk,
    saveBuildChatToDisk,
    initBuildChatWorkspace,
    generateChatId
} from "../services/storage.js";
import { syncActiveWorkspacePrompt } from "../services/system.js";
import { closePanel } from "./gestures.js";
import { hideMobileActions, showChatItemContextMenu } from "./context-menu.js";
import { bindInteractiveCodeBlocks, renderMermaidInElement, renderMath, bindAIImageCards, parseMarkdown } from "./renderer.js";
import { updateSendButtonState, stopChatGeneration } from "./composer.js";
import { updateModelPickerDisplay } from "./model-picker.js";
import { openSettings } from "./settings-view.js";
import { setStartPageMode } from "./chatbox.js";
import { wrapHugeThoughts, renderSessionMessages } from "./chat-ui.js";

let currentSearchFilter = "";
let activeMenuChatId = null;
let activeMenuProjectId = null;
let activeMenuProjectChatId = null;
const collapsedProjects = new Set();
let validateTimer = null;

export function setPanelSearchMode(enabled) {
    const sidePanel = document.getElementById("sidePanel");
    const searchBar = document.getElementById("panelSearchBar");
    const searchInput = document.getElementById("panelSearchInput");
    const searchToggle = document.getElementById("panelSearchToggle");
    if (!sidePanel) return;

    const performUpdate = () => {
        if (enabled) {
            sidePanel.classList.add("search-active");
            if (searchBar) searchBar.setAttribute("aria-hidden", "false");
        } else {
            sidePanel.classList.remove("search-active");
            if (searchBar) searchBar.setAttribute("aria-hidden", "true");
            if (searchInput) searchInput.value = "";
            currentSearchFilter = "";
            renderChatList();
        }
    };

    if (document.startViewTransition) {
        const transition = document.startViewTransition(() => {
            performUpdate();
        });
        transition.finished.finally(() => {
            if (enabled) {
                searchInput?.focus();
            } else {
                searchToggle?.focus();
            }
        });
    } else {
        performUpdate();
        if (enabled) {
            searchInput?.focus();
        } else {
            searchToggle?.focus();
        }
    }
}

export function updateSidePanelView(mode = state.appMode) {
    const isBuild = mode === "build";
    const panelChatNav = document.getElementById("panelChatNav");
    const panelBuildNav = document.getElementById("panelBuildNav");
    const panelSectionLabel = document.getElementById("panelSectionLabel");
    const panelSearchToggle = document.getElementById("panelSearchToggle");
    const panelAddProjectHeaderBtn = document.getElementById("panelAddProjectHeaderBtn");
    const chatList = document.getElementById("chatList");
    const projectList = document.getElementById("projectList");

    if (panelChatNav) panelChatNav.style.display = isBuild ? "none" : "";
    if (panelBuildNav) panelBuildNav.style.display = isBuild ? "" : "none";
    if (panelSectionLabel) panelSectionLabel.textContent = isBuild ? "Projects" : "Chats";
    if (panelSearchToggle) panelSearchToggle.style.display = isBuild ? "none" : "";
    if (panelAddProjectHeaderBtn) panelAddProjectHeaderBtn.style.display = isBuild ? "" : "none";
    if (chatList) chatList.style.display = isBuild ? "none" : "";
    if (projectList) projectList.style.display = isBuild ? "" : "none";

    if (isBuild) {
        renderProjectList(currentSearchFilter);
    } else {
        renderChatList(currentSearchFilter);
    }
}

export function renderProjectList(filterQuery = currentSearchFilter) {
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

/** Cached snapshot per chat-item so we know what's already rendered. */
const _chatItemCache = new Map(); // chatId -> { title, dateStr, isActive, isRunning }

export function renderChatList(filterQuery = currentSearchFilter) {
    if (state.appMode === "build") {
        renderProjectList(filterQuery);
        return;
    }
    const chatList = document.getElementById("chatList");
    if (!chatList) return;

    let ids = Object.keys(state.chatSessions);

    // Clear the keyed-diff map if we had an empty state placeholder
    if (chatList.querySelector(".history-empty")) {
        chatList.innerHTML = "";
        _chatItemCache.clear();
    }

    if (ids.length === 0) {
        chatList.innerHTML = '<div class="history-empty">No conversations yet</div>';
        _chatItemCache.clear();
        return;
    }

    ids.sort((a, b) => (state.chatSessions[b].updatedAt || 0) - (state.chatSessions[a].updatedAt || 0));

    if (filterQuery) {
        ids = ids.filter(id => {
            const title = (state.chatSessions[id]?.title || "Untitled Chat").toLowerCase();
            return title.includes(filterQuery);
        });
        if (ids.length === 0) {
            chatList.innerHTML = '<div class="history-empty">No matching chats</div>';
            _chatItemCache.clear();
            return;
        }
    }

    // --- Keyed diff: reuse existing nodes, only patch what changed ---
    const existingById = new Map();
    for (const el of chatList.querySelectorAll(".chat-item[data-chat-id]")) {
        existingById.set(el.dataset.chatId, el);
    }

    // Remove nodes that are no longer in the visible list
    const idSet = new Set(ids);
    for (const [id, el] of existingById) {
        if (!idSet.has(id)) {
            el.remove();
            _chatItemCache.delete(id);
            existingById.delete(id);
        }
    }

    let prevEl = null; // used to maintain DOM order
    let needsIconRefresh = false;

    for (const id of ids) {
        const session = state.chatSessions[id];
        const isActive = id === state.currentChatId;
        const isRunning = Boolean(state.activeGenerations[id]?.isGenerating);
        const dateStr = formatChatDate(session.updatedAt || session.createdAt);
        const title = session.title || "Untitled Chat";

        let item = existingById.get(id);

        if (!item) {
            // --- Create new node ---
            item = document.createElement("div");
            item.dataset.chatId = id;
            item.setAttribute("role", "button");
            item.setAttribute("tabindex", "0");

            // Inner markup (static structure, content patched below)
            item.innerHTML = `
                <div class="chat-item-main">
                    <span class="chat-item-title"></span>
                </div>
                <span class="chat-item-date"></span>
                <div class="chat-item-spinner" title="Task running in background" style="display:none"></div>
                <button type="button" class="chat-item-more-btn" title="Options" aria-label="Conversation options">
                    <i data-lucide="more-horizontal"></i>
                </button>
            `;

            // Bind events once per node (not re-bound on every render)
            let holdTimer = null;
            let startX = 0;
            let startY = 0;
            let didLongPress = false;

            item.addEventListener("touchstart", (e) => {
                if (e.touches.length !== 1) return;
                if (e.target.closest(".chat-item-more-btn")) return;
                const touch = e.touches[0];
                startX = touch.clientX;
                startY = touch.clientY;
                didLongPress = false;
                clearTimeout(holdTimer);
                holdTimer = setTimeout(() => {
                    didLongPress = true;
                    if (navigator.vibrate) { try { navigator.vibrate(40); } catch (_) {} }
                    showChatItemContextMenu(id, startX, startY);
                }, 450);
            }, { passive: true });

            item.addEventListener("touchmove", (e) => {
                if (!holdTimer) return;
                if (e.touches.length !== 1) { clearTimeout(holdTimer); holdTimer = null; return; }
                const touch = e.touches[0];
                if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
                    clearTimeout(holdTimer); holdTimer = null;
                }
            }, { passive: true });

            item.addEventListener("touchend", () => {
                clearTimeout(holdTimer); holdTimer = null;
                if (didLongPress) setTimeout(() => { didLongPress = false; }, 350);
            });

            item.addEventListener("touchcancel", () => {
                clearTimeout(holdTimer); holdTimer = null; didLongPress = false;
            });

            item.addEventListener("click", (e) => {
                if (didLongPress) { e.preventDefault(); e.stopPropagation(); didLongPress = false; return; }
                if (e.target.closest(".chat-item-more-btn")) return;
                if (id !== state.currentChatId) switchToChat(id);
                closePanel(true);
            });

            item.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (id !== state.currentChatId) switchToChat(id);
                    closePanel(true);
                }
            });

            item.querySelector(".chat-item-more-btn")?.addEventListener("click", (e) => {
                e.stopPropagation(); e.preventDefault();
                showChatItemMenu(id, item.querySelector(".chat-item-more-btn"));
            });

            needsIconRefresh = true;
            existingById.set(id, item);
        }

        // --- Patch only changed fields ---
        const cached = _chatItemCache.get(id) || {};
        if (cached.isActive !== isActive) {
            item.className = `chat-item${isActive ? " active" : ""}`;
        }
        if (cached.title !== title) {
            item.querySelector(".chat-item-title").textContent = title;
        }
        if (cached.dateStr !== dateStr) {
            const dateEl = item.querySelector(".chat-item-date");
            if (dateEl) { dateEl.textContent = dateStr || ""; dateEl.style.display = dateStr ? "" : "none"; }
        }
        if (cached.isRunning !== isRunning) {
            const spinner = item.querySelector(".chat-item-spinner");
            if (spinner) spinner.style.display = isRunning ? "" : "none";
        }
        _chatItemCache.set(id, { title, dateStr, isActive, isRunning });

        // --- Maintain sorted DOM order without full rebuild ---
        const correctNext = prevEl ? prevEl.nextSibling : chatList.firstChild;
        if (item !== correctNext) {
            if (prevEl) {
                chatList.insertBefore(item, prevEl.nextSibling);
            } else {
                chatList.prepend(item);
            }
        }
        prevEl = item;
    }

    if (needsIconRefresh) renderIcons(chatList);

    const panelBody = document.querySelector(".panel-body");
    if (panelBody) {
        panelBody.classList.toggle("scrolled-top", panelBody.scrollTop > 2);
    }
}

export async function switchToBuildChat(projectId, chatId) {
    hideMobileActions();
    hideChatItemMenu();
    hideProjectMenu();

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

        // Accurately render from messages with full tool call and thought trace recovery
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

export async function startFreshBuildChat(projectId) {
    hideMobileActions();
    hideChatItemMenu();
    hideProjectMenu();

    if (state.currentChatId && state.chatSessions[state.currentChatId]) {
        saveCurrentChatState();
    }

    const project = state.buildProjects.find(p => p.id === projectId);
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
        chatHtml: "", // kept for disk-compat with old sessions that may still have it
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

export async function switchToChat(id) {
    if (!state.chatSessions[id]) return;
    hideMobileActions();
    hideChatItemMenu();

    if (state.currentChatId && state.currentChatId !== id && state.chatSessions[state.currentChatId]) {
        saveCurrentChatState();
    }

    state.currentChatId = id;
    try {
        localStorage.setItem(ACTIVE_CHAT_KEY, id);
    } catch (_) {}
    let session = state.chatSessions[id];

    // If session messages are not yet loaded in memory, fetch full session from backend
    if (!session.messages || session.messages.length === 0) {
        try {
            const res = await fetch("/api/chats/" + encodeURIComponent(id));
            if (res.ok) {
                const data = await res.json();
                if (data && data.session) {
                    session = { ...session, ...data.session };
                    state.chatSessions[id] = session;
                    if (data.workspace) session.workspace = data.workspace;
                }
            }
        } catch (e) {
            console.warn("[STORAGE] Error fetching full chat session:", e);
        }
    }

    const chat = document.getElementById("chat");
    const modelSelect = document.getElementById("modelSelect");

    if (session.workspace) {
        syncActiveWorkspacePrompt(session.workspace);
    } else {
        initChatWorkspace(id, session.createdAt);
    }

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

        // Accurately render from messages with full tool call and thought trace recovery
        renderSessionMessages(session, chat);

        chat.querySelectorAll(".user-msg-actions").forEach(el => el.remove());

        chat.querySelectorAll(".message.user").forEach(msg => {
            if (!msg.dataset.rawText) {
                const textEl = msg.querySelector(".msg-bubble-text");
                msg.dataset.rawText = textEl ? textEl.textContent.trim() : msg.textContent.trim();
            }
        });

        bindInteractiveCodeBlocks(chat);
        renderMermaidInElement(chat);
        wrapTablesForScroll(chat);
        renderIcons(chat);
        renderMath(chat);
        bindAIImageCards(chat, true);
        wrapHugeThoughts(chat);

        chat.scrollTop = chat.scrollHeight;

        // If session messages are missing or empty, reconstruct from DOM so context is never lost
        if ((!session.messages || !session.messages.some(m => m.role === "user")) && chat) {
            const userMsgs = chat.querySelectorAll(".message.user");
            if (userMsgs.length > 0) {
                const reconstructed = [{ role: "system", content: state.activeSystemPrompt }];
                chat.querySelectorAll(".message").forEach(el => {
                    if (el.classList.contains("user")) {
                        const text = el.dataset.rawText || el.querySelector(".msg-bubble-text")?.textContent || el.textContent;
                        reconstructed.push({ role: "user", content: (text || "").trim() });
                    } else if (el.classList.contains("ai")) {
                        const text = el.dataset.rawText || el.querySelector(".final-content")?.textContent || el.querySelector(".pre-search-content")?.textContent || el.textContent;
                        reconstructed.push({ role: "assistant", content: (text || "").trim() });
                    }
                });
                if (reconstructed.length > 1) {
                    session.messages = reconstructed;
                    state.messages = structuredClone(reconstructed);
                }
            }
        }

        // Resume any DeepSearch stats bar poller on chat reload
        const activeBox = chat.querySelector(".deepsearch-stats-box");
        if (activeBox) {
            const jId = activeBox.getAttribute("data-job-id");
            if (jId) {
                import("./deepsearch-bar.js").then(({ startDeepSearchPolling, wireDeepSearchBar }) => {
                    wireDeepSearchBar(activeBox.parentElement || activeBox, jId);
                    startDeepSearchPolling(jId, activeBox.parentElement || activeBox);
                });
            }
        } else {
            // Check backend if an active or completed background job exists for this chat
            fetch(`/api/deepsearch/chat/${encodeURIComponent(id)}`)
                .then(r => r.json())
                .then(data => {
                    if (data && data.job && chat) {
                        const msgs = chat.querySelectorAll(".message.ai");
                        const targetMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
                        if (targetMsg && !targetMsg.querySelector(".deepsearch-stats-box")) {
                            import("./deepsearch-bar.js").then(({ renderDeepSearchBar, startDeepSearchPolling, wireDeepSearchBar }) => {
                                let statsContainer = targetMsg.querySelector(".deepsearch-stats-container");
                                if (!statsContainer) {
                                    statsContainer = document.createElement("div");
                                    statsContainer.className = "deepsearch-stats-container";
                                    targetMsg.appendChild(statsContainer);
                                }
                                statsContainer.innerHTML = renderDeepSearchBar(data.job);
                                renderIcons(statsContainer);
                                wireDeepSearchBar(statsContainer, data.job.id);
                                if (data.job.status !== "completed" && data.job.status !== "failed") {
                                    startDeepSearchPolling(data.job.id, statsContainer);
                                }
                            });
                        }
                    }
                })
                .catch(() => {});
        }
    }

    const isThisRunning = Boolean(state.activeGenerations[id]?.isGenerating);
    updateSendButtonState(isThisRunning);

    // Multi-factor detection: a chat is only a start page if it has NO user content anywhere
    const hasUserMsg = Boolean(
        (session.messages && session.messages.some(m => m.role === "user")) ||
        (state.messages && state.messages.some(m => m.role === "user")) ||
        (session.messageCount && session.messageCount > 0) ||
        (chat && chat.querySelector(".message.user")) ||
        session.messages?.some(m => m.role === "user")
    );
    setStartPageMode(!hasUserMsg);
    if (session && session.isDeepSearch) {
        setDeepSearchActive(true);
    } else if (hasUserMsg) {
        if (state.isDeepSearchActive) {
            setDeepSearchActive(false);
        }
    } else if (session && session.isDeepSearch !== undefined) {
        setDeepSearchActive(Boolean(session.isDeepSearch));
    }

    saveStoredChats();
    renderChatList();
}

export function deleteChatSession(id) {
    if (!state.chatSessions[id]) return;

    if (state.activeGenerations[id]) {
        stopChatGeneration(id);
    }

    delete state.chatSessions[id];
    hideChatItemMenu();
    fetch("/api/chats/" + encodeURIComponent(id), { method: "DELETE" }).catch(() => {});

    if (state.currentChatId === id) {
        state.currentChatId = null;
        const remaining = Object.keys(state.chatSessions);
        if (remaining.length > 0) {
            remaining.sort((a, b) => (state.chatSessions[b].updatedAt || 0) - (state.chatSessions[a].updatedAt || 0));
            switchToChat(remaining[0]);
        } else {
            const chat = document.getElementById("chat");
            if (chat) chat.innerHTML = "";
            state.messages = [{ role: "system", content: state.activeSystemPrompt }];
            updateSendButtonState(false);
            saveStoredChats();
            renderChatList();
        }
    } else {
        saveStoredChats();
        renderChatList();
    }
}

export function renameChatSession(id) {
    if (!state.chatSessions[id]) return;
    hideChatItemMenu();
    const oldTitle = state.chatSessions[id].title || "Untitled Chat";
    const newTitle = window.prompt("Rename conversation:", oldTitle);
    if (newTitle !== null && newTitle.trim()) {
        state.chatSessions[id].title = newTitle.trim();
        saveStoredChats();
        renderChatList();
    }
}

function showChatItemMenu(id, targetBtn) {
    activeMenuChatId = id;
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

export function hideChatItemMenu() {
    activeMenuChatId = null;
    activeMenuProjectChatId = null;
    const menu = document.getElementById("chatItemMenu");
    if (menu) menu.style.display = "none";
}

function showProjectMenu(projectId, targetBtn) {
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

export function hideProjectMenu() {
    activeMenuProjectId = null;
    const menu = document.getElementById("projectItemMenu");
    if (menu) menu.style.display = "none";
}

function showBuildChatMenu(projectId, chatId, targetBtn) {
    activeMenuProjectId = projectId;
    activeMenuProjectChatId = chatId;
    activeMenuChatId = chatId;

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

export function closeAddProjectModal() {
    const backdrop = document.getElementById("projectModalBackdrop");
    const modal = document.getElementById("projectModal");
    if (backdrop) backdrop.style.display = "none";
    if (modal) modal.style.display = "none";
}

async function validateDirectoryInput(pathStr) {
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

export let availableModels = [];
export let modelProviderMap = {};
export let modelVisionMap = {};

// Lazy import to avoid circular deps (local-connect imports from side-panel)
let _localConnect = null;
async function getLocalConnect() {
    if (!_localConnect) {
        _localConnect = await import("./local-connect.js");
    }
    return _localConnect;
}

export function isModelVisionCapable(modelId) {
    if (!modelId) {
        const sel = document.getElementById("modelSelect");
        modelId = sel ? sel.value : null;
    }
    if (!modelId) return true;
    if (typeof modelVisionMap[modelId] === "boolean") {
        return modelVisionMap[modelId];
    }
    const lower = String(modelId).toLowerCase();
    if (lower.startsWith("gemini") || lower.includes("vision") || lower.includes("gpt-4o") || lower.includes("claude-3-5") || lower.includes("claude-3-7")) {
        return true;
    }
    return false;
}

export async function loadAvailableModels() {
    const modelSelect = document.getElementById("modelSelect");
    const cfgStartupLLM = document.getElementById("cfgStartupLLM");
    if (!modelSelect) return;

    try {
        const res = await fetch("/api/models");
        if (!res.ok) return;
        const data = await res.json();
        if (!data.providers || !Array.isArray(data.providers)) return;

        availableModels = [];
        modelProviderMap = {};

        const previousVal = modelSelect.value;
        modelSelect.innerHTML = "";
        if (cfgStartupLLM) cfgStartupLLM.innerHTML = "";

        let defaultModelId = null;

        data.providers.forEach(provider => {
            // Rolling providers: show a "Connect…" entry instead of model list
            if (provider.rolling) {
                const group = document.createElement("optgroup");
                group.label = provider.name;
                group.dataset.provider = provider.id;

                const placeholder = document.createElement("option");
                placeholder.value = `__rolling_connect__${provider.id}`;
                placeholder.textContent = `⚡ Connect ${provider.name}…`;
                placeholder.dataset.provider = provider.id;
                placeholder.dataset.rolling = "true";
                group.appendChild(placeholder);

                modelSelect.appendChild(group);

                // If server already probed this session, auto-reconnect silently
                const isLocalProvider = provider.id === "local" || provider.id === "koboldcpp";
                if (isLocalProvider && provider.connected_base_url) {
                    getLocalConnect().then(lc => {
                        lc.tryLocalAutoReconnect(null).catch(() => {});
                    });
                }
                return;
            }

            if (!provider.models || provider.models.length === 0) return;
            const group = document.createElement("optgroup");
            group.label = provider.name + (provider.available ? "" : " (No Key)");
            if (!provider.available) {
                group.disabled = true;
            }

            const cfgGroup = document.createElement("optgroup");
            cfgGroup.label = group.label;

            provider.models.forEach(model => {
                availableModels.push(model);
                modelProviderMap[model.id] = provider.id;
                modelVisionMap[model.id] = Boolean(model.supports_vision);

                const opt = document.createElement("option");
                opt.value = model.id;
                opt.textContent = model.name + (model.supports_vision ? " [Vision]" : "");
                opt.dataset.provider = provider.id;
                opt.dataset.vision = model.supports_vision ? "true" : "false";
                if (model.default && !defaultModelId) {
                    defaultModelId = model.id;
                }
                group.appendChild(opt);

                if (cfgStartupLLM) {
                    const cfgOpt = opt.cloneNode(true);
                    cfgGroup.appendChild(cfgOpt);
                }
            });

            modelSelect.appendChild(group);
            if (cfgStartupLLM) cfgStartupLLM.appendChild(cfgGroup);
        });

        if (state.currentChatId && state.chatSessions[state.currentChatId]?.model) {
            const curModel = state.chatSessions[state.currentChatId].model;
            if (modelSelect.querySelector(`option[value="${CSS.escape(curModel)}"]`)) {
                modelSelect.value = curModel;
            }
        } else if (previousVal && modelSelect.querySelector(`option[value="${CSS.escape(previousVal)}"]`)) {
            modelSelect.value = previousVal;
        } else if (defaultModelId && modelSelect.querySelector(`option[value="${CSS.escape(defaultModelId)}"]`)) {
            modelSelect.value = defaultModelId;
        }

        if (state.currentChatId && state.chatSessions[state.currentChatId]) {
            state.chatSessions[state.currentChatId].model = modelSelect.value;
            const prov = modelSelect.selectedOptions?.[0]?.dataset?.provider;
            if (prov) state.chatSessions[state.currentChatId].provider = prov;
        }

        updateModelPickerDisplay();
    } catch (e) {
        console.warn("[MODELS] Failed to load models from server:", e);
    }
}

export function startFreshChat() {
    hideMobileActions();
    hideChatItemMenu();
    if (state.currentChatId && state.chatSessions[state.currentChatId]) {
        saveCurrentChatState();
    }
    state.currentChatId = null;
    setDeepSearchActive(false);
    saveStoredChats();
    const chat = document.getElementById("chat");
    const input = document.getElementById("input");
    if (chat) chat.innerHTML = "";
    state.messages = [{ role: "system", content: state.activeSystemPrompt }];
    updateSendButtonState(false);
    renderChatList();
    setStartPageMode(true);
    if (input) {
        input.value = "";
        input.focus();
    }
    closePanel(true);
}

export function initSidePanel() {
    const newChatButton = document.getElementById("newChat");
    const headerNewChatBtn = document.getElementById("headerNewChatBtn");
    const newVoiceBtn = document.getElementById("newVoiceBtn");
    const newImageBtn = document.getElementById("newImageBtn");

    if (headerNewChatBtn) {
        headerNewChatBtn.addEventListener("click", () => {
            startFreshChat();
        });
    }
    const modelSelect = document.getElementById("modelSelect");
    const input = document.getElementById("input");

    // Search Controls
    const sidePanel = document.getElementById("sidePanel");
    const panelSearchToggle = document.getElementById("panelSearchToggle");
    const panelSearchClose = document.getElementById("panelSearchClose");
    const panelSearchInput = document.getElementById("panelSearchInput");

    // Context Popover Controls
    const chatRenameBtn = document.getElementById("chatRenameBtn");
    const chatDeleteBtn = document.getElementById("chatDeleteBtn");

    // Project Popover Controls
    const projectCopyPathBtn = document.getElementById("projectCopyPathBtn");
    const projectNewChatMenuBtn = document.getElementById("projectNewChatMenuBtn");
    const projectRemoveBtn = document.getElementById("projectRemoveBtn");

    // Project Modal Controls
    const addProjectBtn = document.getElementById("addProjectBtn");
    const panelAddProjectHeaderBtn = document.getElementById("panelAddProjectHeaderBtn");
    const projectModalBackdrop = document.getElementById("projectModalBackdrop");
    const projectModalCloseBtn = document.getElementById("projectModalCloseBtn");
    const projectModalCancelBtn = document.getElementById("projectModalCancelBtn");
    const projectModalConfirmBtn = document.getElementById("projectModalConfirmBtn");
    const projectPathInput = document.getElementById("projectPathInput");
    const projectNameInput = document.getElementById("projectNameInput");

    // Settings Button
    const panelSettingsBtn = document.getElementById("panelSettingsBtn");

    loadAvailableModels();
    syncBuildProjectsFromDisk();

    // 1. New Chat
    if (newChatButton) {
        newChatButton.addEventListener("click", () => {
            startFreshChat();
        });
    }

    // 2. New Voice Chat
    if (newVoiceBtn) {
        newVoiceBtn.addEventListener("click", () => {
            startFreshChat();
            if (input) {
                input.placeholder = "Listening for voice...";
                input.focus();
            }
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                try {
                    const recognition = new SpeechRecognition();
                    recognition.continuous = false;
                    recognition.interimResults = true;
                    recognition.lang = "en-US";
                    recognition.onresult = (evt) => {
                        const transcript = Array.from(evt.results)
                            .map(r => r[0].transcript)
                            .join("");
                        if (input) {
                            input.value = transcript;
                            input.dispatchEvent(new Event("input"));
                        }
                    };
                    recognition.onend = () => {
                        if (input) input.placeholder = "Message AI…";
                    };
                    recognition.start();
                } catch (err) {
                    console.warn("Speech recognition error:", err);
                    if (input) input.placeholder = "Message AI…";
                }
            } else {
                if (input) {
                    input.placeholder = "Message AI…";
                }
            }
        });
    }

    // 3. New Image
    if (newImageBtn) {
        newImageBtn.addEventListener("click", () => {
            startFreshChat();
            if (input) {
                input.value = "Generate an image of ";
                input.dispatchEvent(new Event("input"));
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
        });
    }

    // 4. Smooth Panel Search Mode
    if (panelSearchToggle) {
        panelSearchToggle.addEventListener("click", () => {
            const isActive = sidePanel?.classList.contains("search-active");
            setPanelSearchMode(!isActive);
        });
    }

    if (panelSearchClose) {
        panelSearchClose.addEventListener("click", () => {
            setPanelSearchMode(false);
        });
    }

    if (panelSearchInput) {
        panelSearchInput.addEventListener("input", () => {
            currentSearchFilter = panelSearchInput.value.trim().toLowerCase();
            if (state.appMode === "build") {
                renderProjectList(currentSearchFilter);
            } else {
                renderChatList(currentSearchFilter);
            }
        });

        panelSearchInput.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                setPanelSearchMode(false);
            }
        });
    }

    // 5. Add Project Controls & Modal
    if (addProjectBtn) {
        addProjectBtn.addEventListener("click", () => {
            openAddProjectModal();
        });
    }

    if (panelAddProjectHeaderBtn) {
        panelAddProjectHeaderBtn.addEventListener("click", () => {
            openAddProjectModal();
        });
    }

    if (projectModalCloseBtn) {
        projectModalCloseBtn.addEventListener("click", closeAddProjectModal);
    }
    if (projectModalCancelBtn) {
        projectModalCancelBtn.addEventListener("click", closeAddProjectModal);
    }
    if (projectModalBackdrop) {
        projectModalBackdrop.addEventListener("click", closeAddProjectModal);
    }

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

    // 6. Project Popover Actions
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

    // 7. Chat Item Popover Actions (Unified for normal chats and build chats)
    if (chatRenameBtn) {
        chatRenameBtn.addEventListener("click", () => {
            if (activeMenuProjectChatId && activeMenuProjectId) {
                hideChatItemMenu();
                const pid = activeMenuProjectId;
                const cid = activeMenuProjectChatId;
                const project = state.buildProjects.find(p => p.id === pid);
                const chat = project?.chats?.find(c => c.id === cid);
                const oldTitle = chat?.title || state.chatSessions[cid]?.title || "Build Task";
                const newTitle = window.prompt("Rename task:", oldTitle);
                if (newTitle !== null && newTitle.trim()) {
                    if (chat) chat.title = newTitle.trim();
                    if (state.chatSessions[cid]) state.chatSessions[cid].title = newTitle.trim();
                    saveBuildChatToDisk(pid, state.chatSessions[cid] || { id: cid, title: newTitle.trim(), projectId: pid, mode: "build" });
                    renderProjectList();
                }
            } else if (activeMenuChatId) {
                renameChatSession(activeMenuChatId);
            }
        });
    }

    if (chatDeleteBtn) {
        chatDeleteBtn.addEventListener("click", () => {
            if (activeMenuProjectChatId && activeMenuProjectId) {
                hideChatItemMenu();
                const pid = activeMenuProjectId;
                const cid = activeMenuProjectChatId;
                fetch(`/api/build/projects/${encodeURIComponent(pid)}/chats/${encodeURIComponent(cid)}`, { method: "DELETE" }).catch(() => {});
                const project = state.buildProjects.find(p => p.id === pid);
                if (project && project.chats) {
                    project.chats = project.chats.filter(c => c.id !== cid);
                }
                delete state.chatSessions[cid];
                if (state.currentChatId === cid) {
                    state.currentChatId = null;
                    const chat = document.getElementById("chat");
                    if (chat) chat.innerHTML = "";
                    state.messages = [{ role: "system", content: state.activeSystemPrompt }];
                    setStartPageMode(true);
                }
                renderProjectList();
            } else if (activeMenuChatId) {
                deleteChatSession(activeMenuChatId);
            }
        });
    }

    document.addEventListener("click", (e) => {
        if (!e.target.closest("#chatItemMenu") && !e.target.closest(".chat-item-more-btn") && !e.target.closest(".project-chat-more-btn")) {
            hideChatItemMenu();
        }
        if (!e.target.closest("#projectItemMenu") && !e.target.closest(".project-more-btn")) {
            hideProjectMenu();
        }
    });

    // 8. Settings Screen
    if (panelSettingsBtn) {
        panelSettingsBtn.addEventListener("click", () => {
            hideChatItemMenu();
            hideProjectMenu();
            openSettings("general");
        });
    }

    // 9. Model select listener
    if (modelSelect) {
        modelSelect.addEventListener("change", () => {
            if (state.currentChatId && state.chatSessions[state.currentChatId]) {
                state.chatSessions[state.currentChatId].model = modelSelect.value;
                const prov = modelSelect.selectedOptions?.[0]?.dataset?.provider;
                if (prov) state.chatSessions[state.currentChatId].provider = prov;
                saveStoredChats();
            }
        });
    }

    // 10. External Event Listeners
    document.addEventListener("chatsUpdated", () => {
        if (state.appMode === "chat") {
            renderChatList();
        }
    });

    document.addEventListener("projectsUpdated", () => {
        if (state.appMode === "build") {
            renderProjectList();
        }
    });

    window.addEventListener("app-mode-changed", (e) => {
        const mode = e.detail?.mode || state.appMode;
        updateSidePanelView(mode);
        syncActiveModeConversation(mode);
    });

    // 11. Scroll gradient listener on panel body
    const panelBody = sidePanel?.querySelector(".panel-body");
    if (panelBody) {
        const updateScrollState = () => {
            panelBody.classList.toggle("scrolled-top", panelBody.scrollTop > 2);
        };
        panelBody.addEventListener("scroll", updateScrollState, { passive: true });
        updateScrollState();
    }

    // Initialize side panel view according to active mode
    updateSidePanelView(state.appMode);
}

/**
 * Automatically activates and renders the appropriate conversation context
 * when switching between Chat and Build modes or when reloading the page.
 */
export async function syncActiveModeConversation(mode = state.appMode) {
    const isBuild = mode === "build";
    const chat = document.getElementById("chat");

    if (isBuild) {
        const activeProjectId = localStorage.getItem(ACTIVE_BUILD_PROJECT_KEY);
        const activeBuildChatId = localStorage.getItem(ACTIVE_BUILD_CHAT_KEY);

        if (activeProjectId && activeBuildChatId) {
            await switchToBuildChat(activeProjectId, activeBuildChatId);
            return;
        }

        // Fallback: Check if any project has chats
        const allProjects = state.buildProjects || [];
        let mostRecentProject = null;
        let mostRecentChat = null;

        for (const proj of allProjects) {
            if (Array.isArray(proj.chats) && proj.chats.length > 0) {
                for (const c of proj.chats) {
                    if (!mostRecentChat || (c.updatedAt || c.createdAt || 0) > (mostRecentChat.updatedAt || mostRecentChat.createdAt || 0)) {
                        mostRecentChat = c;
                        mostRecentProject = proj;
                    }
                }
            }
        }

        if (mostRecentProject && mostRecentChat) {
            await switchToBuildChat(mostRecentProject.id, mostRecentChat.id);
            return;
        }

        if (allProjects.length > 0) {
            await startFreshBuildChat(allProjects[0].id);
            return;
        }

        // Truly empty build mode: show start page with Lets Build
        state.currentProjectId = null;
        state.currentChatId = null;
        if (chat) chat.innerHTML = "";
        state.messages = [{ role: "system", content: state.activeSystemPrompt }];
        setStartPageMode(true);
        updateSidePanelView("build");
    } else {
        const activeId = localStorage.getItem(ACTIVE_CHAT_KEY);
        if (activeId && state.chatSessions[activeId] && !state.chatSessions[activeId].projectId && state.chatSessions[activeId].mode !== "build") {
            state.currentChatId = null;
            await switchToChat(activeId);
            return;
        }

        const validSessions = Object.values(state.chatSessions).filter(s => 
            s && !s.projectId && (s.mode !== "build") && (s.messages?.some(m => m.role === "user") || (s.messageCount && s.messageCount > 0) || s.workspace)
        );

        if (validSessions.length > 0) {
            validSessions.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
            state.currentChatId = null;
            await switchToChat(validSessions[0].id);
            return;
        }

        startFreshChat();
    }
}
