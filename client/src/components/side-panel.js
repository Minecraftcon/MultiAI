/* =========================================================
   SIDE PANEL & SHELL COORDINATOR (DUCK.AI INSPIRED)
   Coordinates Chat History, Build Projects, and Navigation.
   ========================================================= */
import { state, setDeepSearchActive } from "../state/index.js";
import { saveStoredChats, saveCurrentChatState, syncBuildProjectsFromDisk } from "../services/storage.js";
import { closePanel } from "./gestures.js";
import { hideMobileActions } from "./context-menu.js";
import { updateSendButtonState } from "./composer.js";
import { openSettings } from "./settings-view.js";
import { setStartPageMode } from "./chatbox.js";

// Extracted Sub-Components & Services
import { 
    availableModels, 
    modelProviderMap, 
    modelVisionMap, 
    isModelVisionCapable, 
    loadAvailableModels 
} from "../services/models.js";

import {
    collapsedProjects,
    renderProjectList,
    switchToBuildChat,
    startFreshBuildChat,
    showProjectMenu,
    hideProjectMenu,
    showBuildChatMenu,
    openAddProjectModal,
    closeAddProjectModal,
    validateDirectoryInput,
    initBuildProjectsListeners
} from "./build-projects-panel.js";

import {
    _chatItemCache,
    renderChatList,
    switchToChat,
    deleteChatSession,
    renameChatSession,
    showChatItemMenu,
    hideChatItemMenu,
    initChatListListeners
} from "./chat-history-list.js";

import { ACTIVE_BUILD_PROJECT_KEY, ACTIVE_BUILD_CHAT_KEY, ACTIVE_CHAT_KEY } from "../config.js";

// Re-export for seamless backward compatibility across the entire app
export {
    availableModels,
    modelProviderMap,
    modelVisionMap,
    isModelVisionCapable,
    loadAvailableModels,
    collapsedProjects,
    renderProjectList,
    switchToBuildChat,
    startFreshBuildChat,
    showProjectMenu,
    hideProjectMenu,
    showBuildChatMenu,
    openAddProjectModal,
    closeAddProjectModal,
    validateDirectoryInput,
    _chatItemCache,
    renderChatList,
    switchToChat,
    deleteChatSession,
    renameChatSession,
    showChatItemMenu,
    hideChatItemMenu
};

let currentSearchFilter = "";

/**
 * Toggles the smooth slide-in search bar in the side panel.
 */
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

/**
 * Switches the side panel's visible tab between standard Chat history and Build Mode projects.
 */
export function updateSidePanelView(mode = state.appMode) {
    const isBuild = mode === "build";
    const panelChatNav = document.getElementById("panelChatNav");
    const panelBuildNav = document.getElementById("panelBuildNav");
    const panelSectionLabel = document.getElementById("panelSectionLabel");
    const panelSearchToggle = document.getElementById("panelSearchToggle");
    const panelAddProjectHeaderBtn = document.getElementById("panelAddProjectHeaderBtn");
    const chatList = document.getElementById("chatList");
    const projectList = document.getElementById("projectList");

    if (panelChatNav) panelChatNav.style.display = isBuild ? "none" : "";
    if (panelBuildNav) panelBuildNav.style.display = isBuild ? "" : "none";
    if (panelSectionLabel) panelSectionLabel.textContent = isBuild ? "Projects" : "Chats";
    if (panelSearchToggle) panelSearchToggle.style.display = isBuild ? "none" : "";
    if (panelAddProjectHeaderBtn) panelAddProjectHeaderBtn.style.display = isBuild ? "" : "none";
    if (chatList) chatList.style.display = isBuild ? "none" : "";
    if (projectList) projectList.style.display = isBuild ? "" : "none";

    if (isBuild) {
        renderProjectList(currentSearchFilter);
    } else {
        renderChatList(currentSearchFilter);
    }
}

/**
 * Starts a brand new blank chat in normal conversation mode.
 */
