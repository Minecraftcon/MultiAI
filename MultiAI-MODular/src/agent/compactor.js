// Automatic Context Compaction via Model
import { COMPACTION_BUFFER_TOKENS, COMPACTION_MIN_MESSAGES } from "../config.js";
import { state } from "../state/index.js";
import { logEvent } from "../utils/logger.js";
import { extractText } from "../utils/dom.js";
import { callChatModel } from "./chat-client.js";
import { addCompactionBadge } from "../components/chat-ui.js";
import { saveStoredChats } from "../services/storage.js";
import { extractThoughtAndContent } from "../components/renderer.js";
import { availableModels } from "../components/side-panel.js";

/**
 * Estimates the token count for an array of messages using a conservative 3.2 chars/token ratio.
 * @param {Array<Object>} messages
 * @returns {number}
 */
export function estimateMessagesTokens(messages) {
    if (!Array.isArray(messages)) return 0;
    let chars = 0;
    for (const m of messages) {
        if (typeof m.content === "string") {
            chars += m.content.length;
        } else if (m.content) {
            chars += JSON.stringify(m.content).length;
        }
        if (m.tool_calls) {
            chars += JSON.stringify(m.tool_calls).length;
        }
    }
    return Math.ceil(chars / 3.2);
}

/**
 * Resolves the native context token limit for a given model.
 * Checks the availableModels list fetched from /api/models, and falls back to model family heuristics.
 * @param {string} modelId
 * @returns {number}
 */
export function getModelContextLimit(modelId) {
    if (modelId && Array.isArray(availableModels)) {
        const found = availableModels.find(m => m.id === modelId || m.name === modelId);
        if (found && typeof found.max_context_tokens === "number" && found.max_context_tokens > 0) {
            return found.max_context_tokens;
        }
    }

    const m = String(modelId || "").toLowerCase();
    if (m.includes("gemini")) return 1000000;
    if (m.includes("claude")) return 200000;
    if (m.includes("1m") || m.includes("1000k") || m.includes("v4.1")) return 1000000;
    if (m.includes("codestral")) return 32000;
    if (m.includes("glm-4.5")) return 55000;
    if (m.includes("glm-4") || m.includes("glm-5")) return 110000;
    if (m.includes("o1") || m.includes("o3")) return 200000;
    if (m.includes("gpt-4o") || m.includes("gpt-4") || m.includes("deepseek") || m.includes("qwen") || m.includes("llama") || m.includes("gemma") || m.includes("command-r")) return 128000;
    return 128000;
}

/**
 * Calculates the compaction trigger threshold for a model.
 * Compaction triggers when the conversation reaches within 25k tokens of the native limit, or exceeds it.
 * @param {string} modelId
 * @param {number} [bufferTokens]
 * @returns {number}
 */
export function getCompactionThreshold(modelId, bufferTokens = COMPACTION_BUFFER_TOKENS) {
    const limit = getModelContextLimit(modelId);
    if (limit <= 32000) {
        return Math.max(4000, Math.min(limit - 4000, Math.floor(limit * 0.8)));
    }
    return Math.max(10000, limit - bufferTokens);
}

/**
 * Compiles the working messages array for model inference.
 * If a compactionState exists, combines the system prompt, the compacted memory briefing,
 * and uncompacted active turns starting from compactedThroughIndex.
 * All historical messages in session.messages remain completely preserved and unpruned.
 * @param {Object} session
 * @returns {Array<Object>}
 */
export function compileWorkingMessages(session) {
    if (!session || !Array.isArray(session.messages)) return [];
    const msgs = session.messages;
    const compaction = session.compactionState;

    if (!compaction || !compaction.summary || typeof compaction.compactedThroughIndex !== "number") {
        return msgs;
    }

    const systemMsg = msgs[0] || { role: "system", content: "" };
    const briefingMsg = {
        role: "system",
        content: `[CONVERSATION HISTORY COMPACTED BY MODEL]:\n\n${compaction.summary}`
    };

    // Uncompacted active turns starting from compactedThroughIndex
    const startIndex = Math.max(1, Math.min(compaction.compactedThroughIndex, msgs.length));
    const recentTurns = msgs.slice(startIndex);

    return [systemMsg, briefingMsg, ...recentTurns];
}

/**
 * Checks whether the current session messages should undergo model compaction.
 * Triggers only if the working token count exceeds or is within 25k tokens of the model's native context limit.
 * @param {Object} session
 * @param {Object} [options]
 * @param {string} [options.model]
 * @param {number} [options.threshold]
 * @returns {boolean}
 */
export function shouldCompact(session, options = {}) {
    if (!session || !Array.isArray(session.messages)) return false;
    const msgs = session.messages;

    // Minimum messages threshold
    if (msgs.length < COMPACTION_MIN_MESSAGES) return false;

    // Check if there are messages between system prompt and the current user turn
    const lastUserIdx = msgs.map(m => m.role).lastIndexOf("user");
    if (lastUserIdx <= 1 && msgs.length < 18) {
        return false;
    }

    // Evaluate token count of the compiled working context
    const workingMsgs = compileWorkingMessages(session);
    const tokenCount = estimateMessagesTokens(workingMsgs);
    const modelId = options.model || session.model;
    const threshold = options.threshold || getCompactionThreshold(modelId);

    // Trigger only if working tokens reach within 25k of native limit or exceed it
    return tokenCount >= threshold;
}

