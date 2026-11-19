/* =========================================================
   TOOL MODULE ROOT & DISPATCHER
   ========================================================= */
import { state } from "../state/index.js";
import { registerTool, getTool, getAllToolSchemas, hasTool, normalizeToolName, normalizeToolArguments } from "./registry.js";
import { onToolStart, onToolComplete, onToolError } from "./badge-sync.js";
import { terminalTools } from "./terminal/index.js";
import { webTools } from "./web/index.js";
import { mediaTools } from "./media/index.js";
import { filesystemTools } from "./filesystem/index.js";
import { planningTools } from "./planning/index.js";
import { designTools } from "./design/index.js";
import { McpActiveTools, listMcpTool, callMcpTool } from "./mcp/index.js";

// Register core agent execution tools: terminal, web, media, filesystem, planning, and on-demand MCP tools
terminalTools.forEach(registerTool);
webTools.forEach(registerTool);
mediaTools.forEach(registerTool);
filesystemTools.forEach(registerTool);
planningTools.forEach(registerTool);
registerTool(listMcpTool);
registerTool(callMcpTool);

/**
 * Array of all tool schemas provided to LLM chat requests.
 */
export const tools = getAllToolSchemas();

/**
 * Synchronizes the exported tools array in-place when dynamic tools (like MCP) update.
 */
export function syncToolsArray() {
    tools.length = 0;
    tools.push(...getActiveToolSchemas());
    return tools;
}

/**
 * Returns dynamic tool schemas filtering out tools disabled by configuration.
 */
function getActiveToolSchemas() {
    const toolsConfig = state.config?.Tools || {};
    return getAllToolSchemas().filter(schema => {
        const name = schema?.function?.name || "";
        if (toolsConfig.EnableTerminal === false && (name === "run_task" || name === "manage_tasks" || name === "schedule")) return false;
        if (toolsConfig.EnableWebSearch === false && name === "web_search") return false;
        if (toolsConfig.EnableImageGeneration === false && name === "generate_image") return false;
        if (toolsConfig.EnableFilesystem === false && (name === "list_dir" || name === "read_file" || name === "write_file" || name === "replace_file_content" || name === "multi_replace_file_content" || name === "grep_search")) return false;
        if (toolsConfig.EnableMcp === false && (name.startsWith("mcp_") || name === "list_mcp" || name === "call_mcp")) return false;
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

    // Check if terminal execution is disabled in config.ini
    const isTerminalTool = canonicalName === "run_task" || canonicalName === "manage_tasks" || canonicalName === "schedule";
    if (toolsConfig.EnableTerminal === false && isTerminalTool) {
        throw new Error("Terminal execution is disabled in config.ini");
    }

    // Check if web search is disabled in config.ini
    const isWebTool = canonicalName === "web_search";
    if (toolsConfig.EnableWebSearch === false && isWebTool) {
        throw new Error("Web search is disabled in config.ini");
    }

    // Check if image generation is disabled in config.ini
    const isImageTool = canonicalName === "generate_image";
    if (toolsConfig.EnableImageGeneration === false && isImageTool) {
        throw new Error("Image generation is disabled in config.ini");
    }

    // Check if filesystem tools are disabled in config.ini
    const isFilesystemTool = canonicalName === "list_dir" || canonicalName === "read_file" || canonicalName === "write_file" || canonicalName === "replace_file_content" || canonicalName === "multi_replace_file_content" || canonicalName === "grep_search";
    if (toolsConfig.EnableFilesystem === false && isFilesystemTool) {
        throw new Error("Filesystem tools are disabled in config.ini");
    }

    const tool = getTool(canonicalName);
    if (!tool) {
        throw new Error("Unknown tool: " + name);
    }

    // Check if MCP tools are disabled in config.ini
    const isMcpTool = canonicalName.startsWith("mcp_") || tool.isMcp;
    if (toolsConfig.EnableMcp === false && isMcpTool) {
        throw new Error("MCP tools are disabled in config.ini");
    }

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
    hasTool,
    normalizeToolName,
    normalizeToolArguments,
    onToolStart,
    onToolComplete,
    onToolError,
    McpActiveTools
};
