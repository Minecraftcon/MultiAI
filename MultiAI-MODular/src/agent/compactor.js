// Automatic Context Compaction via Model
import { COMPACTION_BUFFER_TOKENS, COMPACTION_MIN_MESSAGES, COMPACTION_TOKEN_THRESHOLD, CHUNK_COMPACTION_TARGET_TOKENS, EMERGENCY_TRIM_TARGET_TOKENS } from "../config.js";
import { state } from "../state/index.js";
import { logEvent } from "../utils/logger.js";
import { extractText } from "../utils/dom.js";
import { callChatModel } from "./chat-client.js";
import { addCompactionBadge } from "../components/chat-ui.js";
import { saveStoredChats } from "../services/storage.js";
import { extractThoughtAndContent } from "../components/renderer.js";
import { availableModels } from "../components/side-panel.js";
import {
    extractUserDirectives,
    extractTodos,
    assessContext,
    compileWorkingContext
} from "./state-machine.js";

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
 * Calculates the compaction trigger threshold for a model, bounded by COMPACTION_TOKEN_THRESHOLD (100k).
 * Compaction triggers when the conversation approaches the 100k ceiling (~85k-90k tokens).
 * @param {string} modelId
 * @param {number} [bufferTokens]
 * @returns {number}
 */
export function getCompactionThreshold(modelId, bufferTokens = COMPACTION_BUFFER_TOKENS) {
    const limit = getModelContextLimit(modelId);
    const effectiveLimit = Math.min(limit, COMPACTION_TOKEN_THRESHOLD);
    if (effectiveLimit <= 32000) {
        return Math.max(4000, Math.min(effectiveLimit - 2000, Math.floor(effectiveLimit * 0.85)));
    }
    return Math.max(15000, effectiveLimit - bufferTokens);
}

/**
 * Compiles the working messages array for model inference using the Deep Agent state machine.
 * Preserves historical messages in session.messages completely intact on disk.
 * @param {Object} session
 * @returns {Array<Object>}
 */
export function compileWorkingMessages(session) {
    return compileWorkingContext(session);
}

/**
 * Checks whether the current session messages should undergo model compaction.
 * Delegates to the state machine context assessment (evaluates 100k threshold and cooldown).
 * @param {Object} session
 * @param {Object} [options]
 * @param {string} [options.model]
 * @param {number} [options.threshold]
 * @returns {boolean}
 */
export function shouldCompact(session, options = {}) {
    return assessContext(session, options).shouldCompact;
}

/**
 * Performs rolling chunk compaction of older conversational turns into checkpoint artifacts,
 * while preserving the entire active trajectory (~40k+ tokens of live reasoning) untouched.
 * 100% of historical turns remain preserved on disk in session.messages and messages.jsonl.
 *
 * @param {Object} params
 * @param {Object} params.session
 * @param {HTMLElement} params.currentAIMessage
 * @param {string} params.selectedModel
 * @param {Object} params.genState
 * @param {number} params.overallStartTime
 * @returns {Promise<boolean>} Whether compaction was executed
 */
