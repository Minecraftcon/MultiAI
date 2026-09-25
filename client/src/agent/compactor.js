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
 * Converts dialogue messages into a clean, structured transcript text.
 * Prevents passing raw 'tool' role objects to callChatModel when tools are empty,
 * and bounds oversized tool outputs so the summarizer prompt never overflows.
 * @param {Array<Object>} messages
 * @returns {string}
 */
export function formatMessagesToTranscript(messages) {
    if (!Array.isArray(messages)) return "";
    return messages.map(m => {
        const role = m.role || "unknown";
        if (role === "user") {
            const text = typeof m.content === "string" 
                ? m.content 
                : (Array.isArray(m.content) ? m.content.map(c => c.text || "[Image]").join(" ") : JSON.stringify(m.content));
            return `[User]:\n${text}`;
        }
        if (role === "assistant") {
            let t = `[Assistant]:\n${m.content || ""}`;
            if (m.tool_calls && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
                const calls = m.tool_calls.map(tc => {
                    const fnName = tc.function?.name || "tool";
                    const argsStr = typeof tc.function?.arguments === "string" 
                        ? tc.function.arguments.slice(0, 300) 
                        : JSON.stringify(tc.function?.arguments || {}).slice(0, 300);
                    return `${fnName}(${argsStr})`;
                }).join("; ");
                t += `\n[Tool Invocations]: ${calls}`;
            }
            return t;
        }
        if (role === "tool") {
            const raw = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            if (raw.includes("data:image/") || raw.includes('"data_url"') || m.type === "image") {
                try {
                    const parsed = typeof m.content === "object" ? m.content : JSON.parse(raw);
                    const imgPath = parsed.path || "image";
                    const mime = parsed.mime || "image";
                    const size = parsed.human_size || (parsed.size_bytes ? `${Math.round(parsed.size_bytes / 1024)} KB` : "");
                    return `[Tool Result (${m.name || m.tool_call_id || "tool"})]: [Image file read: ${imgPath} (${mime}${size ? `, ${size}` : ""})]`;
                } catch (_) {
                    return `[Tool Result (${m.name || m.tool_call_id || "tool"})]: [Image binary data]`;
                }
            }
            const preview = raw.length > 4000 
                ? raw.slice(0, 2000) + "\n... [output truncated for summary] ...\n" + raw.slice(-2000) 
                : raw;
            return `[Tool Result (${m.name || m.tool_call_id || "tool"})]:\n${preview}`;
        }
        if (role === "system") {
            return `[System Note]:\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`;
        }
        return `[${role}]:\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`;
    }).filter(Boolean).join("\n\n---\n\n");
}

/**
 * Estimates the token count for an array of messages using a conservative 3.2 chars/token ratio.
 * @param {Array<Object>} messages
 * @returns {number}
 */
export function estimateMessagesTokens(messages) {
    if (!Array.isArray(messages)) return 0;
    let chars = 0;
    let imageTokens = 0;

    const measure = (text) => {
        if (typeof text !== "string") return;
        const stripped = text.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, () => {
            imageTokens += 1200;
            return "";
        });
        chars += stripped.length;
    };

    for (const m of messages) {
        if (typeof m.content === "string") {
            measure(m.content);
        } else if (Array.isArray(m.content)) {
            for (const part of m.content) {
                if (part.type === "image_url" || part.type === "image") {
                    imageTokens += 1200;
                } else if (part.type === "text") {
                    measure(part.text);
                } else {
                    measure(JSON.stringify(part));
                }
            }
        } else if (m.content) {
            measure(JSON.stringify(m.content));
        }
        if (m.tool_calls) {
            chars += JSON.stringify(m.tool_calls).length;
        }
    }
    return Math.ceil(chars / 3.2) + imageTokens;
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
    // Account for system prompt + compaction briefing overhead (~5000 tokens)
    // so small-context models don't overflow again right after compaction.
    const systemOverhead = 5000;
    if (limit <= 32000) {
        return Math.max(4000, Math.min(limit - 4000 - systemOverhead, Math.floor(limit * 0.7)));
    }
    return Math.max(10000, limit - bufferTokens - systemOverhead);
}

/**
 * Compiles the working messages array for model inference.
 * If a compactionState exists, combines the system prompt, the compacted memory briefing,
 * and uncompacted active turns starting from compactedThroughIndex.
 * Guarantees that the active dialogue never starts on an orphan 'tool' or 'assistant' role.
 * All historical messages in session.messages remain completely preserved on disk.
 * @param {Object} session
 * @returns {Array<Object>}
/**
 * Sanitizes an individual message for working context:
 * - Windowing/truncating giant tool results (> 20,000 chars)
 * - Stripping reasoning <think>...</think> blocks from prior assistant turns so thinking tokens don't leak
 */
