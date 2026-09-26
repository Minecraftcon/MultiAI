/* =========================================================
   BUILD MODE PRE-DONE VERIFICATION GATE
   Modular validation gate ensuring code changes are verified
   before the agent declares task completion.
   ========================================================= */

const VERIFICATION_COMMAND_REGEX = /\b(test|lint|typecheck|tsc|build|check|verify|jest|pytest|vitest|mocha|cargo\s+test|go\s+test|npm\s+test|npm\s+run\s+(test|build|lint|check))\b/i;

/**
 * Checks if a specific tool execution constitutes a verification action.
 *
 * @param {string} toolName
 * @param {Object} args
 * @returns {boolean}
 */
export function isVerificationToolCall(toolName, args = {}) {
    if (toolName !== "run_task" && toolName !== "run_command") {
        return false;
    }
    const cmd = String(args.command || "");
    const taskName = String(args.task_name || args.name || "");
    return VERIFICATION_COMMAND_REGEX.test(cmd) || VERIFICATION_COMMAND_REGEX.test(taskName);
}

/**
 * Evaluates whether the agentic loop should pause before concluding to demand a verification step.
 *
 * @param {Object} options
 * @param {Object} options.session
 * @param {boolean} options.isBuildMode
 * @param {boolean} options.hasRunVerification
 * @param {number} options.verificationNudgeCount
 * @param {boolean} options.hasRunTools
 * @returns {boolean}
 */
export function shouldTriggerVerification({
    session,
    isBuildMode,
    hasRunVerification,
    verificationNudgeCount,
    hasRunTools
}) {
    if (!isBuildMode || !hasRunTools || hasRunVerification || verificationNudgeCount >= 1) {
        return false;
    }

    const todos = session?.todos;
    if (!Array.isArray(todos) || todos.length === 0) {
        return false;
    }

    // Only trigger if all planned tasks are now marked completed
    const allCompleted = todos.every(t => t.status === "completed");
    return allCompleted;
}

/**
 * Returns the prompt message instructing the agent to run tests/verification.
 *
 * @returns {string}
 */
export function getVerificationPrompt() {
    return `[Build Mode Verification Gate]: All planned implementation tasks have been marked completed. Please run project tests, linters, or syntax checks (via run_task) to verify your changes before delivering your final concluding summary.`;
}
