// Automatic Context Compaction via Model (Clean Dual-Layer Architecture)
import { COMPACTION_BUFFER_TOKENS, COMPACTION_MIN_MESSAGES, COMPACTION_TOKEN_THRESHOLD, EMERGENCY_TRIM_TARGET_TOKENS } from "../config.js";
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
 * Calculates the compaction trigger threshold for a model, bounded by COMPACTION_TOKEN_THRESHOLD (65k).
 * Compaction triggers when the conversation reaches within bufferTokens (15k) of the ceiling (~50k tokens).
 * @param {string} modelId
 * @param {number} [bufferTokens]
 * @returns {number}
 */
export function getCompactionThreshold(modelId, bufferTokens = COMPACTION_BUFFER_TOKENS) {
    const limit = getModelContextLimit(modelId);
    const effectiveLimit = Math.min(limit, COMPACTION_TOKEN_THRESHOLD);
    if (effectiveLimit <= 32000) {
        return Math.max(4000, Math.min(effectiveLimit - 2000, Math.floor(effectiveLimit * 0.8)));
    }
    return Math.max(10000, effectiveLimit - bufferTokens);
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
        return msgs;
    }

    const systemMsg = msgs[0] || { role: "system", content: "" };
    const briefingMsg = {
        role: "system",
        content: `[CONVERSATION HISTORY COMPACTED BY MODEL]:\n\n${compaction.summary}\n\n[INSTRUCTION]: The above briefing encapsulates prior goals, discoveries, and actions. Seamlessly continue the conversation from this point.`
    };

    // Calculate safe start index ensuring we never begin on an orphan 'tool' role
    let startIndex = Math.max(1, compaction.compactedThroughIndex);

    // If compactedThroughIndex exceeds current array length, recover last user turn
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

    // Guard: ensure giant tool outputs in recentTurns don't overflow the context window
    const safeRecentTurns = rawRecentTurns.map(m => {
        if (m.role === "tool" && typeof m.content === "string" && m.content.length > 25000) {
            const head = m.content.slice(0, 10000);
            const tail = m.content.slice(-10000);
            const omitted = m.content.length - 20000;
            return {
                ...m,
                content: `${head}\n\n[... OMITTED ${omitted} CHARS OF TOOL OUTPUT FOR WORKING CONTEXT; FULL RECORD IS PRESERVED ON DISK ...] \n\n${tail}`
            };
        }
        return m;
    });

    return bridgeUserMsg
        ? [systemMsg, briefingMsg, bridgeUserMsg, ...safeRecentTurns]
        : [systemMsg, briefingMsg, ...safeRecentTurns];
}

export const compileWorkingContext = compileWorkingMessages;

/**
 * Checks whether the current session messages should undergo model compaction.
 * Triggers when the working token count reaches or exceeds the threshold (50k tokens).
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
    if (lastUserIdx <= 1 && msgs.length < 14) {
        return false;
    }

    // Evaluate token count of the compiled working context
    const workingMsgs = compileWorkingMessages(session);
    const tokenCount = estimateMessagesTokens(workingMsgs);
    const modelId = options.model || session.model;
    const threshold = options.threshold || getCompactionThreshold(modelId);

    // Trigger when working tokens reach threshold
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
 * @param {boolean} [params.forceEmergencyTrim=false]
 * @returns {Promise<boolean>} Whether compaction was executed
 */
