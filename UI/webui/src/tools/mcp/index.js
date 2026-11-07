/* =========================================================
   MCP (MODEL CONTEXT PROTOCOL) ACTIVE TOOLS
   Powered by Anthropic Model Context Protocol (@modelcontextprotocol/sdk)
   Manages client-side active MCP tools, synchronization with the
   backend MCP manager, and auto-registration into the tool registry.
   ========================================================= */
import { toolFetch } from "../http.js";
import { registerTool, unregisterTool } from "../registry.js";

/**
 * Manages active Model Context Protocol (MCP) tools discovered from servers.
 */
export class McpActiveToolsManager {
    constructor() {
        this.registeredToolNames = new Set();
        this.tools = [];
        this.isFetching = false;
        this.lastSynced = null;
        this.listeners = new Set();
    }

    /**
     * Subscribes to tools update events.
     */
    onChange(fn) {
        if (typeof fn === "function") {
            this.listeners.add(fn);
        }
        return () => this.listeners.delete(fn);
    }

    _notify() {
        for (const fn of this.listeners) {
            try {
                fn(this.tools);
            } catch (_) {}
        }
    }

    /**
     * Refreshes active MCP tools from backend /api/mcp/tools
     * and synchronizes them with the MultiAI tool registry.
     */
    async refresh() {
        if (this.isFetching) return this.tools;
        if (typeof window === "undefined" && typeof globalThis?.window === "undefined") {
            return this.tools;
        }
        this.isFetching = true;

        try {
            const data = await toolFetch("/api/mcp/tools", { method: "GET" });
            const activeToolsList = (data && data.activeTools) ? data.activeTools : [];

            // Identify and unregister obsolete tools
            const newNames = new Set(activeToolsList.map(t => t.fullName));
            for (const oldName of this.registeredToolNames) {
                if (!newNames.has(oldName)) {
                    unregisterTool(oldName);
                    this.registeredToolNames.delete(oldName);
                }
            }

            // Register newly discovered or updated MCP tools
            this.tools = [];
            for (const item of activeToolsList) {
                const toolDef = {
                    name: item.fullName,
                    schema: item.schema,
                    isMcp: true,
                    serverId: item.serverId,
                    originalName: item.originalName,
                    handler: async (args, context) => {
                        return await this.callTool(item.fullName, args);
                    }
                };

                registerTool(toolDef);
                this.registeredToolNames.add(item.fullName);
                this.tools.push(toolDef);
            }

            this.lastSynced = Date.now();
            this._notify();
            return this.tools;
        } catch (err) {
            console.warn("[MCP] Active tools refresh failed:", err.message);
            return this.tools;
        } finally {
            this.isFetching = false;
        }
    }

    /**
     * Executes an MCP tool via the server backend /api/mcp/call.
     */
    async callTool(toolName, args = {}) {
        return await toolFetch("/api/mcp/call", {
            method: "POST",
            body: {
                tool: toolName,
                args: args || {}
            }
        });
    }

    /**
     * Returns array of current active MCP tool definitions.
     */
    getActiveTools() {
        return this.tools;
    }

    /**
     * Returns JSON schemas for active MCP tools.
     */
    getSchemas() {
        return this.tools.map(t => t.schema).filter(Boolean);
    }

    /**
     * Fetches current MCP servers status.
     */
    async getServers() {
        try {
            const data = await toolFetch("/api/mcp/servers", { method: "GET" });
            return (data && data.servers) ? data.servers : [];
        } catch (err) {
            console.warn("[MCP] Failed to fetch servers:", err.message);
            return [];
        }
    }
}

// Singleton instance
export const McpActiveTools = new McpActiveToolsManager();

// Also expose manager class on instance for polymorphic usage
McpActiveTools.McpActiveTools = McpActiveToolsManager;
