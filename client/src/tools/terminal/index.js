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

/* =========================================================
   BACKWARD-COMPATIBILITY ALIASES
   ========================================================= */

export const runCommandAlias = {
    name: "run_command",
    schema: null, // Keep prompt schema clean with run_task
    handler: runTaskTool.handler
};

export const manageTaskAlias = {
    name: "manage_task",
    schema: null,
    handler: manageTasksTool.handler
};

export const taskSendInputAlias = {
    name: "task_send_input",
    schema: null,
    handler: (args, ctx) => manageTasksTool.handler({ ...args, action: "send_input" }, ctx)
};

export const taskKillAlias = {
    name: "task_kill",
    schema: null,
    handler: (args, ctx) => manageTasksTool.handler({ ...args, action: "kill_task" }, ctx)
};

export const terminalTools = [
    runTaskTool,
    manageTasksTool,
    runCommandAlias,
    manageTaskAlias,
    taskSendInputAlias,
    taskKillAlias
];
