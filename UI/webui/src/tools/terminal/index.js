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
    const isBg = Boolean(args.background || args.is_daemon || args.isDaemon);
    const defaultTimer = isBg ? 1 : 10;
    const timerVal = args.timer !== undefined ? Number(args.timer) : defaultTimer;

    const payload = {
        command: args.command,
        timer: timerVal,
        timeout: timerVal,
        background: isBg,
        task_name: args.task_name,
        cwd: args.cwd
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
    const payload = {
        command: args.command,
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
            description: "Manage background shell tasks. Send keycodes, interactive text input, or terminate tasks.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["send_input", "kill_task"],
                        description: "Subcommand to execute: 'send_input' (send keycode/text to stdin) or 'kill_task' (terminate task)."
                    },
                    task_id: {
                        type: "string",
                        description: "The ID of the target running task."
                    },
                    input: {
                        type: "string",
                        description: "Input when action is 'send_input'. Keycodes like 'ctrl+c', 'ctrl+d', 'alt+x', 'enter', or text inputs in quotes like \"'my answer'\"."
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
 * Schedules a sleep timer or hooks onto a background task.
 * Supports:
 * - just-wait (sleep timer): Provide time / sleep_time. Waits for the duration and continues.
 * - hook-on-task-and-wait: Provide time and task (task_id or shell command to run and monitor).
 * - optional end_response: Text / response to return when the timer completes, allowing the model to auto-start or continue.
 */
export const scheduleTool = {
    name: "schedule",
    schema: {
        type: "function",
        function: {
            name: "schedule",
            description: "Schedule a timer, pause execution, or hook onto a background task. For long tasks or waits (> 15-20s), set 'detach: true' to finish your response turn immediately; MultiAI will monitor the task in the background and re-awaken you when it completes.",
            parameters: {
                type: "object",
                properties: {
                    time: {
                        type: "number",
                        description: "Duration in seconds to sleep or wait (e.g. 5, 30, 60, 300)."
                    },
                    task: {
                        type: "string",
                        description: "Optional background task_id to monitor (or shell command to start and monitor in background). If omitted, performs a sleep timer."
                    },
                    detach: {
                        type: "boolean",
                        description: "Set to true for long-running tasks or timers (> 15-20s) to detach from the current turn immediately, deliver your status message, and conclude your response turn cleanly. MultiAI will autonomously monitor the task and re-awaken you in a new turn when it finishes."
                    },
                    status_message: {
                        type: "string",
                        description: "Optional status message for the user explaining that the task is running in the background and you will check back on it (e.g. 'The download is running in the background, I will keep a watch on it every few minutes; until then you can do other tasks or close the window.')."
                    },
                    end_response: {
                        type: "string",
                        description: "Optional response or action prompt to return when the timer completes, allowing the agent to automatically start or continue reasoning."
                    },
                    wake_on: {
                        type: "string",
                        enum: ["exit", "output", "any", "never"],
                        description: "When hooked on a task, early wake condition: 'exit' (default: wakes when task exits), 'output' (wakes on new output), 'any' (exit or output), 'never' (always waits full duration)."
                    },
                    reason: {
                        type: "string",
                        description: "Optional human-readable explanation of what is being scheduled or waited for."
                    }
                },
                required: ["time"]
            }
        }
    },
    handler: async (args, { genState }) => {
        const rawTime = args.time ?? args.sleep_time ?? args.seconds ?? 5;
        const time = Math.max(0.1, parseFloat(rawTime) || 5);
        const task = (args.task || args.task_id || "").trim();
        const endResponse = args.end_response ?? args["end-response"] ?? null;
        const wakeOn = args.wake_on || "exit";
        const reason = args.reason || (task ? `Monitoring ${task}` : `Sleeping for ${time}s`);
        const explicitlyBlocking = (args.detach === false || args.exit === false || args.Exit === false);
        const isDetached = !explicitlyBlocking && Boolean(
            args.detach || 
            args.exit || 
            args.Exit || 
            args.background || 
            args.async || 
            time >= 20 || 
            (typeof reason === "string" && /\b(detach|background)\b/i.test(reason))
        );
        const statusMessage = args.status_message || args.statusMessage || args.message || args.messege || args.exit_message || args.exitMessage || "";

        let taskId = null;
        if (task) {
            if (/^[a-zA-Z0-9_-]+$/.test(task)) {
                taskId = task;
            } else {
                try {
                    const runRes = await toolFetch("/api/task/run", {
                        method: "POST",
                        body: { command: task, timer: 0.1, timeout: 0.1, task_name: reason },
                        genState
                    });
                    taskId = runRes.task_id || null;
                    if (!taskId && runRes.stdout !== undefined && !isDetached) {
                        return {
                            status: "task_completed",
                            task,
                            elapsed_seconds: runRes.execution_time || 0.1,
                            output: (runRes.stdout || "") + (runRes.stderr ? "\n" + runRes.stderr : ""),
                            end_response: endResponse || "Task completed immediately."
                        };
                    }
                } catch (err) {
                    console.warn("[SCHEDULE] Could not launch task command:", err.message);
                }
            }
        }

        // If detached mode is requested, register background watcher and yield immediately!
        if (isDetached) {
            watchBackgroundTask({
                chatId: genState?.chatId,
                taskId,
                time,
                wakeOn,
                endResponse,
                reason,
                statusMessage
            });

            return {
                status: "scheduled_detached",
                detached: true,
                task_id: taskId,
                time,
                wake_on: wakeOn,
                reason,
                status_message: statusMessage || `Task running in background (${time}s timeout, wake on ${wakeOn}). I will monitor it and notify you when finished.`
            };
        }

        const res = await toolFetch("/api/task/idle", {
            method: "POST",
            body: {
                seconds: time,
                task_id: taskId,
                wake_on: wakeOn,
                reason
            },
            genState
        });

        if (endResponse) {
            res.end_response = endResponse;
        }
        if (taskId) {
            res.task_id = taskId;
        }
        return res;
    }
};

export const terminalTools = [
    runTaskTool,
    manageTasksTool,
    scheduleTool
];
