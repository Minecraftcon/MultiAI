/* =========================================================
   SIDE PANEL & CHAT HISTORY COMPONENT
   ========================================================= */
import { state } from "../state.js";
import { escapeHTML, formatRelativeTime, wrapTablesForScroll } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { saveStoredChats, saveCurrentChatState } from "../services/storage.js";
import { closePanel } from "./gestures.js";
import { hideMobileActions } from "./context-menu.js";
import { bindInteractiveCodeBlocks, renderMermaidInElement, renderMath } from "./renderer.js";
import { updateSendButtonState, stopChatGeneration } from "./composer.js";

export function renderChatList() {
    const chatList = document.getElementById("chatList");
    const chatCountBadge = document.getElementById("chatCountBadge");
    if (!chatList) return;

    const ids = Object.keys(state.chatSessions);
    if (chatCountBadge) chatCountBadge.textContent = String(ids.length);

    if (ids.length === 0) {
        chatList.innerHTML = '<div class="history-empty">No conversations yet</div>';
        return;
    }

    ids.sort((a, b) => (state.chatSessions[b].updatedAt || 0) - (state.chatSessions[a].updatedAt || 0));

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
                <span class="chat-item-time">${formatRelativeTime(session.updatedAt)}</span>
            </div>
            ${isRunning ? '<div class="chat-item-spinner" title="Task running in background"></div>' : ''}
            <button type="button" class="chat-item-del" title="Delete conversation" aria-label="Delete conversation">
                <i data-lucide="x"></i>
            </button>
        `;

        item.addEventListener("click", (e) => {
            if (e.target.closest(".chat-item-del")) return;
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

        const delBtn = item.querySelector(".chat-item-del");
        if (delBtn) {
            delBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                e.preventDefault();
                deleteChatSession(id);
            });
        }

        chatList.appendChild(item);
    });

    renderIcons(chatList);
}

export function switchToChat(id) {
    if (!state.chatSessions[id]) return;
    hideMobileActions();

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

        let defaultModelId = null;

        data.providers.forEach(provider => {
            if (!provider.models || provider.models.length === 0) return;
            const group = document.createElement("optgroup");
            group.label = provider.name + (provider.available ? "" : " (No Key)");
            if (!provider.available) {
                group.disabled = true;
            }

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
            });

            modelSelect.appendChild(group);
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

export function initSidePanel() {
    const newChatButton = document.getElementById("newChat");
    const modelSelect = document.getElementById("modelSelect");
    const chat = document.getElementById("chat");
    const input = document.getElementById("input");

    loadAvailableModels();

    if (newChatButton) {
        newChatButton.addEventListener("click", () => {
            hideMobileActions();
            if (state.currentChatId && state.chatSessions[state.currentChatId]) {
                saveCurrentChatState();
            }
            state.currentChatId = null;
            saveStoredChats();
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
        });
    }

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

