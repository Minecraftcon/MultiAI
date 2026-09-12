// Groq Cloud Provider (OpenAI Compatible)
const BaseProvider = require("./base");

class GroqProvider extends BaseProvider {
    static id = "groq";
    static displayName = "Groq Cloud";
    static matchPatterns = [
        /^(groq|groq[-_]?cloud)$/i
    ];

    getEndpoint(config, model, apiKey) {
        const baseUrl = config.base_url || "https://api.groq.com/openai/v1";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false }) {
        const payload = super.formatPayload({
            model,
            messages,
            tools,
            tool_choice,
            config,
            supportsTools,
            supportsVision
        });

        // Ensure default_max_tokens is applied for Groq's fast inference
        if (!payload.max_tokens && config.default_max_tokens) {
            payload.max_tokens = config.default_max_tokens;
        }

        return payload;
    }
}

module.exports = GroqProvider;
