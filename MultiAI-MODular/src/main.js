/* =========================================================
   APPLICATION BOOTSTRAP & LIFECYCLE CONTROLLER
   ========================================================= */
import { state } from "./state.js";
window.state = state;
import { ACTIVE_CHAT_KEY } from "./config.js";
import { initSystemEnvironment } from "./services/system.js";
import { loadStoredChats, saveStoredChats, syncFromBackendDisk, syncBuildProjectsFromDisk } from "./services/storage.js";
import { initGestures } from "./components/gestures.js";
import { initSidePanel, renderChatList, switchToChat, syncActiveModeConversation } from "./components/side-panel.js";
import { initChatDelegation } from "./components/chat-ui.js";
import { initComposer } from "./components/composer.js";
import { initContextMenu } from "./components/context-menu.js";
import { initBottomSheet } from "./components/bottom-sheet.js";
import { initErrorRecovery } from "./components/error-recovery.js";
import { initModelPicker } from "./components/model-picker.js";
import { initSettingsView } from "./components/settings-view.js";

import { renderIcons } from "./utils/dom.js";
import { setStartPageMode } from "./components/chatbox.js";
import { initUiScale } from "./components/ui-scale.js";
import { initAuroraTheme } from "./components/aurora-theme.js";
import { initModeSwitcher } from "./components/mode-switcher.js";

async function initChatSessions() {
    loadStoredChats();

    // Await backend disk sync to guarantee all persistent chats and build projects from ~/.MultiAI/ are in memory
    try {
        await syncFromBackendDisk();
        await syncBuildProjectsFromDisk();
    } catch (_) {}

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

    // Activate the appropriate conversation according to the active mode (Chat vs Build)
    await syncActiveModeConversation(state.appMode);
}

async function initConfig() {
    try {
        const res = await fetch("/api/config");
        if (res.ok) {
            const data = await res.json();
            state.config = data || {};

            const defaultLLM = state.config.General?.DefaultStartupLLM;
            const modelSelect = document.getElementById("modelSelect");
            if (defaultLLM && modelSelect && !state.currentChatId) {
                const hasOption = Array.from(modelSelect.options).some(o => o.value === defaultLLM);
                if (hasOption) {
                    modelSelect.value = defaultLLM;
                }
            }

            // Apply theme if configured
            const theme = state.config.UI?.Theme;
            if (theme && theme !== "system") {
                document.documentElement.setAttribute("data-theme", theme);
            }

            // Sync configured Aurora theme
            initAuroraTheme();
        }
    } catch (e) {
        console.warn("[CONFIG] Could not load /api/config:", e);
    }
}

// Global bootstrap with readyState guard
async function bootstrap() {
    renderIcons();
    initUiScale();
    initAuroraTheme();
    initComposer();
    initGestures();
    initSidePanel();
    initModeSwitcher();
    initChatDelegation();
    initContextMenu();
    initBottomSheet();
    initErrorRecovery();
    initModelPicker();
    initSettingsView();

    await initConfig();
    initSystemEnvironment();
    await initChatSessions();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
} else {
    bootstrap();
}

