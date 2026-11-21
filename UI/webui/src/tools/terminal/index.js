import { toolFetch } from "../http.js";
import { parseTerminalAnsi, cleanTerminalScreen } from "./term-emulator.js";
import { watchBackgroundTask } from "./task-watcher.js";

/* =========================================================
   TERMINAL & TASK MANAGEMENT TOOLS (CLEAN & MINIMAL)
   ========================================================= */

/**
 * Streams real-time terminal command execution chunks directly into the UI badge.
 */
async function streamTaskExecution(args, { badgeEl, genState } = {}) {
    const cmd = args.command || args.cmd || args.CommandLine || args.code || args.script;
    if (!cmd || typeof cmd !== "string" || !cmd.trim()) {
        const received = args._unparsed ? `(unparsed arguments: ${args._unparsed})` : JSON.stringify(args);
        return {
            task_id: "error",
            status: "error",
            running: false,
            exit_code: 1,
            error: `Missing 'command' property in run_task arguments. Received: ${received}. Please invoke run_task with {"command": "<shell command>"}.`,
            stderr: `Missing 'command' property in run_task arguments. Received: ${received}`,
            stdout: ""
        };
    }

    const isBg = Boolean(args.background || args.is_daemon || args.isDaemon);
    const defaultTimer = isBg ? 1 : 10;
    const timerVal = args.timer !== undefined ? Number(args.timer) : defaultTimer;

    const payload = {
        command: cmd.trim(),
        timer: timerVal,
        timeout: timerVal,
        background: isBg,
        task_name: args.task_name,
        cwd: args.cwd,
        pty: Boolean(args.pty)
    };

    const resEl = badgeEl?._collapseDiv?.querySelector(".command-output-res");
    const pre = resEl?.closest("pre");

    if (resEl) {
        resEl.innerHTML = `<span class="terminal-stream-text"></span><span class="terminal-stream-cursor">█</span>`;
    }
    const textSpan = resEl?.querySelector(".terminal-stream-text");

    let response;
    try {
        response = await fetch("/api/task/stream", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(genState?.chatId ? { "x-chat-id": genState.chatId } : {})
            },
            body: JSON.stringify(payload),
            signal: genState?.abortController?.signal
        });
    } catch (_) {
        return await fallbackRunTask(args, genState);
    }

    if (!response.ok || !response.body) {
        return await fallbackRunTask(args, genState);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedStdout = "";
    let accumulatedStderr = "";
    let finalPayload = null;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop() || "";

            for (const ev of events) {
                const trimmed = ev.trim();
                if (!trimmed.startsWith("data:")) continue;
                const jsonStr = trimmed.slice(5).trim();
                if (!jsonStr) continue;

                try {
                    const data = JSON.parse(jsonStr);
                    if (data.type === "chunk") {
                        if (data.stdout) {
                            accumulatedStdout += data.stdout;
                        }
                        if (data.stderr) {
                            accumulatedStderr += data.stderr;
                        }
                        if (textSpan) {
                            const raw = accumulatedStdout + (accumulatedStderr ? (accumulatedStdout ? "\n" : "") + accumulatedStderr : "");
                            textSpan.innerHTML = parseTerminalAnsi(raw);
                            if (pre) pre.scrollTop = pre.scrollHeight;
                        }
                    } else if (data.type === "done") {
                        finalPayload = data;
                    }
                } catch (_) {}
            }
        }
    } catch (streamErr) {
        if (genState?.abortRequested) throw streamErr;
        console.warn("Stream interrupted, using accumulated output:", streamErr);
    }

    const cursor = resEl?.querySelector(".terminal-stream-cursor");
    if (cursor) cursor.remove();

    if (finalPayload) {
        finalPayload.alreadyStreamed = true;
        finalPayload.clean_stdout = cleanTerminalScreen(finalPayload.stdout || accumulatedStdout);
        finalPayload.clean_stderr = cleanTerminalScreen(finalPayload.stderr || accumulatedStderr);

        const shouldDetach = Boolean(args.detach || args.exit || args.Exit);
        if (shouldDetach && isBg && finalPayload.running) {
            finalPayload.detached = true;
            finalPayload.status_message = args.status_message || args.message || args.messege || `Background task '${finalPayload.task_id}' is running. I will monitor it and notify you when finished.`;
            if (finalPayload.task_id && genState?.chatId) {
                watchBackgroundTask({
                    chatId: genState.chatId,
                    taskId: finalPayload.task_id,
                    time: Number(args.time || args.timeout || 3600),
                    wakeOn: "exit",
                    reason: args.task_name || args.command,
                    statusMessage: finalPayload.status_message
                });
            }
        }
        return finalPayload;
    }

    return {
        task_id: "task",
        status: "completed",
        running: false,
        exit_code: 0,
        stdout: accumulatedStdout,
        stderr: accumulatedStderr,
        clean_stdout: cleanTerminalScreen(accumulatedStdout),
        clean_stderr: cleanTerminalScreen(accumulatedStderr),
        alreadyStreamed: true
    };
}

