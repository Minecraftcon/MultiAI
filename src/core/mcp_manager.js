/* =========================================================
   MCP (MODEL CONTEXT PROTOCOL) MANAGER
   Powered by @modelcontextprotocol/sdk (Anthropic)
   Manages Stdio and SSE MCP server processes, tool discovery,
   and tool execution across MultiAI.
   ========================================================= */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { SSEClientTransport } = require("@modelcontextprotocol/sdk/client/sse.js");

class McpManager {
    constructor() {
        this.configPath = this._resolveConfigPath();
        this.servers = new Map(); // serverId -> { config, client, transport, status, error, tools }
        this.activeTools = new Map(); // fullToolName -> { serverId, originalName, schema, tool }
        this.initialized = false;
    }

    _resolveConfigPath() {
        const homeDir = os.homedir();
        const primary = path.join(homeDir, ".MultiAI", "mcp_servers.json");
        const secondary = path.join(process.cwd(), "mcp_config.json");

        if (fs.existsSync(primary)) return primary;
        if (fs.existsSync(secondary)) return secondary;

        // Ensure ~/.MultiAI directory exists for primary
        const primaryDir = path.dirname(primary);
        try {
            if (!fs.existsSync(primaryDir)) {
                fs.mkdirSync(primaryDir, { recursive: true });
            }
        } catch (_) {}

        return primary;
    }

    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = fs.readFileSync(this.configPath, "utf-8");
                const data = JSON.parse(raw);
                return data.mcpServers || data.servers || {};
            }
        } catch (err) {
            console.error(`[MCP] Failed to read config from ${this.configPath}:`, err.message);
        }
        return {};
    }

    saveConfig(serversConfig) {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.configPath, JSON.stringify({ mcpServers: serversConfig }, null, 2), "utf-8");
            return true;
        } catch (err) {
            console.error(`[MCP] Failed to save config to ${this.configPath}:`, err.message);
            return false;
        }
    }

    async init() {
        if (this.initialized) return;
        this.initialized = true;
        const config = this.loadConfig();
        const serverIds = Object.keys(config);
        console.log(`[MCP] Initializing ${serverIds.length} configured MCP server(s)...`);

        for (const [id, srvConfig] of Object.entries(config)) {
            if (srvConfig.enabled !== false) {
                await this.startServer(id, srvConfig).catch(err => {
                    console.warn(`[MCP] Failed to start server '${id}':`, err.message);
                });
            } else {
                this.servers.set(id, {
                    config: srvConfig,
                    client: null,
                    transport: null,
                    status: "disabled",
                    error: null,
                    tools: []
                });
            }
        }
    }

    async startServer(id, srvConfig) {
        await this.stopServer(id);

        const serverEntry = {
            config: srvConfig,
            client: null,
            transport: null,
            status: "starting",
            error: null,
            tools: []
        };
        this.servers.set(id, serverEntry);

        try {
            const client = new Client(
                { name: `MultiAI-MCP-Client`, version: "1.0.0" },
                { capabilities: { tools: {} } }
            );

            let transport;
            if (srvConfig.url || srvConfig.transport === "sse") {
                const sseUrl = new URL(srvConfig.url);
                transport = new SSEClientTransport(sseUrl);
            } else {
                const command = srvConfig.command;
                const args = Array.isArray(srvConfig.args) ? srvConfig.args : [];
                const env = { ...process.env, ...(srvConfig.env || {}) };
                const cwd = srvConfig.cwd || process.cwd();

                transport = new StdioClientTransport({
                    command,
                    args,
                    env,
                    cwd,
                    stderr: "inherit"
                });
            }

            serverEntry.client = client;
            serverEntry.transport = transport;

            await client.connect(transport);
            serverEntry.status = "connected";

            // Discover tools
            await this.refreshServerTools(id);
            console.log(`[MCP] Server '${id}' connected successfully with ${serverEntry.tools.length} tool(s).`);
            return serverEntry;
        } catch (err) {
            serverEntry.status = "error";
            serverEntry.error = err.message;
            console.error(`[MCP] Error connecting to server '${id}':`, err.message);
            throw err;
        }
    }

    async refreshServerTools(id) {
        const serverEntry = this.servers.get(id);
        if (!serverEntry || !serverEntry.client || serverEntry.status !== "connected") {
            return [];
        }

        try {
            const result = await serverEntry.client.listTools();
            const rawTools = result?.tools || [];

            // Remove old tools from activeTools for this server
            for (const [fullKey, toolMeta] of Array.from(this.activeTools.entries())) {
                if (toolMeta.serverId === id) {
                    this.activeTools.delete(fullKey);
                }
            }

            serverEntry.tools = rawTools.map(t => {
                const safeServerId = id.replace(/[^a-zA-Z0-9]/g, "_");
                const safeToolName = t.name.replace(/[^a-zA-Z0-9]/g, "_");
                const fullName = `mcp_${safeServerId}_${safeToolName}`;

                // Construct standard JSON schema for function calling
                const schema = {
                    type: "function",
                    function: {
                        name: fullName,
                        description: `[MCP: ${id}] ${t.description || "MCP tool execution"}`,
                        parameters: t.inputSchema || { type: "object", properties: {} }
                    }
                };

                this.activeTools.set(fullName, {
                    serverId: id,
                    originalName: t.name,
                    fullName,
                    description: t.description || "",
                    inputSchema: t.inputSchema || {},
                    schema
                });

                return {
                    originalName: t.name,
                    fullName,
                    description: t.description,
                    inputSchema: t.inputSchema,
                    schema
                };
            });

            return serverEntry.tools;
        } catch (err) {
            console.warn(`[MCP] Failed to list tools for server '${id}':`, err.message);
            return [];
        }
    }

    async stopServer(id) {
        const serverEntry = this.servers.get(id);
        if (!serverEntry) return;

        // Remove tools from registry
        for (const [fullKey, toolMeta] of Array.from(this.activeTools.entries())) {
            if (toolMeta.serverId === id) {
                this.activeTools.delete(fullKey);
            }
        }

        try {
            if (serverEntry.client) {
                await serverEntry.client.close();
            }
        } catch (_) {}

        serverEntry.status = "stopped";
        serverEntry.tools = [];
    }

    async stopAll() {
        for (const id of this.servers.keys()) {
            await this.stopServer(id);
        }
    }

    async addOrUpdateServer(id, serverConfig) {
        const config = this.loadConfig();
        config[id] = serverConfig;
        this.saveConfig(config);
        if (serverConfig.enabled !== false) {
            return await this.startServer(id, serverConfig);
        } else {
            await this.stopServer(id);
            this.servers.set(id, {
                config: serverConfig,
                client: null,
                transport: null,
                status: "disabled",
                error: null,
                tools: []
            });
            return this.servers.get(id);
        }
    }

    async toggleServer(id, enable) {
        const config = this.loadConfig();
        const serverConfig = config[id] || (this.servers.get(id)?.config);
        if (!serverConfig) {
            throw new Error(`Server '${id}' not found in configuration.`);
        }
        const shouldEnable = enable !== undefined ? Boolean(enable) : (serverConfig.enabled === false);
        serverConfig.enabled = shouldEnable;
        config[id] = serverConfig;
        this.saveConfig(config);

        if (shouldEnable) {
            return await this.startServer(id, serverConfig);
        } else {
            await this.stopServer(id);
            this.servers.set(id, {
                config: serverConfig,
                client: null,
                transport: null,
                status: "disabled",
                error: null,
                tools: []
            });
            return this.servers.get(id);
        }
    }

    async removeServer(id) {
        await this.stopServer(id);
        this.servers.delete(id);
        const config = this.loadConfig();
        delete config[id];
        this.saveConfig(config);
        return true;
    }

    async restartServer(id) {
        const config = this.loadConfig();
        const serverConfig = config[id] || (this.servers.get(id)?.config);
        if (!serverConfig) {
            throw new Error(`Server '${id}' not found in configuration.`);
        }
        await this.stopServer(id);
        return await this.startServer(id, serverConfig);
    }

    async callTool(toolIdentifier, args = {}) {
        let meta = this.activeTools.get(toolIdentifier);

        // If not found by full name, look up by original name or prefix
        if (!meta) {
            for (const item of this.activeTools.values()) {
                if (item.originalName === toolIdentifier || item.fullName === toolIdentifier) {
                    meta = item;
                    break;
                }
            }
        }

        if (!meta) {
            throw new Error(`MCP Tool '${toolIdentifier}' not found in active registry.`);
        }

        const serverEntry = this.servers.get(meta.serverId);
        if (!serverEntry || !serverEntry.client || serverEntry.status !== "connected") {
            throw new Error(`MCP Server '${meta.serverId}' is not connected.`);
        }

        try {
            const res = await serverEntry.client.callTool({
                name: meta.originalName,
                arguments: args || {}
            });

            // Parse response content (text, image, resource, or structured error)
            const content = res.content || [];
            let textOutput = "";
            let isError = Boolean(res.isError);

            for (const part of content) {
                if (part.type === "text") {
                    textOutput += (textOutput ? "\n" : "") + part.text;
                } else if (part.type === "image") {
                    textOutput += `\n[Image output: ${part.mimeType || "image"}]`;
                } else if (part.type === "resource") {
                    textOutput += `\n[Resource: ${part.resource?.uri || "unknown"}]`;
                }
            }

            return {
                status: isError ? "error" : "success",
                server: meta.serverId,
                tool: meta.originalName,
                output: textOutput || (isError ? "Tool reported an error" : "Tool executed successfully"),
                raw: res
            };
        } catch (err) {
            return {
                status: "error",
                server: meta.serverId,
                tool: meta.originalName,
                error: err.message
            };
        }
    }

    getActiveToolSchemas() {
        return Array.from(this.activeTools.values()).map(t => t.schema);
    }

    getServersStatus() {
        const list = [];
        for (const [id, entry] of this.servers.entries()) {
            list.push({
                id,
                command: entry.config.command,
                args: entry.config.args,
                url: entry.config.url,
                enabled: entry.config.enabled !== false,
                status: entry.status,
                error: entry.error,
                toolCount: (entry.tools || []).length,
                tools: (entry.tools || []).map(t => ({
                    name: t.originalName,
                    fullName: t.fullName,
                    description: t.description
                }))
            });
        }
        return list;
    }
}

// Global singleton instance
const mcpManager = new McpManager();

module.exports = {
    McpManager,
    mcpManager
};
