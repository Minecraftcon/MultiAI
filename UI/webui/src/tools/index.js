/* =========================================================
   TOOL MODULE ROOT & DISPATCHER
   ========================================================= */
import { state } from "../state/index.js";
import { registerTool, getTool, getAllToolSchemas, hasTool, normalizeToolName, normalizeToolArguments } from "./registry.js";
import { onToolStart, onToolComplete, onToolError } from "./badge-sync.js";
import { terminalTools } from "./terminal/index.js";
import { webTools } from "./web/index.js";
import { mediaTools } from "./media/index.js";
import { filesystemTools, listDirTool, multiReplaceFileContentTool } from "./filesystem/index.js";
import { planningTools } from "./planning/index.js";
import { designTools } from "./design/index.js";
import { McpActiveTools, listMcpTool, callMcpTool } from "./mcp/index.js";

// Register core agent execution tools: terminal, web, media, filesystem, planning, and on-demand MCP tools
terminalTools.forEach(registerTool);
webTools.forEach(registerTool);
mediaTools.forEach(registerTool);
filesystemTools.forEach(registerTool);
// Register legacy aliases for backward compatibility with older prompts/sessions
registerTool(listDirTool);
registerTool(multiReplaceFileContentTool);
planningTools.forEach(registerTool);
registerTool(listMcpTool);
registerTool(callMcpTool);

/**
 * Array of all tool schemas provided to LLM chat requests.
 */
export const tools = getActiveToolSchemas();

/**
 * Synchronizes the exported tools array in-place when dynamic tools (like MCP) update.
 */
export function syncToolsArray() {
    tools.length = 0;
    tools.push(...getActiveToolSchemas());
    return tools;
}

/**
 * Checks whether an individual tool is enabled in config.
 * Checks both individual toggle (Tools.Enable_<name>) and category toggle.
 */
function isToolEnabled(name, toolsConfig = state.config?.Tools || {}) {
    const canonicalName = normalizeToolName(name);

    // 1. Check granular individual toggle if explicitly set
    const granularKey = `Enable_${canonicalName}`;
    if (toolsConfig[granularKey] === false) return false;
    // Also check alias for ask_questions / ask_question
    if (canonicalName === "ask_question" && toolsConfig.Enable_ask_questions === false) return false;
    if (canonicalName === "ask_questions" && toolsConfig.Enable_ask_question === false) return false;

    // 2. Category level checks
    const isTerminalTool = canonicalName === "run_task" || canonicalName === "manage_tasks" || canonicalName === "schedule";
    if (toolsConfig.EnableTerminal === false && isTerminalTool) return false;

    const isWebTool = canonicalName === "web_search";
    if (toolsConfig.EnableWebSearch === false && isWebTool) return false;

    const isImageTool = canonicalName === "generate_image";
    if (toolsConfig.EnableImageGeneration === false && isImageTool) return false;

    const isFilesystemTool = canonicalName === "list_dir" || canonicalName === "read_file" || canonicalName === "write_file" || canonicalName === "replace_file_content" || canonicalName === "multi_replace_file_content" || canonicalName === "grep_search";
    if (toolsConfig.EnableFilesystem === false && isFilesystemTool) return false;

    const isMcpTool = canonicalName.startsWith("mcp_") || canonicalName === "list_mcp" || canonicalName === "call_mcp";
    if (toolsConfig.EnableMcp === false && isMcpTool) return false;

    return true;
}

/**
 * Returns dynamic tool schemas filtering out tools disabled by configuration.
 */
function getActiveToolSchemas() {
    const toolsConfig = state.config?.Tools || {};
    // Deprecated tools merged into read_file & replace_file_content; omit from exposed active schemas
    const deprecatedTools = new Set(["list_dir", "multi_replace_file_content"]);
    return getAllToolSchemas().filter(schema => {
        const name = schema?.function?.name || "";
        if (deprecatedTools.has(name)) return false;
        if (!isToolEnabled(name, toolsConfig)) return false;
        // In on-demand MCP mode (default), do not expose individual mcp_* tool schemas all at once; expose list_mcp and call_mcp instead
        if (name.startsWith("mcp_") && !toolsConfig.ExposeAllMcpTools) return false;
        return true;
    });
}

// Keep exported tools array synchronized whenever active MCP tools update
McpActiveTools.onChange(() => {
    syncToolsArray();
});

// Initial background sync for active MCP tools in browser environment
if (typeof window !== "undefined") {
    queueMicrotask(() => {
        McpActiveTools.refresh().catch(err => {
            console.warn("[MCP] Initial tools refresh failed:", err.message);
        });
    });
}

/**
 * Returns strictly isolated on-chat tool schemas for DeepSearch chats.
 */
export function getDeepSearchOnChatTools() {
    const allowed = ["run_task", "manage_tasks", "web_search", "schedule", "list_dir", "read_file", "write_file", "replace_file_content", "multi_replace_file_content", "grep_search", "write_todos", "ask_question", "ask_questions"];
    return allowed.map(name => getTool(name)?.schema).filter(Boolean);
}

/**
 * Dispatches and executes a tool call with validation, config permission checks,
 * visual badge syncing, and lifecycle management.
 */
export async function executeTool(name, args, badgeEl, genState) {
    if (genState && genState.abortRequested) {
        throw new Error("Generation stopped by user");
    }

    const canonicalName = normalizeToolName(name);
    const resolvedArgs = normalizeToolArguments(canonicalName, args);
    const toolsConfig = state.config?.Tools || {};

    if (!isToolEnabled(canonicalName, toolsConfig)) {
        throw new Error(`Tool '${canonicalName}' is disabled in configuration`);
    }

    const tool = getTool(canonicalName);

    onToolStart(canonicalName, resolvedArgs, badgeEl);

    let data;
    try {
        data = await tool.handler(resolvedArgs, { badgeEl, genState });
    } catch (err) {
        onToolError(canonicalName, badgeEl, err);
        throw err;
    }

    onToolComplete(canonicalName, resolvedArgs, badgeEl, data);
    return data;
}

export {
    registerTool,
    getTool,
    getAllToolSchemas,
    getActiveToolSchemas,
    isToolEnabled,
    hasTool,
    normalizeToolName,
    normalizeToolArguments,
    onToolStart,
    onToolComplete,
    onToolError,
    McpActiveTools
};
