const path = require("path");
const { sendJSON, loadModelsConfig, getEnvKey } = require("../utils");
const { getConfig } = require("../../core/config_manager");
const conversationsManager = require("../../core/conversations_manager");
const deepSearchManager = require("../../services/deepsearch/manager");
const { runDeepSearchWorkflow } = require("../../services/deepsearch/graph");

async function handleDeepSearchRoute(req, res) {
    if (req.method === "POST" && req.url === "/api/deepsearch/start") {
        try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body || "{}");
            const { chatId, topic, plan, model } = data;

            if (!topic) {
                return sendJSON(res, 400, { error: "Topic is required for DeepSearch" });
            }

            let artifactDir;
            if (chatId) {
                try {
                    const ws = conversationsManager.ensureChatWorkspace(chatId);
                    artifactDir = ws.artifactsDir;
                } catch (_) {
                    artifactDir = path.join(conversationsManager.getStorageRoot(), "artifacts");
                }
            } else {
                artifactDir = path.join(conversationsManager.getStorageRoot(), "artifacts");
            }

            const defaultModel = getConfig().General?.DefaultStartupLLM || "glm-4.5-flash";
            const job = deepSearchManager.createJob({
                chatId: chatId || "default",
                topic,
                plan: plan || "",
                model: model || defaultModel,
                artifactDir
            });

            // Fire autonomous LangGraph background job without blocking response
            setImmediate(async () => {
                try {
                    await runDeepSearchWorkflow(job, {
                        configurable: {
                            modelsConfig: loadModelsConfig(),
                            getApiKey: getEnvKey
                        }
                    });
                } catch (e) {
                    console.error("[DeepSearch Background Error]", e);
                }
            });

            return sendJSON(res, 200, { status: "started", job });
        } catch (error) {
            console.error("[DEEPSEARCH START ERROR]", error);
            return sendJSON(res, 500, { error: error.message });
        }
    }

    if (req.method === "GET" && req.url.startsWith("/api/deepsearch/status/")) {
        const jobId = decodeURIComponent(req.url.replace("/api/deepsearch/status/", "")).split("?")[0].trim();
        const job = deepSearchManager.getJob(jobId);
        if (!job) {
            return sendJSON(res, 404, { error: `Job ${jobId} not found` });
        }
        return sendJSON(res, 200, { job });
    }

    if (req.method === "GET" && req.url.startsWith("/api/deepsearch/chat/")) {
        const chatId = decodeURIComponent(req.url.replace("/api/deepsearch/chat/", "")).split("?")[0].trim();
        const job = deepSearchManager.getJobByChatId(chatId);
        return sendJSON(res, 200, { job });
    }

    res.writeHead(404);
    res.end();
}

module.exports = {
    handleDeepSearchRoute
};
