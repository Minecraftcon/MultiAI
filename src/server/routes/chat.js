const { loadModelsConfig, getEnvKey, sendJSON } = require("../utils");
const { resolveProvider } = require("../../providers");
const { createAgentGraph } = require("../../core/agent_graph");
const { getKoboldBaseUrl, getLocalSession } = require("./config");

async function handleChat(req, res) {
    try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body || "{}");
        const { model, messages, tools, tool_choice } = data;
        let providerId = data.provider;

        const config = loadModelsConfig();
        if (!providerId) {
            for (const [pId, pData] of Object.entries(config.providers || {})) {
                if ((pData.models || []).some(m => m.id === model)) {
                    providerId = pId;
                    break;
                }
            }
        }

        const provider = config.providers?.[providerId];
        if (!provider) {
            return sendJSON(res, 400, { error: `Unknown provider or model '${model}'` });
        }

        const apiKey = provider.api_key_env ? getEnvKey(provider.api_key_env) : null;
        if (provider.api_key_env && !apiKey) {
            return sendJSON(res, 400, { error: `API key for provider '${provider.name}' (${provider.api_key_env}) is not set.` });
        }

        const providerKey = providerId || provider.name || provider.type;
        const providerHandler = resolveProvider(providerKey);

        // For rolling providers (local / koboldcpp), inject the full session state
        const effectiveProviderConfig = { ...provider };
        const isLocalProvider = providerKey === "local" || providerKey === "koboldcpp";
        if (isLocalProvider) {
            const localSession = getLocalSession();
            if (localSession.base_url) {
                effectiveProviderConfig.base_url = localSession.base_url;
                if (localSession.api_format) effectiveProviderConfig.api_format = localSession.api_format;
                if (localSession.temperature !== null) effectiveProviderConfig.temperature = localSession.temperature;
                if (localSession.top_p !== null) effectiveProviderConfig.top_p = localSession.top_p;
                if (localSession.top_k !== null) effectiveProviderConfig.top_k = localSession.top_k;
                if (localSession.repetition_penalty !== null) effectiveProviderConfig.repetition_penalty = localSession.repetition_penalty;
            }
        }

        const chatResult = await providerHandler.handleChat({
            model,
            apiKey,
            providerConfig: effectiveProviderConfig,
            messages,
            tools,
            tool_choice
        });

        if (chatResult.status !== 200) {
            return sendJSON(res, chatResult.status || 500, { error: chatResult.error || "Provider error" });
        }

        return sendJSON(res, 200, {
            message: chatResult.message
        });
    } catch (error) {
        console.error("[CHAT API ERROR]", error);
        return sendJSON(res, 500, { error: error.message });
    }
}

async function handleAgentStream(req, res) {
    try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body || "{}");
        const { model, messages, tools, chatId, todos } = data;

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*"
        });

        const graph = createAgentGraph();
        const stream = await graph.stream({
            messages: messages || [],
            model: model || "gemini-2.5-flash",
            chatId: chatId || "",
            todos: todos || []
        }, {
            configurable: {
                thread_id: chatId || "default_thread",
                tools: tools || [],
                modelsConfig: loadModelsConfig(),
                getApiKey: getEnvKey
            },
            streamMode: "updates"
        });

        for await (const update of stream) {
            res.write(`data: ${JSON.stringify(update)}\n\n`);
        }

        res.write("data: [DONE]\n\n");
        return res.end();
    } catch (err) {
        console.error("[AGENT STREAM ERROR]", err);
        if (!res.headersSent) {
            return sendJSON(res, 500, { error: err.message });
        }
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
    }
}

module.exports = {
    handleChat,
    handleAgentStream
};
