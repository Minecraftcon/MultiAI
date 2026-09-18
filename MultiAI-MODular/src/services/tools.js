/* =========================================================
   TOOL DEFINITIONS & HTTP EXECUTION
   ========================================================= */
import { state } from "../state.js";

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
                    task_name: { type: "string", description: "A concise 2-4 word label describing what this command accomplishes (e.g. 'Analyze project', 'Run unit tests', 'Check git status')" },
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
    },
    {
        type: "function",
        function: {
            name: "read_file",
            description: "Inspect, read, or view file content and metadata. Supports line range pagination with line numbers, metadata inspection, and media/binary viewing.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Relative or absolute file or directory path"
                    },
                    action: {
                        type: "string",
                        enum: ["read", "info", "view"],
                        description: "'read' (default: text content with line numbers), 'info' (metadata, size, line count, permissions), 'view' (for images, pdfs, binary)"
                    },
                    start_line: {
                        type: "integer",
                        description: "1-indexed starting line number for reading (default: 1)"
                    },
                    end_line: {
                        type: "integer",
                        description: "1-indexed ending line number for reading (default: start_line + 400)"
                    },
                    numbered: {
                        type: "boolean",
                        description: "Whether to prefix line numbers (e.g. '1 | content'). Default: true"
                    }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "Create, overwrite, replace text, inject lines, or execute batched/nested atomic file modifications.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Relative or absolute target file path"
                    },
                    action: {
                        type: "string",
                        enum: ["write", "replace", "inject", "batch"],
                        description: "'write' (overwrite/create), 'replace' (search and replace exact text), 'inject' (insert at line number), 'batch' (run array of nested operations)"
                    },
                    content: {
                        type: "string",
                        description: "Content to write (for 'write') or content to insert (for 'inject')"
                    },
                    target: {
                        type: "string",
                        description: "Exact text string to find and replace (for 'replace')"
                    },
                    replacement: {
                        type: "string",
                        description: "Replacement text string (for 'replace')"
                    },
                    line: {
                        type: "integer",
                        description: "Target line number for 'inject' (1-indexed. 1 = prepend, -1 = append, N = insert after line N)"
                    },
                    start_line: {
                        type: "integer",
                        description: "Optional starting line constraint for 'replace'"
                    },
                    end_line: {
                        type: "integer",
                        description: "Optional ending line constraint for 'replace'"
                    },
                    all: {
                        type: "boolean",
                        description: "If true, replaces all occurrences. If false, ensures target is unique. Default: false"
                    },
                    overwrite: {
                        type: "boolean",
                        description: "For 'write': whether to allow overwriting an existing file. Default: true"
                    },
                    operations: {
                        type: "array",
                        description: "For 'batch': list of nested edit operations to execute atomically in sequence",
                        items: {
                            type: "object",
                            properties: {
                                action: { type: "string", enum: ["replace", "inject", "write"] },
                                target: { type: "string" },
                                replacement: { type: "string" },
                                content: { type: "string" },
                                line: { type: "integer" },
                                start_line: { type: "integer" },
                                end_line: { type: "integer" },
                                all: { type: "boolean" }
                            }
                        }
                    }
                },
                required: ["path"]
            }
        }
    },
    {
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
    {
        type: "function",
        function: {
            name: "generate_image",
            description: "Generate an image from a detailed visual text prompt. Use this whenever the user asks to draw, generate, visualize, or create an image or artwork.",
            parameters: {
                type: "object",
                properties: {
                    prompt: {
                        type: "string",
                        description: "Detailed visual description of the image: scene, characters, setting, art style, lighting, camera angle, and colors."
                    },
                    aspect_ratio: {
                        type: "string",
                        enum: ["1:1", "16:9", "9:16", "4:3", "3:2"],
                        description: "Aspect ratio of the generated image (default: '1:1')"
                    },
                    model: {
                        type: "string",
                        description: "Optional model/engine: 'flux' (default, high quality), 'turbo' (ultra-fast), or 'dall-e-3'"
                    }
                },
                required: ["prompt"]
            }
        }
    }
];

