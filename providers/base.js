// BaseProvider: Contract and shared logic for all MultiAI pluggable providers
const path = require("path");

class BaseProvider {
    static id = "base";
    static displayName = "Base Provider";
    static matchPatterns = [];

    /**
     * Checks if a provider identifier (type, name, model prefix) matches this provider.
     * Supports case-insensitivity, hyphens, underscores, spaces, etc.
     */
    static matches(identifier) {
        if (!identifier || typeof identifier !== "string") return false;
        const normalized = identifier.trim().toLowerCase().replace(/[\s\-_]+/g, "");
        if (this.id && this.id.replace(/[\s\-_]+/g, "").toLowerCase() === normalized) {
            return true;
        }
        for (const pattern of this.matchPatterns) {
            if (pattern instanceof RegExp && pattern.test(identifier)) {
                return true;
            }
            if (typeof pattern === "string") {
                const normPattern = pattern.trim().toLowerCase().replace(/[\s\-_]+/g, "");
                if (normPattern === normalized) return true;
            }
        }
        return false;
    }

    /**
     * Universal normalization of chat messages for standard OpenAI format.
     */
    normalizeMessages(messages, supportsTools = true, supportsVision = true) {
        if (!Array.isArray(messages)) return [];
        return messages.map(msg => this.normalizeMessage(msg, supportsTools, supportsVision)).filter(Boolean);
    }

    normalizeMessage(msg, supportsTools = true, supportsVision = true) {
        if (!msg || typeof msg !== "object") return null;
        const role = msg.role;

        if (role === "system") {
            return {
                role: "system",
                content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
            };
        }

        if (role === "user") {
            if (Array.isArray(msg.content)) {
                if (supportsVision) {
                    const parts = [];
                    for (const part of msg.content) {
                        if (part.type === "text") {
                            parts.push({ type: "text", text: String(part.text || "") });
                        } else if (part.type === "image_url" && part.image_url?.url) {
                            parts.push({
                                type: "image_url",
                                image_url: { url: String(part.image_url.url) }
                            });
                        }
                    }
                    return { role: "user", content: parts };
                } else {
                    let text = "";
                    let imgCount = 0;
                    for (const part of msg.content) {
                        if (part.type === "text") text += (part.text || "") + " ";
                        if (part.type === "image_url") imgCount++;
                    }
                    if (imgCount > 0) {
                        text += `\n[Note: ${imgCount} image(s) attached, but model is text-only]`;
                    }
                    return { role: "user", content: text.trim() };
                }
            }
            return {
                role: "user",
                content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
            };
        }

        if (role === "assistant") {
            const hasToolCalls = msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
            if (hasToolCalls) {
                if (supportsTools) {
                    return {
                        role: "assistant",
                        content: typeof msg.content === "string" ? msg.content : null,
                        tool_calls: msg.tool_calls.map(tc => ({
                            id: String(tc.id || ("call_" + Math.random().toString(36).substring(2, 9))),
                            type: "function",
                            function: {
                                name: String(tc.function?.name || ""),
                                arguments: typeof tc.function?.arguments === "string"
                                    ? tc.function.arguments
                                    : JSON.stringify(tc.function?.arguments || {})
                            }
                        }))
                    };
                } else {
                    const toolNames = msg.tool_calls.map(tc => tc.function?.name).filter(Boolean).join(", ");
                    return {
                        role: "assistant",
                        content: msg.content || (toolNames ? `[Action taken: ${toolNames}]` : "[Action taken]")
                    };
                }
            }
            return {
                role: "assistant",
                content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
            };
        }

        if (role === "tool") {
            if (supportsTools) {
                return {
                    role: "tool",
                    name: msg.name ? String(msg.name) : undefined,
                    tool_call_id: String(msg.tool_call_id || ""),
                    content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
                };
            } else {
                return {
                    role: "user",
                    content: `[Tool Result]: ${typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)}`
                };
            }
        }

        return {
            role: "user",
            content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
        };
    }

    formatAssistantResponse(resp) {
        if (!resp) return { role: "assistant", content: "" };
        let content = resp.content;
        if (content === null || content === undefined) {
            content = "";
        } else if (typeof content !== "string") {
            content = JSON.stringify(content);
        }

        const out = {
            role: "assistant",
            content
        };

        if (resp.tool_calls && Array.isArray(resp.tool_calls) && resp.tool_calls.length > 0) {
            out.tool_calls = resp.tool_calls.map(tc => ({
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

        return out;
    }

    getHeaders(apiKey, options = {}) {
        const headers = {
            "Content-Type": "application/json"
        };
        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }
        return headers;
    }

    getEndpoint(config, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "https://api.openai.com/v1";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false }) {
        const payload = {
            model,
            messages: this.normalizeMessages(messages, supportsTools, supportsVision)
        };
        if (config.default_max_tokens) {
            payload.max_tokens = config.default_max_tokens;
        }
        if (supportsTools && tools && tools.length > 0 && tool_choice !== "none") {
            payload.tools = tools;
            if (tool_choice) payload.tool_choice = tool_choice;
        }
        return payload;
    }

    async send({ endpoint, headers, payload, timeoutMs = 120000 }) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeout);

            const resText = await res.text();
            if (!res.ok) {
                return {
                    ok: false,
                    status: res.status,
                    error: `${this.constructor.displayName || this.constructor.id} API error (${res.status}): ${resText}`
                };
            }

            let data;
            try {
                data = JSON.parse(resText);
            } catch (e) {
                return {
                    ok: false,
                    status: 502,
                    error: `Invalid JSON returned by ${this.constructor.displayName || this.constructor.id}: ${resText.slice(0, 300)}`
                };
            }

            return {
                ok: true,
                status: res.status,
                data
            };
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === "AbortError") {
                return { ok: false, status: 504, error: `${this.constructor.displayName || this.constructor.id} request timed out after ${timeoutMs / 1000}s` };
            }
            return { ok: false, status: 500, error: err.message };
        }
    }

    parseResponse(data) {
        const choice = data?.choices?.[0];
        return {
            message: this.formatAssistantResponse(choice?.message)
        };
    }

    async handleChat({ model, apiKey, providerConfig = {}, messages, tools, tool_choice, options = {} }) {
        const modelMeta = (providerConfig.models || []).find(m => m.id === model);
        const supportsTools = modelMeta ? (modelMeta.supports_tools !== false) : true;
        const supportsVision = modelMeta ? Boolean(modelMeta.supports_vision) : false;

        const endpoint = this.getEndpoint(providerConfig, model, apiKey);
        const headers = this.getHeaders(apiKey, { model, providerConfig, ...options });
        const payload = this.formatPayload({
            model,
            messages,
            tools,
            tool_choice,
            config: providerConfig,
            supportsTools,
            supportsVision,
            options
        });

        const res = await this.send({ endpoint, headers, payload });
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
}

module.exports = BaseProvider;
