/* =========================================================
   CENTRAL REACTIVE APPLICATION STATE STORE
   ========================================================= */
import { BASE_SYSTEM_PROMPT, DEFAULT_PERSONA_PROMPT } from "../config.js";

export const state = {
    config: {},
    chatSessions: {},
    currentChatId: null,
    activeGenerations: {},
    activePersonaPrompt: DEFAULT_PERSONA_PROMPT,
    activeSystemPrompt: BASE_SYSTEM_PROMPT,
    appMode: "chat",
    messages: [
        { role: "system", content: BASE_SYSTEM_PROMPT }
    ]
};
