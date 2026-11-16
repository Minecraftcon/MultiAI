/* =========================================================
   SUBAGENT EXECUTION ENGINE (TASK DELEGATION & DESIGNER)
   ========================================================= */
import { callChatModel } from "./chat-client.js";
import { sanitizeMessage } from "./sanitizer.js";
import { getTool, executeTool } from "../tools/index.js";
import { extractText } from "../utils/dom.js";
import { state } from "../state/index.js";
import { saveStoredChats } from "../services/storage.js";

export const SUBAGENT_PERSONAS = {
    "designer": "You are an expert UI/UX and web designer subagent. You design, create, style, and iterate on interfaces, HTML/CSS, modern responsive layouts, web components, and visual prototypes. You inspect existing code, write clean modern styling, and use show_html_preview to render live previews directly in the user's browser pane.",
    "general-purpose": "You are a focused, autonomous subagent executing a dedicated task. Complete the requested objective thoroughly using available tools and return a structured, comprehensive final report.",
    "researcher": "You are an expert research subagent. Use web search and page fetching to investigate the query thoroughly and return a well-cited, clear summary report.",
    "auditor": "You are a code inspection and auditing subagent. Use list_dir, read_file, and grep_search to thoroughly inspect code, trace control flow, and identify issues without making edits.",
    "tester": "You are a testing and validation subagent. Run test commands and verify behavior using terminal tasks, returning detailed failure or success reports."
};

export const SUBAGENT_ALLOWED_TOOLS = {
    "designer": [
        "read_file", "write_file", "replace_file_content", "multi_replace_file_content",
        "list_dir", "grep_search", "run_task", "show_html_preview", "open_browser_tab", "toggle_panel"
    ],
    "general-purpose": [
        "read_file", "write_file", "replace_file_content", "multi_replace_file_content",
        "list_dir", "grep_search", "run_task", "manage_tasks", "web_search"
    ],
    "researcher": [
        "web_search", "read_file", "list_dir", "grep_search"
    ],
    "auditor": [
        "list_dir", "read_file", "grep_search"
    ],
    "tester": [
        "run_task", "manage_tasks", "read_file", "list_dir"
    ]
};

// Global active subagents registry
const activeSubagents = new Map();
const subagentListeners = new Set();

/**
 * Returns an array of all currently active subagents.
 * @returns {Array<Object>}
 */
export function getActiveSubagents() {
    return Array.from(activeSubagents.values());
}

/**
 * Returns true if at least one subagent is actively running.
 * @returns {boolean}
 */
export function hasActiveSubagents() {
    return activeSubagents.size > 0;
}

/**
 * Subscribes to changes in active subagents.
 * @param {Function} fn
 * @returns {Function} unsubscribe function
 */
export function onSubagentsChange(fn) {
    if (typeof fn === "function") {
        subagentListeners.add(fn);
        return () => subagentListeners.delete(fn);
    }
    return () => {};
}

function notifySubagentsChange() {
    for (const fn of subagentListeners) {
        try {
            fn(getActiveSubagents());
        } catch (_) {}
    }
}

/**
 * Executes the subagent loop.
 */
