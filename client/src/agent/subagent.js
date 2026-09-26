/* =========================================================
   SUBAGENT EXECUTION ENGINE (TASK DELEGATION)
   ========================================================= */
import { callChatModel } from "./chat-client.js";
import { sanitizeMessage } from "./sanitizer.js";
import { getTool, executeTool } from "../tools/index.js";
import { extractText } from "../utils/dom.js";

const SUBAGENT_PERSONAS = {
    "general-purpose": "You are a focused, autonomous subagent executing a dedicated task. Complete the requested objective thoroughly using available tools and return a structured, comprehensive final report.",
    "researcher": "You are an expert research subagent. Use web search and page fetching to investigate the query thoroughly and return a well-cited, clear summary report.",
    "auditor": "You are a code inspection and auditing subagent. Use list_dir, read_file, and grep_search to thoroughly inspect code, trace control flow, and identify issues without making edits.",
    "tester": "You are a testing and validation subagent. Run test commands and verify behavior using terminal tasks, returning detailed failure or success reports."
};

/**
 * Runs an isolated subagent execution sub-loop for a specific instruction.
 *
 * @param {string} instruction
 * @param {string} [subagentType="general-purpose"]
 * @param {Object} [genState]
 * @returns {Promise<Object>}
 */
export async function runSubagent(instruction, subagentType = "general-purpose", genState = null) {
    if (!instruction || typeof instruction !== "string") {
        throw new Error("Subagent requires a non-empty instruction string.");
    }

    if (genState?.abortRequested) {
        throw new Error("Generation stopped by user");
    }

    const persona = SUBAGENT_PERSONAS[subagentType] || SUBAGENT_PERSONAS["general-purpose"];
    const systemPrompt = `${persona}\n\n[SUBAGENT GUIDELINES]:
1. You run in an isolated execution loop with access to local filesystem, terminal, and web search tools.
2. Fulfill the user's instruction directly and systematically.
3. If an action or inspection is needed, execute the appropriate tool immediately without merely announcing your intent.
4. Conclude with a clear, structured summary report of your findings, results, or actions taken.`;

    const allowedToolNames = ["read_file", "list_dir", "grep_search", "run_task", "manage_tasks", "web_search"];
    const subagentTools = allowedToolNames
        .map(name => getTool(name)?.schema)
        .filter(Boolean);

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: instruction.trim() }
    ];

    const maxRounds = 6;
    let rounds = 0;

    while (rounds < maxRounds) {
        if (genState?.abortRequested) {
            throw new Error("Generation stopped by user");
        }

        rounds++;

        let response;
        try {
            response = await callChatModel(messages, {
                tools: subagentTools,
                signal: genState?.abortController?.signal
            });
        } catch (err) {
            if (genState?.abortRequested || err.name === "AbortError") {
                throw new Error("Generation stopped by user");
            }
            throw err;
        }

        const rawAssistant = response?.message;
        if (!rawAssistant) break;

        const assistantMsg = sanitizeMessage(rawAssistant);
        messages.push(assistantMsg);

        const toolCalls = assistantMsg.tool_calls || [];
        if (toolCalls.length === 0) {
            const reportText = (assistantMsg.content || extractText(response) || "").trim();
            return {
                status: "completed",
                subagent_type: subagentType,
                instruction,
                report: reportText || "Subagent finished with no output.",
                rounds
            };
        }

        // Execute subagent tool calls sequentially
        for (const call of toolCalls) {
            if (genState?.abortRequested) {
                throw new Error("Generation stopped by user");
            }

            const name = call.function?.name;
            let args = {};
            try {
                args = JSON.parse(call.function?.arguments || "{}");
            } catch (_) {}

            let result;
            try {
                result = await executeTool(name, args, null, genState);
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
        }
    }

    const lastMsg = messages[messages.length - 1];
    return {
        status: "completed",
        subagent_type: subagentType,
        instruction,
        report: (lastMsg?.content || "Subagent completed assigned rounds.").trim(),
        rounds
    };
}