export async function compactSessionContext({ session, currentAIMessage, selectedModel, genState, overallStartTime, forceEmergencyTrim = false }) {
    if (!session || !Array.isArray(session.messages) || session.messages.length <= 3) {
        return false;
    }
    if (genState && genState.abortRequested) {
        return false;
    }

    const msgs = session.messages;
    const workingBefore = compileWorkingMessages(session);
    const tokensBefore = estimateMessagesTokens(workingBefore);

    // Fast-path: Force emergency trimming immediately if context window already overflowing
    if (forceEmergencyTrim) {
        logEvent("EMERGENCY_TRIM_FORCED", { chatId: session.id, model: selectedModel, tokensBefore });
        return await emergencyTrimContext({
            session,
            currentAIMessage,
            selectedModel,
            failureReason: "Forced emergency trim on context limit",
            tokensBefore
        });
    }

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
        // Long single-turn agent loop: compact earlier tool cycles while keeping recent 6-8 tool turns intact
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
            logEvent("CONTEXT_COMPACTION_EMPTY_FALLBACK_EMERGENCY", { chatId: session.id });
            return await emergencyTrimContext({
                session,
                currentAIMessage,
                selectedModel,
                failureReason: "Model returned empty summary",
                badge,
                tokensBefore
            });
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

        // Write persistent milestone artifact to $ARTIFACTS/
        const prevCheckpoints = Array.isArray(previousCompaction?.checkpoints) ? previousCompaction.checkpoints : [];
        const checkpointNum = prevCheckpoints.length + 1;

        let artifactPath = null;
        try {
            artifactPath = await writeCompactionArtifact({
                session,
                summaryText,
                sliceStartIdx,
                sliceEndIdx,
                tokensSaved,
                checkpointNum
            });
        } catch (e) {
            console.warn("Could not write checkpoint artifact:", e);
        }

        const combinedSummary = previousCompaction?.summary
            ? `${previousCompaction.summary}\n\n---\n\n### Checkpoint #${checkpointNum} (Turns ${sliceStartIdx}–${sliceEndIdx}):\n${summaryText}`
            : `### Checkpoint #1 (Turns ${sliceStartIdx}–${sliceEndIdx}):\n${summaryText}`;

        session.compactionState = {
            summary: combinedSummary,
            compactedThroughIndex: sliceEndIdx,
            tokensBefore,
            tokensAfter,
            tokensSaved,
            compactedAt: Date.now(),
            model: selectedModel,
            latestArtifactPath: artifactPath,
            checkpoints: [
                ...prevCheckpoints,
                {
                    checkpointNum,
                    path: artifactPath,
                    sliceStartIdx,
                    sliceEndIdx,
                    tokensSaved,
                    timestamp: Date.now()
                }
            ]
        };

        state.messages = session.messages;
        saveStoredChats();

        logEvent("CONTEXT_COMPACTION_COMPLETE", {
            chatId: session.id,
            tokensBefore,
            tokensAfter,
            tokensSaved,
            messagesCompactCount: newMessagesToCompact.length,
            compactedThroughIndex: sliceEndIdx,
            artifactPath,
            checkpointNum
        });

        badge.update({
            status: "completed",
            summaryText,
            tokensSaved,
            messagesCount: newMessagesToCompact.length,
            artifactPath,
            checkpointNum,
            sliceStartIdx,
            sliceEndIdx
        });

        return true;
    } catch (err) {
        logEvent("CONTEXT_COMPACTION_ERROR_FALLBACK_EMERGENCY", { error: err?.message || String(err) });
        try {
            return await emergencyTrimContext({
                session,
                currentAIMessage,
                selectedModel,
                failureReason: `Model compaction failed: ${err?.message || String(err)}`,
                badge,
                tokensBefore
            });
        } catch (emergencyErr) {
            logEvent("EMERGENCY_TRIM_CRITICAL_FAILURE", { error: emergencyErr?.message || String(emergencyErr) });
            badge.update({
                status: "failed",
                error: err?.message || "Compaction failed"
            });
            return false;
        }
    }
}

/**
 * Emergency context trimming fallback: deterministically slices ~15k tokens (EMERGENCY_TRIM_TARGET_TOKENS)
 * of historical turns and permanently archives them as a structured artifact to $ARTIFACTS/.
 * Advances compaction boundary without requiring an upstream model call, rescuing the session from 65k context limit failures.
 *
 * @param {Object} params
 * @param {Object} params.session
 * @param {HTMLElement} [params.currentAIMessage]
 * @param {string} [params.selectedModel]
 * @param {string} [params.failureReason]
 * @param {Object} [params.badge]
 * @param {number} [params.tokensBefore]
 * @param {number} [params.tokensToTrim]
 * @returns {Promise<boolean>}
 */
