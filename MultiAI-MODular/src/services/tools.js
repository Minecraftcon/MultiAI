/* =========================================================
   TOOL DEFINITIONS & HTTP EXECUTION
   ========================================================= */

export const tools = [
    {
        type: "function",
        function: {
            name: "web_search",
            description: "Search the live web for current or external information.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string" },
                    location: { type: "string" },
                    language: { type: "string" },
                    page: { type: "integer" }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "fetch_web_content",
            description: "Fetch and read the full text/markdown content from one or more web page URLs. Use this when you have specific URLs to inspect, read documentation, articles, or web pages.",
            parameters: {
                type: "object",
                properties: {
                    urls: {
                        type: "array",
                        items: { type: "string" },
                        description: "List of HTTP/HTTPS URLs to fetch and read (up to 10 URLs)"
                    },
                    format: {
                        type: "string",
                        enum: ["markdown", "html", "json"],
                        description: "Format of returned content: 'markdown' (default), 'html', or 'json'"
                    }
                },
                required: ["urls"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "run_task",
            description: "Run a system command asynchronously. Waits for cooldown timeout before capturing initial stdout/stderr.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "The shell command to execute" },
                    timeout: { type: "integer", description: "Cooldown seconds to wait before checking output (e.g. 1, 2, 5)" }
                },
                required: ["command", "timeout"]
            }
        }
    },
    {
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
    {
        type: "function",
        function: {
            name: "task_send_input",
            description: "Write text into standard input (stdin) of an active task.",
            parameters: {
                type: "object",
                properties: {
                    task_id: { type: "string" },
                    input_string: { type: "string" }
                },
                required: ["task_id", "input_string"]
            }
        }
    },
    {
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
    {
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
    }
];

export async function executeTool(name, args, badgeEl, genState) {
    if (genState.abortRequested) {
        throw new Error("Generation stopped by user");
    }

    if (name === "run_task" && badgeEl) {
        const cooldown = Math.max(1, parseInt(args.timeout, 10) || 1);
        const ringBar = badgeEl.querySelector(".timer-ring-bar");
        if (ringBar) {
            ringBar.style.transition = "none";
            ringBar.style.strokeDashoffset = "108.39";
            void ringBar.getBoundingClientRect();
            ringBar.style.transition = `stroke-dashoffset ${cooldown}s linear`;
            ringBar.style.strokeDashoffset = "0";
        }
    }

    if (name === "sleep") {
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
                genState.sleepResolve = null;
                res();
            };
            genState.sleepResolve = cleanup;
            timeoutId = setTimeout(cleanup, delay * 1000);
        });

        if (genState.abortRequested) {
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

    let url = "";
    let method = "POST";

    if (name === "web_search") {
        url = "/api/search";
    } else if (name === "fetch_web_content" || name === "web_fetch") {
        url = "/api/fetch";
        if (!args.urls && args.url) {
            args.urls = [args.url];
        }
    } else if (name === "run_task") {
        url = "/api/task/run";
    } else if (name === "task_stdout") {
        url = `/api/task/stdout/${encodeURIComponent(args.task_id)}`;
        method = "GET";
    } else if (name === "task_send_input") {
        url = `/api/task/input/${encodeURIComponent(args.task_id)}`;
    } else if (name === "task_kill") {
        url = `/api/task/kill/${encodeURIComponent(args.task_id)}`;
    } else {
        throw new Error("Unknown tool: " + name);
    }

    const opts = {
        method,
        headers: { "Content-Type": "application/json" }
    };

    if (genState.abortController) {
        opts.signal = genState.abortController.signal;
    }

    if (method === "POST" && name !== "task_kill") {
        opts.body = JSON.stringify(args);
    }

    let response;
    try {
        response = await fetch(url, opts);
    } catch (e) {
        if (genState.abortRequested || e.name === "AbortError") {
            throw new Error("Generation stopped by user");
        }
        throw e;
    }

    let data;
    const text = await response.text();
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(`API error (${response.status}): ${text.slice(0, 70)}...`);
    }

    if (!response.ok) {
        throw new Error(data.error || "Tool call execution failed");
    }

    if (name === "run_task" && badgeEl) {
        badgeEl.classList.add("timer-finished");
    }

    if (badgeEl && badgeEl._collapseDiv) {
        const resEl = badgeEl._collapseDiv.querySelector(".command-output-res");
        if (resEl) {
            let outText = "";
            if (data.stdout || data.stderr) {
                outText = (data.stdout || "") + (data.stderr ? ("\n" + data.stderr) : "");
            } else if (data.status) {
                outText = data.status;
            } else if (data.results && Array.isArray(data.results)) {
                outText = data.results.map(r => `[${r.title || r.url}]\n${(r.text || "").slice(0, 800)}${r.text?.length > 800 ? "..." : ""}`).join("\n\n---\n\n");
            } else {
                outText = JSON.stringify(data, null, 2);
            }
            resEl.textContent = outText.trim() || "(Executed with no standard output)";
        }
    }

    return data;
}
