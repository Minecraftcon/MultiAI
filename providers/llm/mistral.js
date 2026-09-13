// Mistral AI Provider
const BaseProvider = require("./base");

class MistralProvider extends BaseProvider {
    static id = "mistral";
    static displayName = "Mistral AI";
    static matchPatterns = [
        /^(mistral|mistral[-_]?ai|codestral)$/i
    ];

    getEndpoint(config, model, apiKey) {
        const baseUrl = config.base_url || "https://api.mistral.ai/v1";
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

        if (config.safe_prompt !== undefined) {
            payload.safe_prompt = config.safe_prompt;
        }

        return payload;
    }
}

module.exports = MistralProvider;
