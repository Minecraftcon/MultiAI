// ExperientialLabs AI Provider (ExpressLabs)
// Unified OpenAI-compatible gateway (https://api.experientiallabs.ai/v1)
const BaseProvider = require("./base");

class ExperientialLabsProvider extends BaseProvider {
    static id = "experientiallabs";
    static displayName = "ExperientialLabs";
    static matchPatterns = [
        /^(experiential[-_]?labs?|express[-_]?labs?|explabs)$/i,
        "experientiallabs",
        "experiential-labs",
        "expresslabs",
        "express-labs",
        "explabs",
        "ExperientialLabs",
        "ExpressLabs"
    ];

    getEndpoint(config = {}, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "https://api.experientiallabs.ai/v1";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }

    getHeaders(apiKey, options = {}) {
        const headers = {
            "Content-Type": "application/json"
        };
        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }
        return headers;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false, options = {} }) {
        const isVisionModel = Boolean(supportsVision || /vision|image|claude|gemini|gpt-4/i.test(model));

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

        if (config.default_max_tokens && !payload.max_tokens && !payload.max_completion_tokens) {
            payload.max_tokens = config.default_max_tokens;
        }

        return payload;
    }

    parseResponse(data) {
        return super.parseResponse(data);
    }
}

module.exports = ExperientialLabsProvider;
