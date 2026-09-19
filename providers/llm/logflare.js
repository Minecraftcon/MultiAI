// Logfare AI Provider
const BaseProvider = require("./base");

class LogflareProvider extends BaseProvider {
    static id = "logflare";
    static displayName = "Logfare AI";
    static matchPatterns = [
        /^(log[-_]?f[l]?a[r]?e|logfare|logflare)$/i,
        "logflare",
        "logfare",
        "logfare.ai"
    ];

    getEndpoint(config = {}, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "https://logfare.ai/v1";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false, options = {} }) {
        // moondream3.1 is vision-capable; other models are text-only unless specified
        const isVisionModel = Boolean(supportsVision || /vision|moondream/i.test(model));

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

        // Ensure sufficient token budget for reasoning models
        if (!payload.max_tokens && !payload.max_completion_tokens) {
            payload.max_tokens = config.default_max_tokens || 8192;
        }

        return payload;
    }

    parseResponse(data) {
        return super.parseResponse(data);
    }
}

module.exports = LogflareProvider;