export async function compactSessionContext({ session, currentAIMessage, selectedModel, genState, overallStartTime, forceEmergencyTrim = false }) {
    if (!session || !Array.isArray(session.messages) || session.messages.length <= 4) {
        return false;
    }
    if (genState && genState.abortRequested) {
        return false;
    }

    const msgs = session.messages;
    const workingBefore = compileWorkingMessages(session);
    const tokensBefore = estimateMessagesTokens(workingBefore);

    // Fast-path: Force emergency trimming immediately (e.g. upstream context overflow)
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

    // Previous compaction check
    const previousCompaction = session.compactionState;
    const sliceStartIdx = (previousCompaction && typeof previousCompaction.compactedThroughIndex === "number")
        ? Math.max(1, previousCompaction.compactedThroughIndex)
        : 1;

    // Rolling Chunk Compaction:
    // Slices off the oldest ~25k tokens (CHUNK_COMPACTION_TARGET_TOKENS)
    // while strictly leaving the active trajectory live and untouched!
    let chunkTokens = 0;
    let candidateEndIdx = sliceStartIdx;
    while (candidateEndIdx < msgs.length - 8 && chunkTokens < CHUNK_COMPACTION_TARGET_TOKENS) {
        chunkTokens += estimateMessagesTokens([msgs[candidateEndIdx]]);
        candidateEndIdx++;
    }

    // Trajectory guard: calculate maxAllowedEndIdx ensuring we preserve at least 25k tokens or recent active turns
    let liveTrajectoryTokens = 0;
    let maxAllowedEndIdx = msgs.length - 1;
    while (maxAllowedEndIdx > sliceStartIdx + 2 && liveTrajectoryTokens < 25000) {
        liveTrajectoryTokens += estimateMessagesTokens([msgs[maxAllowedEndIdx]]);
        maxAllowedEndIdx--;
    }

    let sliceEndIdx = Math.min(candidateEndIdx, maxAllowedEndIdx);

    // Clean alignment: advance past any tool messages so we never split an assistant tool call from its tool results
    while (sliceEndIdx < msgs.length - 4 && msgs[sliceEndIdx]?.role === "tool") {
        sliceEndIdx++;
    }

    // Safety: ensure sliceEndIdx is strictly greater than sliceStartIdx
    if (sliceEndIdx <= sliceStartIdx) {
        return false; // Not enough messages in the chunk yet to justify compaction
    }

    const newMessagesToCompact = msgs.slice(sliceStartIdx, sliceEndIdx);
    if (newMessagesToCompact.length < 2 && !previousCompaction?.summary) {
        return false; // Not enough new messages to justify compaction
    }

    const threshold = getCompactionThreshold(selectedModel);

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
        activityLabel.textContent = `Checkpointing history… (${sec}s)`;
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

        const compactRes = await callChatModel(compactionPrompt, { model: selectedModel, tools: [] });
        if (genState && genState.abortRequested) {
            return false;
        }

        const rawText = extractText(compactRes);
        const { content: cleanText } = extractThoughtAndContent(rawText);
        const summaryText = (cleanText || rawText).replace(/<\/?think>/gi, "").trim();

        if (!summaryText) {
            logEvent("CONTEXT_COMPACTION_EMPTY_FALLBACK_EMERGENCY", { chatId: session.id });
            // Model returned empty summary -> execute emergency trimming of 15k tokens as artifact!
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

        // Write persistent checkpoint artifact to $ARTIFACTS/
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

        const parsedTodos = extractTodos(msgs, previousCompaction?.todos || []);
        const newCheckpoint = {
            checkpointNum,
            path: artifactPath,
            sliceStartIdx,
            sliceEndIdx,
            tokensSaved,
            timestamp: Date.now()
        };

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
            checkpoints: [...prevCheckpoints, newCheckpoint],
            todos: parsedTodos
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
        // Emergency trimming on failure: trim ~15k tokens and save as artifact!
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
                error: err?.message || "Checkpoint failed"
            });
            return false;
        }
    }
}

/**
 * Archives a timestamped milestone checkpoint in markdown format to $ARTIFACTS/.
 *
 * @param {Object} params
 * @param {Object} params.session
 * @param {string} params.summaryText
 * @param {number} params.sliceStartIdx
 * @param {number} params.sliceEndIdx
 * @param {number} params.tokensSaved
 * @param {number} [params.checkpointNum=1]
 * @returns {Promise<string|null>} Path of saved artifact, e.g. '$ARTIFACTS/checkpoint_1_turns_1_to_35_178991823901.md'
 */
