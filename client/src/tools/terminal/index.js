import { toolFetch } from "../http.js";

/* =========================================================
   TERMINAL & TASK MANAGEMENT TOOLS (CLEAN & MINIMAL)
   ========================================================= */

/**
 * Executes a shell command with a wait timer cooldown.
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
                        description: "Seconds to wait for command output before returning (default: 5)."
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
    handler: async (args, { genState }) => {
        const payload = {
            command: args.command,
            timer: args.timer || 5,
            timeout: args.timer || 5,
            task_name: args.task_name,
            cwd: args.cwd
        };
        return await toolFetch("/api/task/run", { method: "POST", body: payload, genState });
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
            description: "Schedule a timer, pause execution, or hook onto a background task with an optional wake condition and completion response. Supports 'hook-on-task-and-wait' or pure 'just-wait' sleep modes.",
            parameters: {
                type: "object",
                properties: {
                    time: {
                        type: "number",
                        description: "Duration in seconds to sleep or wait (e.g. 5, 10, 30)."
                    },
                    task: {
                        type: "string",
                        description: "Optional background task_id to monitor (or shell command to start and monitor). If omitted, performs a pure sleep timer."
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
                    if (!taskId && runRes.stdout !== undefined) {
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