async function fallbackRunTask(args, genState) {
    const cmd = args.command || args.cmd || args.CommandLine || args.code || args.script;
    if (!cmd || typeof cmd !== "string" || !cmd.trim()) {
        const received = args._unparsed ? `(unparsed arguments: ${args._unparsed})` : JSON.stringify(args);
        return {
            task_id: "error",
            status: "error",
            running: false,
            exit_code: 1,
            error: `Missing 'command' property in run_task arguments. Received: ${received}. Please invoke run_task with {"command": "<shell command>"}.`,
            stderr: `Missing 'command' property in run_task arguments. Received: ${received}`,
            stdout: ""
        };
    }
    const payload = {
        command: cmd.trim(),
        timer: args.timer || 5,
        timeout: args.timer || 5,
        task_name: args.task_name,
        cwd: args.cwd
    };
    return await toolFetch("/api/task/run", { method: "POST", body: payload, genState });
}

/**
 * Executes a shell command with real-time output streaming.
 */
export const runTaskTool = {
    name: "run_task",
    schema: {
        type: "function",
        function: {
            name: "run_task",
            description: "Execute a shell command. Returns stdout, stderr, exit code, and execution time. Commands taking longer than 'timer' seconds continue running safely in the background with a task ID.",
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "The shell command to execute."
                    },
                    timer: {
                        type: "integer",
                        description: "Seconds to wait for command output before returning control (default: 10). If command takes longer, it continues running safely in the background."
                    },
                    background: {
                        type: "boolean",
                        description: "Set to true for long-running jobs (downloads, dev servers, long builds) to let them run in the background immediately so you can continue other work and conclude your response."
                    },
                    detach: {
                        type: "boolean",
                        description: "Set to true alongside background: true to conclude your response turn immediately; MultiAI will monitor the task in the background and re-awaken you when it finishes."
                    },
                    status_message: {
                        type: "string",
                        description: "Optional concluding status message for the user explaining that the background job is running."
                    },
                    task_name: {
                        type: "string",
                        description: "Optional short 2-4 word description for UI presentation (e.g. 'Build project', 'Run tests')."
                    },
                    cwd: {
                        type: "string",
                        description: "Optional working directory to run the command in."
                    },
                    pty: {
                        type: "boolean",
                        description: "Set to true to execute inside a real pseudo-terminal (PTY) with full TTY capabilities, ANSI escape codes, and terminal discipline."
                    }
                },
                required: ["command"]
            }
        }
    },
    handler: async (args, { badgeEl, genState } = {}) => {
        return await streamTaskExecution(args, { badgeEl, genState });
    }
};

/**
 * Manages background tasks: sending keycodes / quoted text input or killing tasks.
 */
