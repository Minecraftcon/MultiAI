/* =========================================================
   TOOL MODULE ROOT & DISPATCHER
   ========================================================= */
import { state } from "../state/index.js";
import { registerTool, getTool, getAllToolSchemas, hasTool } from "./registry.js";
import { onToolStart, onToolComplete, onToolError } from "./badge-sync.js";
import { terminalTools } from "./terminal/index.js";
import { webTools } from "./web/index.js";
import { mediaTools } from "./media/index.js";

// Register terminal, web, and media tools
terminalTools.forEach(registerTool);
webTools.forEach(registerTool);
mediaTools.forEach(registerTool);

/**
 * Array of all tool schemas provided to LLM chat requests.
 */
export const tools = getAllToolSchemas();

/**
 * Returns strictly isolated on-chat tool schemas for DeepSearch chats.
 */
export function getDeepSearchOnChatTools() {
    const allowed = ["run_task", "manage_tasks", "web_search", "schedule"];
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

    const toolsConfig = state.config?.Tools || {};

    // Check if terminal execution is disabled in config.ini
    const isTerminalTool = name === "run_task" || name === "manage_tasks" || name === "schedule";
    if (toolsConfig.EnableTerminal === false && isTerminalTool) {
        throw new Error("Terminal execution is disabled in config.ini");
    }

    // Check if web search is disabled in config.ini
    const isWebTool = name === "web_search";
    if (toolsConfig.EnableWebSearch === false && isWebTool) {
        throw new Error("Web search is disabled in config.ini");
    }

    // Check if image generation is disabled in config.ini
    const isImageTool = name === "generate_image" || name === "get_image_status";
    if (toolsConfig.EnableImageGeneration === false && isImageTool) {
        throw new Error("Image generation is disabled in config.ini");
    }

    const tool = getTool(name);
    if (!tool) {
        throw new Error("Unknown tool: " + name);
    }

    onToolStart(name, args, badgeEl);

    let data;
    try {
        data = await tool.handler(args, { badgeEl, genState });
    } catch (err) {
        onToolError(name, badgeEl, err);
        throw err;
    }

    onToolComplete(name, args, badgeEl, data);
    return data;
}

export {
    registerTool,
    getTool,
    getAllToolSchemas,
    hasTool,
    onToolStart,
    onToolComplete,
    onToolError
};
