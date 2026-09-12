/* =========================================================
   APPLICATION BOOTSTRAP & LIFECYCLE CONTROLLER
   ========================================================= */
import { state } from "./state.js";
import { initSystemEnvironment } from "./services/system.js";
import { loadStoredChats, saveStoredChats } from "./services/storage.js";
import { initGestures } from "./components/gestures.js";
import { initSidePanel, renderChatList, switchToChat } from "./components/side-panel.js";
import { initChatDelegation } from "./components/chat-ui.js";
import { initComposer } from "./components/composer.js";
import { initContextMenu } from "./components/context-menu.js";
import { initBottomSheet } from "./components/bottom-sheet.js";
import { initErrorRecovery } from "./components/error-recovery.js";

import { renderIcons } from "./utils/dom.js";

function initChatSessions() {
    loadStoredChats();

    let hasCleaned = false;
    for (const id of Object.keys(state.chatSessions)) {
        const sess = state.chatSessions[id];
        const hasUserMsg = sess.messages && sess.messages.some(m => m.role === "user");
        if (!hasUserMsg && (!sess.chatHtml || !sess.chatHtml.trim())) {
            delete state.chatSessions[id];
            hasCleaned = true;
        }
    }
    if (hasCleaned) {
        saveStoredChats();
    }

    const chat = document.getElementById("chat");
    const storedIds = Object.keys(state.chatSessions);

    if (storedIds.length > 0) {
        const targetId = (state.currentChatId && state.chatSessions[state.currentChatId]) ? state.currentChatId : (
            storedIds.sort((a, b) => (state.chatSessions[b].updatedAt || 0) - (state.chatSessions[a].updatedAt || 0)),
            storedIds[0]
        );
        state.currentChatId = null;
        switchToChat(targetId);
    } else {
        state.currentChatId = null;
        if (chat) chat.innerHTML = "";
        state.messages = [{ role: "system", content: state.activeSystemPrompt }];
        renderChatList();
    }
}

// Global bootstrap with readyState guard
function bootstrap() {
    renderIcons();
    initGestures();
    initSidePanel();
    initChatDelegation();
    initComposer();
    initContextMenu();
    initBottomSheet();
    initErrorRecovery();

    initSystemEnvironment();
    initChatSessions();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
} else {
    bootstrap();
}

