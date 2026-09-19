/* =========================================================
   STATE ACTIONS & TRANSACTIONAL MUTATIONS
   ========================================================= */
import { state } from "./store.js";

/**
 * Sets the active system prompt and syncs across active session & message buffers.
 */
export function setActiveSystemPrompt(prompt) {
    state.activeSystemPrompt = prompt;
    if (state.messages.length > 0 && state.messages[0].role === "system") {
        state.messages[0].content = prompt;
    }
    if (state.currentChatId && state.chatSessions[state.currentChatId]) {
        if (state.chatSessions[state.currentChatId].messages?.[0]?.role === "system") {
            state.chatSessions[state.currentChatId].messages[0].content = prompt;
        }
    }
}

/**
 * Sets the active persona prompt.
 */
export function setActivePersonaPrompt(prompt) {
    state.activePersonaPrompt = prompt;
}

/**
 * Updates the current active chat ID.
 */
export function setCurrentChatId(chatId) {
    state.currentChatId = chatId;
}

/**
 * Tracks generation status and abort controller for a chat session.
 */
export function setGeneratingState(chatId, isGenerating, abortController = null) {
    if (!chatId) return;
    if (isGenerating) {
        state.activeGenerations[chatId] = {
            isGenerating: true,
            abortController
        };
    } else {
        if (state.activeGenerations[chatId]) {
            state.activeGenerations[chatId].isGenerating = false;
            state.activeGenerations[chatId].abortController = null;
        }
    }
}

/**
 * Safely updates messages in the active or target session.
 */
export function updateSessionMessages(chatId, messages) {
    if (!chatId || !state.chatSessions[chatId]) return;
    state.chatSessions[chatId].messages = messages;
    if (state.currentChatId === chatId) {
        state.messages = JSON.parse(JSON.stringify(messages));
    }
}

/**
 * Sets the active application mode ('chat' | 'build').
 */
export function setAppMode(mode) {
    if (mode !== "chat" && mode !== "build") return;
    state.appMode = mode;
}
