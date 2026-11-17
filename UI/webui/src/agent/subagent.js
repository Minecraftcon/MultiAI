/* =========================================================
   SUBAGENT EXECUTION ENGINE (TASK DELEGATION & DESIGNER)
   ========================================================= */
import { callChatModel } from "./chat-client.js";
import { sanitizeMessage } from "./sanitizer.js";
import { getTool, executeTool } from "../tools/index.js";
import { extractText } from "../utils/dom.js";
import { state } from "../state/index.js";
import { saveStoredChats, persistChatToDisk } from "../services/storage.js";

export const SUBAGENT_PERSONAS = {
    "designer": "You are a UI/UX and frontend engineering subagent. Write clean HTML/CSS, implement responsive layouts and components, inspect existing code, and call show_html_preview to render live previews in the browser pane. Tool contract: read_file → write_file → show_html_preview.",
    "general-purpose": "You are an autonomous execution subagent. Complete the assigned task using all available tools. Return a structured final report covering actions taken, results, and any blockers.",
    "researcher": "You are a research subagent. Use web_search and page fetching to investigate the query exhaustively. Return a well-cited, structured summary with source URLs.",
    "auditor": "You are a code audit subagent. Use list_dir, read_file, and grep_search to trace control flow and identify issues. Report findings precisely — do NOT make edits.",
    "tester": "You are a test execution subagent. Run test suites and validation commands via run_task. Return detailed pass/fail reports with stdout excerpts and reproduction steps."
};

export const SUBAGENT_ALLOWED_TOOLS = {
    "designer": [
        "read_file", "write_file", "replace_file_content", "multi_replace_file_content",
        "list_dir", "grep_search", "run_task", "show_html_preview", "open_browser_tab", "send_message"
    ],
    "general-purpose": [
        "read_file", "write_file", "replace_file_content", "multi_replace_file_content",
        "list_dir", "grep_search", "run_task", "manage_tasks", "web_search", "send_message"
    ],
    "researcher": [
        "web_search", "read_file", "list_dir", "grep_search", "send_message"
    ],
    "auditor": [
        "list_dir", "read_file", "grep_search", "send_message"
    ],
    "tester": [
        "run_task", "manage_tasks", "read_file", "list_dir", "send_message"
    ]
};

// Dynamic registry for custom subagents defined at runtime via define_subagent
const customSubagents = new Map();

/**
 * Registers or updates a custom subagent specification.
 * @param {Object} spec
 * @param {string} spec.name
 * @param {string} [spec.description]
 * @param {string} spec.systemPrompt
 * @param {Array<string>} [spec.tools]
 * @returns {Object}
 */
export function registerCustomSubagent({ name, description = "", systemPrompt = "", tools = [] }) {
    if (!name || typeof name !== "string") {
        throw new Error("Custom subagent requires a valid name string.");
    }
    const cleanName = name.trim().toLowerCase().replace(/[\s_]+/g, "-");
    const cleanPrompt = (systemPrompt || "").trim() || `You are ${cleanName}, an autonomous subagent. Complete the requested objective and report results.`;

    const defaultTools = [
        "read_file", "write_file", "replace_file_content", "multi_replace_file_content",
        "list_dir", "grep_search", "run_task", "send_message"
    ];

    const allowedTools = Array.isArray(tools) && tools.length > 0
        ? tools.map(t => String(t).trim()).filter(Boolean)
        : defaultTools;

    const entry = {
        name: cleanName,
        description: description.trim() || `Custom subagent: ${cleanName}`,
        systemPrompt: cleanPrompt,
        tools: allowedTools,
        updatedAt: Date.now()
    };

    customSubagents.set(cleanName, entry);
    return entry;
}

/**
 * Retrieves a custom subagent by name.
 */
export function getCustomSubagent(name) {
    if (!name || typeof name !== "string") return null;
    const cleanName = name.trim().toLowerCase().replace(/[\s_]+/g, "-");
    return customSubagents.get(cleanName) || null;
}

/**
 * Returns true if a custom subagent with this name is registered.
 */
export function hasCustomSubagent(name) {
    if (!name || typeof name !== "string") return false;
    const cleanName = name.trim().toLowerCase().replace(/[\s_]+/g, "-");
    return customSubagents.has(cleanName);
}

/**
 * Returns an array of all registered custom subagents.
 */
