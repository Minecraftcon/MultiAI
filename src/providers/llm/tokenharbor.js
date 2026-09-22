// Token Harbor Provider
// Unified OpenAI-compatible gateway (https://tokenharbor.ai/v1)
const BaseProvider = require("./base");

class TokenHarborProvider extends BaseProvider {
    static id = "tokenharbor";
    static displayName = "Token Harbor";
    static matchPatterns = [
        /^(token[-_]?harbou?r|th)$/i,
        "tokenharbor",
        "tokenharbour",
        "token-harbor",
        "token-harbour",
        "Token Harbor",
        "Token Harbour",
        "th"
    ];

    getEndpoint(config = {}, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "https://tokenharbor.ai/v1";
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

        if (config.default_max_tokens && !payload.max_tokens) {
            payload.max_tokens = config.default_max_tokens;
        }

        return payload;
    }

    parseResponse(data) {
        return super.parseResponse(data);
    }
}

module.exports = TokenHarborProvider;
