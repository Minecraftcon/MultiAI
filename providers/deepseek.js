// DeepSeek Provider
const BaseProvider = require("./base");

class DeepSeekProvider extends BaseProvider {
    static id = "deepseek";
    static displayName = "DeepSeek";
    static matchPatterns = [
        /^(deep[-_]?seek|deepseek)$/i
    ];

    getEndpoint(config, model, apiKey) {
        const baseUrl = config.base_url || "https://api.deepseek.com";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false }) {
        const isReasoner = model.includes("reasoner") || model.includes("r1");
        const payload = super.formatPayload({
            model,
            messages,
            tools: isReasoner ? [] : tools,
            tool_choice: isReasoner ? undefined : tool_choice,
            config,
            supportsTools: !isReasoner && supportsTools,
            supportsVision
        });

        // DeepSeek Reasoner does not support temperature alteration or tools
        if (isReasoner) {
            delete payload.temperature;
            delete payload.tools;
            delete payload.tool_choice;
        }

        return payload;
    }

    parseResponse(data) {
        const choice = data?.choices?.[0];
        const rawMessage = choice?.message || {};
        // If the model returned thinking in reasoning_content, preserve standard text
        const content = rawMessage.content || "";

        return {
            message: this.formatAssistantResponse({
                content,
                tool_calls: rawMessage.tool_calls
            })
        };
    }
}

module.exports = DeepSeekProvider;
