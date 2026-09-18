// Cohere Provider (v2 Chat API)
const BaseProvider = require("./base");

class CohereProvider extends BaseProvider {
    static id = "cohere";
    static displayName = "Cohere";
    static matchPatterns = [
        /^(cohere|command[-_]?r|command[-_]?a|aya)$/i
    ];

    getEndpoint(config, model, apiKey) {
        const baseUrl = (config.base_url || "https://api.cohere.com/v2").replace(/\/+$/, "");
        return baseUrl.endsWith("/chat") ? baseUrl : `${baseUrl}/chat`;
    }

    hasImageContent(messages) {
        if (!Array.isArray(messages)) return false;
        return messages.some(m => {
            if (Array.isArray(m.content)) {
                return m.content.some(c => c && (c.type === "image_url" || c.type === "image" || c.image_url));
            }
            return false;
        });
    }

    cleanCohereToolCalls(toolCalls) {
        if (!Array.isArray(toolCalls)) return undefined;
        return toolCalls.map(tc => ({
            id: String(tc.id || ("call_" + Math.random().toString(36).substring(2, 9))),
            type: "function",
            function: {
                name: String(tc.function?.name || ""),
                arguments: typeof tc.function?.arguments === "string"
                    ? tc.function.arguments
                    : JSON.stringify(tc.function?.arguments || {})
            }
        }));
    }

    normalizeMessages(messages, supportsTools = true, supportsVision = true) {
        const normalized = super.normalizeMessages(messages, supportsTools, supportsVision);

        // Cohere API quirk: An assistant message with tool_calls MUST be followed by tool messages
        // responding to EACH tool_call_id. If any tool_call_ids are missing in conversation history
        // (e.g. from an aborted turn or client error), Cohere rejects with TOOL_CALLS_MISSING_RESULTS
        // or hangs indefinitely in server-side queue.
        const respondedToolCallIds = new Set();
        normalized.forEach(m => {
            if (m.role === "tool" && m.tool_call_id) {
                respondedToolCallIds.add(String(m.tool_call_id));
            }
        });

        const repaired = [];
        for (let i = 0; i < normalized.length; i++) {
            const m = normalized[i];

            // Cohere API quirk: Cohere v2 strictly validates message schemas and throws HTTP 422
            // if unexpected fields like 'name' or 'thoughtSignature' exist in messages or tool_calls.
            let cleanMsg;
            if (m.role === "tool") {
                cleanMsg = {
                    role: "tool",
                    tool_call_id: String(m.tool_call_id || ""),
                    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content)
                };
            } else if (m.role === "assistant") {
                cleanMsg = {
                    role: "assistant",
                    content: typeof m.content === "string" ? m.content : (m.content === null ? null : "")
                };
                if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
                    cleanMsg.tool_calls = this.cleanCohereToolCalls(m.tool_calls);
                }
            } else {
                cleanMsg = {
                    role: m.role,
                    content: m.content
                };
            }
            repaired.push(cleanMsg);

