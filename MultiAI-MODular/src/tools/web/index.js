import { toolFetch } from "../http.js";

/* =========================================================
   WEB SEARCH & WEB CONTENT TOOLS
   ========================================================= */

export const webTools = [
    {
        name: "web_search",
        schema: {
            type: "function",
            function: {
                name: "web_search",
                description: "Search the live web for current or external information.",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string" },
                        location: { type: "string" },
                        language: { type: "string" },
                        page: { type: "integer" }
                    },
                    required: ["query"]
                }
            }
        },
        handler: async (args, { genState }) => {
            return await toolFetch("/api/search", { method: "POST", body: args, genState });
        }
    },
    {
        name: "fetch_web_content",
        schema: {
            type: "function",
            function: {
                name: "fetch_web_content",
                description: "Fetch and read the full text/markdown content from one or more web page URLs. Use this when you have specific URLs to inspect, read documentation, articles, or web pages.",
                parameters: {
                    type: "object",
                    properties: {
                        urls: {
                            type: "array",
                            items: { type: "string" },
                            description: "List of HTTP/HTTPS URLs to fetch and read (up to 10 URLs)"
                        },
                        format: {
                            type: "string",
                            enum: ["markdown", "html", "json"],
                            description: "Format of returned content: 'markdown' (default), 'html', or 'json'"
                        }
                    },
                    required: ["urls"]
                }
            }
        },
        handler: async (args, { genState }) => {
            const payload = { ...args };
            if (!payload.urls && payload.url) {
                payload.urls = [payload.url];
            }
            return await toolFetch("/api/fetch", { method: "POST", body: payload, genState });
        }
    },
    {
        name: "web_fetch",
        schema: null, // internal alias
        handler: async (args, { genState }) => {
            const payload = { ...args };
            if (!payload.urls && payload.url) {
                payload.urls = [payload.url];
            }
            return await toolFetch("/api/fetch", { method: "POST", body: payload, genState });
        }
    }
];
