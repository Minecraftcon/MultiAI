import { toolFetch } from "../http.js";

/* =========================================================
   TERMINAL & TASK MANAGEMENT TOOLS
   ========================================================= */

export const terminalTools = [
    {
        name: "run_task",
        schema: {
            type: "function",
            function: {
                name: "run_task",
                description: "Run a system command asynchronously. Waits for cooldown timeout before capturing initial stdout/stderr. You can execute scratch scripts or redirect outputs using '$SCRATCH/<filename>'.",
                parameters: {
                    type: "object",
                    properties: {
                        command: { type: "string", description: "The shell command to execute. Supports '$SCRATCH/<filename>' to access conversation scratch files." },
                        task_name: { type: "string", description: "A concise 2-4 word label describing what this command accomplishes (e.g. 'Analyze project', 'Run unit tests', 'Check git status')" },
                        timeout: { type: "integer", description: "Cooldown seconds to wait before checking output (e.g. 1, 2, 5)" }
                    },
                    required: ["command", "timeout"]
                }
            }
        },
        handler: async (args, { genState }) => {
            return await toolFetch("/api/task/run", { method: "POST", body: args, genState });
        }
    },
    {
        name: "run_python",
        schema: {
            type: "function",
            function: {
                name: "run_python",
                description: "Execute Python code directly in the environment. Automatically captures stdout, stderr, execution time, and evaluates the value of the final expression if present (like Jupyter).",
                parameters: {
                    type: "object",
                    properties: {
                        code: {
                            type: "string",
                            description: "The complete Python code snippet to execute."
                        },
                        timeout: {
                            type: "integer",
                            description: "Maximum execution seconds before timeout (default: 30)."
                        }
                    },
                    required: ["code"]
                }
            }
        },
        handler: async (args, { genState }) => {
            return await toolFetch("/api/python/run", { method: "POST", body: args, genState });
        }
    },
    {
        name: "task_stdout",
        schema: {
            type: "function",
            function: {
                name: "task_stdout",
                description: "Read cumulative stdout and stderr buffers for a previously started task.",
                parameters: {
                    type: "object",
                    properties: {
                        task_id: { type: "string", description: "Task ID returned from run_task" }
                    },
                    required: ["task_id"]
                }
            }
        },
        handler: async (args, { genState }) => {
            return await toolFetch(`/api/task/stdout/${encodeURIComponent(args.task_id)}`, { method: "GET", genState });
        }
    },
    {
        name: "task_send_input",
        schema: {
            type: "function",
            function: {
                name: "task_send_input",
                description: "Write text into standard input (stdin) or send keyboard keycodes/combinations (like Ctrl+C, Ctrl+D, Enter, Esc) to an active background task.",
                parameters: {
                    type: "object",
                    properties: {
                        task_id: { 
                            type: "string", 
                            description: "Task ID returned from run_task" 
                        },
                        type: {
                            type: "string",
                            enum: ["text", "keycode"],
                            description: "'text' (default: sends text string and automatically submits with Enter) or 'keycode' (send key combinations like 'ctrl+c', 'ctrl+d', 'ctrl+z', 'enter', 'esc', 'tab', 'up', 'down')."
                        },
                        field: { 
                            type: "string", 
                            description: "For type 'text': the text string to write into standard input (e.g. 'y', 'user_response'). Automatically submits with Enter." 
                        },
                        combination: {
                            type: "string",
                            description: "For type 'keycode': the key combination to send (e.g. 'ctrl+c', 'ctrl+d', 'ctrl+z', 'enter', 'esc', 'tab', 'up', 'down', 'backspace')."
                        },
                        input_string: { 
                            type: "string", 
                            description: "Backward-compatible alias for field when type is 'text'." 
                        }
                    },
                    required: ["task_id"]
                }
            }
        },
        handler: async (args, { genState }) => {
            const payload = { ...args };
            if (payload.field !== undefined && payload.input_string === undefined) {
                payload.input_string = payload.field;
            }
            if (payload.combination && !payload.type) {
                payload.type = "keycode";
            }
            return await toolFetch(`/api/task/input/${encodeURIComponent(args.task_id)}`, { method: "POST", body: payload, genState });
        }
    },
    {
        name: "task_kill",
        schema: {
            type: "function",
            function: {
                name: "task_kill",
                description: "Terminate a background task by ID.",
                parameters: {
                    type: "object",
                    properties: {
                        task_id: { type: "string" }
                    },
                    required: ["task_id"]
                }
            }
        },
        handler: async (args, { genState }) => {
            return await toolFetch(`/api/task/kill/${encodeURIComponent(args.task_id)}`, { method: "POST", genState });
        }
    },
    {
        name: "idle",
        schema: {
            type: "function",
            function: {
                name: "idle",
                description: "Pause execution for a duration or wait until an active background task completes / produces output without wasting timer time.",
                parameters: {
                    type: "object",
                    properties: {
                        seconds: {
                            type: "integer",
                            description: "Maximum seconds to wait (1 to 300, default: 5)"
                        },
                        task_id: {
                            type: "string",
                            description: "Optional background task ID to monitor for early exit or new output"
                        },
                        wake_on: {
                            type: "string",
                            enum: ["exit", "output", "timer"],
                            description: "'exit' (wakes as soon as task finishes or times out), 'output' (wakes on new output), 'timer' (unconditional wait)"
                        },
                        reason: {
                            type: "string",
                            description: "Optional description for why the agent is waiting (displayed in UI)"
                        }
                    }
                }
            }
        },
        handler: async (args, { genState }) => {
            return await toolFetch("/api/task/idle", { method: "POST", body: args, genState });
        }
    },
    {
        name: "sleep",
        schema: {
            type: "function",
            function: {
                name: "sleep",
                description: "Set a timer cooldown before waking up to inspect background operations.",
                parameters: {
                    type: "object",
                    properties: {
                        seconds: { type: "integer", description: "Seconds to wait" }
                    },
                    required: ["seconds"]
                }
            }
        },
        handler: async (args, { badgeEl, genState }) => {
            const delay = Math.max(1, parseInt(args.seconds, 10) || 1);
            if (badgeEl) {
                const ringBar = badgeEl.querySelector(".timer-ring-bar");
                const labelEl = badgeEl.querySelector(".search-label");
                const queryEl = badgeEl.querySelector(".search-query");

                if (ringBar) {
                    ringBar.style.transition = "none";
                    ringBar.style.strokeDashoffset = "108.39";
                    void ringBar.getBoundingClientRect();
                    ringBar.style.transition = `stroke-dashoffset ${delay}s linear`;
                    ringBar.style.strokeDashoffset = "0";
                }
                if (labelEl) labelEl.textContent = "Sleeping...";
                if (queryEl) queryEl.textContent = `${delay}s timer`;
            }

            await new Promise(res => {
                let timeoutId = null;
                const cleanup = () => {
                    if (timeoutId) clearTimeout(timeoutId);
                    if (genState) genState.sleepResolve = null;
                    res();
                };
                if (genState) genState.sleepResolve = cleanup;
                timeoutId = setTimeout(cleanup, delay * 1000);
            });

            if (genState && genState.abortRequested) {
                if (badgeEl) {
                    const labelEl = badgeEl.querySelector(".search-label");
                    if (labelEl) labelEl.textContent = "Stopped";
                    badgeEl.classList.add("timer-finished");
                }
                throw new Error("Generation stopped by user");
            }

            if (badgeEl) {
                const labelEl = badgeEl.querySelector(".search-label");
                const queryEl = badgeEl.querySelector(".search-query");
                if (labelEl) labelEl.textContent = "Timer hit";
                if (queryEl) queryEl.textContent = `${delay}s completed`;
                badgeEl.classList.add("timer-finished");
            }

            return { status: "timer_completed", seconds: delay };
        }
    }
];
