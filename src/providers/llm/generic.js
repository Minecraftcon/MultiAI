// GenericProvider: Universal OpenAI-compatible gateway for standard providers
// Handles all OpenAI-compatible endpoints configured in models.yaml (NVIDIA NIM, TokenHarbor, LLM7, ArliAI,
// ExperientialLabs, Logflare, Uncensored DeepSeek, OmniRoute, OpenAI, etc.)
// No custom provider .js file is needed — simply configure base_url and api_key_env in models.yaml.
const BaseProvider = require("./base");

class GenericProvider extends BaseProvider {
    static id = "generic";
    static displayName = "OpenAI-Compatible Generic";
    static matchPatterns = [
        /^(generic|default|openai[-_]?compatible|custom|other|api)$/i,
        /^(nvidia|nvidia[-_]?nim|nim)$/i,
        /^(token[-_]?harbou?r|th)$/i,
        /^(uncensored[-_]?deepseek|uncensored[-_]?ds)$/i,
        /^(experiential[-_]?labs?|express[-_]?labs?|explabs)$/i,
        /^(llm7|llm7[-_]?io)$/i,
        /^(logflare|logfare)$/i,
        /^(omniroute|omni[-_]?route)$/i,
        /^(arli[-_]?ai|arli)$/i,
        /^(openai|oai)$/i
    ];

    getEndpoint(config = {}, model, apiKey) {
        if (config.endpoint) return config.endpoint;
        const baseUrl = config.base_url || config.api_base || "https://api.openai.com/v1";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }

    getHeaders(apiKey, options = {}) {
        const headers = super.getHeaders(apiKey, options);
        // Add optional custom headers defined in models.yaml
        if (options.providerConfig?.headers && typeof options.providerConfig.headers === "object") {
            Object.assign(headers, options.providerConfig.headers);
        }
        return headers;
    }

    formatPayload(options = {}) {
        const isVisionModel = Boolean(
            options.supportsVision || 
            (options.model && /vision|image|vl/i.test(options.model))
        );

        const payload = super.formatPayload({
            ...options,
            supportsVision: isVisionModel
        });

        // Apply default max tokens if specified in provider config or model options
        const defaultMaxTokens = options.config?.default_max_tokens || options.options?.default_max_tokens;
        if (defaultMaxTokens && !payload.max_tokens && !payload.max_completion_tokens) {
            payload.max_tokens = defaultMaxTokens;
        }

        return payload;
    }
}

module.exports = GenericProvider;
