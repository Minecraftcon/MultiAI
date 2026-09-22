// GenericProvider: Universal OpenAI-compatible fallback for unrecognized providers
const BaseProvider = require("./base");

class GenericProvider extends BaseProvider {
    static id = "generic";
    static displayName = "OpenAI-Compatible Generic";
    static matchPatterns = [
        /^(generic|default|openai[-_]?compatible|custom|other|api)$/i
    ];

    getEndpoint(config, model, apiKey) {
        if (config.endpoint) return config.endpoint;
        const baseUrl = config.base_url || "https://api.openai.com/v1";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }
}

module.exports = GenericProvider;
