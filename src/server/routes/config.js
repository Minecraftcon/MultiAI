const { getConfig, saveConfig } = require("../../core/config_manager");
const { getEnvKey, loadModelsConfig, getModelDefaultContext, getSystemInfo, sendJSON } = require("../utils");

let koboldBaseUrl = null;

function getKoboldBaseUrl() {
    return koboldBaseUrl;
}

function setKoboldBaseUrl(url) {
    koboldBaseUrl = url;
}

async function handleSystemInfo(req, res) {
    if (req.method === "HEAD") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end();
    }
    return sendJSON(res, 200, getSystemInfo());
}

async function handleConfig(req, res) {
    if (req.method === "GET" || req.method === "HEAD") {
        if (req.method === "HEAD") {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end();
        }
        return sendJSON(res, 200, getConfig());
    }

    if (req.method === "POST") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const updates = JSON.parse(body || "{}");
            const updated = saveConfig(updates);
            return sendJSON(res, 200, { success: true, config: updated });
        } catch (err) {
            return sendJSON(res, 500, { error: err.message });
        }
    }

    res.writeHead(405);
    res.end();
}

async function handleModels(req, res) {
    if (req.method === "HEAD") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end();
    }
    const config = loadModelsConfig();
    const resultProviders = [];
    for (const [providerId, provider] of Object.entries(config.providers || {})) {
        const key = provider.api_key_env ? getEnvKey(provider.api_key_env) : null;
        const isAvailable = !provider.api_key_env || Boolean(key);
        const entry = {
            id: providerId,
            name: provider.name || providerId,
            type: provider.type,
            available: isAvailable,
            has_key: Boolean(key),
            models: (provider.models || []).map(m => ({
                id: m.id,
                name: m.name || m.id,
                default: Boolean(m.default),
                supports_tools: m.supports_tools !== false,
                supports_vision: Boolean(m.supports_vision),
                max_context_tokens: m.max_context_tokens || provider.max_context_tokens || getModelDefaultContext(m.id, provider.type || providerId),
                provider: providerId
            }))
        };
        // Pass rolling flag so the frontend knows to show URL-prompt instead of model list
        if (provider.rolling) {
            entry.rolling = true;
            // Inject live-discovered model if probe was called this session
            if (providerId === "koboldcpp" && koboldBaseUrl) {
                entry.connected_base_url = koboldBaseUrl;
            }
        }
        resultProviders.push(entry);
    }
    return sendJSON(res, 200, { providers: resultProviders });
}

async function handleKoboldBaseUrl(req, res) {
    return sendJSON(res, 200, { base_url: koboldBaseUrl || null });
}

async function handleKoboldProbe(req, res) {
    try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { base_url } = JSON.parse(body || "{}");
        if (!base_url || typeof base_url !== "string") {
            return sendJSON(res, 400, { error: "base_url is required" });
        }

        const cleanUrl = base_url.replace(/\/+$/, "");

        // Probe 1: get loaded model name
        const modelRes = await fetch(`${cleanUrl}/api/v1/model`, {
            signal: AbortSignal.timeout(5000)
        });
        if (!modelRes.ok) {
            return sendJSON(res, 502, { error: `KoboldCPP at ${cleanUrl} returned HTTP ${modelRes.status} on /api/v1/model` });
        }
        const modelData = await modelRes.json();
        const modelName = modelData.result || modelData.model || "koboldcpp-model";

        // Probe 2: get context length (graceful fallback)
        let contextSize = 4096;
        try {
            const ctxRes = await fetch(`${cleanUrl}/api/extra/true_max_context_length`, {
                signal: AbortSignal.timeout(3000)
            });
            if (ctxRes.ok) {
                const ctxData = await ctxRes.json();
                contextSize = ctxData.value || ctxData.max_context_length || 4096;
            }
        } catch (_) {}

        // Store in session memory (resets on server restart)
        koboldBaseUrl = cleanUrl;

        console.log(`[KOBOLD] Connected to ${cleanUrl} — model: ${modelName}, ctx: ${contextSize}`);
        return sendJSON(res, 200, {
            success: true,
            base_url: cleanUrl,
            model_name: modelName,
            model_id: `koboldcpp:${modelName}`,
            context_size: contextSize,
            supports_tools: true,
            supports_vision: false
        });
    } catch (err) {
        if (err.name === "TimeoutError") {
            return sendJSON(res, 504, { error: "Connection timed out — is KoboldCPP running at that URL?" });
        }
        return sendJSON(res, 500, { error: err.message });
    }
}

module.exports = {
    handleSystemInfo,
    handleConfig,
    handleModels,
    handleKoboldBaseUrl,
    handleKoboldProbe,
    getKoboldBaseUrl,
    setKoboldBaseUrl
};
