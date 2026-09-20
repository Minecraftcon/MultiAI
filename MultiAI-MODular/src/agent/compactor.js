// Automatic Context Compaction via Model
import { COMPACTION_BUFFER_TOKENS, COMPACTION_MIN_MESSAGES, COMPACTION_TOKEN_THRESHOLD } from "../config.js";
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
 * Calculates the compaction trigger threshold for a model, bounded by COMPACTION_TOKEN_THRESHOLD (32k).
 * Compaction triggers when the conversation approaches the 32k ceiling or the model limit.
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
    return Math.max(10000, effectiveLimit - bufferTokens);
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
 * Delegates to the state machine context assessment (evaluates 32k threshold and rounds count).
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
        let artifactPath = null;
        try {
            artifactPath = await writeCompactionArtifact({
                session,
                summaryText,
                sliceStartIdx,
                sliceEndIdx,
                tokensSaved
            });
        } catch (e) {
            console.warn("Could not write milestone artifact:", e);
        }

        const parsedTodos = extractTodos(msgs, previousCompaction?.todos || []);

        session.compactionState = {
            summary: summaryText,
            compactedThroughIndex: sliceEndIdx,
            tokensBefore,
            tokensAfter,
            tokensSaved,
            compactedAt: Date.now(),
            model: selectedModel,
            latestArtifactPath: artifactPath,
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
            artifactPath
        });

        badge.update({
            status: "completed",
            summaryText,
            tokensSaved,
            messagesCount: newMessagesToCompact.length,
            artifactPath
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

/**
 * Archives a timestamped milestone artifact in markdown format to $ARTIFACTS/.
 *
 * @param {Object} params
 * @param {Object} params.session
 * @param {string} params.summaryText
 * @param {number} params.sliceStartIdx
 * @param {number} params.sliceEndIdx
 * @param {number} params.tokensSaved
 * @returns {Promise<string|null>} Path of saved artifact, e.g. '$ARTIFACTS/milestone-178991823901.md'
 */
export async function writeCompactionArtifact({ session, summaryText, sliceStartIdx, sliceEndIdx, tokensSaved }) {
    if (!session || !session.id) return null;

    try {
        const msgs = session.messages || [];
        const { rootGoal, userDirectives } = extractUserDirectives(msgs);
        const todos = extractTodos(msgs, session.compactionState?.todos || []);

        const cleanTitle = (session.title || "milestone")
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "_")
            .replace(/_+/g, "_")
            .slice(0, 30)
            .replace(/^_+|_+$/g, "");

        const fileName = `${cleanTitle || "milestone"}-${Date.now()}.md`;
        const artifactPath = `$ARTIFACTS/${fileName}`;

        const lines = [
            `# Execution Milestone Artifact: ${session.title || "Session " + session.id}`,
            ``,
            `- **Timestamp**: ${new Date().toISOString()}`,
            `- **Chat ID**: \`${session.id}\``,
            `- **Archived Turns Range**: Turns ${sliceStartIdx} to ${sliceEndIdx}`,
            `- **Estimated Context Reduction**: ~${Math.round(tokensSaved)} tokens`,
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

        lines.push(``, `## 2. Active Roadmap & Todos`);
        if (todos.length > 0) {
            todos.forEach(t => {
                const mark = t.status === "completed" ? "[x]" : " ";
                lines.push(`- [${mark}] ${t.task}`);
            });
        } else {
            lines.push(`_No active checklist items pending._`);
        }

        lines.push(``, `## 3. Compacted Architecture & Discoveries Briefing`, ``, summaryText);

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
            logEvent("COMPACTION_ARTIFACT_SAVED", { chatId: session.id, path: artifactPath });
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