export async function writeCompactionArtifact({ session, summaryText, sliceStartIdx, sliceEndIdx, tokensSaved, checkpointNum = 1 }) {
    if (!session || !session.id) return null;

    try {
        const msgs = session.messages || [];
        const { rootGoal, userDirectives } = extractUserDirectives(msgs);
        const todos = extractTodos(msgs, session.compactionState?.todos || []);

        const fileName = `checkpoint_${checkpointNum}_turns_${sliceStartIdx}_to_${sliceEndIdx}_${Date.now()}.md`;
        const artifactPath = `$ARTIFACTS/${fileName}`;

        const lines = [
            `# Execution Milestone Checkpoint #${checkpointNum}: Turns ${sliceStartIdx} to ${sliceEndIdx}`,
            ``,
            `- **Timestamp**: ${new Date().toISOString()}`,
            `- **Session ID**: \`${session.id}\``,
            `- **Archived Turns Range**: Turns ${sliceStartIdx} to ${sliceEndIdx}`,
            `- **Estimated Context Reduction**: ~${Math.round(tokensSaved)} tokens`,
            `- **Active Trajectory Status**: Turns ${sliceEndIdx} to ${msgs.length} remain LIVE in working memory.`,
            ``,
            `---`,
            ``,
            `## 1. User Directives & Core Intent`,
            `• **Root Objective**: "${rootGoal || "Execute requested tasks."}"`,
        ];

        if (userDirectives.length > 0) {
            lines.push(`• **Steering Directives**:`);
            userDirectives.forEach((d, i) => lines.push(`  ${i + 1}. "${d}"`));
        }

        lines.push(``, `## 2. Active Roadmap & Focus Chain`);
        if (todos.length > 0) {
            todos.forEach(t => {
                const mark = t.status === "completed" ? "[x]" : " ";
                lines.push(`- [${mark}] ${t.task}`);
            });
        } else {
            lines.push(`_No active checklist items pending._`);
        }

        lines.push(``, `## 3. Compacted Architecture & Discoveries Briefing`, ``, summaryText);

        lines.push(
            ``,
            `---`,
            `## 4. History Inspection Pointer`,
            ``,
            `This checkpoint is archived on disk at \`${artifactPath}\`. The full monolithic conversation history is preserved at \`messages.jsonl\`. If detailed past tool outputs or past commands are needed, use \`read_file('${artifactPath}')\`.`
        );

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

    // Accumulate ~15k tokens forward from sliceStartIdx
    let trimmedTokens = 0;
    let sliceEndIdx = sliceStartIdx;
    const minLiveTurns = 6;
    const maxSafeIdx = Math.max(sliceStartIdx + 1, msgs.length - minLiveTurns);

    while (sliceEndIdx < maxSafeIdx && trimmedTokens < tokensToTrim) {
        trimmedTokens += estimateMessagesTokens([msgs[sliceEndIdx]]);
        sliceEndIdx++;
    }

    // Align past contiguous tool messages so we never split assistant tool calls from tool results
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

    // Write persistent emergency artifact to $ARTIFACTS/
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
        ],
        todos: extractTodos(msgs, previousCompaction?.todos || [])
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

    // If a badge doesn't exist yet, try to create one if currentAIMessage is available
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
 * Archives emergency trimmed turns (~15k tokens) to $ARTIFACTS/ with full structured transcript.
 *
 * @param {Object} params
 * @param {Object} params.session
 * @param {Array<Object>} params.trimmedMessages
 * @param {number} params.sliceStartIdx
 * @param {number} params.sliceEndIdx
 * @param {number} params.trimmedTokens
 * @param {number} [params.checkpointNum=1]
 * @param {string} [params.failureReason]
 * @returns {Promise<string|null>} Path of saved artifact
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
        const { rootGoal, userDirectives } = extractUserDirectives(msgs);
        const todos = extractTodos(msgs, session.compactionState?.todos || []);

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
            `## 1. User Directives & Core Intent`,
            `• **Root Objective**: "${rootGoal || "Execute requested tasks."}"`,
        ];

        if (userDirectives.length > 0) {
            lines.push(`• **Steering Directives**:`);
            userDirectives.forEach((d, i) => lines.push(`  ${i + 1}. "${d}"`));
        }

        lines.push(``, `## 2. Active Roadmap & Focus Chain`);
        if (todos.length > 0) {
            todos.forEach(t => {
                const mark = t.status === "completed" ? "[x]" : " ";
                lines.push(`- [${mark}] ${t.task}`);
            });
        } else {
            lines.push(`_No active checklist items pending._`);
        }

        lines.push(
            ``,
            `## 3. Emergency Trimmed Transcript Archive`,
            ``,
            `> **NOTE**: The following turns were trimmed from active working memory to protect the 65k context ceiling. Full historical data is preserved permanently here and in \`messages.jsonl\`.`,
            ``,
            transcript,
            ``,
            `---`,
            `## 4. History Inspection Pointer`,
            ``,
            `This emergency checkpoint is permanently stored at \`${artifactPath}\`. The entire conversation log is retained at \`messages.jsonl\`. If past tool outputs or files from these turns are needed, use \`read_file('${artifactPath}')\`.`
        );

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

