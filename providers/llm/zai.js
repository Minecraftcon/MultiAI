// Z.AI (GLM) Provider
const BaseProvider = require("./base");

class ZAIProvider extends BaseProvider {
    static id = "zai";
    static displayName = "Z.AI (GLM)";
    static matchPatterns = [
        /^(z[-_]?ai|zhipu|zhipuai|bigmodel|glm)$/i,
        "zai",
        "z-ai",
        "zhipu",
        "glm"
    ];

    getEndpoint(config = {}, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "https://api.z.ai/api/paas/v4";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false, options = {} }) {
        // Z.AI models like glm-4.5-flash are text-only unless explicitly vision-enabled
        const isVisionModel = Boolean(supportsVision || /vision|4v/i.test(model));

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

        // Ensure sufficient token budget for reasoning models (e.g. glm-4.5-flash) so thinking steps don't truncate output
        if (!payload.max_tokens && !payload.max_completion_tokens) {
            payload.max_tokens = config.default_max_tokens || 4096;
        }

        return payload;
    }

    parseResponse(data) {
        return super.parseResponse(data);
    }
}

module.exports = ZAIProvider;
