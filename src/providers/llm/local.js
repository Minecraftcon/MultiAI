// Local LLM Provider
// Supports any locally-running LLM server: KoboldCPP, llama.cpp, vLLM, Ollama, etc.
// No API key required. base_url and format are discovered at runtime via the rolling flow.
const BaseProvider = require("./base");

/**
 * API format descriptors.
 * Each format defines:
 *   - chatPath:    path to chat completions endpoint
 *   - modelsPath:  path to list available models (used for probe, optional)
 *   - omitModel:   if true, don't send "model" field in payload (some backends ignore it)
 *   - supportsTools: whether the format reliably supports tool_calls
 */
const LOCAL_FORMATS = {
    openai: {
        label: "OpenAI-compat (v1)",
        chatPath: "/v1/chat/completions",
        modelsPath: "/v1/models",
        supportsTools: true,
    },
    kobold: {
        label: "KoboldCPP (api/v1)",
        chatPath: "/api/v1/chat/completions",
        modelsPath: "/api/v1/model",
        supportsTools: true,
    },
    llama: {
        label: "llama.cpp (/chat/completions)",
        chatPath: "/chat/completions",
        modelsPath: "/v1/models",
        supportsTools: false,
    },
    vllm: {
        label: "vLLM (OpenAI-compat)",
        chatPath: "/v1/chat/completions",
        modelsPath: "/v1/models",
        supportsTools: true,
    },
    ollama: {
        label: "Ollama (api/chat → OpenAI compat)",
        chatPath: "/api/chat",
        modelsPath: "/api/tags",
        supportsTools: false,
        ollamaMode: true, // payload shaped differently
    },
};

class LocalProvider extends BaseProvider {
    static id = "local";
    static displayName = "Local";
    static matchPatterns = [
        /^(local|kobold[-_]?cpp|kobold|kcpp|llama[-_]?cpp|vllm|ollama)$/i,
        "local",
        "koboldcpp",
        "kobold-cpp",
        "kcpp",
    ];

    _getFormat(config = {}) {
        const fmt = config.api_format || "kobold";
        return LOCAL_FORMATS[fmt] || LOCAL_FORMATS.kobold;
    }

    getEndpoint(config = {}, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "http://localhost:5001";
        const clean = baseUrl.replace(/\/+$/, "");
        const format = this._getFormat(config);
        return `${clean}${format.chatPath}`;
    }

