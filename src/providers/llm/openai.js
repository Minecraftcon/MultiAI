// Native OpenAI Provider
const BaseProvider = require("./base");

class OpenAIProvider extends BaseProvider {
    static id = "openai";
    static displayName = "OpenAI";
    static matchPatterns = [
        /^(open[-_]?ai|chatgpt|gpt)$/i
    ];

    getEndpoint(config, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "https://api.openai.com/v1";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = true }) {
        const payload = {
            model,
            messages: this.normalizeMessages(messages, supportsTools, supportsVision)
        };

        // Newer reasoning models (o1, o3-mini, etc.) use max_completion_tokens
        const isReasoningModel = model.startsWith("o1") || model.startsWith("o3");
        if (config.default_max_tokens) {
            if (isReasoningModel) {
                payload.max_completion_tokens = config.default_max_tokens;
            } else {
                payload.max_tokens = config.default_max_tokens;
            }
        }

        if (supportsTools && tools && tools.length > 0 && tool_choice !== "none" && !isReasoningModel) {
            payload.tools = tools;
            if (tool_choice) payload.tool_choice = tool_choice;
        }

        return payload;
    }
}

module.exports = OpenAIProvider;