export async function emergencyTrimContext({
    session,
    currentAIMessage,
    selectedModel,
    failureReason = "Model compaction unavailable",
    badge = null,
    tokensBefore = 0,
    tokensToTrim = EMERGENCY_TRIM_TARGET_TOKENS
}) {
    if (!session || !Array.isArray(session.messages) || session.messages.length <= 4) {
        return false;
    }

    const msgs = session.messages;
    const previousCompaction = session.compactionState;
    const sliceStartIdx = (previousCompaction && typeof previousCompaction.compactedThroughIndex === "number")
        ? Math.max(1, previousCompaction.compactedThroughIndex)
        : 1;

    let trimmedTokens = 0;
    let sliceEndIdx = sliceStartIdx;
    const minLiveTurns = 6;
    const maxSafeIdx = Math.max(sliceStartIdx + 1, msgs.length - minLiveTurns);

    while (sliceEndIdx < maxSafeIdx && trimmedTokens < tokensToTrim) {
        trimmedTokens += estimateMessagesTokens([msgs[sliceEndIdx]]);
        sliceEndIdx++;
    }

    while (sliceEndIdx < msgs.length - 2 && msgs[sliceEndIdx]?.role === "tool") {
        trimmedTokens += estimateMessagesTokens([msgs[sliceEndIdx]]);
        sliceEndIdx++;
    }

    if (sliceEndIdx <= sliceStartIdx) {
        logEvent("EMERGENCY_TRIM_SKIPPED", { reason: "Not enough older messages to trim safely" });
        return false;
    }

    const trimmedMessages = msgs.slice(sliceStartIdx, sliceEndIdx);
    const prevCheckpoints = Array.isArray(previousCompaction?.checkpoints) ? previousCompaction.checkpoints : [];
    const checkpointNum = prevCheckpoints.length + 1;

    let artifactPath = null;
    try {
        artifactPath = await writeEmergencyTrimArtifact({
            session,
            trimmedMessages,
            sliceStartIdx,
            sliceEndIdx,
            trimmedTokens,
            checkpointNum,
            failureReason
        });
    } catch (e) {
        console.warn("Could not write emergency checkpoint artifact:", e);
    }

    const summaryText = `Emergency trimmed ~${Math.round(trimmedTokens)} tokens into artifact \`${artifactPath || "disk"}\` after model compaction failed (${failureReason}). Active trajectory resumes from turn ${sliceEndIdx}.`;

    const combinedSummary = previousCompaction?.summary
        ? `${previousCompaction.summary}\n\n---\n\n### Checkpoint #${checkpointNum} [EMERGENCY TRIM] (Turns ${sliceStartIdx}–${sliceEndIdx}):\n${summaryText}`
        : `### Checkpoint #${checkpointNum} [EMERGENCY TRIM] (Turns ${sliceStartIdx}–${sliceEndIdx}):\n${summaryText}`;

    const estBefore = tokensBefore || estimateMessagesTokens(compileWorkingMessages(session));
    const tokensSaved = Math.round(trimmedTokens);

    session.compactionState = {
        summary: combinedSummary,
        compactedThroughIndex: sliceEndIdx,
        tokensBefore: estBefore,
        tokensAfter: Math.max(0, estBefore - tokensSaved),
        tokensSaved,
        compactedAt: Date.now(),
        model: selectedModel,
        latestArtifactPath: artifactPath,
        checkpoints: [
            ...prevCheckpoints,
            {
                checkpointNum,
                path: artifactPath,
                sliceStartIdx,
                sliceEndIdx,
                tokensSaved,
                isEmergencyTrim: true,
                failureReason,
                timestamp: Date.now()
            }
        ]
    };

    state.messages = session.messages;
    saveStoredChats();

    logEvent("EMERGENCY_TRIM_COMPLETE", {
        chatId: session.id,
        trimmedTokens: tokensSaved,
        sliceStartIdx,
        sliceEndIdx,
        artifactPath,
        checkpointNum,
        failureReason
    });

    let activeBadge = badge;
    if (!activeBadge && currentAIMessage) {
        try {
            activeBadge = addCompactionBadge(currentAIMessage, {
                messagesCount: trimmedMessages.length,
                tokensBefore: estBefore
            });
        } catch (e) {
            // Ignore UI badge creation if element unmounted
        }
    }

    if (activeBadge && typeof activeBadge.update === "function") {
        activeBadge.update({
            status: "completed",
            summaryText,
            tokensSaved,
            messagesCount: trimmedMessages.length,
            artifactPath,
            checkpointNum,
            sliceStartIdx,
            sliceEndIdx,
            isEmergencyTrim: true
        });
    }

    return true;
}

/**
 * Archives a timestamped milestone checkpoint in markdown format to $ARTIFACTS/.
 */
