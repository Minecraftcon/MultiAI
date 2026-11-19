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
        this.servers = [];
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
            try {
                this.servers = await this.getServers();
            } catch (_) {}
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

/**
 * list_mcp: On-demand discovery of connected Model Context Protocol (MCP) servers and tools.
 */
export const listMcpTool = {
    name: "list_mcp",
    schema: {
        type: "function",
        function: {
            name: "list_mcp",
            description: "Discover connected Model Context Protocol (MCP) servers and their available tools. Call with no arguments to list all servers and tool summaries, or provide 'server' to inspect complete parameter schemas for a server's tools.",
            parameters: {
                type: "object",
                properties: {
                    server: {
                        type: "string",
                        description: "Optional ID or name of an MCP server (e.g. 'example-tools', 'github') to inspect its tools and parameters."
                    }
                }
            }
        }
    },
    handler: async (args = {}) => {
        const targetServer = (args?.server || args?.serverId || args?.name || "").trim();
        const activeTools = McpActiveTools.getActiveTools();
        let servers = McpActiveTools.servers;
        if (!servers || servers.length === 0) {
            servers = await McpActiveTools.getServers();
            McpActiveTools.servers = servers;
        }

        if (targetServer) {
            const matchedServer = servers.find(s => (s.id || "").toLowerCase() === targetServer.toLowerCase()) || { id: targetServer, status: "unknown" };
            const serverTools = activeTools.filter(t => 
                (t.serverId || "").toLowerCase() === targetServer.toLowerCase() || 
                (t.name || "").toLowerCase().startsWith(`mcp_${targetServer.toLowerCase()}_`)
            );

            if (serverTools.length === 0) {
                const availableServerIds = servers.map(s => s.id).filter(Boolean);
                return {
                    status: "not_found",
                    server: targetServer,
                    message: `No active tools found for MCP server '${targetServer}'.`,
                    connected_servers: availableServerIds
                };
            }

            return {
                status: "success",
                server: matchedServer.id || targetServer,
                server_status: matchedServer.status || "connected",
                tool_count: serverTools.length,
                tools: serverTools.map(t => ({
                    name: t.originalName || t.name.replace(/^mcp_[^_]+_/, ""),
                    fullName: t.name,
                    description: t.schema?.function?.description || t.description || "",
                    parameters: t.schema?.function?.parameters || { type: "object", properties: {} }
                })),
                usage: `Call call_mcp(tool: "<name>", args: {...}) to execute any of these tools.`
            };
        }

        // List all connected servers with tool summaries
        const serverSummaries = (servers.length > 0 ? servers : []).map(s => {
            const sTools = activeTools.filter(t => (t.serverId || "").toLowerCase() === (s.id || "").toLowerCase());
            const toolNames = sTools.length > 0 
                ? sTools.map(t => t.originalName || t.name.replace(/^mcp_[^_]+_/, ""))
                : (s.tools || []).map(t => t.originalName || t.name || t);
            return {
                id: s.id,
                status: s.status,
                tool_count: sTools.length || toolNames.length,
                tools: toolNames
            };
        });

        return {
            status: "success",
            server_count: servers.length,
            servers: serverSummaries,
            usage: "Call list_mcp(server: '<server_id>') to see full parameter schemas for a server, or call_mcp(tool: '<tool_name>', args: {...}) to execute."
        };
    }
};

/**
 * call_mcp: On-demand execution of an MCP tool.
 */
export const callMcpTool = {
    name: "call_mcp",
    schema: {
        type: "function",
        function: {
            name: "call_mcp",
            description: "Execute a tool from a connected Model Context Protocol (MCP) server discovered via list_mcp.",
            parameters: {
                type: "object",
                properties: {
                    tool: {
                        type: "string",
                        description: "The name of the MCP tool to execute (e.g. 'get_current_time' or 'mcp_example-tools_get_current_time')."
                    },
                    server: {
                        type: "string",
                        description: "Optional server ID if the tool name is ambiguous across multiple servers."
                    },
                    args: {
                        type: "object",
                        description: "Arguments/parameters to pass to the MCP tool."
                    }
                },
                required: ["tool"]
            }
        }
    },
    handler: async (args = {}) => {
        const toolName = (args?.tool || args?.name || "").trim();
        const serverId = (args?.server || args?.serverId || "").trim();
        const toolArgs = args?.args || args?.arguments || {};

        if (!toolName) {
            throw new Error("Missing required parameter 'tool' for call_mcp.");
        }

        let targetIdentifier = toolName;
        if (!targetIdentifier.startsWith("mcp_") && serverId) {
            targetIdentifier = `mcp_${serverId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}_${toolName.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
        }

        return await McpActiveTools.callTool(targetIdentifier, toolArgs);
    }
};
