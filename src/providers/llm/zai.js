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

    /**
     * Resolves the maximum context input token budget for GLM models.
     * GLM-4.5-Flash has a 65,536 token context window (~55,000 token safe input budget).
     * GLM-4.7, GLM-5.3-Flash, GLM-4.5 have 128,000 - 200,000 token windows (~110,000 token safe budget).
     */
    getMaxContextTokens(model = "", config = {}, options = {}) {
        if (options && options.maxContextTokens) return options.maxContextTokens;
        if (config && config.max_context_tokens) return config.max_context_tokens;

        if (/4\.5[-_]?flash/i.test(model)) {
            return 55000;
        }
        return 110000;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false, options = {} }) {
        // Z.AI models like glm-4.5-flash are text-only unless explicitly vision-enabled
        const isVisionModel = Boolean(supportsVision || /vision|4v/i.test(model));
        const maxContextTokens = this.getMaxContextTokens(model, config, options);

        const payload = super.formatPayload({
            model,
            messages,
            tools,
            tool_choice,
            config,
            supportsTools,
            supportsVision: isVisionModel,
            options: { ...options, maxContextTokens }
        });

        // Ensure sufficient token budget for reasoning models (e.g. glm-4.5-flash) so thinking steps don't truncate output (64k default for non-fixed providers)
        if (!payload.max_tokens && !payload.max_completion_tokens) {
            payload.max_tokens = config.default_max_tokens || 65536;
        }

        return payload;
    }

    parseResponse(data) {
        return super.parseResponse(data);
    }
}

module.exports = ZAIProvider;
