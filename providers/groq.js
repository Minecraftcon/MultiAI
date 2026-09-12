// Groq Cloud Provider (OpenAI Compatible) with Forced Tool Calling Support
const BaseProvider = require("./base");

class GroqProvider extends BaseProvider {
    static id = "groq";
    static displayName = "Groq Cloud";
    static matchPatterns = [
        /^(groq|groq[-_]?cloud)$/i
    ];

    /**
     * Models that Groq does not support native OpenAI 'tools' API for.
     */
    isEmulatedToolModel(model, config = {}) {
        if (!model || typeof model !== "string") return false;
        const lower = model.toLowerCase();
        if (config.force_emulated_tools || config.emulated_tools) return true;
        return lower.includes("compound") || lower.includes("deepseek-r1-distill") || lower.includes("whisper");
    }

    getEndpoint(config, model, apiKey) {
        const baseUrl = config.base_url || "https://api.groq.com/openai/v1";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }

    buildToolSystemPrompt(tools) {
        if (!tools || tools.length === 0) return "";
        let prompt = `\n\nWhen you need to execute a tool, you MUST respond ONLY with a JSON object in this format:
\`\`\`json
{"tool": "tool_name", "arguments": {"param_name": "value"}}
\`\`\`
Available tools:`;

        for (const t of tools) {
            const fn = t.function || t;
            const paramKeys = Object.keys(fn.parameters?.properties || {}).map(k => `${k}: ${fn.parameters?.properties[k]?.type || "string"}`).join(", ");
            prompt += `\n- ${fn.name}(${paramKeys}): ${fn.description || "No description"}`;
        }

        prompt += `\nIf you do not need to call any tools (or after you receive the tool output), respond normally with helpful conversational text.`;
        return prompt;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false, options = {} }) {
        const useEmulated = options.forceEmulatedTools || this.isEmulatedToolModel(model, config);

        if (!useEmulated) {
            const payload = super.formatPayload({
                model,
                messages,
                tools,
                tool_choice,
                config,
                supportsTools,
                supportsVision
            });

            if (!payload.max_tokens && config.default_max_tokens) {
                payload.max_tokens = config.default_max_tokens;
            }
            return payload;
        }

        // --- EMULATED TOOL CALLING MODE ---
        // Groq rejects payload.tools for compound models, so we inject tool descriptions into system prompt
        const normalized = this.normalizeMessages(messages, false, supportsVision);
        const formattedMessages = [];
        let systemPromptInjected = false;
        const toolPrompt = (supportsTools && tools && tools.length > 0 && tool_choice !== "none")
            ? this.buildToolSystemPrompt(tools)
            : "";

        for (const msg of normalized) {
            if (msg.role === "system") {
                formattedMessages.push({
                    role: "system",
                    content: msg.content + (toolPrompt ? toolPrompt : "")
                });
                systemPromptInjected = true;
            } else if (msg.role === "assistant") {
                let content = typeof msg.content === "string" ? msg.content : "";
                if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                    const toolJsonBlocks = msg.tool_calls.map(tc => {
                        let args = {};
                        try {
                            args = typeof tc.function?.arguments === "string"
                                ? JSON.parse(tc.function.arguments || "{}")
                                : (tc.function?.arguments || {});
                        } catch (_) {
                            args = {};
                        }
                        return JSON.stringify({
                            tool: tc.function?.name || "",
                            arguments: args
                        }, null, 2);
                    });
                    content = (content ? content + "\n\n" : "") + "```json\n" + toolJsonBlocks.join("\n") + "\n```";
                }
                formattedMessages.push({
                    role: "assistant",
                    content: content || " "
                });
            } else if (msg.role === "tool") {
                formattedMessages.push({
                    role: "user",
                    content: `[Tool Result for ${msg.name || "action"}]:\n${typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)}`
                });
            } else {
                formattedMessages.push(msg);
            }
        }

        if (!systemPromptInjected && toolPrompt) {
            formattedMessages.unshift({
                role: "system",
                content: "You are a helpful AI assistant." + toolPrompt
            });
        }

        const payload = {
            model,
            messages: formattedMessages
        };

        if (config.default_max_tokens) {
            payload.max_tokens = Math.max(config.default_max_tokens, 1024);
        } else {
            payload.max_tokens = 2048;
        }

        return payload;
    }

    extractCallsFromObject(obj) {
        if (!obj || typeof obj !== "object") return [];
        
        // Single call: { tool: "...", arguments: { ... } } or { name: "...", arguments: { ... } }
        if ((obj.tool || obj.name) && (obj.arguments || obj.args || obj.parameters)) {
            return [{
                id: "call_" + Math.random().toString(36).substring(2, 9),
                type: "function",
                function: {
                    name: String(obj.tool || obj.name),
                    arguments: JSON.stringify(obj.arguments || obj.args || obj.parameters || {})
                }
            }];
        }

        // Multi-call array: { tool_calls: [ ... ] }
        if (Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) {
            return obj.tool_calls.map(tc => {
                const fn = tc.function || tc;
                return {
                    id: String(tc.id || ("call_" + Math.random().toString(36).substring(2, 9))),
                    type: "function",
                    function: {
                        name: String(fn.name || fn.tool || ""),
                        arguments: JSON.stringify(fn.arguments || fn.args || fn.parameters || {})
                    }
                };
            });
        }

        return [];
    }

    extractToolCallsFromContent(text) {
        if (!text || typeof text !== "string") return { text: "", toolCalls: [] };
        const toolCalls = [];
        let cleanedText = text;

        // Check for fenced code blocks with json / tool / tool_call
        const codeBlockRegex = /```(?:json|tool_call|tool)?\s*([\s\S]*?)\s*```/gi;
        let match;
        while ((match = codeBlockRegex.exec(text)) !== null) {
            const rawJson = match[1].trim();
            try {
                const parsed = JSON.parse(rawJson);
                const calls = this.extractCallsFromObject(parsed);
                if (calls.length > 0) {
                    toolCalls.push(...calls);
                    cleanedText = cleanedText.replace(match[0], "").trim();
                }
            } catch (_) {}
        }

        // Check for raw top-level or embedded JSON if no fenced block matched
        if (toolCalls.length === 0) {
            const braceStart = text.indexOf("{");
            const braceEnd = text.lastIndexOf("}");
            if (braceStart !== -1 && braceEnd > braceStart) {
                const candidate = text.slice(braceStart, braceEnd + 1).trim();
                try {
                    const parsed = JSON.parse(candidate);
                    const calls = this.extractCallsFromObject(parsed);
                    if (calls.length > 0) {
                        toolCalls.push(...calls);
                        cleanedText = (text.slice(0, braceStart) + text.slice(braceEnd + 1)).trim();
                    }
                } catch (_) {}
            }
        }

        return { text: cleanedText, toolCalls };
    }

    parseResponse(data) {
        const choice = data?.choices?.[0];
        if (!choice) return { message: { role: "assistant", content: "" } };

        const msg = choice.message || {};

        // If native tool_calls returned, pass through
        if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            return {
                message: this.formatAssistantResponse(msg)
            };
        }

        // Otherwise, inspect content for emulated tool call JSON
        const rawContent = msg.content || "";
        const { text, toolCalls } = this.extractToolCallsFromContent(rawContent);

        if (toolCalls.length > 0) {
            return {
                message: {
                    role: "assistant",
                    content: text,
                    tool_calls: toolCalls
                }
            };
        }

        return {
            message: this.formatAssistantResponse(msg)
        };
    }

    async handleChat({ model, apiKey, providerConfig = {}, messages, tools, tool_choice, options = {} }) {
        const isEmulated = options.forceEmulatedTools || this.isEmulatedToolModel(model, providerConfig);

        // Attempt primary request
        const res = await super.handleChat({
            model,
            apiKey,
            providerConfig,
            messages,
            tools,
            tool_choice,
            options: { ...options, forceEmulatedTools: isEmulated }
        });

        // If Groq rejects with 'tool calling is not supported with this model', automatically retry in emulated mode
        if (res.status === 400 && typeof res.error === "string" && res.error.includes("tool calling") && !isEmulated) {
            console.log(`[GROQ PROVIDER] Model '${model}' does not support native tools. Retrying with emulated tool calling...`);
            return super.handleChat({
                model,
                apiKey,
                providerConfig,
                messages,
                tools,
                tool_choice,
                options: { ...options, forceEmulatedTools: true }
            });
        }

        return res;
    }
}

module.exports = GroqProvider;
