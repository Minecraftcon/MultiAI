/**
 * MultiAI State Machine Shim
 * Re-exports clean dual-layer compaction methods from compactor.js
 */

import {
    shouldCompact,
    estimateMessagesTokens,
    getCompactionThreshold,
    compileWorkingMessages,
    compileWorkingContext,
    compactSessionContext,
    emergencyTrimContext
} from "./compactor.js";

export {
    compileWorkingMessages,
    compileWorkingContext,
    shouldCompact,
    compactSessionContext,
    emergencyTrimContext,
    estimateMessagesTokens,
    getCompactionThreshold
};

export function extractUserDirectives(messages) {
    if (!Array.isArray(messages)) return { rootGoal: "", userDirectives: [] };
    const firstUser = messages.find(m => m.role === "user");
    const rootGoal = typeof firstUser?.content === "string" ? firstUser.content : "";
    return { rootGoal, userDirectives: [] };
}

export function extractTodos() {
    return [];
}

export function microPruneToolOutputs(messages) {
    return messages;
}

export function assessContext(session, options = {}) {
    const working = compileWorkingMessages(session);
    const tokenCount = estimateMessagesTokens(working);
    const threshold = options.threshold || getCompactionThreshold(options.model || session?.model);
    return {
        shouldCompact: shouldCompact(session, options),
        tokenCount,
        threshold
    };
}
