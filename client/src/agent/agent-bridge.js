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
import { updateSendButtonState } from "../components/composer.js";

const activeStreams = new Map(); // chatId -> EventSource
const activeResolvers = new Map(); // chatId -> resolve function

/**
 * Checks if a detached agent job is currently running on the server for this chat.
 *
 * @param {string} chatId
 * @returns {Promise<{ isRunning: boolean, todos: Array, status: string }>}
 */
export async function checkAgentStatus(chatId) {
    if (!chatId) return { isRunning: false };
    try {
        const res = await fetch(`/api/agent/status/${encodeURIComponent(chatId)}`);
        if (res.ok) {
            return await res.json();
        }
        // Fallback for legacy endpoints
        const fallbackRes = await fetch(`/api/build/agent/status/${encodeURIComponent(chatId)}`);
        if (fallbackRes.ok) {
            return await fallbackRes.json();
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
 * @returns {Promise<Object>}
 */
export async function startServerAgent({
    projectId = null,
    chatId,
    userText,
    userContent = null,
    model,
    provider,
    currentAIMessage
}) {
    // 1. Trigger background runner on the server
    const endpoint = projectId ? "/api/build/agent/start" : "/api/agent/start";
    const startRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, chatId, userText, userContent, model, provider })
    });

    if (!startRes.ok) {
        const errData = await startRes.json().catch(() => ({}));
        throw new Error(errData.error || `Server runner failed to start (HTTP ${startRes.status})`);
    }

    // 2. Connect live EventSource stream and await execution completion
    return connectAgentStream(chatId, currentAIMessage);
}

/**
 * Connects to the SSE stream of a running server agent job.
 * Returns a Promise that stays pending until the background job finishes,
 * ensuring UI stop buttons remain active throughout execution.
 *
 * @param {string} chatId
 * @param {HTMLElement} currentAIMessage
 * @returns {Promise<Object>}
 */
export function connectAgentStream(chatId, currentAIMessage) {
    if (activeStreams.has(chatId)) {
        activeStreams.get(chatId).close();
        activeStreams.delete(chatId);
    }
    const prevResolver = activeResolvers.get(chatId);
    if (prevResolver) {
        activeResolvers.delete(chatId);
        prevResolver({ stopped: true });
    }

    return new Promise((resolve) => {
        activeResolvers.set(chatId, resolve);

        const eventSource = new EventSource(`/api/agent/stream/${encodeURIComponent(chatId)}`);
        activeStreams.set(chatId, eventSource);

        let activeBadges = new Map();

        const finishStream = (result = { done: true }) => {
            eventSource.close();
            activeStreams.delete(chatId);
            const res = activeResolvers.get(chatId);
            activeResolvers.delete(chatId);
            if (state.activeGenerations[chatId]) {
                state.activeGenerations[chatId].isGenerating = false;
            }
            if (state.currentChatId === chatId) {
                updateSendButtonState(false);
            }
            renderProjectList();
            import("../components/chat-question-prompt.js").then(({ dismissQuestionPrompt }) => {
                dismissQuestionPrompt("Stream finished");
            }).catch(() => {});
            if (res) res(result);
        };

        eventSource.onmessage = (e) => {
            if (!e.data || e.data === "[DONE]") {
                finishStream({ done: true });
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
            } else if (event.type === "question_prompt") {
                import("../components/chat-question-prompt.js").then(({ promptUserQuestions }) => {
                    promptUserQuestions(event.questions).then((result) => {
                        fetch("/api/agent/answer", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                chatId,
                                status: result.status,
                                answers: result.answers
                            })
                        }).catch(err => console.warn("[BUILD] Error sending question answer:", err));
                    });
                }).catch(err => console.error("[BUILD] Failed to load chat-question-prompt:", err));
            } else if (event.type === "tool_start" && currentAIMessage) {
                const toolKey = event.tool_call_id || `${event.name}:${JSON.stringify(event.args || {})}`;
                let badgeEl = activeBadges.get(toolKey) || activeBadges.get(`${event.name}:${JSON.stringify(event.args || {})}`);
                if (!badgeEl) {
                    badgeEl = addToolBadge(currentAIMessage, event.name, event.args || {});
                    activeBadges.set(toolKey, badgeEl);
                    activeBadges.set(`${event.name}:${JSON.stringify(event.args || {})}`, badgeEl);
                }
            } else if (event.type === "tool_complete") {
                const toolKey = event.tool_call_id || `${event.name}:${JSON.stringify(event.args || {})}`;
                let badgeEl = activeBadges.get(toolKey) || activeBadges.get(`${event.name}:${JSON.stringify(event.args || {})}`);
                if (!badgeEl && currentAIMessage) {
                    badgeEl = addToolBadge(currentAIMessage, event.name, event.args || {});
                    activeBadges.set(toolKey, badgeEl);
                }
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
                // Fetch canonical session messages from backend disk to ensure all tool turns are synchronized locally
                fetch(`/api/chats/${encodeURIComponent(chatId)}`)
                    .then(r => r.json())
                    .then(data => {
                        if (data?.session?.messages && Array.isArray(data.session.messages)) {
                            state.chatSessions[chatId] = {
                                ...state.chatSessions[chatId],
                                ...data.session,
                                messages: data.session.messages
                            };
                            if (state.currentChatId === chatId) {
                                state.messages = data.session.messages;
                            }
                            saveStoredChats();
                        }
                    })
                    .catch(() => {});

                finishStream({ done: true, finalAnswer: event.finalAnswer });
            } else if (event.type === "error" && currentAIMessage) {
                finalizeStopped(currentAIMessage, Date.now(), false);
                finishStream({ error: event.error || "Server runner encountered an error" });
            }
        };

        eventSource.onerror = () => {
            finishStream({ done: true });
        };
    });
}

/**
 * Stops a running server-side agent job.
 *
 * @param {string} chatId
 * @returns {Promise<boolean>}
 */
export async function stopServerAgent(chatId) {
    import("../components/chat-question-prompt.js").then(({ dismissQuestionPrompt }) => {
        dismissQuestionPrompt("Generation stopped");
    }).catch(() => {});
    if (activeStreams.has(chatId)) {
        activeStreams.get(chatId).close();
        activeStreams.delete(chatId);
    }
    const resolver = activeResolvers.get(chatId);
    if (resolver) {
        activeResolvers.delete(chatId);
        resolver({ stopped: true });
    }
    if (state.activeGenerations[chatId]) {
        state.activeGenerations[chatId].isGenerating = false;
        state.activeGenerations[chatId].abortRequested = true;
    }
    if (state.currentChatId === chatId) {
        updateSendButtonState(false);
    }
    try {
        const res = await fetch("/api/agent/stop", {
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

