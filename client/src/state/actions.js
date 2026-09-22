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

/**
 * Sets the full list of Build Projects in state.
 */
export function setBuildProjects(projects) {
    state.buildProjects = Array.isArray(projects) ? projects : [];
}

/**
 * Sets the currently active Project ID in Build mode.
 */
export function setCurrentProjectId(projectId) {
    state.currentProjectId = projectId;
}

/**
 * Adds or updates a project in the state.buildProjects array.
 */
export function addBuildProject(project) {
    if (!project || !project.id) return;
    const idx = state.buildProjects.findIndex(p => p.id === project.id);
    if (idx >= 0) {
        state.buildProjects[idx] = { ...state.buildProjects[idx], ...project };
    } else {
        state.buildProjects.unshift(project);
    }
}

/**
 * Removes a project from state.buildProjects.
 */
export function removeBuildProjectState(projectId) {
    state.buildProjects = state.buildProjects.filter(p => p.id !== projectId);
    if (state.currentProjectId === projectId) {
        state.currentProjectId = null;
    }
}

/**
 * Activates or deactivates DeepSearch mode for the current session.
 */
export function setDeepSearchActive(active) {
    state.isDeepSearchActive = Boolean(active);
}
