/* =========================================================
   STATE SELECTORS & DERIVED QUERIES
   ========================================================= */
import { state } from "./store.js";

/**
 * Returns the current active session object or null.
 */
export function getCurrentSession() {
    return state.currentChatId ? state.chatSessions[state.currentChatId] : null;
}

/**
 * Returns the current chat ID.
 */
export function getCurrentChatId() {
    return state.currentChatId;
}

/**
 * Checks whether a specific chat or the active chat is currently generating.
 */
export function isChatGenerating(chatId = state.currentChatId) {
    if (!chatId) return false;
    return Boolean(state.activeGenerations[chatId]?.isGenerating);
}

/**
 * Gets the active system prompt.
 */
export function getActiveSystemPrompt() {
    return state.activeSystemPrompt;
}

/**
 * Gets a specific session by ID.
 */
export function getSessionById(chatId) {
    return state.chatSessions[chatId] || null;
}

/**
 * Gets the current active application mode ('chat' | 'build').
 */
export function getAppMode() {
    return state.appMode || "chat";
}
