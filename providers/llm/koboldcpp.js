// KoboldCPP Local LLM Provider
// Wraps KoboldCPP's OpenAI-compatible /api/v1/chat/completions endpoint.
// No API key required. base_url is discovered at runtime via the rolling flow.
const BaseProvider = require("./base");

class KoboldCPPProvider extends BaseProvider {
    static id = "koboldcpp";
    static displayName = "KoboldCPP (Local)";
    static matchPatterns = [
        /^(kobold[-_]?cpp|kobold|kcpp)$/i,
        "koboldcpp",
        "kobold-cpp",
        "kcpp"
    ];

    getEndpoint(config = {}, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "http://localhost:5001";
        const clean = baseUrl.replace(/\/+$/, "");
        // KoboldCPP OpenAI-compat endpoint
        return `${clean}/api/v1/chat/completions`;
    }

    getHeaders(apiKey, options = {}) {
        // KoboldCPP doesn't require auth — no Authorization header
        return {
            "Content-Type": "application/json"
        };
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = false, supportsVision = false, options = {} }) {
        const payload = super.formatPayload({
            model,
            messages,
            tools,
            tool_choice,
            config,
            // KoboldCPP does NOT reliably support function calling tool schemas
            supportsTools: false,
            supportsVision: false,
            options
        });

        // KoboldCPP uses its own max_context_length — omit max_tokens if not set
        // to avoid overriding the server's loaded context window
        if (!config.max_tokens && !options.max_tokens) {
            delete payload.max_tokens;
        }

        // Strip unsupported fields KoboldCPP ignores or errors on
        delete payload.tool_choice;
        delete payload.tools;

        return payload;
    }

    parseResponse(data) {
        return super.parseResponse(data);
    }
}

module.exports = KoboldCPPProvider;
