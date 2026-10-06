#!/usr/bin/env node
/* =========================================================
   MULTIAI LIVE EXAMPLE MCP SERVER
   Powered by @modelcontextprotocol/sdk (Anthropic standard)
   Demonstrates real-time tool discovery and execution via stdio.
   ========================================================= */
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");

const server = new Server(
    { name: "example-tools", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_current_time",
                description: "Retrieve the current system date, time, timezone, and Unix timestamp",
                inputSchema: {
                    type: "object",
                    properties: {
                        timezone: {
                            type: "string",
                            description: "Optional IANA timezone like 'UTC', 'America/New_York', 'Asia/Kolkata'"
                        }
                    }
                }
            },
            {
                name: "evaluate_math",
                description: "Safely evaluate a mathematical or arithmetic expression",
                inputSchema: {
                    type: "object",
                    properties: {
                        expression: {
                            type: "string",
                            description: "Math expression to evaluate, e.g. '(45 * 12) + 8'"
                        }
                    },
                    required: ["expression"]
                }
            },
            {
                name: "echo_message",
                description: "Echo a test message with optional uppercase or reversed transform",
                inputSchema: {
                    type: "object",
                    properties: {
                        message: {
                            type: "string",
                            description: "Message content to echo back"
                        },
                        transform: {
                            type: "string",
                            enum: ["none", "uppercase", "reverse"],
                            description: "Optional string transformation"
                        }
                    },
                    required: ["message"]
                }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "get_current_time") {
        const now = new Date();
        const tz = args?.timezone;
        let formatted = "";
        try {
            formatted = tz ? now.toLocaleString("en-US", { timeZone: tz }) : now.toLocaleString();
        } catch (_) {
            formatted = now.toLocaleString();
        }

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        local_time: formatted,
                        iso: now.toISOString(),
                        unix: now.getTime(),
                        timezone: tz || Intl.DateTimeFormat().resolvedOptions().timeZone
                    }, null, 2)
                }
            ]
        };
    }

    if (name === "evaluate_math") {
        const expr = String(args?.expression || "").trim();
        // Allow numbers, standard operators, parentheses, and Math functions
        if (!/^[0-9+\-*/().%\s^eMath.sqrtcopsinltagnPIE]+$/.test(expr) || expr.length > 80) {
            return {
                isError: true,
                content: [{ type: "text", text: `Invalid or unsafe math expression: ${expr}` }]
            };
        }

        try {
            const fn = new Function(`return (${expr});`);
            const val = fn();
            return {
                content: [{ type: "text", text: `Result: ${val}` }]
            };
        } catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `Evaluation error: ${err.message}` }]
            };
        }
    }

    if (name === "echo_message") {
        let text = String(args?.message || "");
        if (args?.transform === "uppercase") text = text.toUpperCase();
        if (args?.transform === "reverse") text = text.split("").reverse().join("");

        return {
            content: [
                {
                    type: "text",
                    text: `[MCP Echo Server]: ${text}`
                }
            ]
        };
    }

    throw new Error(`Unknown tool: ${name}`);
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(err => {
    console.error("MCP Server fatal error:", err);
    process.exit(1);
});