export function sanitizeWorkingTurn(m) {
    if (!m || typeof m !== "object") return m;

    if (m.role === "tool") {
        const raw = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        // Do NOT slice if it is an image payload (contains base64 data_url) - slicing destroys base64 and corrupts the image
        if (raw.includes("data:image/") || raw.includes('"data_url"') || m.type === "image") {
            return m;
        }
        if (raw.length > 20000) {
            const head = raw.slice(0, 8000);
            const tail = raw.slice(-8000);
            const omitted = raw.length - 16000;
            return {
                ...m,
                content: `${head}\n\n[... OMITTED ${omitted} CHARS OF TOOL OUTPUT FOR WORKING CONTEXT; FULL RECORD IS PRESERVED ON DISK ...] \n\n${tail}`
            };
        }
        return m;
    }

    if (m.role === "assistant" && typeof m.content === "string" && m.content.includes("</think>")) {
        const stripped = m.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        return {
            ...m,
            content: stripped
        };
    }

    return m;
}

/**
 * Compiles the working messages array for model inference.
 * If a compactionState exists, combines the system prompt, the compacted memory briefing,
 * and uncompacted active turns starting from compactedThroughIndex.
 * Guarantees that the active dialogue never starts on an orphan 'tool' or 'assistant' role.
 * All historical messages in session.messages remain completely preserved on disk.
 * @param {Object} session
 * @returns {Array<Object>}
 */
export function compileWorkingMessages(session) {
    if (!session || !Array.isArray(session.messages)) return [];
    const msgs = session.messages;
    const compaction = session.compactionState;

    if (!compaction || !compaction.summary || typeof compaction.compactedThroughIndex !== "number") {
        return msgs.map(sanitizeWorkingTurn);
    }

    const systemMsg = msgs[0] || { role: "system", content: "" };
    const briefingMsg = {
        role: "system",
        content: `[CONVERSATION HISTORY COMPACTED BY MODEL]:\n\n${compaction.summary}\n\n[INSTRUCTION]: The above briefing encapsulates prior goals, discoveries, and actions. Seamlessly continue the conversation from this point.`
    };

    // Calculate safe start index ensuring we never begin on an orphan 'tool' role
    let startIndex = Math.max(1, compaction.compactedThroughIndex);

    // If compactedThroughIndex exceeds current array length (e.g. from cache sync), recover last user turn
    if (startIndex >= msgs.length) {
        const lastUserIdx = msgs.map(m => m.role).lastIndexOf("user");
        startIndex = lastUserIdx >= 1 ? lastUserIdx : Math.max(1, msgs.length - 2);
    }

    // Advance past any orphan 'tool' messages
    while (startIndex < msgs.length && msgs[startIndex]?.role === "tool") {
        startIndex++;
    }

    // If starting on an assistant message, include its preceding user prompt if available, or generate a safe bridge
    let bridgeUserMsg = null;
    if (startIndex < msgs.length && msgs[startIndex]?.role === "assistant") {
        if (startIndex > 1 && msgs[startIndex - 1]?.role === "user") {
            startIndex = startIndex - 1;
        } else {
            const userPromptMsg = msgs.slice(1, startIndex).reverse().find(m => m.role === "user");
            const promptContent = userPromptMsg?.content;
            const originalPromptText = typeof promptContent === "string"
                ? promptContent
                : (Array.isArray(promptContent) ? promptContent.map(c => c.text || "").join(" ") : "Continue previous instructions.");

            bridgeUserMsg = {
                role: "user",
                content: `[ACTIVE EXECUTION CONTINUATION]\nOriginal user instruction: "${originalPromptText.slice(0, 1000)}"\n\nPlease continue executing the task seamlessly based on the context briefing above.`
            };
        }
    }

    const rawRecentTurns = msgs.slice(startIndex);
    const safeRecentTurns = rawRecentTurns.map(sanitizeWorkingTurn);

    return bridgeUserMsg
        ? [systemMsg, briefingMsg, bridgeUserMsg, ...safeRecentTurns]
        : [systemMsg, briefingMsg, ...safeRecentTurns];
}

