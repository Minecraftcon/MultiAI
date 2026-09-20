/**
 * MultiAI Deep Agent State Machine (LangGraph-style State Management)
 * ===================================================================
 * Implements discrete state channels, append-only user directives ledger,
 * roadmap/todos tracking, and layered context compilation with 32K ceilings.
 */

import {
    COMPACTION_TOKEN_THRESHOLD,
    COMPACTION_MIN_MESSAGES,
    COMPACTION_BUFFER_TOKENS,
    CHUNK_COMPACTION_TARGET_TOKENS,
    COMPACTION_COOLDOWN_TURNS
} from "../config.js";
import { estimateMessagesTokens, getCompactionThreshold } from "./compactor.js";

/**
 * Extracts the user directives ledger (inviolable intent layer).
 * Preserves the root user prompt from Turn 1 and all steering instructions.
 *
 * @param {Array<Object>} messages
 * @returns {{ rootGoal: string, userDirectives: Array<string> }}
 */
export function extractUserDirectives(messages) {
    if (!Array.isArray(messages)) return { rootGoal: "", userDirectives: [] };

    let rootGoal = "";
    const userDirectives = [];

    for (const m of messages) {
        if (m.role === "user") {
            const rawContent = typeof m.content === "string"
                ? m.content
                : (Array.isArray(m.content) ? m.content.map(c => c.text || "").join(" ") : JSON.stringify(m.content || ""));
            const clean = rawContent.trim();
            if (!clean) continue;

            // Skip internal synthetic retry prompts
            if (/^Your previous reply was empty/i.test(clean)) continue;

            if (!rootGoal) {
                rootGoal = clean;
            } else if (!userDirectives.includes(clean)) {
                userDirectives.push(clean);
            }
        }
    }

    return { rootGoal, userDirectives };
}

/**
 * Parses or extracts todos from previous assistant messages or compaction briefings.
 *
 * @param {Array<Object>} messages
 * @param {Array<Object>} [existingTodos]
 * @returns {Array<Object>}
 */
export function extractTodos(messages, existingTodos = []) {
    const todosMap = new Map();
    (existingTodos || []).forEach(t => {
        if (t && t.task) todosMap.set(t.task.trim().toLowerCase(), t);
    });

    // Check recent assistant messages for checklist markdown lines (- [ ] or - [x])
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === "assistant" && typeof m.content === "string") {
            const lines = m.content.split("\n");
            for (const line of lines) {
                const checkMatch = line.match(/^[-*]\s*\[([ xX])\]\s*(.+)$/);
                if (checkMatch) {
                    const isDone = checkMatch[1].toLowerCase() === "x";
                    const taskText = checkMatch[2].trim();
                    const key = taskText.toLowerCase();
                    if (!todosMap.has(key)) {
                        todosMap.set(key, {
                            id: `todo_${todosMap.size + 1}`,
                            task: taskText,
                            status: isDone ? "completed" : "pending"
                        });
                    }
                }
            }
        }
    }

    return Array.from(todosMap.values());
}

/**
 * Pass-through helper (passive micro-pruning removed).
 * Preserves full tool outputs in active memory without in-flight clearing.
 *
 * @param {Array<Object>} messages
 * @returns {Array<Object>}
 */
export function microPruneToolOutputs(messages) {
    return messages;
}

/**
 * Evaluates whether the current agent state exceeds context thresholds and requires chunk compaction.
 *
 * @param {Object} session
 * @param {Object} options
 * @param {string} [options.model]
 * @param {number} [options.threshold]
 * @returns {{ shouldCompact: boolean, tokenCount: number, threshold: number, reason?: string }}
 */
export function assessContext(session, options = {}) {
    if (!session || !Array.isArray(session.messages)) {
        return { shouldCompact: false, tokenCount: 0, threshold: COMPACTION_TOKEN_THRESHOLD };
    }

    const msgs = session.messages;
    if (msgs.length < COMPACTION_MIN_MESSAGES) {
        return { shouldCompact: false, tokenCount: 0, threshold: COMPACTION_TOKEN_THRESHOLD };
    }

    // Evaluate token count of current working messages directly
    const workingMsgs = session.compactionState?.summary
        ? compileWorkingContext(session)
        : msgs;

    const tokenCount = estimateMessagesTokens(workingMsgs);
    const modelId = options.model || session.model;
    const threshold = options.threshold || getCompactionThreshold(modelId);

    // Cooldown check: prevent thrashing if we recently compacted and still under critical ceiling
    const lastCompactedIdx = session.compactionState?.compactedThroughIndex || 0;
    const newTurns = msgs.length - lastCompactedIdx;
    if (lastCompactedIdx > 0 && newTurns < COMPACTION_COOLDOWN_TURNS && tokenCount < threshold * 1.05) {
        return { shouldCompact: false, tokenCount, threshold, reason: "cooldown" };
    }

    // Trigger only when working context genuinely reaches the threshold (e.g. ~85k for 100k models)
    const should = tokenCount >= threshold;
    return { shouldCompact: should, tokenCount, threshold };
}

/**
 * Compiles the multi-layer working context for model inference:
 * Layer 0: System Persona, Tools & Protocols (Static KV-Cache Frozen Prefix)
 * Layer 1: Pinned [PERSISTENT USER GOALS & DIRECTIVES LEDGER] (Inviolable intent)
 * Layer 2: Pinned [ACTIVE ROADMAP & TODOS] (if present)
 * Layer 3: Pinned [HISTORICAL CHECKPOINTS & COMPACTED ARCHITECTURE BRIEFING] + $ARTIFACTS pointer
 * Layer 4 & 5: Active Rolling Trajectory (micro-pruned older tool stubs + live recent turns)
 *
 * FAST PATH: If no compaction has occurred yet, returns micro-pruned session messages.
 *
 * @param {Object} session
 * @returns {Array<Object>}
 */
