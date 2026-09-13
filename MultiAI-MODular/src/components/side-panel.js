/* =========================================================
   SIDE PANEL & CHAT HISTORY COMPONENT (DUCK.AI INSPIRED)
   ========================================================= */
import { state } from "../state.js";
import { escapeHTML, formatRelativeTime, wrapTablesForScroll } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { saveStoredChats, saveCurrentChatState } from "../services/storage.js";
import { closePanel } from "./gestures.js";
import { hideMobileActions } from "./context-menu.js";
import { bindInteractiveCodeBlocks, renderMermaidInElement, renderMath } from "./renderer.js";
import { updateSendButtonState, stopChatGeneration } from "./composer.js";

let currentSearchFilter = "";
let activeMenuChatId = null;

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

        const item = document.createElement("div");
        item.className = `chat-item ${isActive ? "active" : ""}`;
        item.dataset.chatId = id;
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");

        item.innerHTML = `
            <div class="chat-item-main">
                <span class="chat-item-title">${escapeHTML(session.title || "Untitled Chat")}</span>
            </div>
            ${isRunning ? '<div class="chat-item-spinner" title="Task running in background"></div>' : ''}
            <button type="button" class="chat-item-more-btn" title="Options" aria-label="Conversation options">
                <i data-lucide="more-horizontal"></i>
            </button>
        `;

        item.addEventListener("click", (e) => {
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

    state.messages = (session.messages && session.messages.length > 0)
        ? JSON.parse(JSON.stringify(session.messages))
        : [{ role: "system", content: state.activeSystemPrompt }];

    if (state.messages[0]?.role === "system") {
        state.messages[0].content = state.activeSystemPrompt;
    }

    if (session.model && modelSelect) {
        modelSelect.value = session.model;
    }

    if (chat) {
        chat.innerHTML = session.chatHtml || "";

        chat.querySelectorAll(".message.user").forEach(msg => {
            if (!msg.dataset.rawText) {
                msg.dataset.rawText = msg.textContent.trim();
            }
        });

        bindInteractiveCodeBlocks(chat);
        renderMermaidInElement(chat);
        wrapTablesForScroll(chat);
        renderIcons(chat);
        renderMath(chat);

        chat.scrollTop = chat.scrollHeight;
    }

    const isThisRunning = Boolean(state.activeGenerations[id]?.isGenerating);
    updateSendButtonState(isThisRunning);

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
    menu.style.left = `${Math.max(10, rect.left - 100)}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    renderIcons(menu);
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
    } catch (e) {
        console.warn("[MODELS] Failed to load models from server:", e);
    }
}

function startFreshChat() {
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
    if (input) {
        input.value = "";
        input.style.height = "auto";
        input.focus();
    }
    closePanel(true);
}

export function initSidePanel() {
    const newChatButton = document.getElementById("newChat");
    const newVoiceBtn = document.getElementById("newVoiceBtn");
    const newImageBtn = document.getElementById("newImageBtn");
    const modelSelect = document.getElementById("modelSelect");
    const input = document.getElementById("input");

    // Search Controls
    const panelSearchToggle = document.getElementById("panelSearchToggle");
    const panelSearchRow = document.getElementById("panelSearchRow");
    const panelSearchInput = document.getElementById("panelSearchInput");
    const panelSearchClear = document.getElementById("panelSearchClear");

    // Context Popover Controls
    const chatRenameBtn = document.getElementById("chatRenameBtn");
    const chatDeleteBtn = document.getElementById("chatDeleteBtn");

    // Settings Modal Controls
    const panelSettingsBtn = document.getElementById("panelSettingsBtn");
    const settingsModal = document.getElementById("settingsModal");
    const settingsBackdrop = document.getElementById("settingsBackdrop");
    const settingsCloseBtn = document.getElementById("settingsCloseBtn");
    const settingsCancelBtn = document.getElementById("settingsCancelBtn");
    const settingsSaveBtn = document.getElementById("settingsSaveBtn");

    const cfgStartupLLM = document.getElementById("cfgStartupLLM");
    const cfgImageProvider = document.getElementById("cfgImageProvider");
    const cfgImageRatio = document.getElementById("cfgImageRatio");
    const cfgTheme = document.getElementById("cfgTheme");
    const cfgRecordHistory = document.getElementById("cfgRecordHistory");
    const cfgRecordDate = document.getElementById("cfgRecordDate");

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

    // 4. Search Filter
    if (panelSearchToggle && panelSearchRow && panelSearchInput) {
        panelSearchToggle.addEventListener("click", () => {
            const isVisible = panelSearchRow.style.display !== "none";
            if (isVisible) {
                panelSearchRow.style.display = "none";
                panelSearchInput.value = "";
                currentSearchFilter = "";
                renderChatList();
            } else {
                panelSearchRow.style.display = "block";
                panelSearchInput.focus();
            }
        });

        panelSearchInput.addEventListener("input", () => {
            currentSearchFilter = panelSearchInput.value.trim().toLowerCase();
            renderChatList(currentSearchFilter);
        });
    }

    if (panelSearchClear && panelSearchRow && panelSearchInput) {
        panelSearchClear.addEventListener("click", () => {
            panelSearchInput.value = "";
            currentSearchFilter = "";
            panelSearchRow.style.display = "none";
            renderChatList();
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

    // 6. Settings Modal
    const openSettings = () => {
        if (!settingsModal || !settingsBackdrop) return;
        hideChatItemMenu();
        if (state.config) {
            if (cfgStartupLLM && state.config.General?.DefaultStartupLLM) {
                cfgStartupLLM.value = state.config.General.DefaultStartupLLM;
            }
            if (cfgImageProvider && state.config.General?.DefaultImageProvider) {
                cfgImageProvider.value = state.config.General.DefaultImageProvider;
            }
            if (cfgImageRatio && state.config.General?.DefaultImageAspectRatio) {
                cfgImageRatio.value = state.config.General.DefaultImageAspectRatio;
            }
            if (cfgTheme && state.config.UI?.Theme) {
                cfgTheme.value = state.config.UI.Theme;
            }
            if (cfgRecordHistory && state.config.General?.RecordChatHistory !== undefined) {
                cfgRecordHistory.checked = Boolean(state.config.General.RecordChatHistory);
            }
            if (cfgRecordDate && state.config.General?.RecordDate !== undefined) {
                cfgRecordDate.checked = Boolean(state.config.General.RecordDate);
            }
        }
        settingsModal.style.display = "flex";
        settingsBackdrop.style.display = "block";
        renderIcons(settingsModal);
    };

    const closeSettings = () => {
        if (settingsModal) settingsModal.style.display = "none";
        if (settingsBackdrop) settingsBackdrop.style.display = "none";
    };

    if (panelSettingsBtn) {
        panelSettingsBtn.addEventListener("click", openSettings);
    }
    if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", closeSettings);
    if (settingsCancelBtn) settingsCancelBtn.addEventListener("click", closeSettings);
    if (settingsBackdrop) settingsBackdrop.addEventListener("click", closeSettings);

    if (settingsSaveBtn) {
        settingsSaveBtn.addEventListener("click", async () => {
            settingsSaveBtn.disabled = true;
            settingsSaveBtn.textContent = "Saving...";

            state.config = state.config || {};
            state.config.General = state.config.General || {};
            state.config.UI = state.config.UI || {};

            if (cfgStartupLLM) state.config.General.DefaultStartupLLM = cfgStartupLLM.value;
            if (cfgImageProvider) state.config.General.DefaultImageProvider = cfgImageProvider.value;
            if (cfgImageRatio) state.config.General.DefaultImageAspectRatio = cfgImageRatio.value;
            if (cfgTheme) state.config.UI.Theme = cfgTheme.value;
            if (cfgRecordHistory) state.config.General.RecordChatHistory = cfgRecordHistory.checked;
            if (cfgRecordDate) state.config.General.RecordDate = cfgRecordDate.checked;

            try {
                await fetch("/api/config", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(state.config)
                });
            } catch (err) {
                console.warn("Failed to persist config to server:", err);
            }

            settingsSaveBtn.disabled = false;
            settingsSaveBtn.textContent = "Save Changes";
            closeSettings();
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
}