            if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
                const missingCalls = m.tool_calls.filter(tc => !respondedToolCallIds.has(String(tc.id)));
                for (const tc of missingCalls) {
                    repaired.push({
                        role: "tool",
                        tool_call_id: String(tc.id),
                        content: `[Tool ${tc.function?.name || 'action'} execution completed or superseded]`
                    });
                    respondedToolCallIds.add(String(tc.id));
                }
            }
        }
        return repaired;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = true }) {
        const payload = {
            model,
            messages: this.normalizeMessages(messages, supportsTools, supportsVision)
        };

        if (supportsTools && tools && tools.length > 0 && tool_choice !== "none") {
            payload.tools = tools;
        }

        return payload;
    }

    async handleChat({ model, apiKey, providerConfig = {}, messages, tools, tool_choice, options = {} }) {
        let activeModel = model;
        const hasImages = this.hasImageContent(messages);

        // Cohere API quirk: c4ai-aya-vision-32b rejects multimodal messages with 422 NO_VALID_RESPONSE_GENERATED.
        // Route vision requests to command-a-vision-07-2025.
        if (hasImages && activeModel === "c4ai-aya-vision-32b") {
            activeModel = "command-a-vision-07-2025";
        }

        const modelMeta = (providerConfig.models || []).find(m => m.id === activeModel) ||
                          (providerConfig.models || []).find(m => m.id === model);

        // Cohere API quirk: Vision models (command-a-vision-*, c4ai-aya-vision-*) do NOT support tool use
        const isVisionOnly = activeModel.includes("vision") || (modelMeta && modelMeta.supports_vision && !modelMeta.supports_tools);
        const supportsTools = isVisionOnly ? false : (modelMeta ? (modelMeta.supports_tools !== false) : true);
        const supportsVision = hasImages ? true : (modelMeta ? Boolean(modelMeta.supports_vision) : false);

        const endpoint = this.getEndpoint(providerConfig, activeModel, apiKey);
        const headers = this.getHeaders(apiKey, { model: activeModel, providerConfig, ...options });
        const payload = this.formatPayload({
            model: activeModel,
            messages,
            tools,
            tool_choice,
            config: providerConfig,
            supportsTools,
            supportsVision,
            options
        });

        // 60s timeout per attempt so client does not hang for 120s
        let res = await this.send({ endpoint, headers, payload, timeoutMs: 60000 });

        // Fallback 1: Vision error fallback
        if (!res.ok && hasImages && activeModel !== "command-a-vision-07-2025" && String(res.error).includes("NO_VALID_RESPONSE_GENERATED")) {
            console.warn(`[CohereProvider] ${activeModel} failed with NO_VALID_RESPONSE_GENERATED for image payload. Retrying with command-a-vision-07-2025...`);
            activeModel = "command-a-vision-07-2025";
            const fallbackPayload = this.formatPayload({
                model: activeModel,
                messages,
                tools,
                tool_choice,
                config: providerConfig,
                supportsTools: false,
                supportsVision: true,
                options
            });
            res = await this.send({ endpoint, headers, payload: fallbackPayload, timeoutMs: 60000 });
        }

        // Fallback 2: Timeout / Rate limit queue fallback to fast sibling model
        const SIBLING_FALLBACKS = {
            "command-r-plus-08-2024": "command-r-08-2024",
            "command-a-plus-05-2026": "command-a-03-2025"
        };

        if (!res.ok && (res.status === 504 || String(res.error).toLowerCase().includes("timed out") || res.status === 429) && SIBLING_FALLBACKS[activeModel]) {
            const fallbackModel = SIBLING_FALLBACKS[activeModel];
            console.warn(`[CohereProvider] ${activeModel} timed out or was queued (${res.error}). Seamlessly retrying with fast sibling model ${fallbackModel}...`);
            activeModel = fallbackModel;
            const fallbackPayload = this.formatPayload({
                model: activeModel,
                messages,
                tools,
                tool_choice,
                config: providerConfig,
                supportsTools: true,
                supportsVision: false,
                options
            });
            res = await this.send({ endpoint, headers, payload: fallbackPayload, timeoutMs: 60000 });
        }

        if (!res.ok) {
            return {
                status: res.status,
                error: res.error
            };
        }

        const parsed = this.parseResponse(res.data);
        return {
            status: 200,
            message: parsed.message
        };
    }

    parseResponse(data) {
        const rawMsg = data?.message || {};
        let content = rawMsg.content;
        if (typeof content === "string" && content.trim().startsWith("[")) {
            try {
                content = JSON.parse(content);
            } catch(e) {}
        }

        let text = "";
        let reasoning = "";

        if (Array.isArray(content)) {
            const thinkingBlocks = content.filter(b => b.type === "thinking");
            reasoning = thinkingBlocks.map(b => b.thinking || "").join("\n\n").trim();

            const textBlocks = content.filter(b => b.type === "text");
            text = textBlocks.map(b => b.text || "").join("");
            if (!text && !reasoning && content.length > 0) {
                text = content.map(b => b.text || b.thinking || "").join("");
            }
        } else if (typeof content === "string") {
            text = content;
        }

        if (reasoning && text) {
            const durationStr = data?._durationSec ? `${data._durationSec} seconds` : "a few seconds";
            text = `<details class="thought-box" open data-duration="${data?._durationSec || ''}"><summary class="thought-summary"><span class="thought-header"><svg class="thought-brain-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/><path d="M12 8h4"/><path d="M12 12h3"/><path d="M12 16h4"/><path d="M8 8h4"/><path d="M9 12h3"/><path d="M8 16h4"/></svg><span class="thought-label">Thought for ${durationStr}</span><span class="thought-chevron">›</span></span></summary><div class="thought-body"><div class="thought-content">\n\n${reasoning}\n\n</div></div></details>\n\n${text.trim()}`;
        } else if (reasoning && !text) {
            text = reasoning;
        }

        const toolCalls = (rawMsg.tool_calls || []).map(tc => ({
            id: tc.id || ("call_" + Math.random().toString(36).substring(2, 9)),
            type: "function",
            function: {
                name: tc.function?.name,
                arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {})
            }
        }));

        return {
            message: this.formatAssistantResponse({
                content: text,
                tool_calls: toolCalls
            })
        };
    }
}

module.exports = CohereProvider;