export async function executeTool(name, args, badgeEl, genState) {
    if (genState.abortRequested) {
        throw new Error("Generation stopped by user");
    }

    // Check if tool category is disabled in config.ini
    const toolsConfig = state.config?.Tools || {};
    if (toolsConfig.EnableTerminal === false && (name === "run_task" || name.startsWith("task_") || name === "idle")) {
        throw new Error("Terminal execution is disabled in config.ini");
    }
    if (toolsConfig.EnableWebSearch === false && (name === "web_search" || name === "fetch_web_content")) {
        throw new Error("Web search is disabled in config.ini");
    }
    if (toolsConfig.EnableImageGeneration === false && name === "generate_image") {
        throw new Error("Image generation is disabled in config.ini");
    }
    if (toolsConfig.EnableFileOperations === false && (name === "read_file" || name === "write_file")) {
        throw new Error("File operations are disabled in config.ini");
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

    if (name === "idle" && badgeEl) {
        const cooldown = Math.max(1, parseInt(args.seconds, 10) || 5);
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
    } else if (name === "idle") {
        url = "/api/task/idle";
    } else if (name === "read_file") {
        url = "/api/file/read";
    } else if (name === "write_file") {
        url = "/api/file/write";
    } else if (name === "generate_image") {
        url = "/api/image/generate";
        if (!args.aspect_ratio && state.config?.General?.DefaultImageAspectRatio) {
            args.aspect_ratio = state.config.General.DefaultImageAspectRatio;
        }
        if (!args.provider && state.config?.General?.DefaultImageProvider) {
            args.provider = state.config.General.DefaultImageProvider;
        }
        if (!args.model && state.config?.General?.DefaultImageModel) {
            args.model = state.config.General.DefaultImageModel;
        }
        if (!args.chatId && state.currentChatId) {
            args.chatId = state.currentChatId;
        }
    } else {
        throw new Error("Unknown tool: " + name);
    }

    const opts = {
        method,
        headers: { 
            "Content-Type": "application/json",
            "x-chat-id": state.currentChatId || ""
        }
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
        if ((name === "run_task" || name === "idle") && badgeEl) {
            badgeEl.classList.add("timer-finished");
        }
        throw new Error(data.error || "Tool call execution failed");
    }

    if ((name === "run_task" || name === "idle") && badgeEl) {
        const ringBar = badgeEl.querySelector(".timer-ring-bar");
        if (ringBar) {
            ringBar.style.transition = "stroke-dashoffset 0.15s ease, stroke 0.3s ease";
            ringBar.style.strokeDashoffset = "0";
        }
        badgeEl.classList.add("timer-finished");

        if (name === "idle") {
            const labelEl = badgeEl.querySelector(".search-label");
            const queryEl = badgeEl.querySelector(".search-query");
            if (data.status === "task_completed") {
                if (labelEl) labelEl.textContent = "Task completed";
                if (queryEl) queryEl.textContent = `${data.task_id || "task"} exited in ${data.elapsed_seconds}s (code: ${data.exit_code ?? 0})`;
            } else if (data.status === "task_output") {
                if (labelEl) labelEl.textContent = "Task output";
                if (queryEl) queryEl.textContent = `${data.task_id || "task"} emitted output in ${data.elapsed_seconds}s`;
            } else {
                if (labelEl) labelEl.textContent = "Timer hit";
                if (queryEl) queryEl.textContent = `${data.elapsed_seconds || args.seconds || 5}s cooldown completed`;
            }
        }
    }

    if (badgeEl && badgeEl._collapseDiv) {
        const resEl = badgeEl._collapseDiv.querySelector(".command-output-res");
        if (resEl) {
            let outText = "";
            const isLarge = data.is_large_output || (data.stdout && data.stdout.split("\n").length > 100);
            if (isLarge && (name === "run_task" || name === "idle" || name.startsWith("task_"))) {
                const rawOutput = data.truncated_lines || data.stdout || "";
                const lines = rawOutput.split("\n").slice(-100);
                const indentedLines = lines.map(l => "      " + l).join("\n");
                outText = `id: ${data.task_id || args.task_id || "task"}\n`;
                if (data.stderr && data.stderr.trim()) {
                    outText += `stderr: [output turnicated] ... showing last 100 lines\n${indentedLines}\n`;
                } else {
                    outText += `stdrr: [output turnicated] ... showing last 100 lines\n${indentedLines}\n`;
                }
                outText += `status_code: ${data.exit_code ?? 0}\n`;
                outText += `ran_for: ${data.ran_for || data.elapsed_seconds || "1.0"}s\n`;
                outText += `sys: output has been saved to ${data.scratch_log_path || `scratch/${args.task_name ? (args.task_name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') + '-') : ''}${data.task_id || 'task'}.log`}`;
            } else if (name === "read_file") {
                if (data.action === "view" && data.type === "image") {
                    outText = `[Image View: ${data.path} (${data.mime}, ${data.human_size})]\n${data.markdown || ""}`;
                } else if (data.action === "info") {
                    outText = JSON.stringify(data, null, 2);
                } else {
                    outText = data.content || (data.entries ? JSON.stringify(data.entries, null, 2) : "");
                }
            } else if (name === "write_file") {
                outText = data.message || JSON.stringify(data, null, 2);
            } else if (name === "generate_image") {
                outText = `[Image Generated: ${data.model || "flux"} (${data.dimensions?.width || 1024}x${data.dimensions?.height || 1024})]\n${data.markdown || `![](${data.url})`}\nDirect URL: ${data.url}`;
                if (data.url) {
                    let imgPreview = badgeEl._collapseDiv.querySelector(".tool-image-preview");
                    if (!imgPreview) {
                        imgPreview = document.createElement("img");
                        imgPreview.className = "tool-image-preview";
                        imgPreview.style.maxWidth = "100%";
                        imgPreview.style.maxHeight = "320px";
                        imgPreview.style.borderRadius = "8px";
                        imgPreview.style.marginTop = "10px";
                        imgPreview.style.display = "block";
                        imgPreview.style.objectFit = "contain";
                        imgPreview.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                        badgeEl._collapseDiv.appendChild(imgPreview);
                    }
                    imgPreview.src = data.url;
                    imgPreview.alt = data.prompt || "Generated image";
                }
            } else if (name === "idle") {
                outText = `[Idle Result: ${data.status}] Elapsed: ${data.elapsed_seconds}s${data.exit_code !== undefined ? ` (Exit code: ${data.exit_code})` : ""}`;
                if (data.stdout || data.stderr) {
                    outText += "\n\n" + (data.stdout || "") + (data.stderr ? ("\n" + data.stderr) : "");
                }
            } else if (data.stdout || data.stderr) {
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
