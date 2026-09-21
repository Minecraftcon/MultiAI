// OmniRoute Provider
// Connects to local or remote OmniRoute AI Gateway instances (default: http://localhost:20128/v1)
// Supports keyless providers, BYOK routing, auto-fallbacks, and standard OpenAI schema.
const BaseProvider = require("./base");

class OmniRouteProvider extends BaseProvider {
    static id = "omniroute";
    static displayName = "OmniRoute (Local Gateway)";
    static matchPatterns = [
        /^(omni[-_]?route|omni)$/i,
        "omniroute",
        "omni-route",
        "omni",
        "OmniRoute"
    ];

    getEndpoint(config = {}, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "http://localhost:20128/v1";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }

    getHeaders(apiKey, options = {}) {
        const headers = {
            "Content-Type": "application/json"
        };
        // OmniRoute accepts any token or user-configured master key
        headers["Authorization"] = `Bearer ${apiKey || "omniroute"}`;
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

module.exports = OmniRouteProvider;
