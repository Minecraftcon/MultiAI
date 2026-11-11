/**
 * Background Task Watcher & Autonomous Wake-Up Dispatcher
 * ========================================================
 * Monitors detached background tasks and timers without blocking the UI.
 * When a background task exits or a timer expires, automatically re-awakens
 * the AI agent in a new conversational turn to deliver results.
 */
import { state } from "../../state.js";
import { saveStoredChats } from "../../services/storage.js";
import { createAIMessageShell, forceReengageAutoScroll, addWakeupBadge } from "../../components/chat-ui.js";
import { updateSendButtonState } from "../../components/composer.js";
import { renderChatList } from "../../components/side-panel.js";
import { escapeHTML } from "../../utils/dom.js";
import { cleanTerminalScreen } from "./term-emulator.js";

const STORAGE_KEY = "multiai_active_task_watches";
let watcherInterval = null;
let turnRunnerFn = null;

/**
 * Registers the agent execution function (runAgent) to avoid circular imports.
 */
export function registerAgentRunner(fn) {
    turnRunnerFn = fn;
}

/**
 * Retrieves all stored active background watches.
 */
function getActiveWatches() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) {
        return [];
    }
}

/**
 * Persists the active background watches array.
 */
function saveActiveWatches(watches) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(watches));
    } catch (_) {}
}

/**
 * Adds a background task or timer to the autonomous watcher.
 */
export function watchBackgroundTask({
    chatId,
    taskId = null,
    time = 60,
    wakeOn = "exit",
    endResponse = null,
    reason = "",
    statusMessage = ""
}) {
    if (!chatId) return;

    const watches = getActiveWatches();
    // Prevent duplicate watcher entries for the same task in the same chat
    const filtered = watches.filter(w => !(w.chatId === chatId && w.taskId === taskId && taskId !== null));

    filtered.push({
        id: `watch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        chatId,
        taskId,
        time: parseFloat(time) || 60,
        wakeOn,
        endResponse,
        reason,
        statusMessage,
        startedAt: Date.now()
    });

    saveActiveWatches(filtered);
    ensureWatcherRunning();
    try {
        document.dispatchEvent(new CustomEvent("runningTasksUpdated"));
    } catch (_) {}
}

/**
 * Dispatches an autonomous agent turn with the task completion notification.
 */
export async function triggerTaskNotificationTurn(chatId, notificationText, badgeInfo = {}) {
    if (!chatId || !state.chatSessions[chatId] || !turnRunnerFn) return;

    // If generation is already active on this chat, retry shortly
    if (state.activeGenerations[chatId]?.isGenerating) {
        setTimeout(() => triggerTaskNotificationTurn(chatId, notificationText, badgeInfo), 2000);
        return;
    }

    state.activeGenerations[chatId] = {
        chatId,
        isGenerating: true,
        abortRequested: false,
        abortController: new AbortController(),
        sleepResolve: null
    };

    updateSendButtonState(true);
    renderChatList();

    const isCurrentChat = (state.currentChatId === chatId);
    const chatContainer = document.getElementById("chat");
    let currentAIMessage;

    if (isCurrentChat && chatContainer) {
        currentAIMessage = createAIMessageShell();
        addWakeupBadge(currentAIMessage, badgeInfo);
        forceReengageAutoScroll(chatContainer);
    } else {
        currentAIMessage = document.createElement("div");
    }

    try {
        await turnRunnerFn(notificationText, currentAIMessage, chatId, [], badgeInfo);
    } catch (err) {
        console.error("[TASK WATCHER] Failed running notification turn:", err);
    } finally {
        if (state.activeGenerations[chatId]) {
            delete state.activeGenerations[chatId];
        }
        updateSendButtonState(false);
    }
}

/**
 * Single polling tick checking all monitored background tasks and timers.
 */
async function checkWatchesTick() {
    const watches = getActiveWatches();
    if (watches.length === 0) {
        if (watcherInterval) {
            clearInterval(watcherInterval);
            watcherInterval = null;
        }
        return;
    }

    const remainingWatches = [];

    for (const watch of watches) {
        const { chatId, taskId, time, startedAt, endResponse, reason } = watch;
        const elapsedSec = (Date.now() - startedAt) / 1000;

        if (taskId) {
            try {
                const res = await fetch(`/api/task/stdout/${encodeURIComponent(taskId)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.running === false) {
                        // Task completed!
                        const exitCode = data.exit_code ?? 0;
                        const stdout = cleanTerminalScreen(data.stdout || "").trim();
                        const stderr = cleanTerminalScreen(data.stderr || "").trim();
                        const duration = data.elapsed_seconds || elapsedSec.toFixed(1);

                        let notifyMsg = `[Background Task Notification]: Task '${taskId}' (${reason || "background job"}) completed with exit code ${exitCode} after ${duration}s.`;
                        if (stdout) notifyMsg += `\n\nStandard Output:\n\`\`\`\n${stdout.slice(0, 3000)}\n\`\`\``;
                        if (stderr) notifyMsg += `\n\nStandard Error:\n\`\`\`\n${stderr.slice(0, 1500)}\n\`\`\``;
                        if (endResponse) notifyMsg += `\n\nPrompt: ${endResponse}`;

                        const taskName = reason || taskId;
                        const badgeInfo = {
                            taskName,
                            taskId,
                            duration,
                            exitCode,
                            isTimer: false,
                            stdout,
                            stderr
                        };

                        triggerTaskNotificationTurn(chatId, notifyMsg, badgeInfo);
                        continue;
                    }
                }
            } catch (_) {}

            // If a timeout was set and has elapsed while task is still running
            if (time > 0 && elapsedSec >= time) {
                let notifyMsg = `[Background Task Timeout]: Monitored task '${taskId}' (${reason || "background job"}) has reached its observation limit of ${time}s and is still running in the background.`;
                if (endResponse) notifyMsg += `\n\nPrompt: ${endResponse}`;
                const taskName = reason || taskId;
                const badgeInfo = {
                    taskName,
                    taskId,
                    duration: time,
                    isTimer: true
                };
                triggerTaskNotificationTurn(chatId, notifyMsg, badgeInfo);
                continue;
            }
        } else {
            // Pure timer
            if (elapsedSec >= time) {
                let notifyMsg = `[Timer Notification]: Scheduled timer (${time}s${reason ? ` for ${reason}` : ""}) has completed.`;
                if (endResponse) notifyMsg += `\n\nPrompt: ${endResponse}`;
                const taskName = reason || (taskId ? `task ${taskId}` : "");
                const badgeInfo = {
                    taskName,
                    taskId,
                    duration: time,
                    isTimer: true
                };
                triggerTaskNotificationTurn(chatId, notifyMsg, badgeInfo);
                continue;
            }
        }

        // Still active
        remainingWatches.push(watch);
    }

    saveActiveWatches(remainingWatches);
    try {
        document.dispatchEvent(new CustomEvent("runningTasksUpdated"));
    } catch (_) {}
}

/**
 * Ensures the monitoring polling interval is running.
 */
function ensureWatcherRunning() {
    if (!watcherInterval) {
        watcherInterval = setInterval(checkWatchesTick, 2500);
    }
}

/**
 * Initializes the task watcher on application startup.
 */
export function initTaskWatcher() {
    const watches = getActiveWatches();
    if (watches.length > 0) {
        ensureWatcherRunning();
    }
}
