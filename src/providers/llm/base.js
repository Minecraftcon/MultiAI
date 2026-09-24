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
     * Extracts image data from tool result content if present.
     */
    static extractImageFromToolResult(content) {
        if (!content) return null;
        let obj = content;
        if (typeof content === "string") {
            if (!content.includes("data_url") && !content.includes("data:image/")) return null;
            try {
                obj = JSON.parse(content);
            } catch (_) {
                const match = content.match(/data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)/);
                if (match) {
                    return {
                        mime: match[1],
                        base64: match[2],
                        dataUrl: match[0],
                        path: "image",
                        humanSize: "",
                        cleanContent: content.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "[embedded image data]")
                    };
                }
                return null;
            }
        }
        if (obj && (obj.type === "image" || (typeof obj.mime === "string" && obj.mime.startsWith("image/")))) {
            const rawUrl = obj.data_url || obj.url;
            if (rawUrl && typeof rawUrl === "string") {
                const match = rawUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                    const cleanObj = {
                        path: obj.path || "image",
                        type: "image",
                        mime: match[1],
                        size_bytes: obj.size_bytes,
                        human_size: obj.human_size,
                        status: "success",
                        message: `Image read successfully: ${obj.path || "image"} (${obj.human_size || match[1]})`
                    };
                    return {
                        mime: match[1],
                        base64: match[2],
                        dataUrl: rawUrl,
                        path: obj.path || "image",
                        humanSize: obj.human_size || "",
                        cleanContent: JSON.stringify(cleanObj)
                    };
                }
            }
        }
        return null;
    }

    /**
     * Universal normalization of chat messages for standard OpenAI format.
     */
    normalizeMessages(messages, supportsTools = true, supportsVision = true) {
        if (!Array.isArray(messages)) return [];
        const result = [];
        const pendingToolImages = [];

        for (let i = 0; i < messages.length; i++) {
            const rawMsg = messages[i];
            if (!rawMsg || typeof rawMsg !== "object") continue;

            if (rawMsg.role === "tool") {
                const img = BaseProvider.extractImageFromToolResult(rawMsg.content);
                if (img && supportsVision) {
                    pendingToolImages.push(img);
                }
                const norm = this.normalizeMessage(rawMsg, supportsTools, supportsVision);
                if (norm) {
                    if (img) {
                        norm.content = img.cleanContent;
                    }
                    result.push(norm);
                }

                // If next message is not a tool message, flush pending tool images into a user message
                const nextMsg = messages[i + 1];
                if (!nextMsg || nextMsg.role !== "tool") {
                    if (pendingToolImages.length > 0) {
                        const userParts = [];
                        for (const item of pendingToolImages) {
                            userParts.push({
                                type: "text",
                                text: `[Visual preview of ${item.path}]:`
                            });
                            userParts.push({
                                type: "image_url",
                                image_url: { url: item.dataUrl }
                            });
                        }
                        result.push({
                            role: "user",
                            content: userParts
                        });
                        pendingToolImages.length = 0;
                    }
                }
            } else {
                const norm = this.normalizeMessage(rawMsg, supportsTools, supportsVision);
                if (norm) result.push(norm);
            }
        }
        return result;
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
                        content: typeof msg.content === "string" ? this.cleanPromptContent(msg.content) : null,
                        tool_calls: msg.tool_calls.map(tc => {
                            const call = {
                                id: String(tc.id || ("call_" + Math.random().toString(36).substring(2, 9))),
                                type: "function",
                                function: {
                                    name: String(tc.function?.name || ""),
                                    arguments: typeof tc.function?.arguments === "string"
                                        ? tc.function.arguments
                                        : JSON.stringify(tc.function?.arguments || {})
                                }
                            };
                            const sig = tc.thoughtSignature || tc.thought_signature || tc.function?.thoughtSignature || tc.function?.thought_signature;
                            if (sig) {
                                call.thoughtSignature = sig;
                            }
                            return call;
                        })
                    };
                } else {
                    const toolNames = msg.tool_calls.map(tc => tc.function?.name).filter(Boolean).join(", ");
                    return {
                        role: "assistant",
                        content: this.cleanPromptContent(msg.content) || (toolNames ? `[Action taken: ${toolNames}]` : "[Action taken]")
                    };
                }
            }
            if (!hasToolCalls) {
                const cleanedContent = typeof msg.content === "string" ? this.cleanPromptContent(msg.content) : String(msg.content || "");
                if (!cleanedContent.trim()) {
                    return null; // Scrub empty assistant turns
                }
                return {
                    role: "assistant",
                    content: cleanedContent
                };
            }
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
                    content: `[Tool Result: ${msg.name || "action"}]:\n${typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)}`
                };
            }
        }

        return {
            role,
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
            const normalizedCalls = this.normalizeToolCalls(resp.tool_calls);
            out.tool_calls = normalizedCalls.map(tc => {
                const call = {
                    id: String(tc.id || ("call_" + Math.random().toString(36).substring(2, 9))),
                    type: "function",
                    function: {
                        name: String(tc.function?.name || ""),
                        arguments: typeof tc.function?.arguments === "string"
                            ? tc.function.arguments
                            : JSON.stringify(tc.function?.arguments || {})
                    }
                };
                const sig = tc.thoughtSignature || tc.thought_signature || tc.function?.thoughtSignature || tc.function?.thought_signature;
                if (sig) {
                    call.thoughtSignature = sig;
                }
                return call;
            });
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

    /**
     * Estimates token count for a message.
     * Uses conservative 3.0 characters/token ratio.
     */
    estimateMessageTokens(msg) {
        if (!msg) return 0;
        let chars = 0;
        let imageTokens = 0;

        const measure = (text) => {
            if (typeof text !== "string") return;
            const stripped = text.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, () => {
                imageTokens += 1200;
                return "";
            });
            chars += stripped.length;
        };

        if (typeof msg.content === "string") {
            measure(msg.content);
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === "image_url" || part.type === "image") {
                    imageTokens += 1200;
                } else if (part.type === "text") {
                    measure(part.text);
                } else {
                    measure(JSON.stringify(part));
                }
            }
        } else if (msg.content) {
            measure(JSON.stringify(msg.content));
        }

        if (msg.tool_calls) {
            chars += JSON.stringify(msg.tool_calls).length;
        }
        return Math.ceil(chars / 3.0) + imageTokens;
    }

    /**
     * Prunes conversation messages to fit within a target token budget while strictly preserving:
     * 1. The system message (index 0).
     * 2. The most recent user instruction and active agent turn.
     * 3. Atomic tool-call integrity: assistant tool_calls and their matching tool result messages
     *    are grouped and dropped together so no orphaned tool messages are left.
     * 4. Caps oversized historical tool outputs in older turns to avoid token waste.
     */
    pruneMessagesForContext(messages, maxTokens = 60000, options = {}) {
        if (!Array.isArray(messages) || messages.length <= 1) return messages;

        const totalEstTokens = messages.reduce((acc, m) => acc + this.estimateMessageTokens(m), 0);
        if (totalEstTokens <= maxTokens) {
            return messages;
        }

        const maxToolChars = options.maxToolChars || 6000;
        let systemMsg = null;
        const nonSystem = [];

        for (let i = 0; i < messages.length; i++) {
            if (i === 0 && messages[i].role === "system") {
                systemMsg = messages[i];
            } else {
                nonSystem.push(messages[i]);
            }
        }

        if (nonSystem.length === 0) return messages;

        // 1. Cap massive historical tool outputs in older turns (excluding recent turns)
        const processed = nonSystem.map((m, idx) => {
            const isRecent = idx >= nonSystem.length - 2;
            if (!isRecent && m.role === "tool" && typeof m.content === "string" && m.content.length > maxToolChars) {
                const half = Math.floor(maxToolChars / 2);
                return {
                    ...m,
                    content: `${m.content.slice(0, half)}\n\n[... Output truncated to fit model context window ...]\n\n${m.content.slice(-half)}`
                };
            }
            return m;
        });

        // 2. Group into atomic blocks:
        // - user message block
        // - assistant message (and all its corresponding tool result messages) block
        const blocks = [];
        let currentBlock = [];

        for (let i = 0; i < processed.length; i++) {
            const m = processed[i];
            if (m.role === "user") {
                if (currentBlock.length > 0) {
                    blocks.push(currentBlock);
                    currentBlock = [];
                }
                blocks.push([m]);
            } else if (m.role === "assistant") {
                if (currentBlock.length > 0) {
                    blocks.push(currentBlock);
                    currentBlock = [];
                }
                currentBlock.push(m);
            } else if (m.role === "tool") {
                if (currentBlock.length > 0 && (currentBlock[0].role === "assistant" || currentBlock[0].role === "tool")) {
                    currentBlock.push(m);
                } else {
                    if (currentBlock.length > 0) blocks.push(currentBlock);
                    currentBlock = [m];
                }
            } else {
                if (currentBlock.length > 0) {
                    blocks.push(currentBlock);
                    currentBlock = [];
                }
                blocks.push([m]);
            }
        }
        if (currentBlock.length > 0) {
            blocks.push(currentBlock);
        }

        // 3. Keep blocks from newest to oldest until available token budget is filled
        const sysTokens = systemMsg ? this.estimateMessageTokens(systemMsg) : 0;
        const availableTokens = Math.max(maxTokens - sysTokens, 4000);

        const keptBlocks = [];
        let accumulatedTokens = 0;

        for (let b = blocks.length - 1; b >= 0; b--) {
            const blk = blocks[b];
            const blkTokens = blk.reduce((acc, m) => acc + this.estimateMessageTokens(m), 0);

            if (keptBlocks.length === 0 || accumulatedTokens + blkTokens <= availableTokens) {
                keptBlocks.unshift(blk);
                accumulatedTokens += blkTokens;
            } else {
                break;
            }
        }

        const pruned = [];
        if (systemMsg) pruned.push(systemMsg);
        for (const blk of keptBlocks) {
            pruned.push(...blk);
        }

        return pruned;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false, options = {} }) {
        const maxContextTokens = options.maxContextTokens || config.max_context_tokens || 100000;
        const msgsToNormalize = maxContextTokens ? this.pruneMessagesForContext(messages, maxContextTokens, options) : messages;

        const payload = {
            model,
            messages: this.normalizeMessages(msgsToNormalize, supportsTools, supportsVision)
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
                    cleanErr = `Cloudflare 524 (Timeout): Origin web server timed out responding (>100s). The model took too long or tunnel is unreachable. (${cleanErr})`;
                }
                return {
                    ok: false,
                    status: res.status,
                    error: `${this.constructor.displayName || this.constructor.id} API error (${res.status}): ${cleanErr}`
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

            const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
            if (data && typeof data === "object") {
                data._durationSec = elapsedSec;
            }

            return {
                ok: true,
                status: res.status,
                data
            };
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === "AbortError") {
                if (signal?.aborted) {
                    return { ok: false, status: 499, error: "Client cancelled request" };
                }
                return { ok: false, status: 504, error: `${this.constructor.displayName || this.constructor.id} request timed out after ${timeoutMs / 1000}s` };
            }
            const causeDetail = err.cause ? (err.cause.message || err.cause.code || String(err.cause)) : "";
            const detailMsg = causeDetail ? `${err.message} (${causeDetail})` : (err.message || "Unknown network error");
            return { ok: false, status: 502, error: `${this.constructor.displayName || this.constructor.id} upstream connection failed: ${detailMsg}` };
        }
    }

    /**
     * Cleans frontend thought-box markup and HTML tags from assistant messages
     * before sending conversation history back to upstream LLMs.
     * Prevents LLM context contamination and tag hallucination.
     */
    cleanPromptContent(text) {
        if (!text || typeof text !== "string") return text;
        let cleaned = text;
        const thoughtBoxRegex = /<details class="thought-box"[^>]*>[\s\S]*?<div class="thought-content[^"]*">([\s\S]*?)<\/div>\s*<\/div>\s*<\/details>/gi;
        cleaned = cleaned.replace(thoughtBoxRegex, (match, inner) => {
            const cleanInner = inner.replace(/<[^>]+>/g, "").trim();
            return cleanInner ? `<think>\n${cleanInner}\n</think>\n\n` : "";
        });
        cleaned = cleaned.replace(/<\/?(?:details|summary|svg|path|span)[^>]*>/gi, "");
        return cleaned.trim();
    }

    /**
     * Parses tool call argument string supporting standard JSON or delimited key:<|"|>val<|"|> syntax.
     */
    parseToolCallArgs(rawArgs) {
        if (!rawArgs || typeof rawArgs !== "string") return {};
        const trimmed = rawArgs.trim();
        if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
            try {
                return JSON.parse(trimmed);
            } catch (_) {}
        }
        const argsObj = {};
        const argRegex = /["\x27]?([a-zA-Z0-9_\-]+)["\x27]?\s*:\s*(?:<\|"\|>([\s\S]*?)<\|"\|>|"([^"]*)"|'([^']*)'|([^,}\s]+))/g;
        let match;
        let found = false;
        while ((match = argRegex.exec(trimmed)) !== null) {
            found = true;
            const key = match[1];
            let val = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : (match[4] !== undefined ? match[4] : match[5]));
            if (val === "true") val = true;
            else if (val === "false") val = false;
            else if (val === "null") val = null;
            else if (!isNaN(Number(val)) && val !== "") val = Number(val);
            argsObj[key] = val;
        }
        if (found) return argsObj;
        return trimmed;
    }

    /**
     * Extracts unparsed or leaked tool calls from raw response content or reasoning text.
     * Supports:
     * 1. <|tool_calls_section_begin|>...<|tool_call_begin|>functions.NAME:N<|tool_call_argument_begin|>{args}<|tool_call_end|>...<|tool_calls_section_end|>
     *    (GLM-4 / Qwen2.5 / Hermes chat template — emitted by Logflare Auto Smart Router)
     * 2. <|tool_call>call:NAME{args}<|tool_call|> (Qwen / Command R / GLM / Hermes template tokens)
     * 3. <tool_call> JSON </tool_call> (XML wrapped calls)
     * 4. ```tool_call / ```json code blocks with tool calls
     */
    extractToolCallsFromText(text) {
        if (!text || typeof text !== "string") return { cleanedText: text || "", toolCalls: [] };
        const toolCalls = [];

        // Protect non-tool markdown code blocks and inline code spans so examples (e.g. ```json ... ```) are never falsely extracted
        const protectedBlocks = [];
        let cleaned = text.replace(/```(?!tool_call|tool\b)[a-zA-Z0-9_\-]*\n[\s\S]*?```|`[^`\n]+`/g, (match) => {
            const placeholder = `__PROTECTED_CODE_BLOCK_${protectedBlocks.length}__`;
            protectedBlocks.push({ placeholder, match });
            return placeholder;
        });

        // 0. GLM-4/Qwen2.5/Hermes section-begin format:
        //    <|tool_calls_section_begin|>
        //    <|tool_call_begin|>functions.NAME:INDEX<|tool_call_argument_begin|>{...JSON...}
        //    <|tool_call_end|>
        //    <|tool_calls_section_end|>
        const sectionRegex = /<\|tool_calls_section_begin\|>([\s\S]*?)<\|tool_calls_section_end\|>/gi;
        let sm;
        while ((sm = sectionRegex.exec(cleaned)) !== null) {
            const sectionBody = sm[1];
            // Each individual tool call inside the section
            const callRegex = /<\|tool_call_begin\|>\s*(?:functions\.)?([a-zA-Z0-9_\-]+)(?::\d+)?\s*<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_end\|>/gi;
            let cm;
            while ((cm = callRegex.exec(sectionBody)) !== null) {
                const name = cm[1];
                const rawArgs = cm[2].trim();
                const parsedArgs = this.parseToolCallArgs(rawArgs);
                toolCalls.push({
                    id: "call_" + Math.random().toString(36).substring(2, 9),
                    type: "function",
                    function: {
                        name,
                        arguments: typeof parsedArgs === "string" ? parsedArgs : JSON.stringify(parsedArgs || {})
                    }
                });
            }
            cleaned = cleaned.replace(sm[0], "").trim();
        }

        // Also handle orphaned individual tool_call_begin (no wrapping section)
        const orphanCallRegex = /<\|tool_call_begin\|>\s*(?:functions\.)?([a-zA-Z0-9_\-]+)(?::\d+)?\s*<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_end\|>/gi;
        let om;
        while ((om = orphanCallRegex.exec(cleaned)) !== null) {
            const name = om[1];
            const rawArgs = om[2].trim();
            const parsedArgs = this.parseToolCallArgs(rawArgs);
            toolCalls.push({
                id: "call_" + Math.random().toString(36).substring(2, 9),
                type: "function",
                function: {
                    name,
                    arguments: typeof parsedArgs === "string" ? parsedArgs : JSON.stringify(parsedArgs || {})
                }
            });
            cleaned = cleaned.replace(om[0], "").trim();
        }

        // 1. Template tokens: <|tool_call>call:NAME{...}<tool_call|> or call:NAME{...}
        const callDelimRegex = /(?:<\|?(?:tool_call|tool)\|?>\s*)?call:([a-zA-Z0-9_\-]+)\s*\{([\s\S]*?)\}(?:\s*<\|?\/?(?:tool_call|tool)\|?>)?/gi;
        let m;
        while ((m = callDelimRegex.exec(cleaned)) !== null) {
            const name = m[1];
            const rawArgs = m[2];
            const parsedArgs = this.parseToolCallArgs(rawArgs);
            toolCalls.push({
                id: "call_" + Math.random().toString(36).substring(2, 9),
                type: "function",
                function: {
                    name,
                    arguments: typeof parsedArgs === "string" ? parsedArgs : JSON.stringify(parsedArgs)
                }
            });
            cleaned = cleaned.replace(m[0], "").trim();
        }

        // 2. XML wrapped calls: <tool_call> JSON </tool_call>
        const xmlRegex = /<\|?(?:tool_call|tool)\|?>\s*([\s\S]*?)\s*<\|?\/(?:tool_call|tool)\|?>/gi;
        while ((m = xmlRegex.exec(cleaned)) !== null) {
            try {
                const parsed = JSON.parse(m[1].trim());
                const name = parsed.name || parsed.tool || parsed.function?.name;
                const rawArgs = parsed.arguments !== undefined ? parsed.arguments : (parsed.args !== undefined ? parsed.args : parsed.parameters);
                if (name) {
                    toolCalls.push({
                        id: "call_" + Math.random().toString(36).substring(2, 9),
                        type: "function",
                        function: {
                            name,
                            arguments: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs || {})
                        }
                    });
                    cleaned = cleaned.replace(m[0], "").trim();
                }
            } catch (_) {}
        }

        // 3. Fenced code block calls: ```tool_call ... ```
        const codeBlockRegex = /```(?:tool_call|tool)\s*(\{[\s\S]*?\})\s*```/gi;
        while ((m = codeBlockRegex.exec(cleaned)) !== null) {
            try {
                const parsed = JSON.parse(m[1].trim());
                const name = parsed.name || parsed.tool || parsed.function?.name;
                const rawArgs = parsed.arguments !== undefined ? parsed.arguments : (parsed.args !== undefined ? parsed.args : parsed.parameters);
                if (name) {
                    toolCalls.push({
                        id: "call_" + Math.random().toString(36).substring(2, 9),
                        type: "function",
                        function: {
                            name,
                            arguments: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs || {})
                        }
                    });
                    cleaned = cleaned.replace(m[0], "").trim();
                }
            } catch (_) {}
        }

        // 4. Bracketed tool request format: [tool request] NAME(...) or [tool_call] NAME(...) or [tool] NAME(...)
        const bracketedCallRegex = /\[(?:tool[ _]request|tool[ _]call|tool)\]\s*(?:functions\.)?([a-zA-Z0-9_\-]+)\s*(?:\(\s*([\s\S]*?)\s*\)|\s*(\{[\s\S]*?\}))/gi;
        while ((m = bracketedCallRegex.exec(cleaned)) !== null) {
            const name = m[1];
            const rawArgs = m[2] || m[3];
            const parsedArgs = this.parseToolCallArgs(rawArgs);
            if (parsedArgs && typeof parsedArgs === "object" && Object.keys(parsedArgs).length > 0) {
                toolCalls.push({
                    id: "call_" + Math.random().toString(36).substring(2, 9),
                    type: "function",
                    function: {
                        name,
                        arguments: typeof parsedArgs === "string" ? parsedArgs : JSON.stringify(parsedArgs)
                    }
                });
                cleaned = cleaned.replace(m[0], "").trim();
            }
        }

        // 5. Raw known tool invocation: (run_task|read_file|...)(...) or (run_task|read_file|...){...}
        const knownToolsRegex = /(?:^|[\n.\s])(run_task|read_file|write_file|grep_search|search_and_replace|fetch_web_content|web_search|idle|run_python|generate_image|task_send_input|task_stdout|task_kill)\s*(?:\(\s*([\s\S]*?)\s*\)|(\{[\s\S]*?\}))(?:\s*\1)?/gi;
        while ((m = knownToolsRegex.exec(cleaned)) !== null) {
            const name = m[1];
            const rawArgs = m[2] || m[3];
            const parsedArgs = this.parseToolCallArgs(rawArgs);
            if (parsedArgs && typeof parsedArgs === "object" && Object.keys(parsedArgs).length > 0) {
                toolCalls.push({
                    id: "call_" + Math.random().toString(36).substring(2, 9),
                    type: "function",
                    function: {
                        name,
                        arguments: typeof parsedArgs === "string" ? parsedArgs : JSON.stringify(parsedArgs)
                    }
                });
                cleaned = cleaned.replace(m[0], "").trim();
            }
        }

        // Restore protected markdown code blocks
        for (const block of protectedBlocks) {
            cleaned = cleaned.replace(block.placeholder, block.match);
        }

        return { cleanedText: cleaned, toolCalls };
    }

    /**
     * Normalizes hallucinated tool aliases and repairs XML fragment leaks inside function names.
     */
    normalizeToolCalls(tool_calls) {
        if (!Array.isArray(tool_calls)) return [];
        return tool_calls.map(tc => {
            if (!tc || typeof tc !== "object") return tc;
            let name = String(tc.function?.name || tc.name || "").trim();
            let rawArgs = tc.function?.arguments !== undefined ? tc.function.arguments : (tc.arguments !== undefined ? tc.arguments : tc.parameters);
            let argsObj = {};

            if (typeof rawArgs === "object" && rawArgs !== null) {
                argsObj = { ...rawArgs };
            } else if (typeof rawArgs === "string") {
                try {
                    argsObj = JSON.parse(rawArgs);
                } catch (_) {
                    argsObj = this.parseToolCallArgs(rawArgs);
                    if (typeof argsObj !== "object" || argsObj === null) argsObj = {};
                }
            }

            // Check for XML fragment leaks in function name, e.g.:
            // "read_task_command</arg_key><arg_value>cd "$SCRATCH/apk" && unzip -l ...</arg_value>"
            // or "<arg_value>...</arg_value>"
            const xmlArgMatch = /<\/arg_key><arg_value>([\s\S]*?)(?:<\/arg_value>|$)/i.exec(name) ||
                                /<arg_value>([\s\S]*?)(?:<\/arg_value>|$)/i.exec(name);
            if (xmlArgMatch) {
                const extractedValue = xmlArgMatch[1].trim();
                name = name.replace(/<\/?(?:arg_key|arg_value)[^>]*>[\s\S]*/gi, "").trim();
                if (extractedValue && !argsObj.command) {
                    argsObj.command = extractedValue;
                }
            }

            // Strip any remaining XML or HTML tags from the tool name
            name = name.replace(/<[^>]+>/g, "").trim();

            // Known alias & hallucination mapping to valid system tools:
            const nameLower = name.toLowerCase();
            if (nameLower === "read_task_command" || nameLower === "task_command" || nameLower === "exec_command" ||
                nameLower === "run_command" || nameLower === "execute_command" || nameLower === "terminal" ||
                nameLower === "bash" || nameLower === "shell" || nameLower === "sh" || nameLower === "cmd") {
                name = "run_task";
                if (argsObj.cmd && !argsObj.command) argsObj.command = argsObj.cmd;
            } else if (nameLower === "view_file" || nameLower === "cat" || nameLower === "open_file" || nameLower === "get_file") {
                name = "read_file";
                if (argsObj.file && !argsObj.path) argsObj.path = argsObj.file;
                if (argsObj.filepath && !argsObj.path) argsObj.path = argsObj.filepath;
            } else if (nameLower === "write_to_file" || nameLower === "create_file" || nameLower === "save_file") {
                name = "write_file";
                if (argsObj.file && !argsObj.path) argsObj.path = argsObj.file;
                if (argsObj.filepath && !argsObj.path) argsObj.path = argsObj.filepath;
            } else if (nameLower === "edit_file" || nameLower === "replace_in_file" || nameLower === "str_replace") {
                name = "search_and_replace";
                if (argsObj.file && !argsObj.path) argsObj.path = argsObj.file;
            } else if (nameLower === "find_in_files" || nameLower === "grep" || nameLower === "search_files") {
                name = "grep_search";
            } else if (nameLower === "fetch_web_content" || nameLower === "web_fetch" || nameLower === "fetch_url" || nameLower === "curl" || nameLower === "scrape") {
                name = "web_search";
                if (!argsObj.type) argsObj.type = "fetch";
                if (!argsObj.query && argsObj.url) argsObj.query = argsObj.url;
            } else if (nameLower === "google_search" || nameLower === "duckduckgo_search" || nameLower === "search") {
                name = "web_search";
                if (!argsObj.type) argsObj.type = "search";
            } else if (nameLower === "manage_task" || nameLower === "task_manager") {
                name = "manage_tasks";
            } else if (nameLower === "task_send_input" || nameLower === "send_input") {
                name = "manage_tasks";
                if (!argsObj.action) argsObj.action = "send_input";
            } else if (nameLower === "task_kill" || nameLower === "kill_task") {
                name = "manage_tasks";
                if (!argsObj.action) argsObj.action = "kill_task";
            } else if (nameLower === "task_stdout" || nameLower === "get_task_output") {
                name = "manage_tasks";
                if (!argsObj.action) argsObj.action = "status";
            } else if (nameLower === "sleep" || nameLower === "wait") {
                name = "idle";
            }

            return {
                id: String(tc.id || ("call_" + Math.random().toString(36).substring(2, 9))),
                type: "function",
                function: {
                    name,
                    arguments: JSON.stringify(argsObj)
                },
                thoughtSignature: tc.thoughtSignature || tc.thought_signature || tc.function?.thoughtSignature || tc.function?.thought_signature
            };
        });
    }

    parseResponse(data) {
        const choice = data?.choices?.[0];
        const rawMessage = choice?.message || {};
        let content = rawMessage.content || "";
        let reasoning = rawMessage.reasoning_content || rawMessage.reasoning ? String(rawMessage.reasoning_content || rawMessage.reasoning).trim() : "";
        if (reasoning === "null" || reasoning === "undefined" || reasoning === "{}" || reasoning === "[]") {
            reasoning = "";
        }

        let tool_calls = Array.isArray(rawMessage.tool_calls) ? [...rawMessage.tool_calls] : [];

        // Check if model emitted raw tool calls in reasoning or content
        if (tool_calls.length === 0) {
            if (reasoning) {
                const resR = this.extractToolCallsFromText(reasoning);
                if (resR.toolCalls.length > 0) {
                    tool_calls.push(...resR.toolCalls);
                    reasoning = resR.cleanedText;
                }
            }
            if (content) {
                const resC = this.extractToolCallsFromText(content);
                if (resC.toolCalls.length > 0) {
                    tool_calls.push(...resC.toolCalls);
                    content = resC.cleanedText;
                }
            }
        }

        if (tool_calls.length > 0) {
            tool_calls = this.normalizeToolCalls(tool_calls);
        }

        // Clean any parroted thought-box envelopes from reasoning
        if (reasoning) {
            reasoning = reasoning.replace(/<details class="thought-box"[^>]*>[\s\S]*?<div class="thought-content[^"]*">([\s\S]*?)<\/div>\s*<\/div>\s*<\/details>/gi, "$1").trim();
            reasoning = reasoning.replace(/<\/?(?:details|summary|svg|path|span)[^>]*>/gi, "").trim();
        }

        // If reasoning content mirrors or equals the main content, discard reasoning
        // to prevent falsely wrapping the answer in a thought box and duplicating it.
        if (reasoning && content && reasoning.trim() === content.trim()) {
            reasoning = "";
        }

        if (reasoning && content) {
            const durationStr = data?._durationSec ? `${data._durationSec} seconds` : "a few seconds";
            content = `<details class="thought-box" open data-duration="${data?._durationSec || ''}"><summary class="thought-summary"><span class="thought-header"><svg class="thought-brain-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/><path d="M12 8h4"/><path d="M12 12h3"/><path d="M12 16h4"/><path d="M8 8h4"/><path d="M9 12h3"/><path d="M8 16h4"/></svg><span class="thought-label">Thought for ${durationStr}</span><span class="thought-chevron">›</span></span></summary><div class="thought-body"><div class="thought-content">\n\n${reasoning}\n\n</div></div></details>\n\n${content.trim()}`;
        } else if (reasoning && !content) {
            const durationStr = data?._durationSec ? `${data._durationSec} seconds` : "a few seconds";
            content = `<details class="thought-box" open data-duration="${data?._durationSec || ''}"><summary class="thought-summary"><span class="thought-header"><svg class="thought-brain-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/><path d="M12 8h4"/><path d="M12 12h3"/><path d="M12 16h4"/><path d="M8 8h4"/><path d="M9 12h3"/><path d="M8 16h4"/></svg><span class="thought-label">Thought for ${durationStr}</span><span class="thought-chevron">›</span></span></summary><div class="thought-body"><div class="thought-content">\n\n${reasoning}\n\n</div></div></details>`;
        }

        return {
            message: this.formatAssistantResponse({
                ...rawMessage,
                content,
                tool_calls: tool_calls.length > 0 ? tool_calls : undefined
            })
        };
    }

    async handleChat({ model, apiKey, providerConfig = {}, messages, tools, tool_choice, options = {} }) {
        const modelMeta = (providerConfig.models || []).find(m => m.id === model);
        const supportsTools = modelMeta ? (modelMeta.supports_tools !== false) : true;
        const supportsVision = modelMeta ? Boolean(modelMeta.supports_vision) : false;

        const maxContextTokens = options.maxContextTokens || modelMeta?.max_context_tokens || providerConfig.max_context_tokens;
        const chatOptions = maxContextTokens ? { ...options, maxContextTokens } : options;

        const endpoint = this.getEndpoint(providerConfig, model, apiKey);
        const headers = this.getHeaders(apiKey, { model, providerConfig, ...chatOptions });
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

        const timeoutMs = chatOptions.timeoutMs || providerConfig.timeout_ms || 300000;
        const res = await this.send({
            endpoint,
            headers,
            payload,
            timeoutMs,
            signal: chatOptions.signal || options.signal
        });
        if (!res.ok) {
            // General context overflow recovery: retry once with auto-pruned context window if prompt exceeds limits
            const isContextOverflow = (res.status === 400 || res.status === 413) &&
                typeof res.error === "string" &&
                /prompt exceeds max length|context length|context window|maximum context|too many tokens|token limit|maximum prompt length|reduce your prompt|exceeds the limit of|1214/i.test(res.error);

            if (isContextOverflow && !options._retriedContextOverflow) {
                const currentBudget = chatOptions.maxContextTokens || 55000;
                const retryBudget = Math.max(Math.floor(currentBudget * 0.5), 15000);
                console.warn(`[${this.constructor.displayName || this.constructor.id}] Prompt exceeded context limit (${res.error}). Retrying with auto-pruned context window (${retryBudget} tokens)...`);
                return this.handleChat({
                    model,
                    apiKey,
                    providerConfig,
                    messages,
                    tools,
                    tool_choice,
                    options: { ...options, maxContextTokens: retryBudget, _retriedContextOverflow: true }
                });
            }

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