export const manageTasksTool = {
    name: "manage_tasks",
    schema: {
        type: "function",
        function: {
            name: "manage_tasks",
            description: "Manage background shell tasks: check status, inspect stdout, send interactive input, or terminate tasks.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["status", "stdout", "send_input", "kill_task"],
                        description: "Action to execute: 'status' or 'stdout' (view output/status), 'send_input' (send keycode/text to stdin), or 'kill_task' (terminate task)."
                    },
                    task_id: {
                        type: "string",
                        description: "The ID of the target running task."
                    },
                    input: {
                        type: "string",
                        description: "Input when action is 'send_input'. Keycodes like 'ctrl+c', 'ctrl+d', 'enter', or text inputs in quotes like \"'my answer'\"."
                    }
                },
                required: ["action", "task_id"]
            }
        }
    },
    handler: async (args, { genState }) => {
        const action = (args.action || args.subcommand || "").toLowerCase().trim();
        const taskId = args.task_id || args.id || args.taskId;
        if (!taskId) {
            throw new Error("Missing 'task_id' for manage_tasks.");
        }

        // 1. Kill Task Subcommand
        if (action === "kill_task" || action === "kill") {
            return await toolFetch(`/api/task/kill/${encodeURIComponent(taskId)}`, {
                method: "POST",
                genState
            });
        }

        // 2. Send Input Subcommand
        if (action === "send_input" || action === "input") {
            const rawVal = args.input !== undefined ? args.input : (args.text !== undefined ? args.text : (args.key !== undefined ? args.key : ""));
            let isKeycode = false;
            let combination = "";
            let textInput = "";

            if (typeof rawVal === "string") {
                const trimmed = rawVal.trim();
                // Check if wrapped in quotes e.g. 'input' or "input"
                const isSingleQuoted = trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2;
                const isDoubleQuoted = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2;

                if (isSingleQuoted || isDoubleQuoted) {
                    textInput = trimmed.slice(1, -1);
                    isKeycode = false;
                } else if (
                    /^(ctrl|alt|control|shift)[\+\-\s][a-z0-9]$/i.test(trimmed) ||
                    ["enter", "return", "tab", "esc", "escape", "up", "down", "left", "right", "backspace", "space"].includes(trimmed.toLowerCase())
                ) {
                    isKeycode = true;
                    combination = trimmed;
                } else {
                    textInput = trimmed;
                }
            } else {
                textInput = String(rawVal ?? "");
            }

            const payload = {
                type: isKeycode ? "keycode" : "text",
                combination: isKeycode ? combination : undefined,
                input_string: isKeycode ? undefined : textInput,
                press_enter: !isKeycode
            };

            return await toolFetch(`/api/task/input/${encodeURIComponent(taskId)}`, {
                method: "POST",
                body: payload,
                genState
            });
        }

        // Optional status / stdout inspect
        if (action === "status" || action === "stdout" || action === "get_output") {
            return await toolFetch(`/api/task/stdout/${encodeURIComponent(taskId)}`, {
                method: "GET",
                genState
            });
        }

        throw new Error(`Unknown manage_tasks action '${action}'. Supported subcommands: 'send_input', 'kill_task'.`);
    }
};

/**
 * Schedules a one-shot timer or a recurring cron job that notifies via Prompt.
 * Full Antigravity schedule capability integrated into MultiAI.
 */
