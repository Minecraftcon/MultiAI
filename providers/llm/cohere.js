// Cohere Provider (v2 Chat API)
const BaseProvider = require("./base");

class CohereProvider extends BaseProvider {
    static id = "cohere";
    static displayName = "Cohere";
    static matchPatterns = [
        /^(cohere|command[-_]?r|command[-_]?a|aya)$/i
    ];

    getEndpoint(config, model, apiKey) {
        const baseUrl = (config.base_url || "https://api.cohere.com/v2").replace(/\/+$/, "");
        return baseUrl.endsWith("/chat") ? baseUrl : `${baseUrl}/chat`;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = true }) {
        const payload = {
            model,
            messages: this.normalizeMessages(messages, supportsTools, supportsVision)
        };

        if (supportsTools && tools && tools.length > 0 && tool_choice !== "none") {
            payload.tools = tools;
        }

        return payload;
    }

    parseResponse(data) {
        const rawMsg = data?.message || {};
        let content = rawMsg.content;
        if (typeof content === "string" && content.trim().startsWith("[")) {
            try {
                content = JSON.parse(content);
            } catch(e) {}
        }

        let text = "";
        if (Array.isArray(content)) {
            const textBlocks = content.filter(b => b.type === "text");
            text = textBlocks.map(b => b.text || "").join("");
            if (!text && content.length > 0) {
                text = content.map(b => b.text || b.thinking || "").join("");
            }
        } else if (typeof content === "string") {
            text = content;
        }

        const toolCalls = (rawMsg.tool_calls || []).map(tc => ({
            id: tc.id || ("call_" + Math.random().toString(36).substring(2, 9)),
            type: "function",
            function: {
                name: tc.function?.name,
                arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {})
            }
        }));

        return {
            message: this.formatAssistantResponse({
                content: text,
                tool_calls: toolCalls
            })
        };
    }
}

module.exports = CohereProvider;
