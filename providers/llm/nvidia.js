// NVIDIA NIM Provider
const BaseProvider = require("./base");

class NvidiaProvider extends BaseProvider {
    static id = "nvidia";
    static displayName = "NVIDIA NIM";
    static matchPatterns = [
        /^(nvidia|nvidia[-_]?nim|nim)$/i
    ];

    getEndpoint(config, model, apiKey) {
        const baseUrl = config.base_url || "https://integrate.api.nvidia.com/v1";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }
}

module.exports = NvidiaProvider;
