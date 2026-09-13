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

    normalizeMessage(msg, supportsTools = true, supportsVision = false) {
        const normalized = super.normalizeMessage(msg, supportsTools, supportsVision);
        if (!normalized) return null;

        // Groq-specific system prompt adaptation:
        // When native tools are enabled on Groq, phrases like "Return your response with a JSON object at the start"
        // cause models to emit a function call for tool 'JSON', which Groq's validator rejects with HTTP 400.
        // We rephrase this to "Start your text with: {"chatname": ...}" so the model returns standard text JSON
        // matching what the frontend expects without triggering an invalid tool call.
        if (normalized.role === "system" && typeof normalized.content === "string") {
            normalized.content = normalized.content.replace(
                /Return your response with a JSON object at the start:\s*\{"chatname":\s*"Short Topic Title"\}\s*followed immediately by your normal response\./i,
                'Start your text with: {"chatname": "Short Topic Title"}\nfollowed immediately by your normal response. (Do not invoke any tools for the title).'
            );
        }
        return normalized;
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

        prompt += `\nIMPORTANT: Do NOT emit raw function calling tokens or API tool calls; write only standard text with the \`\`\`json code block above.`;
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
        const normalized = this.normalizeMessages(messages, true, supportsVision);
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

    extractCallsFromObject(obj, tools = []) {
        if (!obj) return [];

        const invalidNames = new Set(["json", "none", "null", "undefined", "object", "string", "tool"]);

        const resolveToolName = (name) => {
            if (!name) return "";
            const raw = String(name).trim();
            if (!raw || invalidNames.has(raw.toLowerCase())) return "";
            if (tools && tools.length > 0) {
                const knownNames = tools.map(t => t.function?.name || t.name).filter(Boolean);
                if (knownNames.includes(raw)) return raw;
                const dotClean = raw.includes(".") ? raw.split(".").pop() : raw;
                if (knownNames.includes(dotClean)) return dotClean;
                const colonClean = raw.includes(":") ? raw.split(":").pop() : raw;
                if (knownNames.includes(colonClean)) return colonClean;
            }
            if (raw.includes(".")) return raw.split(".").pop();
            if (raw.includes(":")) return raw.split(":").pop();
            return raw;
        };

        // If array of call objects
        if (Array.isArray(obj)) {
            return obj.flatMap(item => this.extractCallsFromObject(item, tools));
        }

        if (typeof obj !== "object") return [];

        // Multi-call array property: { tool_calls: [ ... ] }
        if (Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) {
            return obj.tool_calls.map(tc => {
                const fn = tc.function || tc;
                const toolName = resolveToolName(fn.name || fn.tool || "");
                if (!toolName || invalidNames.has(toolName.toLowerCase())) return null;
                const rawArgs = fn.arguments !== undefined ? fn.arguments : (fn.args !== undefined ? fn.args : fn.parameters);
                return {
                    id: String(tc.id || ("call_" + Math.random().toString(36).substring(2, 9))),
                    type: "function",
                    function: {
                        name: toolName,
                        arguments: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs || {})
                    }
                };
            }).filter(Boolean);
        }

        // Single call: { tool: "...", arguments: { ... } } or { name: "...", arguments: { ... } }
        if ((obj.tool || obj.name) && (obj.arguments !== undefined || obj.args !== undefined || obj.parameters !== undefined)) {
            const toolName = resolveToolName(obj.tool || obj.name);
            if (toolName && !invalidNames.has(toolName.toLowerCase())) {
                const rawArgs = obj.arguments !== undefined ? obj.arguments : (obj.args !== undefined ? obj.args : obj.parameters);
                return [{
                    id: "call_" + Math.random().toString(36).substring(2, 9),
                    type: "function",
                    function: {
                        name: toolName,
                        arguments: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs || {})
                    }
                }];
            }
        }

        return [];
    }

    extractToolCallsFromContent(text, tools = []) {
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
                const calls = this.extractCallsFromObject(parsed, tools);
                if (calls.length > 0) {
                    toolCalls.push(...calls);
                    cleanedText = cleanedText.replace(match[0], "").trim();
                }
            } catch (_) {}
        }

        // Check for XML-style tool calls e.g. <tool_call> ... </tool_call> or <tool> ... </tool>
        const xmlRegex = /<(?:tool_call|tool)>([\s\S]*?)<\/(?:tool_call|tool)>/gi;
        while ((match = xmlRegex.exec(text)) !== null) {
            const raw = match[1].trim();
            try {
                const parsed = JSON.parse(raw);
                const calls = this.extractCallsFromObject(parsed, tools);
                if (calls.length > 0) {
                    toolCalls.push(...calls);
                    cleanedText = cleanedText.replace(match[0], "").trim();
                }
            } catch (_) {}
        }

        // Check for raw top-level or embedded JSON if no fenced or XML block matched
        if (toolCalls.length === 0) {
            const braceStart = text.indexOf("{");
            const braceEnd = text.lastIndexOf("}");
            if (braceStart !== -1 && braceEnd > braceStart) {
                const candidate = text.slice(braceStart, braceEnd + 1).trim();
                try {
                    const parsed = JSON.parse(candidate);
                    const calls = this.extractCallsFromObject(parsed, tools);
                    if (calls.length > 0) {
                        toolCalls.push(...calls);
                        cleanedText = (text.slice(0, braceStart) + text.slice(braceEnd + 1)).trim();
                    }
                } catch (_) {}
            }
        }

        return { text: cleanedText, toolCalls };
    }

    parseResponse(data, tools = []) {
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
        const activeTools = (tools && tools.length > 0) ? tools : (this._lastTools || []);
        let { text, toolCalls } = this.extractToolCallsFromContent(rawContent, activeTools);

        // If no tool calls found in content, also inspect reasoning (frequently used by Groq compound models)
        if (toolCalls.length === 0 && typeof msg.reasoning === "string" && msg.reasoning.trim()) {
            const reasoningExt = this.extractToolCallsFromContent(msg.reasoning, activeTools);
            if (reasoningExt.toolCalls.length > 0) {
                toolCalls = reasoningExt.toolCalls;
                if (!text) text = reasoningExt.text;
            }
        }

        if (toolCalls.length > 0) {
            return {
                message: {
                    role: "assistant",
                    content: text,
                    tool_calls: toolCalls
                }
            };
        }

        if (!text && typeof msg.reasoning === "string" && msg.reasoning.trim()) {
            return {
                message: {
                    role: "assistant",
                    content: msg.reasoning.trim()
                }
            };
        }

        return {
            message: this.formatAssistantResponse(msg)
        };
    }

    async handleChat({ model, apiKey, providerConfig = {}, messages, tools, tool_choice, options = {} }) {
        this._lastTools = tools;
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

        if (res.status === 400) {
            const errStr = typeof res.error === "string" ? res.error : JSON.stringify(res.error || "");

            // 1. Recover tool call if Groq intercepted model generation with 'failed_generation'
            let failedGen = null;
            try {
                const jsonMatch = errStr.match(/\{[\s\S]*"error"[\s\S]*\}/);
                if (jsonMatch) {
                    const parsedErr = JSON.parse(jsonMatch[0]);
                    failedGen = parsedErr.error?.failed_generation;
                }
            } catch (_) {}

            if (failedGen) {
                let recoveredCalls = [];
                try {
                    const parsedObj = typeof failedGen === "string" ? JSON.parse(failedGen) : failedGen;
                    recoveredCalls = this.extractCallsFromObject(parsedObj, tools);
                } catch (_) {
                    const ext = this.extractToolCallsFromContent(failedGen, tools);
                    recoveredCalls = ext.toolCalls;
                }

                if (recoveredCalls.length > 0) {
                    console.log(`[GROQ PROVIDER] Model '${model}' triggered tool interception (${errStr.slice(0, 150)}...). Recovered ${recoveredCalls.length} tool call(s) successfully.`);
                    return {
                        status: 200,
                        message: {
                            role: "assistant",
                            content: "",
                            tool_calls: recoveredCalls
                        }
                    };
                }
            }

            // 2. If no tool call recovered from failed_generation, check if it was a tool-related error and retry in emulated mode
            const isToolError = (
                errStr.includes("tool calling") ||
                errStr.includes("Tool call validation failed") ||
                errStr.includes("tool_use_failed") ||
                errStr.includes("attempted to call tool") ||
                errStr.includes("Failed to parse tool call") ||
                errStr.includes("not in request.tools") ||
                errStr.includes("Tool choice is none")
            );

            if (isToolError && !isEmulated) {
                console.log(`[GROQ PROVIDER] Model '${model}' failed native tool validation (${errStr.slice(0, 150)}...). Automatically retrying with emulated tool calling...`);
                return this.handleChat({
                    model,
                    apiKey,
                    providerConfig,
                    messages,
                    tools,
                    tool_choice,
                    options: { ...options, forceEmulatedTools: true }
                });
            }
        }

        return res;
    }
}

module.exports = GroqProvider;
