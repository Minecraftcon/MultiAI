/* =========================================================
   TOOL MODULE ROOT & DISPATCHER
   ========================================================= */
import { state } from "../state/index.js";
import { registerTool, getTool, getAllToolSchemas, hasTool } from "./registry.js";
import { terminalTools } from "./terminal/index.js";
import { filesystemTools } from "./filesystem/index.js";
import { webTools } from "./web/index.js";
import { mediaTools } from "./media/index.js";
import { onToolStart, onToolComplete, onToolError } from "./badge-sync.js";

// Register all domain tool definitions
[...terminalTools, ...filesystemTools, ...webTools, ...mediaTools].forEach(registerTool);

/**
 * Array of all tool schemas provided to LLM chat requests.
 */
export const tools = getAllToolSchemas();

/**
 * Dispatches and executes a tool call with validation, config permission checks,
 * visual badge syncing, and lifecycle management.
 *
 * @param {string} name
 * @param {Object} args
 * @param {HTMLElement|null} badgeEl
 * @param {Object} genState
 * @returns {Promise<any>}
 */
export async function executeTool(name, args, badgeEl, genState) {
    if (genState && genState.abortRequested) {
        throw new Error("Generation stopped by user");
    }

    // Check if tool category is disabled in config.ini
    const toolsConfig = state.config?.Tools || {};
    if (toolsConfig.EnableTerminal === false && (name === "run_task" || name.startsWith("task_") || name === "idle")) {
        throw new Error("Terminal execution is disabled in config.ini");
    }
    if (toolsConfig.EnableWebSearch === false && (name === "web_search" || name === "fetch_web_content" || name === "web_fetch")) {
        throw new Error("Web search is disabled in config.ini");
    }
    if (toolsConfig.EnableImageGeneration === false && name === "generate_image") {
        throw new Error("Image generation is disabled in config.ini");
    }
    if (toolsConfig.EnableFileOperations === false && (name === "read_file" || name === "write_file" || name === "search_and_replace" || name === "grep_search")) {
        throw new Error("File operations are disabled in config.ini");
    }

    const tool = getTool(name);
    if (!tool) {
        throw new Error("Unknown tool: " + name);
    }

    // Initialize visual state on badge (e.g. timers)
    onToolStart(name, args, badgeEl);

    let data;
    try {
        data = await tool.handler(args, { badgeEl, genState });
    } catch (err) {
        onToolError(name, badgeEl);
        throw err;
    }

    // Synchronize UI badge and collapse output
    onToolComplete(name, args, badgeEl, data);

    return data;
}

export {
    registerTool,
    getTool,
    getAllToolSchemas,
    hasTool
};