    getHeaders(apiKey, options = {}) {
        // Local providers typically don't require auth.
        // If the user set an apiKey in config, pass it anyway (useful for vLLM auth).
        const headers = { "Content-Type": "application/json" };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
        return headers;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false, options = {} }) {
        const format = this._getFormat(config);

        // Ollama uses a different payload shape
        if (format.ollamaMode) {
            return this._formatOllamaPayload({ model, messages, config, options });
        }

        const payload = super.formatPayload({
            model,
            messages,
            tools: format.supportsTools ? tools : undefined,
            tool_choice: format.supportsTools ? tool_choice : undefined,
            config,
            supportsTools: format.supportsTools && supportsTools,
            supportsVision,
            options,
        });

        // Strip provider prefix for local server payload
        const cleanModel = (model || "").replace(/^(local|koboldcpp|kobold):/, "") || config.model;
        if (cleanModel) payload.model = cleanModel;

        // Apply user-defined temperature override
        if (config.temperature !== undefined && config.temperature !== null) {
            payload.temperature = parseFloat(config.temperature);
        }
        if (config.top_p !== undefined && config.top_p !== null) {
            payload.top_p = parseFloat(config.top_p);
        }
        if (config.top_k !== undefined && config.top_k !== null) {
            payload.top_k = parseInt(config.top_k, 10);
        }
        if (config.repetition_penalty !== undefined && config.repetition_penalty !== null) {
            const rep = parseFloat(config.repetition_penalty);
            payload.repetition_penalty = rep;
            payload.repeat_penalty = rep;
        }

        // KoboldCPP/llama.cpp use own context window — omit max_tokens if not set
        if (!config.max_tokens && !options.max_tokens) {
            delete payload.max_tokens;
        }

        return payload;
    }

    _formatOllamaPayload({ model, messages, config = {}, options = {} }) {
        const payload = {
            model: model || config.model || "llama3",
            messages,
            stream: true,
            options: {},
        };
        if (config.temperature !== undefined) payload.options.temperature = parseFloat(config.temperature);
        if (config.top_p !== undefined) payload.options.top_p = parseFloat(config.top_p);
        if (config.top_k !== undefined) payload.options.top_k = parseInt(config.top_k, 10);
        if (config.max_tokens || options.max_tokens) {
            payload.options.num_predict = config.max_tokens || options.max_tokens;
        }
        return payload;
    }

    cleanLocalText(text) {
        if (!text || typeof text !== "string") return text;
        return text
            .replace(/<\|?begin_of_response\|?>/gi, "")
            .replace(/<\|?end_of_response\|?>/gi, "")
            .replace(/<\|?begin_of_thought\|?>/gi, "")
            .replace(/<\|?end_of_thought\|?>/gi, "")
            .replace(/<\|?im_start\|?>/gi, "")
            .replace(/<\|?im_end\|?>/gi, "")
            .replace(/<\|?start_header_id\|?>/gi, "")
            .replace(/<\|?end_header_id\|?>/gi, "")
            .replace(/<\|?eot_id\|?>/gi, "")
            .replace(/<\|?observation\|?>/gi, "")
            .replace(/<\|?thought\|?>/gi, "")
            .replace(/\{['"](?:task_name|name)['"]:\s*['"][^'"]+['"],\s*['"]output['"']:\s*[\s\S]*?\}/gi, "")
            .trim();
    }

    parseResponse(data) {
        const choice = data?.choices?.[0];
        if (choice?.message) {
            let content = choice.message.content || "";
            let reasoning = choice.message.reasoning_content || choice.message.reasoning || "";

            content = this.cleanLocalText(content);
            reasoning = this.cleanLocalText(reasoning);
            choice.message.content = content;

            // Suppress mirrored reasoning (KoboldCPP/GGUF quirk)
            if (reasoning) {
                const trimmedC = content.trim();
                const trimmedR = reasoning.trim();
                const longer = Math.max(trimmedC.length, trimmedR.length);
                const shorter = Math.min(trimmedC.length, trimmedR.length);
                const isMirror = longer > 0 && shorter / longer >= 0.85 && (
                    trimmedR === trimmedC ||
                    trimmedC.startsWith(trimmedR + "\n") ||
                    trimmedC.endsWith("\n" + trimmedR) ||
                    trimmedR.startsWith(trimmedC + "\n") ||
                    trimmedR.endsWith("\n" + trimmedC)
                );
                if (isMirror) {
                    choice.message.reasoning_content = "";
                    if (choice.message.reasoning) choice.message.reasoning = "";
                } else {
                    choice.message.reasoning_content = reasoning;
                }
            }
        }
        return super.parseResponse(data);
    }

    /**
     * Overrides send() with an active stream accumulator.
     * Always requests stream: true from local/tunnel endpoints so tokens flow continuously.
     * This keeps the connection alive across reverse proxies (e.g. Cloudflare tunnels with strict 100s idle limits).
     */
    async send({ endpoint, headers, payload, timeoutMs = 300000, signal }) {
        const startTime = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        if (signal) {
            if (signal.aborted) {
                clearTimeout(timeout);
                controller.abort();
            } else {
                signal.addEventListener("abort", () => {
                    clearTimeout(timeout);
                    controller.abort();
                }, { once: true });
            }
        }

        // Enable streaming to keep tunnel connection active during long generations
        const streamPayload = { ...payload, stream: true };

        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify(streamPayload),
                signal: controller.signal
            });

            if (!res.ok) {
                const resText = await res.text();
                clearTimeout(timeout);
                let cleanErr = (resText || "").trim();
                if (cleanErr.includes("<html") || cleanErr.includes("<!DOCTYPE") || cleanErr.includes("<body")) {
                    const titleMatch = cleanErr.match(/<title>([^<]+)<\/title>/i);
                    const h1Match = cleanErr.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                    const descMatch = cleanErr.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
                    const parts = [];
                    if (titleMatch) parts.push(titleMatch[1].trim());
                    if (h1Match) {
                        const h1 = h1Match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
                        if (h1 && !parts.includes(h1)) parts.push(h1);
                    }
                    if (descMatch) {
                        const desc = descMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
                        if (desc && desc.length < 200) parts.push(desc);
                    }
                    cleanErr = parts.filter(Boolean).join(" — ") || `HTML response (HTTP ${res.status})`;
                }
                if (res.status === 524) {
                    cleanErr = `Cloudflare 524 (Timeout): Origin server timed out (>100s). The model took too long or tunnel is unreachable. (${cleanErr})`;
                }
                return {
                    ok: false,
                    status: res.status,
                    error: `Local API error (${res.status}): ${cleanErr}`
                };
            }

            const contentType = (res.headers.get("content-type") || "").toLowerCase();

            // If upstream backend returned standard JSON directly (ignored stream flag)
            if (!contentType.includes("event-stream") && !contentType.includes("ndjson") && contentType.includes("json")) {
                const data = await res.json();
                clearTimeout(timeout);
                const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
                if (data && typeof data === "object") data._durationSec = elapsedSec;
                return { ok: true, status: res.status, data };
            }

            // Stream accumulator: reassemble SSE chunks into standard response object
            let fullContent = "";
            let fullReasoning = "";
            let fullToolCalls = [];
            let lastId = "local-" + Date.now();
            let modelName = payload.model || "local-model";
            let finishReason = "stop";
            let buffer = "";
            let isDone = false;

            for await (const chunk of res.body) {
                if (isDone) break;
                buffer += Buffer.from(chunk).toString("utf8");
                const lines = buffer.split("\n");
                buffer = lines.pop(); // retain incomplete line in buffer

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    if (trimmed === "data: [DONE]" || trimmed === "[DONE]") {
                        isDone = true;
                        break;
                    }

                    let jsonStr = trimmed;
                    if (trimmed.startsWith("data: ")) {
                        jsonStr = trimmed.slice(6).trim();
                        if (jsonStr === "[DONE]") {
                            isDone = true;
                            break;
                        }
                    }

                    try {
                        const parsed = JSON.parse(jsonStr);
                        if (parsed.id) lastId = parsed.id;
                        if (parsed.model) modelName = parsed.model;

                        // Ollama stream format
                        if (parsed.message) {
                            if (parsed.message.content) fullContent += parsed.message.content;
                            if (parsed.message.thinking || parsed.message.reasoning) {
                                fullReasoning += (parsed.message.thinking || parsed.message.reasoning);
                            }
                            if (parsed.done) {
                                finishReason = parsed.done_reason || "stop";
                                isDone = true;
                                break;
                            }
                            continue;
                        }

                        // KoboldCPP native format: { token: "..." }
                        if (typeof parsed.token === "string") {
                            fullContent += parsed.token;
                            continue;
                        }

                        // OpenAI-compat / llama.cpp / vLLM format
                        const choice = parsed.choices?.[0];
                        if (choice) {
                            if (choice.finish_reason) {
                                finishReason = choice.finish_reason;
                                if (finishReason === "stop" || finishReason === "length" || finishReason === "tool_calls") {
                                    isDone = true;
                                }
                            }
                            const delta = choice.delta || choice.message;
                            if (delta) {
                                if (delta.content) fullContent += delta.content;
                                if (delta.reasoning_content) fullReasoning += delta.reasoning_content;
                                else if (delta.reasoning) fullReasoning += delta.reasoning;

                                if (Array.isArray(delta.tool_calls)) {
                                    for (const tc of delta.tool_calls) {
                                        const idx = tc.index ?? fullToolCalls.length;
                                        if (!fullToolCalls[idx]) {
                                            fullToolCalls[idx] = {
                                                id: tc.id || "",
                                                type: "function",
                                                function: { name: tc.function?.name || "", arguments: "" }
                                            };
                                        }
                                        if (tc.id) fullToolCalls[idx].id = tc.id;
                                        if (tc.function?.name) fullToolCalls[idx].function.name += tc.function.name;
                                        if (tc.function?.arguments) fullToolCalls[idx].function.arguments += tc.function.arguments;
                                    }
                                }
                            }
                        }
                    } catch (_) {}
                }
                if (isDone) break;
            }
            clearTimeout(timeout);

            // If main content is empty but model produced reasoning, fallback so user receives response
            if (!fullContent.trim() && fullReasoning.trim()) {
                fullContent = fullReasoning;
            }

            const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
            const assembledData = {
                id: lastId,
                model: modelName,
                object: "chat.completion",
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: fullContent,
                        reasoning_content: fullReasoning,
                        ...(fullToolCalls.length > 0 ? { tool_calls: fullToolCalls.filter(Boolean) } : {})
                    },
                    finish_reason: finishReason
                }],
                _durationSec: elapsedSec
            };

            return {
                ok: true,
                status: 200,
                data: assembledData
            };
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === "AbortError") {
                if (signal?.aborted) {
                    return { ok: false, status: 499, error: "Client cancelled request" };
                }
                return { ok: false, status: 504, error: `Local request timed out after ${timeoutMs / 1000}s` };
            }
            const causeDetail = err.cause ? (err.cause.message || err.cause.code || String(err.cause)) : "";
            const detailMsg = causeDetail ? `${err.message} (${causeDetail})` : (err.message || "Unknown network error");
            return { ok: false, status: 502, error: `Local upstream connection failed: ${detailMsg}` };
        }
    }
}

module.exports = LocalProvider;
module.exports.LOCAL_FORMATS = LOCAL_FORMATS;
