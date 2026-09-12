/* =========================================================
   LOCAL STORAGE & CONVERSATION PERSISTENCE
   ========================================================= */
import { CHATS_STORAGE_KEY, ACTIVE_CHAT_KEY } from "../config.js";
import { state } from "../state.js";

export function loadStoredChats() {
    try {
        const raw = localStorage.getItem(CHATS_STORAGE_KEY);
        state.chatSessions = raw ? JSON.parse(raw) : {};
    } catch (e) {
        state.chatSessions = {};
    }
    state.currentChatId = localStorage.getItem(ACTIVE_CHAT_KEY);
}

export function saveStoredChats() {
    try {
        localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(state.chatSessions));
        if (state.currentChatId) {
            localStorage.setItem(ACTIVE_CHAT_KEY, state.currentChatId);
        } else {
            localStorage.removeItem(ACTIVE_CHAT_KEY);
        }
    } catch (e) {
        console.warn("Storage write error:", e);
    }
}

export function generateChatId() {
    return "chat_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
}

export function createNewChatSession(initialUserText = "") {
    const modelSelect = document.getElementById("modelSelect");
    const chat = document.getElementById("chat");

    const id = generateChatId();
    const raw = (initialUserText || "").trim();
    const title = raw ? (raw.slice(0, 34) + (raw.length > 34 ? "..." : "")) : "Conversation";

    state.chatSessions[id] = {
        id,
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: modelSelect ? modelSelect.value : "gemini-2.5-flash",
        messages: [...state.messages],
        chatHtml: chat ? chat.innerHTML : ""
    };
    state.currentChatId = id;
    saveStoredChats();
    return id;
}

export function saveCurrentChatState() {
    if (!state.currentChatId || !state.chatSessions[state.currentChatId]) return;

    const chat = document.getElementById("chat");
    const modelSelect = document.getElementById("modelSelect");

    const session = state.chatSessions[state.currentChatId];
    if (chat) session.chatHtml = chat.innerHTML;
    
    // session.messages is the live conversation history.
    // Keep state.messages synchronized with session.messages, never clobber session.messages with stale state.messages
    if (session.messages && session.messages.length > 0) {
        state.messages = JSON.parse(JSON.stringify(session.messages));
    } else if (state.messages && state.messages.length > 0) {
        session.messages = JSON.parse(JSON.stringify(state.messages));
    }
    session.updatedAt = Date.now();
    if (modelSelect) session.model = modelSelect.value;

    if (!session.title || session.title === "Conversation") {
        const firstUserMsg = session.messages.find(m => m.role === "user");
        if (firstUserMsg && typeof firstUserMsg.content === "string") {
            const rawTitle = firstUserMsg.content.trim();
            session.title = rawTitle.slice(0, 34) + (rawTitle.length > 34 ? "..." : "");
        }
    }

    saveStoredChats();
}
