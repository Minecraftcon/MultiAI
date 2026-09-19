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
                contents.push({ role: "user", parts: userParts });
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
                contents.push({
                    role: "user",
                    parts: [{
                        functionResponse: {
                            name: toolName,
                            response: {
                                name: toolName,
                                content: msg.content
                            }
                        }
                    }]
                });
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
}

module.exports = GoogleProvider;
