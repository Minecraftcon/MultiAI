/* =========================================================
   SIDE PANEL & CHAT HISTORY COMPONENT (DUCK.AI INSPIRED)
   ========================================================= */
import { state } from "../state.js";
import { escapeHTML, formatChatDate, wrapTablesForScroll } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { saveStoredChats, saveCurrentChatState, initChatWorkspace } from "../services/storage.js";
import { syncActiveWorkspacePrompt } from "../services/system.js";
import { closePanel } from "./gestures.js";
import { hideMobileActions, showChatItemContextMenu } from "./context-menu.js";
import { bindInteractiveCodeBlocks, renderMermaidInElement, renderMath, bindAIImageCards } from "./renderer.js";
import { updateSendButtonState, stopChatGeneration } from "./composer.js";
import { updateModelPickerDisplay } from "./model-picker.js";
import { openSettings } from "./settings-view.js";
import { setStartPageMode } from "./chatbox.js";

let currentSearchFilter = "";
let activeMenuChatId = null;

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

export function renderChatList(filterQuery = currentSearchFilter) {
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
            // If moved more than 10px, it is scrolling, cancel hold
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

        chat.scrollTop = chat.scrollHeight;
    }

    const isThisRunning = Boolean(state.activeGenerations[id]?.isGenerating);
    updateSendButtonState(isThisRunning);

    const hasUserMsg = session.messages && session.messages.some(m => m.role === "user");
    setStartPageMode(!hasUserMsg);

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
    const menu = document.getElementById("chatItemMenu");
    if (menu) menu.style.display = "none";
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

    // Settings Button
    const panelSettingsBtn = document.getElementById("panelSettingsBtn");

    loadAvailableModels();

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
                        if (input) input.placeholder = "Message AI...";
                    };
                    recognition.start();
                } catch (err) {
                    console.warn("Speech recognition error:", err);
                    if (input) input.placeholder = "Message AI...";
                }
            } else {
                if (input) {
                    input.placeholder = "Message AI...";
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
            renderChatList(currentSearchFilter);
        });

        panelSearchInput.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                setPanelSearchMode(false);
            }
        });
    }

    // 5. Chat Item Popover Actions
    if (chatRenameBtn) {
        chatRenameBtn.addEventListener("click", () => {
            if (activeMenuChatId) renameChatSession(activeMenuChatId);
        });
    }

    if (chatDeleteBtn) {
        chatDeleteBtn.addEventListener("click", () => {
            if (activeMenuChatId) deleteChatSession(activeMenuChatId);
        });
    }

    document.addEventListener("click", (e) => {
        if (!e.target.closest("#chatItemMenu") && !e.target.closest(".chat-item-more-btn")) {
            hideChatItemMenu();
        }
    });

    // 6. Settings Screen
    if (panelSettingsBtn) {
        panelSettingsBtn.addEventListener("click", () => {
            hideChatItemMenu();
            openSettings("general");
        });
    }

    // 7. Model select listener
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

    // 8. Disk sync listener
    document.addEventListener("chatsUpdated", () => {
        renderChatList();
    });

    // 9. Scroll gradient listener on panel body
    const panelBody = sidePanel?.querySelector(".panel-body");
    if (panelBody) {
        const updateScrollState = () => {
            panelBody.classList.toggle("scrolled-top", panelBody.scrollTop > 2);
        };
        panelBody.addEventListener("scroll", updateScrollState, { passive: true });
        updateScrollState();
    }
}