export function listCustomSubagents() {
    return Array.from(customSubagents.values());
}

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
    const custom = getCustomSubagent(subagentType);
    let subSession = state.chatSessions[subagentId];
    const persona = options?.persona || custom?.systemPrompt || SUBAGENT_PERSONAS[subagentType] || SUBAGENT_PERSONAS["general-purpose"];
    const modelSelect = typeof document !== "undefined" ? document.getElementById("modelSelect") : null;
    const parentChatId = options?.parentChatId || genState?.chatId || state.currentChatId || null;
    const parentSession = parentChatId ? state.chatSessions[parentChatId] : null;
    const subagentModel = subSession?.model || options?.model || parentSession?.model || modelSelect?.value || "gemini-2.5-flash";
    const subagentProvider = subSession?.provider || options?.provider || parentSession?.provider || modelSelect?.selectedOptions?.[0]?.dataset?.provider || null;

    const systemPrompt = `${persona}\n\n[SUBAGENT GUIDELINES & INTER-AGENT MESSAGING CONTRACT]:
1. Operate within your allowed tool set only. Do not reference tools outside your persona's contract.
2. Execute the instruction directly and completely — no preamble, no intent announcements without tool calls.
3. For designer tasks: write code with write_file, then call show_html_preview immediately.
4. EXECUTION MANDATE: You are an autonomous execution agent. You MUST call tools (e.g. read_file, write_file, show_html_preview, run_task, send_message) to perform the requested actions.
5. INTER-AGENT COMMUNICATION: The coordinator/main agent ONLY receives updates or reports from you if you explicitly invoke the \`send_message\` tool.
   - You can invoke \`send_message\` at ANY time during your execution (for progress notes, findings, blockers, or final reports).
   - Use Recipient: "coordinator" to send updates to the main agent.
   - If you finish without calling \`send_message\`, the coordinator will not receive any report or message from you.`;

    const allowedToolNames = options?.tools || custom?.tools || SUBAGENT_ALLOWED_TOOLS[subagentType] || SUBAGENT_ALLOWED_TOOLS["general-purpose"];
    const subagentTools = allowedToolNames
        .map(name => getTool(name)?.schema)
        .filter(Boolean);

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
    let subagentMessagesSent = 0;
    let isDetached = false;

    try {
        while (rounds < maxRounds) {
            const entry = activeSubagents.get(subagentId);
            if (entry?.isKilled) {
                if (subSession) {
                    subSession.subagentStatus = "killed";
                    subSession.updatedAt = Date.now();
                    saveStoredChats();
                }
                return {
                    status: "killed",
                    subagent_id: subagentId,
                    conversationId: subagentId,
                    subagent_type: subagentType,
                    instruction,
                    report: "Subagent terminated by kill command.",
                    rounds
                };
            }

            // If the main generation was stopped by user, decouple and run detached in background
            if (genState?.abortRequested && !isDetached) {
                isDetached = true;
                if (entry) {
                    entry.detached = true;
                    notifySubagentsChange();
                }
            }

            rounds++;
            if (entry) {
                entry.rounds = rounds;
            }

            let response;
            try {
                // Pass entry's abort signal or parent abort signal (if not detached)
                const signal = entry?.abortController?.signal || (isDetached ? null : genState?.abortController?.signal);
                const currentModel = subSession?.model || subagentModel;
                const currentProvider = subSession?.provider || subagentProvider;
                response = await callChatModel(messages, {
                    model: currentModel,
                    provider: currentProvider,
                    tools: subagentTools,
                    signal
                });
            } catch (err) {
                if (entry?.isKilled || (err.name === "AbortError" && entry?.isKilled)) {
                    if (subSession) {
                        subSession.subagentStatus = "killed";
                        saveStoredChats();
                    }
                    return {
                        status: "killed",
                        subagent_id: subagentId,
                        conversationId: subagentId,
                        subagent_type: subagentType,
                        instruction,
                        report: "Subagent terminated by kill command.",
                        rounds
                    };
                }
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
                        content: "Please execute the appropriate tool calls (e.g. write_file, read_file, show_html_preview, run_task, send_message) now to perform this work rather than only describing it."
                    });
                    continue;
                }
                const finalResult = {
                    status: "completed",
                    subagent_id: subagentId,
                    conversationId: subagentId,
                    subagent_type: subagentType,
                    instruction,
                    messages_sent_to_coordinator: subagentMessagesSent,
                    report: subagentMessagesSent > 0
                        ? "Subagent finished execution. Updates and reports were dispatched via send_message to coordinator."
                        : (reportText || "Subagent finished execution without dispatching messages to coordinator."),
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
                    const toolCtx = {
                        isSubagent: true,
                        subagentId,
                        subagentType,
                        parentChatId: subSession?.parentChatId || parentChatId,
                        senderName: `Subagent (${subagentType})`
                    };
                    if (name === "send_message") {
                        if (!args.parentChatId) args.parentChatId = toolCtx.parentChatId;
                        if (!args.senderName) args.senderName = toolCtx.senderName;
                        subagentMessagesSent++;
                    }
                    result = await executeTool(name, args, null, isDetached ? null : genState, toolCtx);
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
            conversationId: subagentId,
            subagent_type: subagentType,
            instruction,
            messages_sent_to_coordinator: subagentMessagesSent,
            report: subagentMessagesSent > 0
                ? "Subagent completed assigned rounds. Updates were dispatched via send_message to coordinator."
                : ((lastMsg?.content || "Subagent completed assigned rounds without dispatching messages to coordinator.").trim()),
            rounds
        };
    } finally {
        const wasKilled = activeSubagents.get(subagentId)?.isKilled;
        activeSubagents.delete(subagentId);
        notifySubagentsChange();

        if (subSession) {
            subSession.subagentStatus = wasKilled ? "killed" : "completed";
            subSession.updatedAt = Date.now();
            subSession.rounds = rounds;
            saveStoredChats();
            persistChatToDisk(subSession);
            if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
                document.dispatchEvent(new CustomEvent("chatsUpdated"));
            }
        }

        // Update badge if provided
        if (options?.badgeEl) {
            import("../tools/badge-sync.js").then(({ onToolComplete }) => {
                try {
                    onToolComplete("invoke_subagent", options.args || {}, options.badgeEl, {
                        status: wasKilled ? "killed" : "completed",
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

    const cleanType = (SUBAGENT_PERSONAS[subagentType] || hasCustomSubagent(subagentType)) ? subagentType : (options?.persona ? subagentType : "designer");
    const subagentId = "subagent_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);

    const abortController = new AbortController();
    const subagentEntry = {
        id: subagentId,
        conversationId: subagentId,
        task: instruction.trim(),
        subagentType: cleanType,
        status: "running",
        startTime: Date.now(),
        rounds: 0,
        background: options.background === true,
        parentChatId: options.parentChatId || genState?.chatId || state.currentChatId || null,
        abortController,
        isKilled: false
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
            conversationId: subagentId,
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
 * Continues an existing subagent conversation with a new user or agent message.
 * @param {string} subagentId
 * @param {string} userMessage
 * @param {Object} [options]
 * @param {boolean} [options.isAgentMessage=false]
 * @param {string} [options.sender="user"]
 * @param {string} [options.senderName]
 */
export async function continueSubagentChat(subagentId, userMessage, options = {}) {
    const subSession = state.chatSessions[subagentId];
    if (!subSession) throw new Error("Subagent session not found: " + subagentId);

    const isAgent = options?.isAgentMessage === true || options?.sender === "agent";
    const senderName = options?.senderName || (isAgent ? "Agent" : "User");

    subSession.messages = subSession.messages || [];
    const formattedContent = isAgent 
        ? `[Agent Message]:\n${userMessage.trim()}`
        : userMessage.trim();

    subSession.messages.push({
        role: "user",
        content: formattedContent,
        rawContent: userMessage.trim(),
        isAgentMessage: isAgent,
        sender: isAgent ? "agent" : "user",
        senderName: senderName
    });
    subSession.subagentStatus = "running";
    subSession.updatedAt = Date.now();
    saveStoredChats();

    const abortController = new AbortController();
    const subagentEntry = {
        id: subagentId,
        conversationId: subagentId,
        type: subSession.subagentType || "designer",
        subagentType: subSession.subagentType || "designer",
        task: userMessage.trim(),
        parentChatId: subSession.parentChatId,
        status: "running",
        startTime: Date.now(),
        rounds: 0,
        background: false,
        abortController,
        isKilled: false
    };
    activeSubagents.set(subagentId, subagentEntry);
    notifySubagentsChange();

    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
        document.dispatchEvent(new CustomEvent("chatsUpdated"));
    }

    return await executeSubagentLoop(subagentId, userMessage, subSession.subagentType || "designer", null, { session: subSession });
}

/**
 * Lists all active subagents, conversation IDs, and status.
 * @returns {Array<Object>}
 */
export function listActiveSubagents() {
    const list = [];
    const seen = new Set();

    // From activeSubagents in-memory map
    for (const [id, entry] of activeSubagents.entries()) {
        seen.add(id);
        list.push({
            conversationId: id,
            id: id,
            subagentType: entry.subagentType || entry.type || "designer",
            task: entry.task || "",
            status: entry.isKilled ? "killed" : (entry.status || "running"),
            startTime: entry.startTime || Date.now(),
            rounds: entry.rounds || 0,
            background: entry.background === true,
            parentChatId: entry.parentChatId || null
        });
    }

    // Also check state.chatSessions for any subagents marked running
    if (state?.chatSessions) {
        for (const [id, sess] of Object.entries(state.chatSessions)) {
            if (sess?.isSubagent && sess.subagentStatus === "running" && !seen.has(id)) {
                seen.add(id);
                list.push({
                    conversationId: id,
                    id: id,
                    subagentType: sess.subagentType || "designer",
                    task: sess.task || sess.title || "",
                    status: sess.subagentStatus,
                    startTime: sess.createdAt || Date.now(),
                    rounds: sess.rounds || 0,
                    background: true,
                    parentChatId: sess.parentChatId || null
                });
            }
        }
    }

    return list;
}

/**
 * Terminates specific subagents by conversation ID.
 * @param {string} subagentId
 * @returns {boolean}
 */
export function killSubagent(subagentId) {
    if (!subagentId) return false;
    let found = false;

    const entry = activeSubagents.get(subagentId);
    if (entry) {
        entry.isKilled = true;
        try { entry.abortController?.abort(); } catch (_) {}
        activeSubagents.delete(subagentId);
        found = true;
    }

    if (state?.chatSessions?.[subagentId]) {
        state.chatSessions[subagentId].subagentStatus = "killed";
        state.chatSessions[subagentId].updatedAt = Date.now();
        saveStoredChats();
        found = true;
    }

    notifySubagentsChange();
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
        document.dispatchEvent(new CustomEvent("chatsUpdated"));
    }
    return found;
}

/**
 * Terminates all currently active subagents.
 * @returns {number} count of killed subagents
 */
export function killAllSubagents() {
    let count = 0;
    for (const [id, entry] of activeSubagents.entries()) {
        entry.isKilled = true;
        try { entry.abortController?.abort(); } catch (_) {}
        if (state?.chatSessions?.[id]) {
            state.chatSessions[id].subagentStatus = "killed";
            state.chatSessions[id].updatedAt = Date.now();
        }
        count++;
    }
    activeSubagents.clear();

    if (state?.chatSessions) {
        for (const sess of Object.values(state.chatSessions)) {
            if (sess?.isSubagent && sess.subagentStatus === "running") {
                sess.subagentStatus = "killed";
                sess.updatedAt = Date.now();
                count++;
            }
        }
    }

    saveStoredChats();
    notifySubagentsChange();
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
        document.dispatchEvent(new CustomEvent("chatsUpdated"));
    }
    return count;
}

/**
 * Sends guidance, new input, or followup response to an existing subagent.
 * @param {string} recipientId
 * @param {string} message
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function sendMessageToSubagent(recipientId, message, options = {}) {
    if (!recipientId || typeof recipientId !== "string") {
        throw new Error("Recipient conversationId is required.");
    }
    if (!message || typeof message !== "string") {
        throw new Error("Message string is required.");
    }

    const cleanRecipient = recipientId.trim();
    const isCoordinatorTarget = ["coordinator", "main", "parent"].includes(cleanRecipient.toLowerCase());

    if (isCoordinatorTarget) {
        const parentId = options?.parentChatId || options?.chatId || state.currentChatId;
        const parentSession = parentId ? state.chatSessions[parentId] : null;
        if (!parentSession) {
            throw new Error("Coordinator conversation not found.");
        }

        const senderLabel = options?.senderName || "Subagent";
        const formattedContent = `[Message from ${senderLabel}]:\n${message.trim()}`;

        parentSession.messages = parentSession.messages || [];
        parentSession.messages.push({
            role: "user",
            content: formattedContent,
            rawContent: message.trim(),
            isAgentMessage: true,
            sender: "agent",
            senderName: senderLabel
        });
        parentSession.updatedAt = Date.now();
        saveStoredChats();
        persistChatToDisk(parentSession);

        if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
            document.dispatchEvent(new CustomEvent("chatsUpdated"));
        }

        // If parentChat is currently the active chat on screen, render the turn immediately
        if (state.currentChatId === parentId && typeof document !== "undefined") {
            const chat = document.getElementById("chat");
            if (chat) {
                try {
                    const { groupMessagesIntoTurns, renderTurn } = await import("../components/chat-ui.js");
                    const turns = groupMessagesIntoTurns(parentSession.messages);
                    const lastTurn = turns[turns.length - 1];
                    if (lastTurn) {
                        const turnFragment = renderTurn(lastTurn, parentSession, null, true);
                        chat.appendChild(turnFragment);
                        const { requestScrollToBottom } = await import("../utils/dom.js");
                        requestScrollToBottom(chat, true);
                    }
                } catch (_) {}
            }
        }

        return {
            status: "delivered",
            recipient: "coordinator",
            message: `Message delivered to coordinator (${parentId}).`
        };
    }

    const subSession = state?.chatSessions?.[cleanRecipient];
    if (!subSession) {
        const active = activeSubagents.get(cleanRecipient);
        if (!active) {
            throw new Error(`Subagent with conversationId '${cleanRecipient}' not found.`);
        }
    }

    return await continueSubagentChat(cleanRecipient, message, {
        isAgentMessage: true,
        sender: "agent",
        senderName: options?.senderName || "Agent",
        ...options
    });
}
