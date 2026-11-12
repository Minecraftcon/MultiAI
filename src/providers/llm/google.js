// Google Gemini & Gemma Provider
const BaseProvider = require("./base");

class GoogleProvider extends BaseProvider {
    static id = "gemini";
    static displayName = "Google Gemini & Gemma";
    static matchPatterns = [
        /^(google|gemini|gemma|google[-_]?gemini|google[-_]?ai|generative[-_]?ai)$/i
    ];

    getHeaders(apiKey, options = {}) {
        return {
            "Content-Type": "application/json"
        };
    }

    getEndpoint(config, model, apiKey) {
        const baseEndpoint = (config.endpoint || "https://generativelanguage.googleapis.com/v1beta/models").replace(/\/+$/, "");
        return `${baseEndpoint}/${model}:generateContent?key=${apiKey}`;
    }

    getStreamEndpoint(config, model, apiKey) {
        const baseEndpoint = (config.endpoint || "https://generativelanguage.googleapis.com/v1beta/models").replace(/\/+$/, "");
        return `${baseEndpoint}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = true }) {
        const normalized = this.normalizeMessages(messages, supportsTools, supportsVision);
        const systemParts = [];
        const contents = [];

        for (const msg of normalized) {
            if (msg.role === "system") {
                systemParts.push({ text: msg.content });
            } else if (msg.role === "user") {
                const userParts = [];
                if (Array.isArray(msg.content)) {
                    for (const part of msg.content) {
                        if (part.type === "text" && part.text) {
                            userParts.push({ text: part.text });
                        } else if (part.type === "image_url" && part.image_url?.url) {
                            const url = part.image_url.url;
                            const match = url.match(/^data:([^;]+);base64,(.+)$/);
                            if (match) {
                                userParts.push({
                                    inlineData: {
                                        mimeType: match[1],
                                        data: match[2]
                                    }
                                });
                            }
                        }
                    }
                } else if (typeof msg.content === "string") {
                    userParts.push({ text: msg.content });
                }
                if (userParts.length === 0) userParts.push({ text: " " });
                const prev = contents[contents.length - 1];
                if (prev && prev.role === "user") {
                    prev.parts.push(...userParts);
                } else {
                    contents.push({ role: "user", parts: userParts });
                }
            } else if (msg.role === "assistant") {
                const parts = [];
                if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                    for (const tc of msg.tool_calls) {
                        let args = {};
                        try {
                            args = typeof tc.function?.arguments === "string"
                                ? JSON.parse(tc.function.arguments || "{}")
                                : (tc.function?.arguments || {});
                        } catch (e) {
                            args = {};
                        }
                        const fcPart = {
                            functionCall: {
                                name: tc.function?.name || "",
                                args
                            }
                        };
                        const thoughtSig = tc.thoughtSignature || tc.thought_signature || tc.function?.thoughtSignature || tc.function?.thought_signature;
                        if (thoughtSig) {
                            fcPart.thoughtSignature = thoughtSig;
                        }
                        parts.push(fcPart);
                    }
                }
                if (msg.content) {
                    // Strip synthetic <think> tags from history so Gemini does not mimic raw XML in subsequent turns
                    const cleanedContent = typeof msg.content === "string"
                        ? msg.content.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim()
                        : msg.content;
                    if (cleanedContent) {
                        parts.unshift({ text: cleanedContent });
                    }
                }
                if (parts.length > 0) {
                    contents.push({ role: "model", parts });
                }
            } else if (msg.role === "tool") {
                const toolName = msg.name || "tool";
                const toolParts = [{
                    functionResponse: {
                        name: toolName,
                        response: {
                            name: toolName,
                            content: msg.content
                        }
                    }
                }];
                const prev = contents[contents.length - 1];
                if (prev && prev.role === "user") {
                    prev.parts.push(...toolParts);
                } else {
                    contents.push({ role: "user", parts: toolParts });
                }
            }
        }

        const payload = { contents };
        if (systemParts.length > 0) {
            payload.systemInstruction = { parts: systemParts };
        }
        if (supportsTools && tools && tools.length > 0 && tool_choice !== "none") {
            payload.tools = [{
                functionDeclarations: tools.map(t => ({
                    name: t.function.name,
                    description: t.function.description || "",
                    parameters: t.function.parameters || { type: "object" }
                }))
            }];
        }

        const generationConfig = {};
        if (config.default_max_tokens) {
            generationConfig.maxOutputTokens = config.default_max_tokens;
        }
        if (typeof config.temperature === "number") {
            generationConfig.temperature = config.temperature;
        }

        // Enable thought reasoning retention for Gemini 2.0+ / 2.5+ / 3.0+ thinking models
        const isThinkingCapable = typeof model === "string" && (
            model.includes("gemini-2.") ||
            model.includes("gemini-3.") ||
            model.includes("thinking") ||
            model.includes("flash-latest") ||
            model.includes("flash-lite-latest") ||
            model.includes("pro-latest")
        );

        if (isThinkingCapable) {
            generationConfig.thinkingConfig = {
                includeThoughts: true
            };
        }

        if (Object.keys(generationConfig).length > 0) {
            payload.generationConfig = generationConfig;
        }

        return payload;
    }

    parseResponse(data) {
        const candidate = data?.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        let text = "";
        const toolCalls = [];

        // Extract thinking / reasoning parts if present
        const thoughtParts = parts.filter(p => p.text && p.thought);
        const thoughtText = thoughtParts.map(p => p.text).join("").trim();

        // Distinguish non-thought response tokens
        const nonThoughtParts = parts.filter(p => p.text && !p.thought);
        const textParts = nonThoughtParts.length > 0 ? nonThoughtParts : (parts.some(p => p.functionCall) ? [] : parts.filter(p => p.text && !p.thought));
        for (const part of textParts) {
            text += part.text;
        }

        for (const part of parts) {
            if (part.functionCall) {
                const thoughtSig = part.thoughtSignature || part.thought_signature || part.functionCall?.thoughtSignature || part.functionCall?.thought_signature || null;
                const toolCall = {
                    id: part.functionCall.id || ("call_" + Math.random().toString(36).substring(2, 10)),
                    type: "function",
                    function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args || {})
                    }
                };
                if (thoughtSig) {
                    toolCall.thoughtSignature = thoughtSig;
                }
                toolCalls.push(toolCall);
            }
        }

        let fullContent = text;
        if (thoughtText) {
            fullContent = `<think>\n${thoughtText}\n</think>\n\n${text}`.trimEnd();
        }

        return {
            message: this.formatAssistantResponse({
                content: fullContent,
                tool_calls: toolCalls
            })
        };
    }

    /**
     * Google Gemini SSE streaming handler.
     * Gemini uses :streamGenerateContent?alt=sse and does not accept `stream: true` in the JSON body.
     * Transforms incoming Gemini SSE chunks into standard OpenAI SSE delta format expected by the WebUI.
     */
    async handleChatStream({ model, apiKey, providerConfig = {}, messages, tools, tool_choice, options = {}, req, res }) {
        const modelMeta = (providerConfig.models || []).find(m => m.id === model);
        const supportsTools = modelMeta ? (modelMeta.supports_tools !== false) : true;
        const supportsVision = modelMeta ? Boolean(modelMeta.supports_vision) : false;

        const maxContextTokens = options.maxContextTokens || modelMeta?.max_context_tokens || providerConfig.max_context_tokens;
        const chatOptions = maxContextTokens ? { ...options, maxContextTokens } : options;

        const endpoint = this.getStreamEndpoint(providerConfig, model, apiKey);
        const headers = this.getHeaders(apiKey, { model, providerConfig, ...chatOptions });
        headers["Accept"] = "text/event-stream";

        const payload = this.formatPayload({
            model,
            messages,
            tools,
            tool_choice,
            config: providerConfig,
            supportsTools,
            supportsVision,
            options: chatOptions
        });
        // Note: Do NOT add payload.stream = true! Gemini REST API rejects "stream" field with HTTP 400.

        const timeoutMs = chatOptions.timeoutMs || providerConfig.timeout_ms || 300000;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        if (req) {
            req.on("close", () => {
                clearTimeout(timeout);
                controller.abort();
            });
        }

        try {
            const upstreamRes = await fetch(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            if (!upstreamRes.ok) {
                clearTimeout(timeout);
                const resText = await upstreamRes.text();
                return {
                    status: upstreamRes.status,
                    error: `Google Gemini API error (${upstreamRes.status}): ${resText.slice(0, 500)}`
                };
            }

            res.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            });
            if (res.socket) res.socket.setNoDelay(true);
            if (typeof res.flushHeaders === "function") res.flushHeaders();

            const textDecoder = new TextDecoder("utf-8");
            let buffer = "";
            let toolCallIndex = 0;

            const processLine = (line) => {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data:")) return;
                const dataStr = trimmed.replace(/^data:\s*/, "");
                if (dataStr === "[DONE]") return;

                let data;
                try {
                    data = JSON.parse(dataStr);
                } catch (_) {
                    return;
                }

                const candidate = data.candidates?.[0];
                if (!candidate) return;

                const parts = candidate.content?.parts || [];
                for (const part of parts) {
                    // 1. Thoughts / reasoning delta
                    if (part.text && part.thought) {
                        const sseChunk = {
                            choices: [{
                                delta: {
                                    reasoning_content: part.text
                                }
                            }]
                        };
                        res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
                        if (typeof res.flush === "function") res.flush();
                    }
                    // 2. Standard content delta
                    else if (part.text && !part.thought) {
                        const sseChunk = {
                            choices: [{
                                delta: {
                                    content: part.text
                                }
                            }]
                        };
                        res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
                        if (typeof res.flush === "function") res.flush();
                    }
                    // 3. Tool call / function call delta
                    if (part.functionCall) {
                        const thoughtSig = part.thoughtSignature || part.thought_signature || part.functionCall?.thoughtSignature || null;
                        const toolCallChunk = {
                            index: toolCallIndex++,
                            id: part.functionCall.id || ("call_" + Math.random().toString(36).slice(2, 10)),
                            type: "function",
                            function: {
                                name: part.functionCall.name,
                                arguments: JSON.stringify(part.functionCall.args || {})
                            }
                        };
                        if (thoughtSig) {
                            toolCallChunk.thoughtSignature = thoughtSig;
                        }
                        const sseChunk = {
                            choices: [{
                                delta: {
                                    tool_calls: [toolCallChunk]
                                }
                            }]
                        };
                        res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
                        if (typeof res.flush === "function") res.flush();
                    }
                }
            };

            if (upstreamRes.body) {
                if (typeof upstreamRes.body.getReader === "function") {
                    const reader = upstreamRes.body.getReader();
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += textDecoder.decode(value, { stream: true });
                        const lines = buffer.split("\n");
                        buffer = lines.pop();
                        for (const line of lines) processLine(line);
                    }
                } else {
                    for await (const chunk of upstreamRes.body) {
                        buffer += textDecoder.decode(chunk, { stream: true });
                        const lines = buffer.split("\n");
                        buffer = lines.pop();
                        for (const line of lines) processLine(line);
                    }
                }
                if (buffer.trim()) {
                    processLine(buffer);
                }
            }

            res.write("data: [DONE]\n\n");
            if (typeof res.flush === "function") res.flush();
            clearTimeout(timeout);
            res.end();
            return { status: 200 };
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === "AbortError" && req?.destroyed) {
                return { status: 499, error: "Client cancelled request" };
            }
            if (!res.headersSent) {
                return {
                    status: 502,
                    error: `Google Gemini streaming connection failed: ${err.message}`
                };
            }
            try { res.end(); } catch (_) {}
            return { status: 502, error: err.message };
        }
    }
}

module.exports = GoogleProvider;
