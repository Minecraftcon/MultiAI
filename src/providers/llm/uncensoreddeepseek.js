// Uncensored DeepSeek Provider
// Gateway (https://api.uncensoreddeepseek.com/v1)
const BaseProvider = require("./base");

class UncensoredDeepSeekProvider extends BaseProvider {
    static id = "uncensoreddeepseek";
    static displayName = "Uncensored DeepSeek";
    static matchPatterns = [
        /^(uncensored[-_]?deepseek|uncensored[-_]?ds)$/i,
        "uncensoreddeepseek",
        "uncensored-deepseek",
        "uncensored_deepseek",
        "UncensoredDeepSeek"
    ];

    getEndpoint(config = {}, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "https://api.uncensoreddeepseek.com/v1";
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
        const isVisionModel = Boolean(supportsVision || /uncensored|vision|image/i.test(model));

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

module.exports = UncensoredDeepSeekProvider;
