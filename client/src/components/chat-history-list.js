/* =========================================================
   CHAT HISTORY LIST & SESSION SWITCHING COMPONENT
   ========================================================= */
import { ACTIVE_CHAT_KEY } from "../config.js";
import { state, setDeepSearchActive } from "../state/index.js";
import { formatChatDate, wrapTablesForScroll } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { 
    saveStoredChats, 
    saveCurrentChatState, 
    initChatWorkspace,
    saveBuildChatToDisk
} from "../services/storage.js";
import { syncActiveWorkspacePrompt } from "../services/system.js";
import { closePanel } from "./gestures.js";
import { hideMobileActions, showChatItemContextMenu } from "./context-menu.js";
import { bindInteractiveCodeBlocks, renderMermaidInElement, renderMath, bindAIImageCards } from "./renderer.js";
import { updateSendButtonState, stopChatGeneration } from "./composer.js";
import { updateModelPickerDisplay } from "./model-picker.js";
import { setStartPageMode } from "./chatbox.js";
import { wrapHugeThoughts, renderSessionMessages } from "./chat-ui.js";
import { 
    renderProjectList, 
    hideProjectMenu, 
    activeMenuProjectId, 
    activeMenuProjectChatId,
    resetBuildChatMenuState,
    switchToBuildChat,
    startFreshBuildChat
} from "./build-projects-panel.js";

/** Cached snapshot per chat-item so we know what's already rendered. */
export const _chatItemCache = new Map(); // chatId -> { title, dateStr, isActive, isRunning }
export let activeMenuChatId = null;

/**
 * Renders the list of conversations with keyed-diff patching.
 */
export function renderChatList(filterQuery = "") {
    if (state.appMode === "build") {
        renderProjectList(filterQuery);
        return;
    }
    const chatList = document.getElementById("chatList");
    if (!chatList) return;

    let ids = Object.keys(state.chatSessions || {});

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

            // Bind events once per node
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

        // Maintain sorted DOM order without full rebuild
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

/**
 * Activates and displays a selected conversation session.
 */
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

/**
 * Deletes a chat session by ID and switches to remaining sessions.
 */
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

/**
 * Prompts the user to rename a chat session.
 */
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

/**
 * Positions and displays the options popover for a chat item.
 */
export function showChatItemMenu(id, targetBtn) {
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

/**
 * Hides the chat item options popover.
 */
export function hideChatItemMenu() {
    activeMenuChatId = null;
    resetBuildChatMenuState();
    const menu = document.getElementById("chatItemMenu");
    if (menu) menu.style.display = "none";
}

/**
 * Binds Rename and Delete actions on the shared chatItemMenu.
 */
export function initChatListListeners() {
    const chatRenameBtn = document.getElementById("chatRenameBtn");
    const chatDeleteBtn = document.getElementById("chatDeleteBtn");

    if (chatRenameBtn) {
        chatRenameBtn.addEventListener("click", () => {
            if (activeMenuProjectChatId && activeMenuProjectId) {
                const pid = activeMenuProjectId;
                const cid = activeMenuProjectChatId;
                hideChatItemMenu();

                const project = state.buildProjects?.find(p => p.id === pid);
                const chat = project?.chats?.find(c => c.id === cid);
                const oldTitle = chat?.title || state.chatSessions[cid]?.title || "Build Task";

                // Find the rendered list item and inline-edit its title span
                const listItem = document.querySelector(
                    `.project-chat-item[data-chat-id="${CSS.escape(cid)}"]`
                );
                const titleSpan = listItem?.querySelector(".project-chat-title");

                if (titleSpan) {
                    const input = document.createElement("input");
                    input.className = "project-chat-title-edit";
                    input.value = oldTitle;
                    input.maxLength = 80;
                    titleSpan.replaceWith(input);
                    input.select();

                    const commit = () => {
                        const val = input.value.trim() || oldTitle;
                        const span = document.createElement("span");
                        span.className = "project-chat-title";
                        span.textContent = val;
                        input.replaceWith(span);
                        if (val !== oldTitle) {
                            if (chat) chat.title = val;
                            if (state.chatSessions[cid]) state.chatSessions[cid].title = val;
                            saveBuildChatToDisk(pid, state.chatSessions[cid] || { id: cid, title: val, projectId: pid, mode: "build" });
                        }
                    };
                    input.addEventListener("blur", commit, { once: true });
                    input.addEventListener("keydown", (e) => {
                        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
                        if (e.key === "Escape") { input.value = oldTitle; input.blur(); }
                    });
                } else {
                    // fallback if item not visible in DOM
                    const newTitle = window.prompt("Rename task:", oldTitle);
                    if (newTitle !== null && newTitle.trim()) {
                        if (chat) chat.title = newTitle.trim();
                        if (state.chatSessions[cid]) state.chatSessions[cid].title = newTitle.trim();
                        saveBuildChatToDisk(pid, state.chatSessions[cid] || { id: cid, title: newTitle.trim(), projectId: pid, mode: "build" });
                        renderProjectList();
                    }
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
                const project = state.buildProjects?.find(p => p.id === pid);
                const chat = project?.chats?.find(c => c.id === cid);
                const chatName = chat?.title || "this build task";
                if (window.confirm(`Delete "${chatName}"?`)) {
                    if (project && Array.isArray(project.chats)) {
                        project.chats = project.chats.filter(c => c.id !== cid);
                    }
                    delete state.chatSessions[cid];
                    fetch(`/api/build/projects/${encodeURIComponent(pid)}/chats/${encodeURIComponent(cid)}`, { method: "DELETE" }).catch(() => {});
                    if (state.currentChatId === cid) {
                        const remaining = project?.chats || [];
                        if (remaining.length > 0) {
                            switchToBuildChat(pid, remaining[0].id);
                        } else {
                            startFreshBuildChat(pid);
                        }
                    } else {
                        renderProjectList();
                    }
                }
            } else if (activeMenuChatId) {
                deleteChatSession(activeMenuChatId);
            }
        });
    }
}