async function executeSubagentLoop(subagentId, instruction, subagentType, genState, options = {}) {
    const persona = SUBAGENT_PERSONAS[subagentType] || SUBAGENT_PERSONAS["general-purpose"];
    const modelSelect = typeof document !== "undefined" ? document.getElementById("modelSelect") : null;
    const parentChatId = options?.parentChatId || genState?.chatId || state.currentChatId || null;
    const parentSession = parentChatId ? state.chatSessions[parentChatId] : null;
    const subagentModel = options?.model || parentSession?.model || modelSelect?.value || "gemini-2.5-flash";
    const subagentProvider = options?.provider || parentSession?.provider || modelSelect?.selectedOptions?.[0]?.dataset?.provider || null;

    const systemPrompt = `${persona}\n\n[SUBAGENT GUIDELINES]:
1. You run in an isolated execution loop with access to specialized tools for your persona.
2. Fulfill the instruction directly, cleanly, and systematically.
3. If designing or creating an interface, write the code using write_file and call show_html_preview to render it live for the user.
4. EXECUTION MANDATE: You are an autonomous execution agent. You MUST call tools (e.g. read_file, write_file, show_html_preview, run_task) to perform the requested actions. NEVER output text merely acknowledging or describing the prompt without executing the appropriate tool calls.
5. Conclude with a clear, structured summary report of your findings, results, or actions taken.`;

    const allowedToolNames = SUBAGENT_ALLOWED_TOOLS[subagentType] || SUBAGENT_ALLOWED_TOOLS["general-purpose"];
    const subagentTools = allowedToolNames
        .map(name => getTool(name)?.schema)
        .filter(Boolean);

    let subSession = state.chatSessions[subagentId];
    let messages = subSession?.messages;
    if (!messages || messages.length === 0) {
        messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: instruction.trim() }
        ];
    }

    const cleanTitle = `${subagentType.charAt(0).toUpperCase() + subagentType.slice(1)}: ${instruction.trim().slice(0, 36)}${instruction.trim().length > 36 ? '…' : ''}`;
    if (!subSession) {
        subSession = {
            id: subagentId,
            title: cleanTitle,
            isSubagent: true,
            subagentType: subagentType,
            subagentStatus: "running",
            parentChatId: parentChatId,
            task: instruction.trim(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            model: subagentModel,
            provider: subagentProvider,
            messages: messages
        };
        state.chatSessions[subagentId] = subSession;
    } else {
        subSession.subagentStatus = "running";
        subSession.updatedAt = Date.now();
        subSession.messages = messages;
    }
    saveStoredChats();
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
        document.dispatchEvent(new CustomEvent("chatsUpdated"));
    }

    const maxRounds = 6;
    let rounds = 0;
    let isDetached = false;

    try {
        while (rounds < maxRounds) {
            // If the main generation was stopped by user, decouple and run detached in background
            if (genState?.abortRequested && !isDetached) {
                isDetached = true;
                const entry = activeSubagents.get(subagentId);
                if (entry) {
                    entry.detached = true;
                    notifySubagentsChange();
                }
            }

            rounds++;
            const entry = activeSubagents.get(subagentId);
            if (entry) {
                entry.rounds = rounds;
            }

            let response;
            try {
                // When detached, do not pass parent abort signal so background completion succeeds
                const signal = isDetached ? null : genState?.abortController?.signal;
                response = await callChatModel(messages, {
                    model: subagentModel,
                    provider: subagentProvider,
                    tools: subagentTools,
                    signal
                });
            } catch (err) {
                if (err.name === "AbortError" && !isDetached) {
                    isDetached = true;
                    continue;
                }
                throw err;
            }

            const rawAssistant = response?.message;
            if (!rawAssistant) break;

            const assistantMsg = sanitizeMessage(rawAssistant);
            messages.push(assistantMsg);
            if (subSession) {
                subSession.updatedAt = Date.now();
                subSession.rounds = rounds;
                saveStoredChats();
                if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
            document.dispatchEvent(new CustomEvent("chatsUpdated"));
        }
            }

            const toolCalls = assistantMsg.tool_calls || [];
            if (toolCalls.length === 0) {
                const reportText = (assistantMsg.content || extractText(response) || "").trim();
                const needsAction = /create|write|read|design|render|inspect|build|save/i.test(instruction);
                if (rounds === 1 && needsAction && maxRounds > 1) {
                    messages.push({
                        role: "user",
                        content: "Please execute the appropriate tool calls (e.g. write_file, read_file, show_html_preview, run_task) now to perform this work rather than only describing it."
                    });
                    continue;
                }
                const finalResult = {
                    status: "completed",
                    subagent_id: subagentId,
                    subagent_type: subagentType,
                    instruction,
                    report: reportText || "Subagent finished with no output.",
                    rounds
                };
                return finalResult;
            }

            // Execute subagent tool calls sequentially
            for (const call of toolCalls) {
                const name = call.function?.name;
                let args = {};
                try {
                    args = JSON.parse(call.function?.arguments || "{}");
                } catch (_) {}

                let result;
                try {
                    result = await executeTool(name, args, null, isDetached ? null : genState);
                } catch (err) {
                    result = { error: err.message || String(err) };
                }

                const content = typeof result === "string" ? result : JSON.stringify(result);
                messages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    name,
                    content
                });
                if (subSession) {
                    subSession.updatedAt = Date.now();
                    saveStoredChats();
                    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
            document.dispatchEvent(new CustomEvent("chatsUpdated"));
        }
                }
            }
        }

        const lastMsg = messages[messages.length - 1];
        return {
            status: "completed",
            subagent_id: subagentId,
            subagent_type: subagentType,
            instruction,
            report: (lastMsg?.content || "Subagent completed assigned rounds.").trim(),
            rounds
        };
    } finally {
        activeSubagents.delete(subagentId);
        notifySubagentsChange();

        if (subSession) {
            subSession.subagentStatus = "completed";
            subSession.updatedAt = Date.now();
            subSession.rounds = rounds;
            saveStoredChats();
            if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
            document.dispatchEvent(new CustomEvent("chatsUpdated"));
        }
        }

        // Update badge if provided
        if (options?.badgeEl) {
            import("../tools/badge-sync.js").then(({ onToolComplete }) => {
                try {
                    onToolComplete("invoke_subagent", options.args || {}, options.badgeEl, {
                        status: "completed",
                        subagent_type: subagentType,
                        rounds,
                        report: (messages[messages.length - 1]?.content || "").trim()
                    });
                } catch (_) {}
            });
        }
    }
}