/**
 * Compacts older conversational history into a dedicated compactionState object,
 * preserving 100% of historical turns in session.messages and updating the activity UI.
 *
 * @param {Object} params
 * @param {Object} params.session
 * @param {HTMLElement} params.currentAIMessage
 * @param {string} params.selectedModel
 * @param {Object} params.genState
 * @param {number} params.overallStartTime
 * @returns {Promise<boolean>} Whether compaction was executed
 */
export async function compactSessionContext({ session, currentAIMessage, selectedModel, genState, overallStartTime }) {
    if (!session || !Array.isArray(session.messages) || session.messages.length <= 3) {
        return false;
    }
    if (genState && genState.abortRequested) {
        return false;
    }

    const msgs = session.messages;
    const workingBefore = compileWorkingMessages(session);
    const tokensBefore = estimateMessagesTokens(workingBefore);

    // Identify the slice of session.messages to compact:
    // Keep active user prompt and following assistant/tool turns uncompacted.
    const lastUserIdx = msgs.map(m => m.role).lastIndexOf("user");
    let sliceEndIdx = lastUserIdx > 1 ? lastUserIdx : Math.max(1, msgs.length - 3);

    // If previously compacted up to an index, compact from there forward to avoid re-compacting
    const previousCompaction = session.compactionState;
    const sliceStartIdx = (previousCompaction && typeof previousCompaction.compactedThroughIndex === "number")
        ? Math.max(1, previousCompaction.compactedThroughIndex)
        : 1;

    // Messages to compact in this cycle
    const newMessagesToCompact = msgs.slice(sliceStartIdx, sliceEndIdx);
    if (newMessagesToCompact.length < 2 && !previousCompaction?.summary) {
        return false; // Not enough new messages to justify compaction
    }

    logEvent("CONTEXT_COMPACTION_START", {
        chatId: session.id,
        model: selectedModel,
        modelLimit: getModelContextLimit(selectedModel),
        compactionThreshold: getCompactionThreshold(selectedModel),
        tokensBefore,
        messagesCount: newMessagesToCompact.length,
        sliceStartIdx,
        sliceEndIdx
    });

    // Update loop status text
    const activityLabel = currentAIMessage?.querySelector(".activity-label");
    if (activityLabel) {
        const sec = ((Date.now() - overallStartTime) / 1000).toFixed(1);
        activityLabel.textContent = `Compacting context… (${sec}s)`;
    }

    // Insert compaction badge into the loop UI
    const badge = addCompactionBadge(currentAIMessage, {
        messagesCount: newMessagesToCompact.length,
        tokensBefore
    });

    try {
        // Build compaction prompt incorporating any prior summary and new turns
        const priorContextItem = previousCompaction?.summary
            ? [{ role: "system", content: `[PRIOR CONTEXT BRIEFING]:\n${previousCompaction.summary}` }]
            : [];

        const compactionPrompt = [
            {
                role: "system",
                content: `You are an expert AI context compressor. Distill the conversation history below into an ultra-dense, factual, structured markdown memory briefing.
Preserve without loss:
- **User Goals & Directives**: What the user asked for, constraints, preferences.
- **Key Technical Discoveries**: Specific file paths, package names, hashes, endpoints, data formats, analysis results.
- **Tool Actions & Results**: Crucial command outputs, errors encountered, and conclusions.
- **Files Modified / Created**: Full paths, functions changed, status.
- **Current Execution State**: What has been completed, what is currently underway, and immediate next steps.
Be concise, clear, and omit conversational filler. Return ONLY the markdown briefing.`
            },
            ...priorContextItem,
            ...newMessagesToCompact,
            {
                role: "user",
                content: "Please generate the structured context briefing summarizing the conversation history above."
            }
        ];

        const compactRes = await callChatModel(compactionPrompt, { model: selectedModel, tools: [] });
        if (genState && genState.abortRequested) {
            return false;
        }

        const rawText = extractText(compactRes);
        const { content: cleanText } = extractThoughtAndContent(rawText);
        const summaryText = (cleanText || rawText).replace(/<\/?think>/gi, "").trim();

        if (!summaryText) {
            badge.update({
                status: "failed",
                error: "Model returned empty summary"
            });
            return false;
        }

        // CRITICAL: NEVER SPLICING OR PRUNING session.messages!
        // Older messages remain 100% intact in session.messages and chatHtml for full UI reload.
        // Instead, we update session.compactionState which is used by compileWorkingMessages for model inference.
        const workingAfter = [
            msgs[0] || { role: "system", content: "" },
            { role: "system", content: `[CONVERSATION HISTORY COMPACTED BY MODEL]:\n\n${summaryText}` },
            ...msgs.slice(sliceEndIdx)
        ];
        const tokensAfter = estimateMessagesTokens(workingAfter);
        const tokensSaved = Math.max(0, tokensBefore - tokensAfter);

        session.compactionState = {
            summary: summaryText,
            compactedThroughIndex: sliceEndIdx,
            tokensBefore,
            tokensAfter,
            tokensSaved,
            compactedAt: Date.now(),
            model: selectedModel
        };

        state.messages = session.messages;
        saveStoredChats();

        logEvent("CONTEXT_COMPACTION_COMPLETE", {
            chatId: session.id,
            tokensBefore,
            tokensAfter,
            tokensSaved,
            messagesCompactCount: newMessagesToCompact.length,
            compactedThroughIndex: sliceEndIdx
        });

        badge.update({
            status: "completed",
            summaryText,
            tokensSaved,
            messagesCount: newMessagesToCompact.length
        });

        return true;
    } catch (err) {
        logEvent("CONTEXT_COMPACTION_ERROR", { error: err?.message || String(err) });
        badge.update({
            status: "failed",
            error: err?.message || "Compaction failed"
        });
        return false;
    }
}
