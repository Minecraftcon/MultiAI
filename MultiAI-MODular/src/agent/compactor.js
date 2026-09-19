// Automatic Context Compaction via Model
import { COMPACTION_TOKEN_THRESHOLD, COMPACTION_MIN_MESSAGES } from "../config.js";
import { state } from "../state/index.js";
import { logEvent } from "../utils/logger.js";
import { extractText } from "../utils/dom.js";
import { callChatModel } from "./chat-client.js";
import { addCompactionBadge } from "../components/chat-ui.js";
import { saveStoredChats } from "../services/storage.js";
import { extractThoughtAndContent } from "../components/renderer.js";

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
 * Checks whether the current session messages should undergo model compaction.
 * @param {Object} session
 * @param {Object} [options]
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

    const tokenCount = estimateMessagesTokens(msgs);
    const threshold = options.threshold || COMPACTION_TOKEN_THRESHOLD;

    // Trigger if total tokens exceed compaction threshold, or message count is very high (>20) with heavy content (>15k tokens)
    return tokenCount >= threshold || (msgs.length >= 24 && tokenCount >= 15000);
}

/**
 * Compacts older conversational history using the model, preserving system instructions
 * and the active turn, while updating the activity UI in the loop.
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
    const tokensBefore = estimateMessagesTokens(msgs);

    // Identify message slice to compact:
    // Keep messages[0] (system prompt).
    // If multiple user turns exist, compact everything between index 1 and the last user turn.
    // If only one user turn exists with many tool executions, compact earlier tool turns, keeping the last 3 messages.
    const lastUserIdx = msgs.map(m => m.role).lastIndexOf("user");
    let sliceEndIdx;
    if (lastUserIdx > 1) {
        sliceEndIdx = lastUserIdx; // Keep the latest user prompt and following responses uncompacted
    } else {
        sliceEndIdx = Math.max(1, msgs.length - 3);
    }

    const messagesToCompact = msgs.slice(1, sliceEndIdx);
    if (messagesToCompact.length < 3) {
        return false; // Not enough messages to justify compaction
    }

    logEvent("CONTEXT_COMPACTION_START", {
        chatId: session.id,
        model: selectedModel,
        tokensBefore,
        messagesCount: messagesToCompact.length
    });

    // Update loop status text
    const activityLabel = currentAIMessage?.querySelector(".activity-label");
    if (activityLabel) {
        const sec = ((Date.now() - overallStartTime) / 1000).toFixed(1);
        activityLabel.textContent = `Compacting context… (${sec}s)`;
    }

    // Insert compaction badge into the loop UI
    const badge = addCompactionBadge(currentAIMessage, {
        messagesCount: messagesToCompact.length,
        tokensBefore
    });

    try {
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
            ...messagesToCompact,
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

        // Replace the compacted slice in session.messages
        const compactedMessage = {
            role: "system",
            content: `[CONVERSATION HISTORY COMPACTED BY MODEL]:\n\n${summaryText}`
        };

        session.messages.splice(1, sliceEndIdx - 1, compactedMessage);
        state.messages = session.messages;
        saveStoredChats();

        const tokensAfter = estimateMessagesTokens(session.messages);
        const tokensSaved = Math.max(0, tokensBefore - tokensAfter);

        logEvent("CONTEXT_COMPACTION_COMPLETE", {
            chatId: session.id,
            tokensBefore,
            tokensAfter,
            tokensSaved,
            messagesCompactCount: messagesToCompact.length
        });

        badge.update({
            status: "completed",
            summaryText,
            tokensSaved,
            messagesCount: messagesToCompact.length
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