export function compileWorkingContext(session) {
    if (!session || !Array.isArray(session.messages)) return [];
    const msgs = session.messages;
    const compaction = session.compactionState;

    // FAST PATH: Fresh conversations without compaction
    if (!compaction || !compaction.summary || typeof compaction.compactedThroughIndex !== "number") {
        return msgs;
    }

    const systemMsg = msgs[0] || { role: "system", content: "" };

    // 1. Directives Ledger (North Star)
    const { rootGoal, userDirectives } = extractUserDirectives(msgs);
    let directivesContent = `[PERSISTENT USER GOALS & STEERING DIRECTIVES LEDGER]:\n`;
    directivesContent += `• ROOT USER OBJECTIVE: "${rootGoal || "Execute requested tasks."}"\n`;
    if (userDirectives.length > 0) {
        directivesContent += `• USER STEERING DIRECTIVES (Chronological):\n`;
        userDirectives.forEach((dir, idx) => {
            directivesContent += `  ${idx + 1}. "${dir}"\n`;
        });
    }
    directivesContent += `\n[INVARIANT RULES]:\n`;
    directivesContent += `1. Never deviate from or forget the above user objectives across tool execution cycles.\n`;
    directivesContent += `2. Do not repeatedly re-read the same files in an inspection loop. Once you have inspected the repository or skeleton, proceed directly to implementation (writing missing source files with write_file, compiling, and testing).\n`;

    const directivesMsg = {
        role: "system",
        content: directivesContent
    };

    // 2. Active Roadmap Channel (Todos)
    const todos = extractTodos(msgs, compaction.todos || []);
    let todosMsg = null;
    if (todos.length > 0) {
        let todosContent = `[ACTIVE EXECUTION ROADMAP & TODOS]:\n`;
        todos.forEach(t => {
            const mark = t.status === "completed" ? "[x]" : (t.status === "in_progress" ? "[-]" : "[ ]");
            todosContent += `${mark} ${t.task}\n`;
        });
        todosMsg = { role: "system", content: todosContent.trim() };
    }

    // 3. Compacted Architecture & Historical Checkpoint Briefing
    let briefingContent = `[HISTORICAL CHECKPOINTS & COMPACTED ARCHITECTURE BRIEFING]:\n\n${compaction.summary}`;
    if (compaction.latestArtifactPath) {
        briefingContent += `\n\n[PERMANENT CHECKPOINT ARCHIVE]: Earlier execution turns were archived to ${compaction.latestArtifactPath}. Full raw logs are preserved on disk at messages.jsonl. If deep historical analysis is required, use read_file('${compaction.latestArtifactPath}').`;
    }
    const briefingMsg = {
        role: "system",
        content: briefingContent
    };

    // 4. Safe Active Turns (Rolling Trajectory)
    let startIndex = Math.max(1, compaction.compactedThroughIndex);
    if (startIndex >= msgs.length) {
        const lastUserIdx = msgs.map(m => m.role).lastIndexOf("user");
        startIndex = lastUserIdx >= 1 ? lastUserIdx : Math.max(1, msgs.length - 2);
    }

    while (startIndex < msgs.length && msgs[startIndex]?.role === "tool") {
        startIndex++;
    }

    // Ensure proper OpenAI turn alternation: if starting on assistant, precede with user bridge
    let bridgeUserMsg = null;
    if (startIndex < msgs.length && msgs[startIndex]?.role === "assistant") {
        if (startIndex > 1 && msgs[startIndex - 1]?.role === "user") {
            startIndex = startIndex - 1;
        } else {
            const goalSnippet = rootGoal ? `In response to "${rootGoal}": ` : "";
            bridgeUserMsg = {
                role: "user",
                content: `[CONTINUATION DIRECTIVE]: ${goalSnippet}Please continue executing the next steps from the active roadmap and trajectory below. Do not re-read files you have already inspected; proceed directly to implementing the missing files and code.`
            };
        }
    }

    const rawActiveTurns = msgs.slice(startIndex);

    // Sanitize active turns:
    // - Bound oversized tool outputs (>15,000 chars)
    // - Scrub empty assistant messages
    const safeTurns = [];
    for (const m of rawActiveTurns) {
        if (m.role === "assistant") {
            const hasTools = m.tool_calls && Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
            const contentStr = typeof m.content === "string" ? m.content.trim() : "";
            if (!hasTools && !contentStr) {
                continue; // Skip empty assistant turns
            }
        }
        if (m.role === "tool" && typeof m.content === "string" && m.content.length > 15000) {
            const head = m.content.slice(0, 6000);
            const tail = m.content.slice(-6000);
            const omitted = m.content.length - 12000;
            safeTurns.push({
                ...m,
                content: `${head}\n\n[... OMITTED ${omitted} CHARS OF LARGE TOOL OUTPUT FOR WORKING CONTEXT; FULL CONTENT SAVED ON DISK ...] \n\n${tail}`
            });
            continue;
        }
        safeTurns.push(m);
    }

    const working = [systemMsg, directivesMsg];
    if (todosMsg) working.push(todosMsg);
    working.push(briefingMsg);
    if (bridgeUserMsg) working.push(bridgeUserMsg);
    working.push(...safeTurns);

    return working;
}

export const compileWorkingMessages = compileWorkingContext;
