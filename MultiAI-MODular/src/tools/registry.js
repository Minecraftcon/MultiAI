/* =========================================================
   TOOL REGISTRY & DISPATCH ENGINE
   ========================================================= */

const toolRegistry = new Map();

/**
 * Registers a tool definition with its schema and handler.
 * @param {Object} tool
 * @param {string} tool.name
 * @param {Object} tool.schema
 * @param {Function} tool.handler
 */
export function registerTool(tool) {
    if (!tool || !tool.name || typeof tool.handler !== "function") {
        throw new Error(`Invalid tool registration: missing name or handler`);
    }
    toolRegistry.set(tool.name, tool);
}

/**
 * Retrieves a registered tool by name.
 */
export function getTool(name) {
    return toolRegistry.get(name);
}

/**
 * Returns JSON-schema array of all registered tools for the LLM.
 */
export function getAllToolSchemas() {
    const schemas = [];
    for (const tool of toolRegistry.values()) {
        if (tool.schema) {
            schemas.push(tool.schema);
        }
    }
    return schemas;
}

/**
 * Checks if a tool is registered.
 */
export function hasTool(name) {
    return toolRegistry.has(name);
}
