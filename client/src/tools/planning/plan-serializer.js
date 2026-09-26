/* =========================================================
   PLAN SERIALIZER & ARTIFACT PERSISTENCE MODULE
   Decoupled serialization for Tasklist markdown documents
   ========================================================= */

/**
 * Formats a list of todo items into a clean markdown document.
 *
 * @param {string} title
 * @param {Array<Object>} todos
 * @returns {string}
 */
export function formatTodosMarkdown(title, todos = []) {
    const total = todos.length;
    const completed = todos.filter(t => t.status === "completed").length;
    const inProgress = todos.filter(t => t.status === "in_progress").length;
    const pending = todos.filter(t => t.status === "pending").length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    let md = `# Task Plan: ${title || "Build Task"}\n\n`;
    md += `> **Progress**: ${completed}/${total} completed (${pct}%) • **Status**: ${completed === total ? "✅ All Completed" : (inProgress > 0 ? "🔄 In Progress" : "⏳ Pending")}\n`;
    md += `> **Last Updated**: ${now}\n\n`;
    md += `## Milestones & Tasks\n\n`;

    todos.forEach((t) => {
        let box = "[ ]";
        let statusBadge = "⏳ Pending";
        if (t.status === "completed") {
            box = "[x]";
            statusBadge = "✅ Completed";
        } else if (t.status === "in_progress") {
            box = "[-]";
            statusBadge = "🔄 In Progress";
        }
        md += `- ${box} **${t.content}** (${statusBadge})\n`;
    });

    md += `\n---\n*Auto-generated plan artifact for MultiAI Build Mode*\n`;
    return md;
}

/**
 * Resolves a clean filename for a plan artifact under $ARTIFACTS/.
 *
 * @param {string} title
 * @returns {string}
 */
export function resolvePlanArtifactPath(title) {
    const cleanName = ((title || "plan")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "plan").slice(0, 28);
    return `$ARTIFACTS/Tasklist-${cleanName}.md`;
}

/**
 * Persists the plan markdown to the server workspace via /api/file/write.
 *
 * @param {string} title
 * @param {Array<Object>} todos
 * @param {string} chatId
 * @param {Function} toolFetch
 * @param {Object} [genState]
 * @returns {Promise<string>} The resolved artifact path
 */
export async function persistPlanArtifact(title, todos, chatId, toolFetch, genState = null) {
    const artifactPath = resolvePlanArtifactPath(title);
    const mdContent = formatTodosMarkdown(title || "Build Task", todos);
    try {
        await toolFetch("/api/file/write", {
            method: "POST",
            body: { path: artifactPath, content: mdContent, chatId },
            genState
        });
    } catch (err) {
        console.warn("[PLAN_SERIALIZER] Could not persist plan artifact:", err.message);
    }
    return artifactPath;
}
