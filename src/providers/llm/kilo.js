// Kilo AI Gateway Provider (https://ai-gateway.kilo.ai/api/v1)
// Unified OpenAI-compatible multi-model gateway with free tier auto-routing and frontier models
const BaseProvider = require("./base");

class KiloProvider extends BaseProvider {
    static id = "kilo";
    static displayName = "Kilo AI Gateway";
    static matchPatterns = [
        /^(kilo|kilo[-_]?ai|kilo[-_]?gateway|kilocode)$/i,
        "kilo",
        "kilo-ai",
        "kiloai",
        "kilo-gateway",
        "kilogateway",
        "kilocode"
    ];

    /**
     * Resolves the gateway chat completions endpoint.
     * Default base URL: https://ai-gateway.kilo.ai/api/v1
     */
    getEndpoint(config = {}, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "https://ai-gateway.kilo.ai/api/v1";
        const clean = baseUrl.replace(/\/+$/, "");
        return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
    }

    /**
     * Builds request headers for Kilo AI Gateway.
     * Supports optional KILO_API_KEY / Bearer token (free tier routes function with or without auth).
     */
    getHeaders(apiKey, options = {}) {
        const headers = {
            "Content-Type": "application/json",
            "User-Agent": "MultiAI-Gateway/1.0.0 (Kilo-Provider)"
        };

        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        return headers;
    }

    /**
     * Formats chat payload for Kilo AI Gateway (standard OpenAI format).
     * Cleans model ID prefixes if present.
     */
    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false, options = {} }) {
        const isVisionModel = Boolean(
            supportsVision ||
            /vision|image|claude|gemini|gpt-4|omni|super-vl/i.test(model)
        );

        // Strip provider prefix if passed as "kilo:kilo-auto/free" -> "kilo-auto/free"
        const cleanModel = (model || "").replace(/^(kilo|kilo-ai|kilo-gateway):/i, "") || config.model;

        const payload = super.formatPayload({
            model: cleanModel,
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
}

module.exports = KiloProvider;