export const compileWorkingContext = compileWorkingMessages;

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

    // Identify user indices in session.messages
    const userIndices = [];
    for (let i = 1; i < msgs.length; i++) {
        if (msgs[i].role === "user") userIndices.push(i);
    }

    let sliceEndIdx = 1;
    const threshold = getCompactionThreshold(selectedModel);

    if (userIndices.length >= 3) {
        // Try keeping the last 2 user turns uncompacted for seamless context grounding
        const twoTurnsIdx = userIndices[userIndices.length - 2];
        const tokensRemaining = estimateMessagesTokens(msgs.slice(twoTurnsIdx));
        if (tokensRemaining < threshold * 0.5) {
            sliceEndIdx = twoTurnsIdx;
        } else {
            sliceEndIdx = userIndices[userIndices.length - 1];
        }
    } else if (userIndices.length >= 2) {
        sliceEndIdx = userIndices[userIndices.length - 1];
    } else if (userIndices.length === 1) {
        // Long single-turn agent loop: compact earlier tool cycles while keeping recent ones intact
        const targetRecent = Math.max(2, msgs.length - 6);
        let candidateIdx = targetRecent;
        while (candidateIdx > 1 && msgs[candidateIdx]?.role !== "assistant") {
            candidateIdx--;
        }
        if (candidateIdx > 1 && msgs[candidateIdx]?.role === "assistant") {
            sliceEndIdx = candidateIdx;
        } else {
            sliceEndIdx = userIndices[0];
        }
    } else {
        sliceEndIdx = Math.max(1, msgs.length - 2);
    }

    // Previous compaction check
    const previousCompaction = session.compactionState;
    const sliceStartIdx = (previousCompaction && typeof previousCompaction.compactedThroughIndex === "number")
        ? Math.max(1, previousCompaction.compactedThroughIndex)
        : 1;

    // Safety: ensure sliceEndIdx is strictly greater than sliceStartIdx
    if (sliceEndIdx <= sliceStartIdx) {
        if (msgs.length - 4 > sliceStartIdx) {
            let candidate = msgs.length - 4;
            while (candidate > sliceStartIdx && msgs[candidate]?.role !== "assistant" && msgs[candidate]?.role !== "user") {
                candidate--;
            }
            if (candidate > sliceStartIdx) {
                sliceEndIdx = candidate;
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    const newMessagesToCompact = msgs.slice(sliceStartIdx, sliceEndIdx);
    if (newMessagesToCompact.length < 2 && !previousCompaction?.summary) {
        return false; // Not enough new messages to justify compaction
    }

    logEvent("CONTEXT_COMPACTION_START", {
        chatId: session.id,
        model: selectedModel,
        modelLimit: getModelContextLimit(selectedModel),
        compactionThreshold: threshold,
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
        const priorContextItem = previousCompaction?.summary
            ? `[PRIOR CONTEXT BRIEFING]:\n${previousCompaction.summary}\n\n`
            : "";

        const transcriptText = formatMessagesToTranscript(newMessagesToCompact);

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
            {
                role: "user",
                content: `${priorContextItem}Please generate the structured context briefing summarizing the conversation history transcript below:\n\n${transcriptText}`
            }
        ];

        const compactRes = await callChatModel(compactionPrompt, {
            model: selectedModel,
            tools: [],
            signal: genState?.abortController?.signal
        });
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
        // We update session.compactionState which compileWorkingMessages reads.
        const previewSession = {
            ...session,
            compactionState: {
                summary: summaryText,
                compactedThroughIndex: sliceEndIdx
            }
        };
        const workingAfter = compileWorkingMessages(previewSession);
        const tokensAfter = estimateMessagesTokens(workingAfter);
        const tokensSaved = Math.max(0, tokensBefore - tokensAfter);

        const checkpointNum = (session.compactionCount || 0) + 1;
        session.compactionCount = checkpointNum;
        const artifactFileName = `checkpoint_${checkpointNum}.md`;
        const artifactPath = `$ARTIFACTS/${artifactFileName}`;
        const checkpointMarkdown = `# Context Checkpoint #${checkpointNum}\n\n` +
            `**Archived Turns:** ${sliceStartIdx}–${sliceEndIdx}\n` +
            `**Tokens Saved:** ~${Math.round(tokensSaved / 1000)}k\n\n` +
            `## Context & Discoveries Briefing\n\n${summaryText}\n`;

        let absoluteArtifactPath = artifactPath;
        try {
            const writeRes = await fetch("/api/file/write", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    path: artifactPath,
                    content: checkpointMarkdown,
                    action: "write",
                    overwrite: true,
                    chatId: session.id
                })
            });
            if (writeRes.ok) {
                const writeData = await writeRes.json();
                if (writeData?.resolved_path) {
                    absoluteArtifactPath = writeData.resolved_path;
                }
            }
        } catch (e) {
            console.warn("[COMPACTOR] Could not persist checkpoint artifact:", e);
        }

        session.compactionState = {
            summary: summaryText,
            compactedThroughIndex: sliceEndIdx,
            tokensBefore,
            tokensAfter,
            tokensSaved,
            compactedAt: Date.now(),
            model: selectedModel,
            checkpointNum,
            sliceStartIdx,
            sliceEndIdx,
            artifactPath: absoluteArtifactPath
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
            messagesCount: newMessagesToCompact.length,
            artifactPath: absoluteArtifactPath,
            checkpointNum,
            sliceStartIdx,
            sliceEndIdx
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
