/* =========================================================
   SERVER-SIDE DECOUPLED BUILD AGENT RUNNER
   Executes autonomous agent loops in the background on Node.js.
   Disconnecting or closing the browser tab will NOT stop execution.
   ========================================================= */
const { EventEmitter } = require("events");
const path = require("path");
const fs = require("fs");
const { resolveProvider } = require("../providers");
const { loadModelsConfig, getEnvKey, resolveSafePath, postJSON, getChatWorkspace, getChatScratchDir, getChatArtifactsDir } = require("../server/utils");
const { getConfig } = require("./config_manager");
const { mcpManager } = require("./mcp_manager");
const conversationsManager = require("./conversations_manager");
const { handleFileRead } = require("../server/routes/files");
const { 
    handleWriteFile, 
    handleReplaceFileContent, 
    handleMultiReplaceFileContent, 
    handleSearchAndReplace, 
    handleListDir, 
    handleCodeGrep 
} = require("../tools/filesystem/code_tools");

/** In-memory registry of active agent jobs: chatId -> JobInstance */
const activeJobs = new Map();
/** In-memory registry of pending human-in-the-loop questionnaire answers: chatId -> { resolve } */
const pendingAnswers = new Map();

/** Tool definitions exposed to the server-side build agent */
const SERVER_BUILD_TOOLS = [
    {
        type: "function",
        function: {
            name: "read_file",
            description: "Read the contents of a file (text or source code).",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path to file relative to project root or $SCRATCH/$ARTIFACTS" },
                    start_line: { type: "integer", description: "Optional starting line (1-indexed)" },
                    end_line: { type: "integer", description: "Optional ending line (inclusive)" }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "Create or overwrite a file with given content.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "File path relative to project root or $SCRATCH/$ARTIFACTS" },
                    content: { type: "string", description: "Full content to write" }
                },
                required: ["path", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "replace_file_content",
            description: "Surgically replace a unique block of text in a file.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Target file path" },
                    target_content: { type: "string", description: "Exact character sequence to be replaced" },
                    replacement_content: { type: "string", description: "Drop-in replacement text" }
                },
                required: ["path", "target_content", "replacement_content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_dir",
            description: "List directory contents including file sizes and subdirectories.",
            parameters: {
                type: "object",
                properties: {
                    DirectoryPath: { type: "string", description: "Directory path to list (use '.' for project root, or '$SCRATCH' / '$ARTIFACTS' for chat workspaces)" }
                },
                required: ["DirectoryPath"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "grep_search",
            description: "Search for regex or literal patterns across files in the project.",
            parameters: {
                type: "object",
                properties: {
                    SearchPath: { type: "string", description: "Path to search within" },
                    Query: { type: "string", description: "Search query or regex pattern" }
                },
                required: ["SearchPath", "Query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "run_task",
            description: "Execute a terminal command or test in the project workspace. ALWAYS provide a concise 2-4 word task_name for command tagging in the UI (e.g. 'Run tests', 'Check git status').",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "Terminal command line to run" },
                    task_name: { type: "string", description: "Concise 2-4 word descriptive tag/name for the task (e.g. 'Run tests', 'Check git status'). Always supply this for command name tagging." },
                    timer: { type: "integer", description: "Seconds to wait before returning output (default 5)" }
                },
                required: ["command"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "write_todos",
            description: "Create or update the structured engineering task checklist.",
            parameters: {
                type: "object",
                properties: {
                    todos: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "string" },
                                content: { type: "string" },
                                status: { type: "string", enum: ["pending", "in_progress", "completed"] }
                            },
                            required: ["content", "status"]
                        }
                    }
                },
                required: ["todos"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "generate_image",
            description: "Generate an image from a detailed visual text prompt. Automatically backgrounded after 15 seconds if slow so you can continue reasoning without blocking.",
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
                    },
                    background: {
                        type: "boolean",
                        description: "If true, starts image generation in the background and immediately returns a task ID so you can continue other work without waiting."
                    }
                },
                required: ["prompt"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "web_search",
            description: "Search the web for up-to-date information, documentation, news, or articles.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query string" }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "fetch_web_content",
            description: "Fetch and extract text content from one or more web URLs.",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "Single URL to fetch" },
                    urls: { type: "array", items: { type: "string" }, description: "List of URLs to fetch in parallel" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "run_python",
            description: "Execute a Python script or expression and return stdout/stderr.",
            parameters: {
                type: "object",
                properties: {
                    code: { type: "string", description: "Python code to execute" }
                },
                required: ["code"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "schedule",
            description: "Wait or sleep for a specified number of seconds before continuing.",
            parameters: {
                type: "object",
                properties: {
                    seconds: { type: "number", description: "Seconds to pause (max 30)" }
                },
                required: ["seconds"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "ask_question",
            description: "Ask the user clarifying multiple-choice or open-ended questions with an interactive questionnaire directly in the composer. Execution pauses until the user answers or skips.",
            parameters: {
                type: "object",
                properties: {
                    questions: {
                        type: "array",
                        description: "List of questions to ask the user.",
                        items: {
                            type: "object",
                            properties: {
                                question: { type: "string", description: "The question prompt or title" },
                                options: { type: "array", items: { type: "string" }, description: "List of 2-5 selectable choices" },
                                is_multi_select: { type: "boolean", description: "Whether multiple choices can be selected" },
                                allow_custom: { type: "boolean", description: "Whether to allow custom write-in answers (default true)" }
                            },
                            required: ["question", "options"]
                        }
                    }
                },
                required: ["questions"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "ask_questions",
            description: "Alias for ask_question. Ask the user clarifying multiple-choice or open-ended questions with an interactive questionnaire directly in the composer. Execution pauses until the user answers or skips.",
            parameters: {
                type: "object",
                properties: {
                    questions: {
                        type: "array",
                        description: "List of questions to ask the user.",
                        items: {
                            type: "object",
                            properties: {
                                question: { type: "string", description: "The question prompt or title" },
                                options: { type: "array", items: { type: "string" }, description: "List of 2-5 selectable choices" },
                                is_multi_select: { type: "boolean", description: "Whether multiple choices can be selected" },
                                allow_custom: { type: "boolean", description: "Whether to allow custom write-in answers (default true)" }
                            },
                            required: ["question", "options"]
                        }
                    }
                },
                required: ["questions"]
            }
        }
    }
];

function formatPlanMarkdown(title, todos = []) {
    const total = todos.length;
    const completed = todos.filter(t => t.status === "completed").length;
    const inProgress = todos.filter(t => t.status === "in_progress").length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    let md = `# Task Plan: ${title || "Build Task"}\n\n`;
    md += `> **Progress**: ${completed}/${total} completed (${pct}%) • **Status**: ${completed === total ? "✅ All Completed" : (inProgress > 0 ? "🔄 In Progress" : "⏳ Pending")}\n`;
    md += `> **Last Updated**: ${now}\n\n`;
    md += `## Milestones & Tasks\n\n`;

    todos.forEach((t) => {
        let box = t.status === "completed" ? "[x]" : (t.status === "in_progress" ? "[-]" : "[ ]");
        let badge = t.status === "completed" ? "✅ Completed" : (t.status === "in_progress" ? "🔄 In Progress" : "⏳ Pending");
        md += `- ${box} **${t.content}** (${badge})\n`;
    });

    md += `\n---\n*Auto-generated plan artifact for MultiAI Build Mode (Server Daemon)*\n`;
    return md;
}

/**
 * Executes a single tool call on the local server.
 */
async function executeServerTool(name, args, { chatId, projectId, abortSignal, job, dispatchEvent }) {
    if (name.startsWith("mcp_") || mcpManager.activeTools.has(name)) {
        try {
            return await mcpManager.callTool(name, args);
        } catch (err) {
            return { error: `MCP tool execution failed: ${err.message}` };
        }
    }
    if (name === "read_file") {
        return await handleFileRead(args, chatId);
    }
    if (name === "write_file") {
        return await handleWriteFile(args, chatId, { resolveSafePath });
    }
    if (name === "replace_file_content" || name === "search_and_replace") {
        return await handleReplaceFileContent(args, chatId, { resolveSafePath });
    }
    if (name === "multi_replace_file_content") {
        return await handleMultiReplaceFileContent(args, chatId, { resolveSafePath });
    }
    if (name === "list_dir") {
        return await handleListDir(args, chatId, { resolveSafePath });
    }
    if (name === "grep_search") {
        return await handleCodeGrep(args, chatId, { resolveSafePath, postJSON });
    }
    if (name === "run_task") {
        // Forward terminal execution to local terminal daemon (port 5000)
        try {
            const res = await postJSON(5000, "/api/task/run", {
                command: args.command,
                task_name: args.task_name,
                timer: args.timer || 5,
                chatId
            }, 30000);
            return res;
        } catch (err) {
            return { error: `Terminal task failed: ${err.message}` };
        }
    }
    if (name === "generate_image") {
        try {
            const payload = { ...args, chatId };
            const port = process.env.PORT ? parseInt(process.env.PORT, 10) : (getConfig().General?.Port || 8080);
            const res = await postJSON(port, "/api/image/generate", payload, 25000);
            return res;
        } catch (err) {
            return { error: `Image generation failed: ${err.message}` };
        }
    }
    if (name === "web_search") {
        try {
            const { tinyfishSearch } = require("../server/routes/search");
            return await tinyfishSearch(args);
        } catch (err) {
            return { error: `Web search failed: ${err.message}` };
        }
    }
    if (name === "fetch_web_content" || name === "web_fetch") {
        try {
            const { tinyfishFetch } = require("../server/routes/search");
            return await tinyfishFetch(args);
        } catch (err) {
            return { error: `Web fetch failed: ${err.message}` };
        }
    }
    if (name === "run_python") {
        try {
            return await postJSON(5000, "/api/python/run", args, 35000);
        } catch (err) {
            return { error: `Python execution failed: ${err.message}` };
        }
    }
    if (name === "schedule" || name === "sleep") {
        const secs = Math.min(30, Math.max(1, parseFloat(args.seconds || args.time || 5) || 5));
        await new Promise(r => setTimeout(r, secs * 1000));
        return { status: "completed", elapsed_seconds: secs };
    }
    if (name === "ask_question" || name === "ask_questions") {
        const rawQuestions = Array.isArray(args.questions)
            ? args.questions
            : (args.question ? [args] : []);
        const questions = rawQuestions.map((q, idx) => ({
            id: q.id || `q_${idx + 1}`,
            question: q.question || "Please clarify:",
            options: Array.isArray(q.options) ? q.options : [],
            is_multi_select: Boolean(q.is_multi_select || q.isMultiSelect),
            allow_custom: q.allow_custom !== false
        }));

        if (job) {
            job.pendingQuestion = { questions, chatId };
        }
        if (job && job.emitter) {
            job.emitter.emit("event", { type: "question_prompt", questions, chatId });
        }

        const answer = await new Promise((resolve) => {
            pendingAnswers.set(chatId, { resolve });
            if (abortSignal) {
                if (abortSignal.aborted) {
                    pendingAnswers.delete(chatId);
                    resolve({ status: "cancelled", reason: "Generation stopped by user" });
                    return;
                }
                abortSignal.addEventListener("abort", () => {
                    pendingAnswers.delete(chatId);
                    resolve({ status: "cancelled", reason: "Generation stopped by user" });
                }, { once: true });
            }
        });

        if (job) {
            job.pendingQuestion = null;
        }
        return answer;
    }
    if (name === "write_todos") {
        const rawTodos = Array.isArray(args.todos) ? args.todos : [];
        const normalized = rawTodos.map((t, idx) => ({
            id: String(t.id || (idx + 1)),
            content: String(t.content || "").trim(),
            status: ["pending", "in_progress", "completed"].includes(t.status) ? t.status : "pending"
        })).filter(t => t.content.length > 0);

        const cleanName = ((args.title || "build_task").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "build_task").slice(0, 28);
        const artifactPath = `$ARTIFACTS/Tasklist-${cleanName}.md`;
        const md = formatPlanMarkdown(args.title || "Build Task", normalized);

        try {
            await handleWriteFile({ path: artifactPath, content: md }, chatId, { resolveSafePath });
        } catch (_) {}

        return {
            status: "success",
            total: normalized.length,
            completed: normalized.filter(t => t.status === "completed").length,
            in_progress: normalized.filter(t => t.status === "in_progress").length,
            pending: normalized.filter(t => t.status === "pending").length,
            artifact_path: artifactPath,
            todos: normalized
        };
    }
    throw new Error(`Tool '${name}' is not recognized.`);
}

/**
 * Starts an autonomous detached agent job on the server.
 */
function startAgentJob({ projectId = null, chatId, userText, userContent = null, model = "gemini-2.5-flash", provider = null }) {
    if (!chatId) {
        throw new Error("Missing required parameter chatId");
    }

    if (activeJobs.has(chatId) && activeJobs.get(chatId).isRunning) {
        return activeJobs.get(chatId);
    }

    const emitter = new EventEmitter();
    const abortController = new AbortController();

    const job = {
        chatId,
        projectId,
        model,
        provider,
        isRunning: true,
        startedAt: Date.now(),
        lastUpdated: Date.now(),
        abortController,
        emitter,
        events: [],
        todos: [],
        error: null
    };

    const dispatchEvent = (eventData) => {
        job.events.push(eventData);
        job.lastUpdated = Date.now();
        emitter.emit("event", eventData);
    };

    activeJobs.set(chatId, job);

    // Run detached async loop
    (async () => {
        try {
            const ws = projectId
                ? conversationsManager.ensureProjectChatWorkspace(projectId, chatId)
                : conversationsManager.ensureChatWorkspace(chatId);
            const savedChat = projectId
                ? conversationsManager.getProjectChat(projectId, chatId)
                : conversationsManager.getChat(chatId);
            let sessionMessages = savedChat?.messages || [];

            // Ensure system turn exists
            if (sessionMessages.length === 0 || sessionMessages[0]?.role !== "system") {
                const sysPrompt = ws.workspacePrompt || "You are MultiAI, an intelligent, helpful agent.";
                const sysTurn = { role: "system", content: sysPrompt, timestamp: Date.now() };
                sessionMessages.unshift(sysTurn);
                conversationsManager.appendMessage(ws.messagesFile, sysTurn);
            }

            // Add user turn if provided
            if (userContent || userText) {
                const userTurn = { role: "user", content: userContent || userText, timestamp: Date.now() };
                sessionMessages.push(userTurn);
                conversationsManager.appendMessage(ws.messagesFile, userTurn);
            }

            // Determine provider
            const config = loadModelsConfig();
            let providerId = provider;
            if (!providerId) {
                for (const [pId, pData] of Object.entries(config.providers || {})) {
                    if ((pData.models || []).some(m => m.id === model)) {
                        providerId = pId;
                        break;
                    }
                }
            }

            const providerConfig = config.providers?.[providerId] || {};
            const apiKey = providerConfig.api_key_env ? getEnvKey(providerConfig.api_key_env) : null;
            const providerHandler = resolveProvider(providerId || providerConfig.name || providerConfig.type || model);

            let round = 0;
            const maxRounds = 25;
            let hasRunVerification = false;
            let verificationNudgeCount = 0;
            let todoContinueRetries = 0;

            while (round < maxRounds && job.isRunning) {
                if (abortController.signal.aborted) {
                    throw new Error("Execution cancelled by user");
                }

                round++;
                job.lastUpdated = Date.now();
                dispatchEvent({ type: "round_start", round, model });

                // Call LLM with base build tools + dynamic active MCP tools
                let chatResult;
                try {
                    const activeTools = [...SERVER_BUILD_TOOLS, ...mcpManager.getActiveToolSchemas()];
                    chatResult = await providerHandler.handleChat({
                        model,
                        apiKey,
                        providerConfig,
                        messages: sessionMessages,
                        tools: activeTools
                    });
                } catch (err) {
                    if (abortController.signal.aborted) throw err;
                    throw new Error(`LLM Error: ${err.message}`);
                }

                const assistantMsg = chatResult?.message || { role: "assistant", content: "" };
                const toolCalls = assistantMsg.tool_calls || [];
                const content = (assistantMsg.content || "").trim();

                // Persist assistant message
                sessionMessages.push(assistantMsg);
                conversationsManager.appendMessage(ws.messagesFile, assistantMsg);

                if (content && toolCalls.length > 0) {
                    dispatchEvent({ type: "thought", content });
                }

                // If tool calls, execute them
                if (toolCalls.length > 0) {
                    for (const call of toolCalls) {
                        if (abortController.signal.aborted) break;

                        const name = call.function?.name;
                        let args = {};
                        try {
                            args = typeof call.function?.arguments === "string" 
                                ? JSON.parse(call.function.arguments) 
                                : (call.function?.arguments || {});
                        } catch (_) {}

                        dispatchEvent({ type: "tool_start", name, args, tool_call_id: call.id });

                        let result;
                        try {
                            result = await executeServerTool(name, args, { 
                                chatId, 
                                projectId, 
                                abortSignal: abortController.signal,
                                job,
                                dispatchEvent
                            });
                            if (name === "write_todos" && result?.todos) {
                                job.todos = result.todos;
                                dispatchEvent({ type: "todos_updated", todos: result.todos, artifactPath: result.artifact_path });
                            }
                        } catch (err) {
                            result = { error: err.message };
                        }

                        // Check verification tool calls
                        if (name === "run_task" && /\b(test|lint|typecheck|build|vitest|jest|pytest)\b/i.test(String(args.command || ""))) {
                            hasRunVerification = true;
                        }

                        dispatchEvent({ type: "tool_complete", name, args, result, tool_call_id: call.id });

                        const toolTurn = {
                            role: "tool",
                            tool_call_id: call.id,
                            name,
                            content: typeof result === "string" ? result : JSON.stringify(result)
                        };
                        sessionMessages.push(toolTurn);
                        conversationsManager.appendMessage(ws.messagesFile, toolTurn);
                    }
                    continue;
                }

                // Check for autonomous task continuation
                const activeOrPendingTask = (job.todos || []).find(t => t.status === "in_progress" || t.status === "pending");
                const isQuestion = /(\?|confirm\b|what would you like|do you want me to|should i\b)/i.test(content);

                if (activeOrPendingTask && !isQuestion && todoContinueRetries < 15 && round < maxRounds - 1) {
                    todoContinueRetries++;
                    const nudgeTurn = {
                        role: "user",
                        content: `[Build Mode Engine]: Proceed with the next planned task: "${activeOrPendingTask.content}". Update your plan status with write_todos and execute the necessary tool actions.`
                    };
                    sessionMessages.push(nudgeTurn);
                    conversationsManager.appendMessage(ws.messagesFile, nudgeTurn);
                    continue;
                }

                // Check verification gate
                const allCompleted = job.todos.length > 0 && job.todos.every(t => t.status === "completed");
                if (allCompleted && !hasRunVerification && verificationNudgeCount < 1) {
                    verificationNudgeCount++;
                    const verifTurn = {
                        role: "user",
                        content: `[Build Mode Verification Gate]: All planned implementation tasks have been marked completed. Please run project tests, linters, or syntax checks (via run_task) to verify your changes before delivering your final concluding summary.`
                    };
                    sessionMessages.push(verifTurn);
                    conversationsManager.appendMessage(ws.messagesFile, verifTurn);
                    continue;
                }

                // Concluding turn
                dispatchEvent({ type: "done", finalAnswer: content });
                break;
            }
        } catch (err) {
            job.error = err.message;
            dispatchEvent({ type: "error", error: err.message });
        } finally {
            job.isRunning = false;
            job.lastUpdated = Date.now();
        }
    })();

    return job;
}

function getAgentJob(chatId) {
    return activeJobs.get(chatId) || null;
}

function stopAgentJob(chatId) {
    if (pendingAnswers.has(chatId)) {
        const pending = pendingAnswers.get(chatId);
        pendingAnswers.delete(chatId);
        pending.resolve({ status: "cancelled", reason: "Generation stopped by user" });
    }
    const job = activeJobs.get(chatId);
    if (job) {
        job.pendingQuestion = null;
        if (job.isRunning) {
            job.abortController.abort();
            job.isRunning = false;
            job.lastUpdated = Date.now();
            const cancelEv = { type: "cancelled", message: "Generation stopped by user" };
            if (Array.isArray(job.events)) job.events.push(cancelEv);
            job.emitter.emit("event", cancelEv);
            return true;
        }
    }
    return false;
}

function answerAgentQuestion(chatId, answerPayload) {
    const pending = pendingAnswers.get(chatId);
    if (!pending) {
        return false;
    }
    pendingAnswers.delete(chatId);
    pending.resolve(answerPayload);
    return true;
}

function subscribeAgentJob(chatId, listener) {
    const job = activeJobs.get(chatId);
    if (!job) return null;
    job.emitter.on("event", listener);
    return () => {
        job.emitter.off("event", listener);
    };
}

module.exports = {
    startAgentJob,
    getAgentJob,
    stopAgentJob,
    subscribeAgentJob,
    answerAgentQuestion,
    activeJobs
};
