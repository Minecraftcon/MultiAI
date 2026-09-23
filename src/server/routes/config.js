const { getConfig, saveConfig } = require("../../core/config_manager");
const { getEnvKey, loadModelsConfig, getModelDefaultContext, getSystemInfo, sendJSON } = require("../utils");

// In-memory session state for the rolling local provider (resets on server restart)
let localSessionState = {
    base_url: null,
    api_format: "kobold",
    temperature: null,
    top_p: null,
    top_k: null,
    repetition_penalty: null,
};

function getLocalSession() { return { ...localSessionState }; }
function setLocalSession(updates) { Object.assign(localSessionState, updates); }

// Backward-compat: config.js previously exported these as koboldBaseUrl helpers
function getKoboldBaseUrl() { return localSessionState.base_url; }
function setKoboldBaseUrl(url) { localSessionState.base_url = url; }

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
            // Inject live-discovered state if probe was called this session
            const isLocalProvider = providerId === "local" || providerId === "koboldcpp";
            if (isLocalProvider && localSessionState.base_url) {
                entry.connected_base_url = localSessionState.base_url;
                entry.api_format = localSessionState.api_format || "kobold";
            }
        }
        resultProviders.push(entry);
    }
    return sendJSON(res, 200, { providers: resultProviders });
}

// GET /api/kobold/base_url — backward-compat route
async function handleKoboldBaseUrl(req, res) {
    return sendJSON(res, 200, { base_url: localSessionState.base_url || null });
}

// GET /api/local/session — full local session state
async function handleLocalSession(req, res) {
    return sendJSON(res, 200, getLocalSession());
}

// POST /api/kobold/probe and POST /api/local/probe — format-aware probe
async function handleLocalProbe(req, res) {
    try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const parsed = JSON.parse(body || "{}");
        const api_format = parsed.api_format || parsed.format || "kobold";
        const { base_url, temperature, top_p, top_k, repetition_penalty } = parsed;

        if (!base_url || typeof base_url !== "string") {
            return sendJSON(res, 400, { error: "base_url is required" });
        }

        const cleanUrl = base_url.replace(/\/+$/, "");

        // Format-specific model detection paths
        const MODEL_PATHS = {
            kobold:  "/api/v1/model",
            openai:  "/v1/models",
            llama:   "/v1/models",
            vllm:    "/v1/models",
            ollama:  "/api/tags",
        };
        const modelPath = MODEL_PATHS[api_format] || "/api/v1/model";

        let modelName = "local-model";
        let contextSize = 4096;
        let supportsTools = (api_format === "kobold" || api_format === "openai" || api_format === "vllm");

        // Probe model endpoint
        const modelRes = await fetch(`${cleanUrl}${modelPath}`, {
            signal: AbortSignal.timeout(6000)
        });
        if (!modelRes.ok) {
            return sendJSON(res, 502, { error: `Server at ${cleanUrl} returned HTTP ${modelRes.status} on ${modelPath}` });
        }
        const modelData = await modelRes.json();

        // Parse model name based on format
        let firstModel = null;
        if (api_format === "kobold") {
            modelName = modelData.result || modelData.model || "koboldcpp-model";
        } else if (api_format === "ollama") {
            firstModel = modelData.models?.[0];
            modelName = firstModel?.name || firstModel?.model || "ollama-model";
        } else {
            // OpenAI-compat / llama.cpp / vLLM: first model in list
            firstModel = modelData.data?.[0] || modelData.models?.[0];
            modelName = firstModel?.id || firstModel?.name || modelData.model || "local-model";
        }

        // Context length probe
        if (api_format === "kobold") {
            try {
                const ctxRes = await fetch(`${cleanUrl}/api/extra/true_max_context_length`, {
                    signal: AbortSignal.timeout(3000)
                });
                if (ctxRes.ok) {
                    const ctxData = await ctxRes.json();
                    contextSize = ctxData.value || ctxData.max_context_length || 4096;
                }
            } catch (_) {}
        } else if (api_format === "llama" || api_format === "openai" || api_format === "vllm") {
            if (firstModel?.meta?.n_ctx) {
                contextSize = Number(firstModel.meta.n_ctx);
            } else {
                try {
                    const propsRes = await fetch(`${cleanUrl}/props`, { signal: AbortSignal.timeout(3000) });
                    if (propsRes.ok) {
                        const propsData = await propsRes.json();
                        const pCtx = propsData.default_generation_settings?.n_ctx || propsData.n_ctx;
                        if (pCtx) contextSize = Number(pCtx);
                    }
                } catch (_) {}
            }
        }

        // Store in session memory (resets on server restart)
        setLocalSession({
            base_url: cleanUrl,
            api_format,
            temperature: temperature !== undefined ? temperature : null,
            top_p: top_p !== undefined ? top_p : null,
            top_k: top_k !== undefined ? top_k : null,
            repetition_penalty: repetition_penalty !== undefined ? repetition_penalty : null,
        });

        console.log(`[LOCAL] Connected to ${cleanUrl} — format: ${api_format}, model: ${modelName}, ctx: ${contextSize}`);
        return sendJSON(res, 200, {
            success: true,
            base_url: cleanUrl,
            api_format,
            model_name: modelName,
            model_id: `local:${modelName}`,
            context_size: contextSize,
            supports_tools: supportsTools,
            supports_vision: false,
        });
    } catch (err) {
        if (err.name === "TimeoutError") {
            return sendJSON(res, 504, { error: "Connection timed out — is the server running at that URL?" });
        }
        return sendJSON(res, 500, { error: err.message });
    }
}

// Alias for backward compat
const handleKoboldProbe = handleLocalProbe;

module.exports = {
    handleSystemInfo,
    handleConfig,
    handleModels,
    handleKoboldBaseUrl,
    handleKoboldProbe,
    handleLocalSession,
    handleLocalProbe,
    getKoboldBaseUrl,
    setKoboldBaseUrl,
    getLocalSession,
    setLocalSession,
};