export async function writeCompactionArtifact({ session, summaryText, sliceStartIdx, sliceEndIdx, tokensSaved, checkpointNum = 1 }) {
    if (!session || !session.id) return null;

    try {
        const msgs = session.messages || [];
        const rootUserMsg = msgs.find(m => m.role === "user");
        const rootGoal = typeof rootUserMsg?.content === "string" ? rootUserMsg.content : "Execute requested tasks.";

        const fileName = `checkpoint_${checkpointNum}_turns_${sliceStartIdx}_to_${sliceEndIdx}_${Date.now()}.md`;
        const artifactPath = `$ARTIFACTS/${fileName}`;

        const lines = [
            `# Execution Milestone Checkpoint #${checkpointNum}: Turns ${sliceStartIdx} to ${sliceEndIdx}`,
            ``,
            `- **Timestamp**: ${new Date().toISOString()}`,
            `- **Session ID**: \`${session.id}\``,
            `- **Archived Turns Range**: Turns ${sliceStartIdx} to ${sliceEndIdx}`,
            `- **Context Reduction**: ~${Math.round(tokensSaved)} tokens`,
            `- **Active Trajectory**: Turns ${sliceEndIdx} to ${msgs.length} remain LIVE in working memory.`,
            ``,
            `---`,
            ``,
            `## 1. Core Objective`,
            `"${rootGoal}"`,
            ``,
            `## 2. Compacted Architecture & Discoveries Briefing`,
            ``,
            summaryText,
            ``,
            `---`,
            `## 3. History Inspection Pointer`,
            ``,
            `This checkpoint is archived on disk at \`${artifactPath}\`. The full conversation history is preserved at \`messages.jsonl\`. If detailed past tool outputs are needed, use \`read_file('${artifactPath}')\`.`
        ];

        const content = lines.join("\n");

        const res = await fetch("/api/file/write", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-chat-id": session.id
            },
            body: JSON.stringify({
                path: artifactPath,
                content: content
            })
        });

        if (res.ok) {
            logEvent("COMPACTION_ARTIFACT_SAVED", { chatId: session.id, path: artifactPath, checkpointNum });
            return artifactPath;
        } else {
            console.warn("Failed to write compaction artifact:", await res.text());
            return null;
        }
    } catch (e) {
        console.warn("Error saving compaction artifact:", e);
        return null;
    }
}

/**
 * Archives emergency trimmed turns (~15k tokens) to $ARTIFACTS/ with full structured transcript.
 */
export async function writeEmergencyTrimArtifact({
    session,
    trimmedMessages,
    sliceStartIdx,
    sliceEndIdx,
    trimmedTokens,
    checkpointNum = 1,
    failureReason = "Standard model compaction failed"
}) {
    if (!session || !session.id) return null;

    try {
        const msgs = session.messages || [];
        const rootUserMsg = msgs.find(m => m.role === "user");
        const rootGoal = typeof rootUserMsg?.content === "string" ? rootUserMsg.content : "Execute requested tasks.";

        const fileName = `checkpoint_emergency_${checkpointNum}_turns_${sliceStartIdx}_to_${sliceEndIdx}_${Date.now()}.md`;
        const artifactPath = `$ARTIFACTS/${fileName}`;

        const transcript = formatMessagesToTranscript(trimmedMessages);

        const lines = [
            `# Emergency Context Checkpoint #${checkpointNum}: Turns ${sliceStartIdx} to ${sliceEndIdx}`,
            ``,
            `- **Timestamp**: ${new Date().toISOString()}`,
            `- **Session ID**: \`${session.id}\``,
            `- **Trigger**: Emergency Context Trimming (~${Math.round(trimmedTokens)} tokens)`,
            `- **Reason**: ${failureReason}`,
            `- **Operational Context Ceiling**: 65,000 tokens`,
            `- **Archived Turns Range**: Turns ${sliceStartIdx} to ${sliceEndIdx}`,
            `- **Active Trajectory**: Turns ${sliceEndIdx} to ${msgs.length} remain LIVE in working memory.`,
            ``,
            `---`,
            ``,
            `## 1. Core Objective`,
            `"${rootGoal}"`,
            ``,
            `## 2. Emergency Trimmed Transcript Archive`,
            ``,
            `> **NOTE**: The following turns were trimmed from active working memory to protect the 65k context ceiling. Full historical data is preserved permanently here and in \`messages.jsonl\`.`,
            ``,
            transcript,
            ``,
            `---`,
            `## 3. History Inspection Pointer`,
            ``,
            `This emergency checkpoint is permanently stored at \`${artifactPath}\`. The entire conversation log is retained at \`messages.jsonl\`. If past tool outputs from these turns are needed, use \`read_file('${artifactPath}')\`.`
        ];

        const content = lines.join("\n");

        const res = await fetch("/api/file/write", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-chat-id": session.id
            },
            body: JSON.stringify({
                path: artifactPath,
                content: content
            })
        });

        if (res.ok) {
            logEvent("EMERGENCY_ARTIFACT_SAVED", { chatId: session.id, path: artifactPath, checkpointNum });
            return artifactPath;
        } else {
            console.warn("Failed to write emergency compaction artifact:", await res.text());
            return null;
        }
    } catch (e) {
        console.warn("Error saving emergency compaction artifact:", e);
        return null;
    }
}
