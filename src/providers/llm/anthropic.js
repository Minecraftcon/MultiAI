// Anthropic Claude Provider (Messages API)
const BaseProvider = require("./base");

class AnthropicProvider extends BaseProvider {
    static id = "anthropic";
    static displayName = "Anthropic Claude";
    static matchPatterns = [
        /^(anthropic.*|claude.*)$/i
    ];

    getHeaders(apiKey, options = {}) {
        return {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        };
    }

    getEndpoint(config, model, apiKey) {
        const baseUrl = (config.base_url || config.endpoint || "https://api.anthropic.com/v1").replace(/\/+$/, "");
        return baseUrl.endsWith("/messages") ? baseUrl : `${baseUrl}/messages`;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = true }) {
        let systemPrompt = "";
        const anthropicMessages = [];

        for (const msg of messages || []) {
            if (msg.role === "system") {
                systemPrompt += (systemPrompt ? "\n\n" : "") + (typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
                continue;
            }

            if (msg.role === "user") {
                if (Array.isArray(msg.content)) {
                    const parts = [];
                    for (const part of msg.content) {
                        if (part.type === "text") {
                            parts.push({ type: "text", text: String(part.text || "") });
                        } else if (part.type === "image_url" && part.image_url?.url) {
                            const match = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
                            if (match) {
                                parts.push({
                                    type: "image",
                                    source: {
                                        type: "base64",
                                        media_type: match[1],
                                        data: match[2]
                                    }
                                });
                            }
                        }
                    }
                    anthropicMessages.push({ role: "user", content: parts.length > 0 ? parts : " " });
                } else {
                    anthropicMessages.push({ role: "user", content: typeof msg.content === "string" ? msg.content : String(msg.content || "") });
                }
            } else if (msg.role === "assistant") {
                const parts = [];
                if (msg.content) {
                    parts.push({ type: "text", text: typeof msg.content === "string" ? msg.content : String(msg.content) });
                }
                if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                    for (const tc of msg.tool_calls) {
                        let input = {};
                        try {
                            input = typeof tc.function?.arguments === "string" ? JSON.parse(tc.function.arguments || "{}") : (tc.function?.arguments || {});
                        } catch (e) {
                            input = {};
                        }
                        parts.push({
                            type: "tool_use",
                            id: tc.id,
                            name: tc.function?.name,
                            input
                        });
                    }
                }
                anthropicMessages.push({ role: "assistant", content: parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts });
            } else if (msg.role === "tool") {
                anthropicMessages.push({
                    role: "user",
                    content: [{
                        type: "tool_result",
                        tool_use_id: msg.tool_call_id,
                        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
                    }]
                });
            }
        }

        const payload = {
            model,
            max_tokens: config.default_max_tokens || 4096,
            messages: anthropicMessages
        };

        if (systemPrompt) {
            payload.system = systemPrompt;
        }

        if (supportsTools && tools && tools.length > 0 && tool_choice !== "none") {
            payload.tools = tools.map(t => ({
                name: t.function.name,
                description: t.function.description || "",
                input_schema: t.function.parameters || { type: "object" }
            }));
        }

        return payload;
    }

    parseResponse(data) {
        let text = "";
        const toolCalls = [];

        const content = data?.content || [];
        if (Array.isArray(content)) {
            for (const block of content) {
                if (block.type === "text") {
                    text += block.text;
                } else if (block.type === "tool_use") {
                    toolCalls.push({
                        id: block.id,
                        type: "function",
                        function: {
                            name: block.name,
                            arguments: JSON.stringify(block.input || {})
                        }
                    });
                }
            }
        }

        return {
            message: this.formatAssistantResponse({
                content: text,
                tool_calls: toolCalls
            })
        };
    }
}

module.exports = AnthropicProvider;
