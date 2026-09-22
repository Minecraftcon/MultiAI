// LLM7.io Provider
const BaseProvider = require("./base");

class LLM7Provider extends BaseProvider {
    static id = "llm7";
    static displayName = "LLM7.io";
    static matchPatterns = [
        /^(llm[-_]?7|llm7\.?io)$/i,
        "llm7",
        "llm-7",
        "llm7.io"
    ];

    getEndpoint(config = {}, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "https://api.llm7.io/v1";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }

    getHeaders(apiKey, options = {}) {
        const headers = {
            "Content-Type": "application/json"
        };
        // Supports both free token authenticated and anonymous calls
        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }
        return headers;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false, options = {} }) {
        const isVisionModel = Boolean(supportsVision || /vision|image/i.test(model));

        const payload = super.formatPayload({
            model,
            messages,
            tools,
            tool_choice,
            config,
            supportsTools,
            supportsVision: isVisionModel,
            options
        });

        // Ensure sufficient token budget for reasoning models (e.g. minimax-m2.7, 64k default for non-fixed providers)
        if (!payload.max_tokens && !payload.max_completion_tokens) {
            payload.max_tokens = config.default_max_tokens || 65536;
        }

        return payload;
    }

    parseResponse(data) {
        return super.parseResponse(data);
    }
}

module.exports = LLM7Provider;