/**
 * Runs an isolated subagent execution loop for a specific instruction.
 *
 * @param {string} instruction
 * @param {string} [subagentType="designer"]
 * @param {Object} [genState]
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function runSubagent(instruction, subagentType = "designer", genState = null, options = {}) {
    if (!instruction || typeof instruction !== "string") {
        throw new Error("Subagent requires a non-empty instruction string.");
    }

    const cleanType = SUBAGENT_PERSONAS[subagentType] ? subagentType : "designer";
    const subagentId = "subagent_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);

    const subagentEntry = {
        id: subagentId,
        task: instruction.trim(),
        subagentType: cleanType,
        status: "running",
        startTime: Date.now(),
        rounds: 0,
        background: options.background === true
    };

    activeSubagents.set(subagentId, subagentEntry);
    notifySubagentsChange();

    if (options.background === true) {
        // Run completely asynchronously in the background
        executeSubagentLoop(subagentId, instruction, cleanType, genState, options).catch(err => {
            console.error(`[Subagent ${subagentId}] Background error:`, err);
        });

        return {
            status: "running",
            subagent_id: subagentId,
            subagent_type: cleanType,
            task: instruction,
            background: true,
            message: `Subagent [${cleanType}] launched in background: ${instruction}`
        };
    }

    // Synchronous execution (with automatic background detachment if main turn stops)
    return await executeSubagentLoop(subagentId, instruction, cleanType, genState, options);
}

/**
 * Continues an existing subagent conversation with a new user message.
 */
export async function continueSubagentChat(subagentId, userMessage) {
    const subSession = state.chatSessions[subagentId];
    if (!subSession) throw new Error("Subagent session not found: " + subagentId);

    subSession.messages = subSession.messages || [];
    subSession.messages.push({ role: "user", content: userMessage.trim() });
    subSession.subagentStatus = "running";
    subSession.updatedAt = Date.now();
    saveStoredChats();

    const subagentEntry = {
        id: subagentId,
        type: subSession.subagentType || "designer",
        task: userMessage.trim(),
        parentChatId: subSession.parentChatId,
        status: "running",
        startTime: Date.now(),
        rounds: 0,
        background: false
    };
    activeSubagents.set(subagentId, subagentEntry);
    notifySubagentsChange();

    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
        document.dispatchEvent(new CustomEvent("chatsUpdated"));
    }

    return await executeSubagentLoop(subagentId, userMessage, subSession.subagentType || "designer", null, { session: subSession });
}
