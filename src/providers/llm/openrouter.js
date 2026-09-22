// OpenRouter Provider
const BaseProvider = require("./base");

class OpenRouterProvider extends BaseProvider {
    static id = "openrouter";
    static displayName = "OpenRouter";
    static matchPatterns = [
        /^(open[-_]?router|openrouter)$/i
    ];

    getHeaders(apiKey, options = {}) {
        const headers = super.getHeaders(apiKey, options);
        headers["HTTP-Referer"] = options.referer || "http://localhost:8080";
        headers["X-Title"] = "MultiAI";
        return headers;
    }

    getEndpoint(config, model, apiKey) {
        const baseUrl = config.base_url || "https://openrouter.ai/api/v1";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = true }) {
        const payload = super.formatPayload({
            model,
            messages,
            tools,
            tool_choice,
            config,
            supportsTools,
            supportsVision
        });

        if (config.provider_routing) {
            payload.provider = config.provider_routing;
        }

        return payload;
    }
}

module.exports = OpenRouterProvider;
