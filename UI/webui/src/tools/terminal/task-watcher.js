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

function matchField(expr, val, min, max) {
    if (!expr || expr === "*") return true;
    for (const part of expr.split(",")) {
        if (part.includes("/")) {
            const [range, stepStr] = part.split("/");
            const step = parseInt(stepStr, 10);
            if (!step || step <= 0) continue;
            let start = min;
            let end = max;
            if (range !== "*") {
                if (range.includes("-")) {
                    const [s, e] = range.split("-").map(Number);
                    start = s; end = e;
                } else {
                    start = parseInt(range, 10);
                }
            }
            if (val >= start && val <= end && (val - start) % step === 0) {
                return true;
            }
        } else if (part.includes("-")) {
            const [s, e] = part.split("-").map(Number);
            if (val >= s && val <= e) return true;
        } else {
            if (parseInt(part, 10) === val) return true;
        }
    }
    return false;
}

/**
 * Evaluates standard 5-field cron expression: (minute hour dom month dow).
 */
export function matchesCron(cronExpr, date = new Date()) {
    if (!cronExpr || typeof cronExpr !== "string") return false;
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return false;

    const [minExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts;
    return (
        matchField(minExpr, date.getMinutes(), 0, 59) &&
        matchField(hourExpr, date.getHours(), 0, 23) &&
        matchField(domExpr, date.getDate(), 1, 31) &&
        matchField(monthExpr, date.getMonth() + 1, 1, 12) &&
        matchField(dowExpr, date.getDay(), 0, 6)
    );
}

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
 * Adds a background task, timer, or recurring cron job to the autonomous watcher.
 */
export function watchBackgroundTask({
    chatId,
    taskId = null,
    time = 60,
    cronExpression = null,
    maxIterations = null,
    isDaemon = false,
    exactTiming = false,
    timerCondition = "never",
    wakeOn = "exit",
    prompt = null,
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
        time: parseFloat(time) || 0,
        cronExpression: cronExpression ? cronExpression.trim() : null,
        maxIterations: maxIterations ? parseInt(maxIterations, 10) : null,
        iterationCount: 0,
        isDaemon: Boolean(isDaemon),
        exactTiming: Boolean(exactTiming),
        timerCondition: timerCondition || (wakeOn === "never" ? "never" : (taskId ? taskId : "any")),
        wakeOn,
        prompt: prompt || endResponse,
        endResponse: prompt || endResponse,
        reason,
        statusMessage,
        startedAt: Date.now(),
        lastFiredMinute: null
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

        // Chat was deleted or is no longer loaded: drop the watch instead of firing it
        if (!state.chatSessions || !state.chatSessions[chatId]) continue;

        const elapsedSec = (Date.now() - startedAt) / 1000;

        // 1. Cron Expression Evaluation
        if (watch.cronExpression) {
            const currentMinuteKey = Math.floor(Date.now() / 60000);
            if (watch.lastFiredMinute !== currentMinuteKey && matchesCron(watch.cronExpression, new Date())) {
                watch.lastFiredMinute = currentMinuteKey;
                watch.iterationCount = (watch.iterationCount || 0) + 1;
                const iterationInfo = watch.maxIterations ? ` (${watch.iterationCount}/${watch.maxIterations})` : ` (#${watch.iterationCount})`;
                let notifyMsg = watch.prompt || watch.endResponse || `[Recurring Cron Trigger]: Cron '${watch.cronExpression}' triggered${iterationInfo}.`;
                const badgeInfo = {
                    taskName: `Cron: ${watch.cronExpression}`,
                    taskId: null,
                    duration: 0,
                    isTimer: true
                };
                triggerTaskNotificationTurn(chatId, notifyMsg, badgeInfo);

                if (watch.maxIterations && watch.iterationCount >= watch.maxIterations) {
                    continue; // Reached max iterations, stop
                }
            }
            remainingWatches.push(watch);
            continue;
        }

        // 2. Monitored Background Task or Timer with TimerCondition
        if (taskId) {
            try {
                const res = await fetch(`/api/task/stdout/${encodeURIComponent(taskId)}`);
                if (res.status === 404) {
                    // Task no longer exists (e.g. terminal daemon restarted) — drop the stale watch
                    continue;
                }
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.running === false) {
                        // Task completed!
                        const exitCode = data.exit_code ?? 0;
                        const stdout = cleanTerminalScreen(data.stdout || "").trim();
                        const stderr = cleanTerminalScreen(data.stderr || "").trim();
                        const duration = data.elapsed_seconds || elapsedSec.toFixed(1);

                        // If timerCondition is 'never', ignore early exit and wait full duration
                        if (watch.timerCondition === "never" && time > 0 && elapsedSec < time) {
                            remainingWatches.push(watch);
                            continue;
                        }

                        let notifyMsg = watch.prompt || watch.endResponse || `[Background Task Notification]: Task '${taskId}' (${reason || "background job"}) completed with exit code ${exitCode} after ${duration}s.`;
                        if (!watch.prompt) {
                            if (stdout) notifyMsg += `\n\nStandard Output:\n\`\`\`\n${stdout.slice(0, 3000)}\n\`\`\``;
                            if (stderr) notifyMsg += `\n\nStandard Error:\n\`\`\`\n${stderr.slice(0, 1500)}\n\`\`\``;
                        }

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
                let notifyMsg = watch.prompt || watch.endResponse || `[Background Task Timeout]: Monitored task '${taskId}' (${reason || "background job"}) has reached its observation limit of ${time}s and is still running in the background.`;
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
                let notifyMsg = watch.prompt || watch.endResponse || `[Timer Notification]: Scheduled timer (${time}s${reason ? ` for ${reason}` : ""}) has completed.`;
                const taskName = reason || (taskId ? `task ${taskId}` : "Schedule timer");
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
 * Drops watches left over from earlier sessions that must never fire on startup:
 * watches for chats that no longer exist, one-shot timers that already elapsed while
 * the page was closed, and exhausted recurring schedules.
 */
function pruneRestoredWatches(watches) {
    const now = Date.now();
    const knownChats = Object.keys(state.chatSessions || {});
    const chatSet = new Set(knownChats);

    return watches.filter((w) => {
        if (!w || !w.chatId) return false;
        // Only drop for unknown chats when sessions actually loaded, so a loading
        // race can never wipe every watch.
        if (chatSet.size > 0 && !chatSet.has(w.chatId)) return false;

        if (w.cronExpression) {
            if (w.maxIterations && (w.iterationCount || 0) >= w.maxIterations) return false;
            return true;
        }

        const time = Number(w.time) || 0;
        const startedAt = Number(w.startedAt) || 0;

        // Task watches are verified against the server below
        if (w.taskId) return true;

        // One-shot timer already expired before this page loaded: stale, do not fire
        if (time > 0 && now - startedAt >= time * 1000) return false;

        return true;
    });
}

/**
 * Initializes the task watcher on application startup.
 * Restored watches are validated before monitoring resumes so stale timers and
 * schedules from previous sessions never fire a burst of notifications on load.
 */
export function initTaskWatcher() {
    const watches = getActiveWatches();
    if (watches.length === 0) return;

    const restored = pruneRestoredWatches(watches);

    // Restored task watches are trusted only while their task is still running on the
    // server; finished or vanished tasks must never produce a stale notification turn.
    const taskWatches = restored.filter((w) => w.taskId && !w.cronExpression);
    if (taskWatches.length === 0) {
        saveActiveWatches(restored);
        ensureWatcherRunning();
        return;
    }

    Promise.all(taskWatches.map(async (w) => {
        try {
            const res = await fetch(`/api/task/stdout/${encodeURIComponent(w.taskId)}`);
            if (!res.ok) return { id: w.id, keep: false };
            const data = await res.json();
            return { id: w.id, keep: Boolean(data && data.running === true) };
        } catch (_) {
            // Transient network failure: keep the watch rather than lose a live task
            return { id: w.id, keep: true };
        }
    })).then((results) => {
        const keepIds = new Set(results.filter((r) => r.keep).map((r) => r.id));
        const keep = restored.filter((w) => !w.taskId || w.cronExpression || keepIds.has(w.id));
        saveActiveWatches(keep);
        if (keep.length > 0) ensureWatcherRunning();
        try {
            document.dispatchEvent(new CustomEvent("runningTasksUpdated"));
        } catch (_) {}
    });
}
