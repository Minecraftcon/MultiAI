/* =========================================================
   SIDE PANEL & CHAT HISTORY COMPONENT (DUCK.AI INSPIRED)
   ========================================================= */
import { state } from "../state.js";
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

export function renderChatList(filterQuery = currentSearchFilter) {
    if (state.appMode === "build") {
        renderProjectList(filterQuery);
        return;
    }
    const chatList = document.getElementById("chatList");
    if (!chatList) return;

    let ids = Object.keys(state.chatSessions);

    if (ids.length === 0) {
        chatList.innerHTML = '<div class="history-empty">No conversations yet</div>';
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
            return;
        }
    }

    chatList.innerHTML = "";
    ids.forEach(id => {
        const session = state.chatSessions[id];
        const isActive = id === state.currentChatId;
        const isRunning = Boolean(state.activeGenerations[id]?.isGenerating);
        const dateStr = formatChatDate(session.updatedAt || session.createdAt);

        const item = document.createElement("div");
        item.className = `chat-item ${isActive ? "active" : ""}`;
        item.dataset.chatId = id;
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");

        item.innerHTML = `
            <div class="chat-item-main">
                <span class="chat-item-title">${escapeHTML(session.title || "Untitled Chat")}</span>
            </div>
            ${dateStr ? `<span class="chat-item-date">${escapeHTML(dateStr)}</span>` : ''}
            ${isRunning ? '<div class="chat-item-spinner" title="Task running in background"></div>' : ''}
            <button type="button" class="chat-item-more-btn" title="Options" aria-label="Conversation options">
                <i data-lucide="more-horizontal"></i>
            </button>
        `;

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
                if (navigator.vibrate) {
                    try { navigator.vibrate(40); } catch (err) {}
                }
                showChatItemContextMenu(id, startX, startY);
            }, 450);
        }, { passive: true });

        item.addEventListener("touchmove", (e) => {
            if (!holdTimer) return;
            if (e.touches.length !== 1) {
                clearTimeout(holdTimer);
                holdTimer = null;
                return;
            }
            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - startX);
            const dy = Math.abs(touch.clientY - startY);
            if (dx > 10 || dy > 10) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
        }, { passive: true });

        item.addEventListener("touchend", () => {
            clearTimeout(holdTimer);
            holdTimer = null;
            if (didLongPress) {
                setTimeout(() => {
                    didLongPress = false;
                }, 350);
            }
        });

        item.addEventListener("touchcancel", () => {
            clearTimeout(holdTimer);
            holdTimer = null;
            didLongPress = false;
        });

        item.addEventListener("click", (e) => {
            if (didLongPress) {
                e.preventDefault();
                e.stopPropagation();
                didLongPress = false;
                return;
            }
            if (e.target.closest(".chat-item-more-btn")) return;
            if (id !== state.currentChatId) {
                switchToChat(id);
            }
            closePanel(true);
        });

        item.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (id !== state.currentChatId) {
                    switchToChat(id);
                }
                closePanel(true);
            }
        });

        const moreBtn = item.querySelector(".chat-item-more-btn");
        if (moreBtn) {
            moreBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                e.preventDefault();
                showChatItemMenu(id, moreBtn);
            });
        }

        chatList.appendChild(item);
    });

    renderIcons(chatList);

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
        ? JSON.parse(JSON.stringify(session.messages))
        : [{ role: "system", content: state.activeSystemPrompt }];

    if (state.messages[0]?.role === "system") {
        state.messages[0].content = state.activeSystemPrompt;
    }

    if (session.model && modelSelect) {
        modelSelect.value = session.model;
        updateModelPickerDisplay();
    }

    if (chat) {
        chat.innerHTML = session.chatHtml || "";

        if ((!chat.innerHTML || !chat.innerHTML.trim()) && Array.isArray(session.messages) && session.messages.length > 0) {
            session.messages.forEach(m => {
                if (m.role === "user") {
                    const div = document.createElement("div");
                    div.className = "message user";
                    div.dataset.rawText = m.content || "";
                    div.innerHTML = `<div class="user-bubble-content"><div class="msg-bubble-text">${escapeHTML(m.content || "")}</div></div>`;
                    chat.appendChild(div);
                } else if (m.role === "assistant") {
                    const div = document.createElement("div");
                    div.className = "message ai";
                    div.dataset.rawText = m.content || "";
                    div.innerHTML = `<div class="pre-search-content">${parseMarkdown(m.content || "")}</div><div class="activity-wrapper" style="display:none;"><button type="button" class="activity-toggle"><span class="chevron">▶</span><span class="activity-label">Activity</span></button><div class="activity-collapse"><div class="activity-overflow"><div class="activity-content"><div class="search-items-container"></div></div></div></div></div><div class="final-content"></div><div class="followup-suggestions" style="display:none;"></div>`;
                    chat.appendChild(div);
                }
            });
        }

        bindInteractiveCodeBlocks(chat);
        renderMermaidInElement(chat);
        wrapTablesForScroll(chat);
        renderIcons(chat);
        renderMath(chat);
        bindAIImageCards(chat, true);
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

export function switchToChat(id) {
    if (!state.chatSessions[id]) return;
    hideMobileActions();
    hideChatItemMenu();

    if (state.currentChatId && state.currentChatId !== id && state.chatSessions[state.currentChatId]) {
        saveCurrentChatState();
    }

    state.currentChatId = id;
    const session = state.chatSessions[id];
    const chat = document.getElementById("chat");
    const modelSelect = document.getElementById("modelSelect");

    if (session.workspace) {
        syncActiveWorkspacePrompt(session.workspace);
    } else {
        initChatWorkspace(id, session.createdAt);
    }

    state.messages = (session.messages && session.messages.length > 0)
        ? JSON.parse(JSON.stringify(session.messages))
        : [{ role: "system", content: state.activeSystemPrompt }];

    if (state.messages[0]?.role === "system") {
        state.messages[0].content = state.activeSystemPrompt;
    }

    if (session.model && modelSelect) {
        modelSelect.value = session.model;
        updateModelPickerDisplay();
    }

    if (chat) {
        chat.innerHTML = session.chatHtml || "";

        // Reconstruct from messages if chatHtml was empty or missing
        if ((!chat.innerHTML || !chat.innerHTML.trim()) && Array.isArray(session.messages) && session.messages.length > 0) {
            session.messages.forEach(m => {
                if (m.role === "user") {
                    const div = document.createElement("div");
                    div.className = "message user";
                    div.dataset.rawText = m.content || "";
                    div.innerHTML = `<div class="user-bubble-content"><div class="msg-bubble-text">${escapeHTML(m.content || "")}</div></div>`;
                    chat.appendChild(div);
                } else if (m.role === "assistant") {
                    const div = document.createElement("div");
                    div.className = "message ai";
                    div.dataset.rawText = m.content || "";
                    div.innerHTML = `<div class="pre-search-content">${parseMarkdown(m.content || "")}</div><div class="activity-wrapper" style="display:none;"><button type="button" class="activity-toggle"><span class="chevron">▶</span><span class="activity-label">Activity</span></button><div class="activity-collapse"><div class="activity-overflow"><div class="activity-content"><div class="search-items-container"></div></div></div></div></div><div class="final-content"></div><div class="followup-suggestions" style="display:none;"></div>`;
                    chat.appendChild(div);
                }
            });
        }

        chat.querySelectorAll(".user-msg-actions").forEach(el => el.remove());

        chat.querySelectorAll(".message.user").forEach(msg => {
            if (!msg.dataset.rawText) {
                const textEl = msg.querySelector(".msg-bubble-text");
                msg.dataset.rawText = textEl ? textEl.textContent.trim() : msg.textContent.trim();
            }
        });

        // Upgrade/re-hydrate any AI messages whose rawText contains math but KaTeX elements are absent
        chat.querySelectorAll(".message.ai").forEach(msg => {
            const raw = msg.dataset.rawText;
            if (raw && !msg.querySelector(".katex")) {
                const hasMath = raw.includes("\\[") || raw.includes("$$") || raw.includes("\\(") ||
                                /(?:^|\n)\s*\[\s*[\s\S]*?\\[a-zA-Z]+[\s\S]*?\s*\]/.test(raw) ||
                                /(?<![\$\\\w])\$[^\s\$][^\$]*?[^\s\$]?\$(?![\$\d\w])/.test(raw);
                if (hasMath) {
                    const preContent = msg.querySelector(".pre-search-content");
                    const finalContent = msg.querySelector(".final-content");
                    const target = (finalContent && finalContent.innerHTML.trim()) ? finalContent : preContent;
                    if (target) {
                        target.innerHTML = parseMarkdown(raw);
                    }
                }
            }
        });

        // Re-hydrate any thought traces that contain unrendered markdown (e.g. from runs before marked was introduced)
        chat.querySelectorAll(".activity-thought-item").forEach(item => {
            const raw = item.textContent || "";
            if (raw.includes("**") || raw.includes("`")) {
                if (typeof marked !== "undefined" && typeof marked.parse === "function") {
                    try {
                        item.innerHTML = marked.parse(raw.trim());
                    } catch {
                        // ignore
                    }
                }
            }
        });

        bindInteractiveCodeBlocks(chat);
        renderMermaidInElement(chat);
        wrapTablesForScroll(chat);
        renderIcons(chat);
        renderMath(chat);
        bindAIImageCards(chat, true);

        chat.scrollTop = chat.scrollHeight;

        // Ensure newly rendered KaTeX markup is stored in chatHtml for seamless reload
        if (session.chatHtml !== chat.innerHTML) {
            session.chatHtml = chat.innerHTML;
        }

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
                    state.messages = JSON.parse(JSON.stringify(reconstructed));
                }
            }
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
        (session.chatHtml && (session.chatHtml.includes('class="message user"') || session.chatHtml.includes("message user")))
    );
    setStartPageMode(!hasUserMsg);

    // Asynchronously fetch full messages from backend if missing
    if (!session.messages || !session.messages.some(m => m.role === "user")) {
        fetch("/api/chats/" + encodeURIComponent(id))
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data && data.session && Array.isArray(data.session.messages) && data.session.messages.length > 0) {
                    if (state.currentChatId === id) {
                        session.messages = data.session.messages;
                        state.messages = JSON.parse(JSON.stringify(session.messages));
                        if (session.messages.some(m => m.role === "user")) {
                            setStartPageMode(false);
                        }
                    }
                }
            })
            .catch(() => {});
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
        updateSidePanelView(e.detail?.mode || state.appMode);
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