export function startFreshChat() {
    hideMobileActions();
    hideChatItemMenu();
    if (state.currentChatId && state.chatSessions[state.currentChatId]) {
        saveCurrentChatState();
    }
    state.currentChatId = null;
    setDeepSearchActive(false);
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

/**
 * Automatically activates and renders the appropriate conversation context
 * when switching between Chat and Build modes or when reloading the page.
 */
export async function syncActiveModeConversation(mode = state.appMode) {
    const isBuild = mode === "build";
    const chat = document.getElementById("chat");

    if (isBuild) {
        const activeProjectId = localStorage.getItem(ACTIVE_BUILD_PROJECT_KEY);
        const activeBuildChatId = localStorage.getItem(ACTIVE_BUILD_CHAT_KEY);

        if (activeProjectId && activeBuildChatId) {
            await switchToBuildChat(activeProjectId, activeBuildChatId);
            return;
        }

        // Fallback: Check if any project has chats
        const allProjects = state.buildProjects || [];
        let mostRecentProject = null;
        let mostRecentChat = null;

        for (const proj of allProjects) {
            if (Array.isArray(proj.chats) && proj.chats.length > 0) {
                for (const c of proj.chats) {
                    if (!mostRecentChat || (c.updatedAt || c.createdAt || 0) > (mostRecentChat.updatedAt || mostRecentChat.createdAt || 0)) {
                        mostRecentChat = c;
                        mostRecentProject = proj;
                    }
                }
            }
        }

        if (mostRecentProject && mostRecentChat) {
            await switchToBuildChat(mostRecentProject.id, mostRecentChat.id);
            return;
        }

        if (allProjects.length > 0) {
            await startFreshBuildChat(allProjects[0].id);
            return;
        }

        // Truly empty build mode: show start page with Lets Build
        state.currentProjectId = null;
        state.currentChatId = null;
        if (chat) chat.innerHTML = "";
        state.messages = [{ role: "system", content: state.activeSystemPrompt }];
        setStartPageMode(true);
        updateSidePanelView("build");
    } else {
        const activeId = localStorage.getItem(ACTIVE_CHAT_KEY);
        if (activeId && state.chatSessions[activeId] && !state.chatSessions[activeId].projectId && state.chatSessions[activeId].mode !== "build") {
            state.currentChatId = null;
            await switchToChat(activeId);
            return;
        }

        const validSessions = Object.values(state.chatSessions).filter(s => 
            s && !s.projectId && (s.mode !== "build") && (s.messages?.some(m => m.role === "user") || (s.messageCount && s.messageCount > 0) || s.workspace)
        );

        if (validSessions.length > 0) {
            validSessions.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
            state.currentChatId = null;
            await switchToChat(validSessions[0].id);
            return;
        }

        startFreshChat();
    }
}

/**
 * Initializes the side panel shell, navigation, search, and delegates sub-panel handlers.
 */
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

    // Settings Button
    const panelSettingsBtn = document.getElementById("panelSettingsBtn");

    // Bootstrap models and projects
    loadAvailableModels();
    syncBuildProjectsFromDisk();

    // Initialize sub-component event listeners
    initBuildProjectsListeners();
    initChatListListeners();

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
                        if (input) input.placeholder = "Message AI…";
                    };
                    recognition.start();
                } catch (err) {
                    console.warn("Speech recognition error:", err);
                    if (input) input.placeholder = "Message AI…";
                }
            } else {
                if (input) {
                    input.placeholder = "Message AI…";
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
            if (state.appMode === "build") {
                renderProjectList(currentSearchFilter);
            } else {
                renderChatList(currentSearchFilter);
            }
        });

        panelSearchInput.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                setPanelSearchMode(false);
            }
        });
    }

    // Close menus on outside click
    document.addEventListener("click", (e) => {
        if (!e.target.closest("#chatItemMenu") && !e.target.closest(".chat-item-more-btn") && !e.target.closest(".project-chat-more-btn")) {
            hideChatItemMenu();
        }
        if (!e.target.closest("#projectItemMenu") && !e.target.closest(".project-more-btn")) {
            hideProjectMenu();
        }
    });

    // Settings Screen
    if (panelSettingsBtn) {
        panelSettingsBtn.addEventListener("click", () => {
            hideChatItemMenu();
            hideProjectMenu();
            openSettings("general");
        });
    }

    // Model select listener
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

    // External Event Listeners
    document.addEventListener("chatsUpdated", () => {
        if (state.appMode === "chat") {
            renderChatList();
        }
    });

    document.addEventListener("projectsUpdated", () => {
        if (state.appMode === "build") {
            renderProjectList();
        }
    });

    window.addEventListener("app-mode-changed", (e) => {
        const mode = e.detail?.mode || state.appMode;
        updateSidePanelView(mode);
        syncActiveModeConversation(mode);
    });

    // Scroll gradient listener on panel body
    const panelBody = sidePanel?.querySelector(".panel-body");
    if (panelBody) {
        const updateScrollState = () => {
            panelBody.classList.toggle("scrolled-top", panelBody.scrollTop > 2);
        };
        panelBody.addEventListener("scroll", updateScrollState, { passive: true });
        updateScrollState();
    }

    // Initialize side panel view according to active mode
    updateSidePanelView(state.appMode);
}
