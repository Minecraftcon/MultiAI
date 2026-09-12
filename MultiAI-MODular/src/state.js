/* =========================================================
   CENTRAL REACTIVE APPLICATION STATE
   ========================================================= */
import { BASE_SYSTEM_PROMPT } from "./config.js";

export const state = {
    chatSessions: {},
    currentChatId: null,
    activeGenerations: {},
    activeSystemPrompt: BASE_SYSTEM_PROMPT,
    messages: [
        { role: "system", content: BASE_SYSTEM_PROMPT }
    ]
};

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

export function getCurrentSession() {
    return state.currentChatId ? state.chatSessions[state.currentChatId] : null;
}
