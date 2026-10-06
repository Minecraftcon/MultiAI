/* =========================================================
   MCP (MODEL CONTEXT PROTOCOL) HTTP ROUTER
   Handles /api/mcp/* endpoints for server management,
   tool discovery, and tool execution.
   ========================================================= */
const { sendJSON } = require("../utils");
const { mcpManager } = require("../../core/mcp_manager");

async function parseBody(req) {
    let body = "";
    for await (const chunk of req) {
        body += chunk;
    }
    return JSON.parse(body || "{}");
}

async function handleMcpRoute(req, res) {
    const reqUrl = req.url.split("?")[0];

    try {
        // 1. GET /api/mcp/servers - List configured servers & connection status
        if (req.method === "GET" && reqUrl === "/api/mcp/servers") {
            const servers = mcpManager.getServersStatus();
            return sendJSON(res, 200, {
                success: true,
                servers,
                count: servers.length
            });
        }

        // 2. GET /api/mcp/tools - List active tool schemas
        if (req.method === "GET" && reqUrl === "/api/mcp/tools") {
            const schemas = mcpManager.getActiveToolSchemas();
            const activeTools = Array.from(mcpManager.activeTools.values()).map(t => ({
                serverId: t.serverId,
                originalName: t.originalName,
                fullName: t.fullName,
                description: t.description,
                schema: t.schema
            }));
            return sendJSON(res, 200, {
                success: true,
                tools: schemas,
                activeTools,
                count: schemas.length
            });
        }

        // 3. POST /api/mcp/call - Execute an MCP tool
        if (req.method === "POST" && reqUrl === "/api/mcp/call") {
            const data = await parseBody(req);
            const toolName = data.tool || data.name;
            const args = data.args || data.arguments || {};

            if (!toolName) {
                return sendJSON(res, 400, { error: "Missing required parameter 'tool'" });
            }

            const result = await mcpManager.callTool(toolName, args);
            return sendJSON(res, 200, result);
        }

        // 4. POST /api/mcp/servers - Add or update a server config
        if (req.method === "POST" && reqUrl === "/api/mcp/servers") {
            const data = await parseBody(req);
            const id = data.id || data.name;

            if (!id) {
                return sendJSON(res, 400, { error: "Missing server id or name" });
            }

            const serverConfig = {
                command: data.command,
                args: data.args || [],
                env: data.env || {},
                cwd: data.cwd,
                url: data.url,
                transport: data.transport || (data.url ? "sse" : "stdio"),
                enabled: data.enabled !== false
            };

            const entry = await mcpManager.addOrUpdateServer(id, serverConfig);
            return sendJSON(res, 200, {
                success: true,
                server: {
                    id,
                    status: entry.status,
                    error: entry.error,
                    toolCount: (entry.tools || []).length
                }
            });
        }

        // 5. POST /api/mcp/servers/:id/toggle
        if (req.method === "POST" && reqUrl.match(/^\/api\/mcp\/servers\/([^/]+)\/toggle$/)) {
            const id = decodeURIComponent(reqUrl.match(/^\/api\/mcp\/servers\/([^/]+)\/toggle$/)[1]);
            const data = await parseBody(req).catch(() => ({}));
            const entry = await mcpManager.toggleServer(id, data.enabled);
            return sendJSON(res, 200, {
                success: true,
                server: {
                    id,
                    status: entry.status,
                    enabled: entry.config?.enabled !== false,
                    toolCount: (entry.tools || []).length
                }
            });
        }

        // 6. POST /api/mcp/servers/:id/restart
        if (req.method === "POST" && reqUrl.match(/^\/api\/mcp\/servers\/([^/]+)\/restart$/)) {
            const id = decodeURIComponent(reqUrl.match(/^\/api\/mcp\/servers\/([^/]+)\/restart$/)[1]);
            const entry = await mcpManager.restartServer(id);
            return sendJSON(res, 200, {
                success: true,
                server: {
                    id,
                    status: entry.status,
                    toolCount: (entry.tools || []).length
                }
            });
        }

        // 7. DELETE /api/mcp/servers/:id
        if (req.method === "DELETE" && reqUrl.match(/^\/api\/mcp\/servers\/([^/]+)$/)) {
            const id = decodeURIComponent(reqUrl.match(/^\/api\/mcp\/servers\/([^/]+)$/)[1]);
            await mcpManager.removeServer(id);
            return sendJSON(res, 200, { success: true, removed: id });
        }

        return sendJSON(res, 404, { error: "MCP endpoint not found" });
    } catch (err) {
        console.error("[MCP ROUTE ERROR]", err);
        return sendJSON(res, 500, { error: err.message || "Internal MCP server error" });
    }
}

module.exports = {
    handleMcpRoute
};