export const scheduleTool = {
    name: "schedule",
    schema: {
        type: "function",
        function: {
            name: "schedule",
            description: "Schedule a one-shot timer (DurationSeconds) or a recurring cron job (CronExpression) that notifies you via Prompt. This tool call runs as a background task and returns immediately; end your turn (call no more tools) to wait for notifications. A timer with a TimerCondition is cancelled early by a matching message or task completion, which is itself your wakeup. Set IsDaemon only for a cron that should keep firing after the current task is done. Set ExactTiming only when a cron must fire at the exact wall-clock time without jitter. Use manage_tasks to cancel active schedules, and never use a shell sleep command as a timer.",
            parameters: {
                type: "object",
                properties: {
                    CronExpression: {
                        type: "string",
                        description: "Standard 5-field cron expression for a recurring schedule (e.g. '*/5 * * * *' for every 5 minutes). Mutually exclusive with DurationSeconds."
                    },
                    DurationSeconds: {
                        type: "integer",
                        description: "Seconds to wait for a one-shot timer. Mutually exclusive with CronExpression."
                    },
                    Prompt: {
                        type: "string",
                        description: "Message sent to you as a high-priority notification when the timer fires or the cron triggers."
                    },
                    TimerCondition: {
                        type: "string",
                        description: "Timer only. Cancels the timer early when a matching message arrives or task finishes: 'never' (default), 'any' (any message/task event), or a sender/task ID."
                    },
                    IsDaemon: {
                        type: "boolean",
                        description: "Cron only. Set true only for an independent standing job that should keep firing after the current task is done."
                    },
                    MaxIterations: {
                        type: "integer",
                        description: "Cron only. Maximum number of triggers before the schedule stops; defaults to unlimited."
                    },
                    ExactTiming: {
                        type: "boolean",
                        description: "Cron only. Set true only when the user explicitly requires the schedule to fire at the exact wall-clock time without jitter."
                    },
                    task: {
                        type: "string",
                        description: "Optional background task_id (e.g. 't_...') or shell command to run and monitor in the background."
                    },
                    detach: {
                        type: "boolean",
                        description: "Set to true to conclude your turn immediately; MultiAI will monitor in background and re-awaken you when complete (default: true)."
                    }
                }
            }
        }
    },
    handler: async (args, { genState } = {}) => {
        // Resolve Cron vs Duration
        const cronExpr = args.CronExpression || args.cron_expression || args.cron || null;
        const rawDuration = args.DurationSeconds ?? args.duration_seconds ?? args.time ?? args.seconds ?? args.sleep_time;
        const durationSec = rawDuration !== undefined ? Math.max(0.1, parseFloat(rawDuration)) : (cronExpr ? null : 5);
        const prompt = args.Prompt || args.prompt || args.end_response || args["end-response"] || null;
        const timerCondition = args.TimerCondition || args.timer_condition || args.wake_on || "never";
        const isDaemon = Boolean(args.IsDaemon ?? args.is_daemon ?? args.daemon);
        const maxIterations = args.MaxIterations ?? args.max_iterations ?? null;
        const exactTiming = Boolean(args.ExactTiming ?? args.exact_timing);
        const task = (args.task || args.task_id || "").trim();
        const reason = args.reason || (cronExpr ? `Cron: ${cronExpr}` : (task ? `Monitoring ${task}` : `Timer: ${durationSec}s`));

        let taskId = null;
        if (task) {
            const isTaskIdPattern = /^(t_|task[_-])[a-zA-Z0-9_-]+$/i.test(task);
            if (isTaskIdPattern) {
                taskId = task;
            } else {
                try {
                    const spawnRes = await toolFetch("/api/task/idle", {
                        method: "POST",
                        body: { command: task },
                        genState
                    });
                    taskId = spawnRes.task_id || null;
                } catch (err) {
                    console.warn("[SCHEDULE] Could not launch task command:", err.message);
                }
            }
        }

        const isDetached = args.detach !== false && args.blocking !== true;

        if (isDetached || cronExpr) {
            watchBackgroundTask({
                chatId: genState?.chatId,
                taskId,
                time: durationSec || 0,
                cronExpression: cronExpr,
                maxIterations,
                isDaemon,
                exactTiming,
                timerCondition,
                wakeOn: timerCondition,
                prompt,
                endResponse: prompt,
                reason
            });

            if (cronExpr) {
                return {
                    status: "scheduled_cron",
                    CronExpression: cronExpr,
                    IsDaemon: isDaemon,
                    MaxIterations: maxIterations,
                    Prompt: prompt || `Cron schedule '${cronExpr}' triggered`,
                    message: `Recurring cron job '${cronExpr}' scheduled as background task. Notification prompt: "${prompt || 'Cron trigger'}"`
                };
            }

            return {
                status: "scheduled_timer",
                DurationSeconds: durationSec,
                TimerCondition: timerCondition,
                Prompt: prompt || `Timer completed after ${durationSec}s`,
                task_id: taskId || undefined,
                message: `One-shot timer of ${durationSec}s scheduled as background task. Returns immediately; will notify via Prompt.`
            };
        }

        // Inline blocking timer fallback for short waits if explicitly requested (detach: false)
        const res = await toolFetch("/api/task/idle", {
            method: "POST",
            body: {
                seconds: durationSec || 5,
                task_id: taskId,
                wake_on: timerCondition === "never" ? "never" : "exit",
                reason
            },
            genState
        });

        if (prompt) res.Prompt = prompt;
        if (taskId) res.task_id = taskId;
        return res;
    }
};

export const terminalTools = [
    runTaskTool,
    manageTasksTool,
    scheduleTool
];
