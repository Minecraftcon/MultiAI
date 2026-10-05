/* =========================================================
   DECOUPLED BUILD AGENT BRIDGE (CLIENT <-> SERVER DAEMON)
   Streams live progress from the server-side autonomous agent.
   Closing the browser tab will NOT interrupt execution.
   ========================================================= */
import { state } from "../state/index.js";
import { addToolBadge, addThoughtTrace, updateAIStream, finalizeStopped } from "../components/chat-ui.js";
import { onToolStart, onToolComplete } from "../tools/index.js";
import { renderProjectList } from "../components/build-projects-panel.js";
import { saveStoredChats } from "../services/storage.js";

const activeStreams = new Map(); // chatId -> EventSource

/**
 * Checks if a detached agent job is currently running on the server for this chat.
 *
 * @param {string} chatId
 * @returns {Promise<{ isRunning: boolean, todos: Array, status: string }>}
 */
export async function checkAgentStatus(chatId) {
    if (!chatId) return { isRunning: false };
    try {
        const res = await fetch(`/api/build/agent/status/${encodeURIComponent(chatId)}`);
        if (res.ok) {
            return await res.json();
        }
    } catch (_) {}
    return { isRunning: false };
}

/**
 * Starts a detached server-side agent job and connects to its event stream.
 *
 * @param {Object} options
 * @param {string} options.projectId
 * @param {string} options.chatId
 * @param {string} options.userText
 * @param {string} options.model
 * @param {string} [options.provider]
 * @param {HTMLElement} options.currentAIMessage
 */
export async function startServerAgent({
    projectId,
    chatId,
    userText,
    model,
    provider,
    currentAIMessage
}) {
    // 1. Trigger background runner on the server
    const startRes = await fetch("/api/build/agent/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, chatId, userText, model, provider })
    });

    if (!startRes.ok) {
        const errData = await startRes.json().catch(() => ({}));
        throw new Error(errData.error || `Server runner failed to start (HTTP ${startRes.status})`);
    }

    // 2. Connect live EventSource stream
    return connectAgentStream(chatId, currentAIMessage);
}

/**
 * Connects to the SSE stream of a running server agent job.
 *
 * @param {string} chatId
 * @param {HTMLElement} currentAIMessage
 */
export function connectAgentStream(chatId, currentAIMessage) {
    if (activeStreams.has(chatId)) {
        activeStreams.get(chatId).close();
        activeStreams.delete(chatId);
    }

    const eventSource = new EventSource(`/api/build/agent/stream/${encodeURIComponent(chatId)}`);
    activeStreams.set(chatId, eventSource);

    let activeBadges = new Map();

    eventSource.onmessage = (e) => {
        if (!e.data || e.data === "[DONE]") {
            eventSource.close();
            activeStreams.delete(chatId);
            if (state.activeGenerations[chatId]) {
                state.activeGenerations[chatId].isGenerating = false;
            }
            renderProjectList();
            return;
        }

        let event = {};
        try {
            event = JSON.parse(e.data);
        } catch (_) {
            return;
        }

        if (event.type === "thought" && event.content && currentAIMessage) {
            addThoughtTrace(currentAIMessage, event.content);
        } else if (event.type === "tool_start" && currentAIMessage) {
            const badgeEl = addToolBadge(currentAIMessage, event.name, event.args || {});
            activeBadges.set(`${event.name}:${JSON.stringify(event.args || {})}`, badgeEl);
        } else if (event.type === "tool_complete") {
            const key = `${event.name}:${JSON.stringify(event.args || {})}`;
            const badgeEl = activeBadges.get(key);
            if (badgeEl) {
                onToolComplete(event.name, event.args || {}, badgeEl, event.result);
            }
        } else if (event.type === "todos_updated" && event.todos) {
            const session = state.chatSessions?.[chatId];
            if (session) {
                session.todos = event.todos;
                session.artifactPath = event.artifactPath;
                saveStoredChats();
            }
            document.dispatchEvent(new CustomEvent("todosUpdated", {
                detail: { chatId, todos: event.todos, artifactPath: event.artifactPath }
            }));
        } else if (event.type === "done" && currentAIMessage) {
            updateAIStream(currentAIMessage, event.finalAnswer || "", true);
            if (state.activeGenerations[chatId]) {
                state.activeGenerations[chatId].isGenerating = false;
            }
            eventSource.close();
            activeStreams.delete(chatId);
            renderProjectList();
        } else if (event.type === "error" && currentAIMessage) {
            finalizeStopped(currentAIMessage, Date.now(), false);
            eventSource.close();
            activeStreams.delete(chatId);
            if (state.activeGenerations[chatId]) {
                state.activeGenerations[chatId].isGenerating = false;
            }
            renderProjectList();
        }
    };

    eventSource.onerror = () => {
        // SSE automatically handles reconnects; if connection closed by server, cleanup
        eventSource.close();
        activeStreams.delete(chatId);
    };

    return eventSource;
}

/**
 * Stops a running server-side agent job.
 *
 * @param {string} chatId
 * @returns {Promise<boolean>}
 */
export async function stopServerAgent(chatId) {
    if (activeStreams.has(chatId)) {
        activeStreams.get(chatId).close();
        activeStreams.delete(chatId);
    }
    try {
        const res = await fetch("/api/build/agent/stop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId })
        });
        if (res.ok) {
            const data = await res.json();
            return data.success;
        }
    } catch (_) {}
    return false;
}
