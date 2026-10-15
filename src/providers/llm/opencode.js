// Pluggable Provider for OpenCode Zen API (opencode.ai/zen/v1)
// Emulates OpenCode CLI headers, session/request IDs, and sentinel tool schemas
// to satisfy upstream free tier validation requirements.

const crypto = require("crypto");
const BaseProvider = require("./base");

// OpenCode free tier requires all 11 core agent tools to be present in the tools payload
const OPENCODE_SENTINEL_TOOLS = [
    { type: "function", function: { name: "bash", description: "Executes a given bash command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
    { type: "function", function: { name: "edit", description: "Performs string replacements in files", parameters: { type: "object", properties: { filePath: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } }, required: ["filePath", "oldString", "newString"] } } },
    { type: "function", function: { name: "glob", description: "Finds files matching pattern", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } } },
    { type: "function", function: { name: "grep", description: "Searches file contents using regex", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } } },
    { type: "function", function: { name: "read", description: "Reads a file from local filesystem", parameters: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] } } },
    { type: "function", function: { name: "skill", description: "Loads a specialized skill", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
    { type: "function", function: { name: "task", description: "Launch subagent task", parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] } } },
    { type: "function", function: { name: "todowrite", description: "Maintains task list", parameters: { type: "object", properties: { todos: { type: "array" } }, required: ["todos"] } } },
    { type: "function", function: { name: "webfetch", description: "Fetches web URL content", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
    { type: "function", function: { name: "websearch", description: "Performs web searches", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
    { type: "function", function: { name: "write", description: "Writes file to disk", parameters: { type: "object", properties: { filePath: { type: "string" }, content: { type: "string" } }, required: ["filePath", "content"] } } }
];

const OPENCODE_SENTINEL_TOOLS_FLAT = OPENCODE_SENTINEL_TOOLS.map(t => ({
    type: "function",
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters
}));

/**
 * OpenCode Zen uses the OpenAI Responses protocol (/v1/responses) for specific model families
 * (such as muse-spark, gpt-5/6, grok), while traditional models use /v1/chat/completions.
 */
function isResponsesProtocolModel(model) {
    const clean = (model || "").toLowerCase().replace(/^(opencode|opencode[-_]?zen):/i, "").trim();
    return clean.includes("muse-") || clean.startsWith("gpt-5") || clean.startsWith("gpt-6") || clean.startsWith("grok");
}

let lastTimestamp = 0;
let counter = 0;

/**
 * Generates an OpenCode-compliant 26-character timestamp-encoded ID.
 * OpenCode binary logic:
 *   Session ID: "ses_" + ID(true)  (uses bitwise NOT on timestamp val)
 *   Request ID: "msg_" + ID(false) (uses raw timestamp val)
 */
function generateOpenCodeId(descending, timestamp = Date.now()) {
    if (timestamp !== lastTimestamp) {
        lastTimestamp = timestamp;
        counter = 0;
    }
    counter++;
    const val = BigInt(timestamp) * 0x1000n + BigInt(counter);
    const A = descending ? ~val : val;
    const hexPrefix = Array.from({ length: 6 }, (_, W) =>
        Number((A >> BigInt(40 - 8 * W)) & 0xffn).toString(16).padStart(2, "0")
    ).join("");
    const randomBytes = crypto.randomBytes(14);
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const randomSuffix = Array.from(randomBytes, (b) => chars[b % 62]).join("");
    return hexPrefix + randomSuffix;
}

/**
 * Maps OpenCode's sentinel tool names and arguments back into MultiAI's native tools.
 */
function mapOpenCodeSentinelToolCall(tc) {
    if (!tc || !tc.function) return tc;
    const name = tc.function.name;
    let args = {};
    try {
        args = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments || "{}") : (tc.function.arguments || {});
    } catch (_) {
        args = {};
    }

    if (name === "todowrite") {
        return {
            ...tc,
            function: {
                name: "write_todos",
                arguments: JSON.stringify(args)
            }
        };
    }
    if (name === "bash") {
        return {
            ...tc,
            function: {
                name: "run_task",
                arguments: JSON.stringify({
                    command: args.command || "",
                    task_name: args.task_name || "Run shell command"
                })
            }
        };
    }
    if (name === "read") {
        return {
            ...tc,
            function: {
                name: "read_file",
                arguments: JSON.stringify({
                    path: args.filePath || args.path || ""
                })
            }
        };
    }
    if (name === "write") {
        return {
            ...tc,
            function: {
                name: "write_file",
                arguments: JSON.stringify({
                    path: args.filePath || args.path || "",
                    content: args.content || ""
                })
            }
        };
    }
    if (name === "edit") {
        return {
            ...tc,
            function: {
                name: "replace_file_content",
                arguments: JSON.stringify({
                    path: args.filePath || args.path || "",
                    target_content: args.oldString || args.target_content || "",
                    replacement_content: args.newString || args.replacement_content || ""
                })
            }
        };
    }
    if (name === "websearch") {
        return {
            ...tc,
            function: {
                name: "web_search",
                arguments: JSON.stringify({
                    query: args.query || ""
                })
            }
        };
    }
    return tc;
}

class OpenCodeProvider extends BaseProvider {
    static id = "opencode";
    static displayName = "OpenCode Zen";
    static matchPatterns = [
        /^(opencode|opencode[-_]?zen)$/i,
        "opencode",
        "opencode-zen",
        "opencodezen"
    ];

    getEndpoint(config = {}, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "https://opencode.ai/zen/v1";
        const clean = baseUrl.replace(/\/+$/, "");
        const cleanModel = (model || "").replace(/^(opencode|opencode-zen):/i, "") || config.model;
        if (isResponsesProtocolModel(cleanModel)) {
            return clean.endsWith("/responses") ? clean : `${clean}/responses`;
        }
        return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
    }

    getHeaders(apiKey, options = {}) {
        const sessionId = "ses_" + generateOpenCodeId(true);
        const requestId = "msg_" + generateOpenCodeId(false);

        const headers = {
            "Content-Type": "application/json",
            "User-Agent": "opencode/1.18.32 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14",
            "x-opencode-client": "cli",
            "x-opencode-project": "global",
            "x-opencode-session": sessionId,
            "x-opencode-request": requestId
        };

        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        return headers;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false, options = {} }) {
        const maxContextTokens = options.maxContextTokens || config.max_context_tokens || 100000;
        const msgsToNormalize = maxContextTokens ? this.pruneMessagesForContext(messages, maxContextTokens, options) : messages;

        // Strip any provider prefixes (e.g. "opencode:mimo-v2.6-flash-free" -> "mimo-v2.6-flash-free")
        const cleanModel = (model || "").replace(/^(opencode|opencode-zen):/i, "") || config.model;
        const normalized = this.normalizeMessages(msgsToNormalize, supportsTools, supportsVision);
        const useResponses = isResponsesProtocolModel(cleanModel);

        if (useResponses) {
            // Transform messages into OpenAI Responses API input format
            const input = [];
            for (const msg of normalized) {
                if (!msg) continue;
                if (msg.role === "tool") {
                    input.push({
                        type: "function_call_output",
                        call_id: msg.tool_call_id || "call_unknown",
                        output: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
                    });
                } else if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                    if (msg.content) {
                        input.push({
                            role: "assistant",
                            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
                        });
                    }
                    for (const tc of msg.tool_calls) {
                        input.push({
                            type: "function_call",
                            call_id: tc.id || ("call_" + generateOpenCodeId(false)),
                            name: tc.function?.name || tc.name || "",
                            arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {})
                        });
                    }
                } else {
                    input.push({
                        role: msg.role === "system" ? "system" : (msg.role === "assistant" ? "assistant" : "user"),
                        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
                    });
                }
            }

            const effectiveTools = OPENCODE_SENTINEL_TOOLS_FLAT.map(t => ({ ...t }));
            if (Array.isArray(tools) && tools.length > 0) {
                for (const userTool of tools) {
                    const name = userTool?.function?.name || userTool?.name;
                    if (!name) continue;
                    if (!effectiveTools.some(t => t.name === name)) {
                        effectiveTools.push({
                            type: "function",
                            name,
                            description: userTool?.function?.description || userTool?.description || "",
                            parameters: userTool?.function?.parameters || userTool?.parameters || { type: "object", properties: {} }
                        });
                    }
                }
            }

            const payload = {
                model: cleanModel,
                input,
                tools: effectiveTools,
                tool_choice: (Array.isArray(tools) && tools.length > 0) ? (tool_choice || "auto") : "auto",
                stream: true
            };

            if (config.default_max_tokens) {
                payload.max_tokens = config.default_max_tokens;
            }

            return payload;
        }

        // Standard OpenAI Chat Completions payload
        const payload = {
            model: cleanModel,
            messages: normalized,
            stream: true // OpenCode free tier strictly requires stream: true
        };

        if (config.default_max_tokens) {
            payload.max_tokens = config.default_max_tokens;
        }

        // Upstream FreeTier validation requires the 11 sentinel tools to be present in the request.
        // If the caller provided tools, merge them; otherwise provide the sentinel set with tool_choice: "none"
        // so the model does not attempt unprompted tool calls.
        const effectiveTools = [...OPENCODE_SENTINEL_TOOLS];
        if (Array.isArray(tools) && tools.length > 0) {
            for (const userTool of tools) {
                const name = userTool?.function?.name || userTool?.name;
                if (!effectiveTools.some(t => (t.function?.name || t.name) === name)) {
                    effectiveTools.push(userTool);
                }
            }
            payload.tools = effectiveTools;
            payload.tool_choice = tool_choice || "auto";
        } else {
            payload.tools = effectiveTools;
            payload.tool_choice = "none";
        }

        return payload;
    }

    /**
     * Overrides send() with an SSE stream accumulator.
     * OpenCode free tier requires stream: true, returning event-stream deltas.
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

        // Enforce stream flag
        const streamPayload = { ...payload, stream: true };
        const isResponses = Boolean(endpoint.endsWith("/responses") || streamPayload.input);

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
                try {
                    const parsedErr = JSON.parse(cleanErr);
                    if (parsedErr?.error?.message) cleanErr = parsedErr.error.message;
                    else if (parsedErr?.message) cleanErr = parsedErr.message;
                } catch (_) {}

                return {
                    ok: false,
                    status: res.status,
                    error: `OpenCode Zen API error (${res.status}): ${cleanErr}`
                };
            }

            const contentType = (res.headers.get("content-type") || "").toLowerCase();

            // If upstream returned standard JSON directly
            if (!contentType.includes("event-stream") && !contentType.includes("ndjson") && contentType.includes("json")) {
                const data = await res.json();
                clearTimeout(timeout);
                const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
                if (data && typeof data === "object") data._durationSec = elapsedSec;
                return { ok: true, status: res.status, data };
            }

            // Reassemble SSE stream into standard chat completion object
            let fullContent = "";
            let fullReasoning = "";
            const fullToolCalls = [];
            let lastId = "opencode-" + Date.now();
            let modelName = streamPayload.model;
            let finishReason = "stop";
            let buffer = "";
            let isDone = false;

            for await (const chunk of res.body) {
                if (isDone) break;
                buffer += Buffer.from(chunk).toString("utf8");
                const lines = buffer.split("\n");
                buffer = lines.pop(); // keep partial line

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === ": keep-alive") continue;
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

                        if (isResponses) {
                            // --- OpenAI Responses API Stream Format ---
                            if (parsed.response?.id) lastId = parsed.response.id;
                            if (parsed.response?.model) modelName = parsed.response.model;

                            const evtType = parsed.type;
                            if (evtType === "response.output_text.delta" && typeof parsed.delta === "string") {
                                fullContent += parsed.delta;
                            } else if (evtType === "response.reasoning_text.delta" && typeof parsed.delta === "string") {
                                fullReasoning += parsed.delta;
                            } else if (evtType === "response.output_item.added") {
                                if (parsed.item?.type === "function_call") {
                                    const callId = parsed.item.call_id || parsed.item.id;
                                    fullToolCalls.push({
                                        id: callId,
                                        type: "function",
                                        function: {
                                            name: parsed.item.name || "",
                                            arguments: parsed.item.arguments || ""
                                        }
                                    });
                                }
                            } else if (evtType === "response.function_call_arguments.delta") {
                                const itemId = parsed.item_id;
                                const target = fullToolCalls.find(tc => tc.id === itemId) || fullToolCalls[fullToolCalls.length - 1];
                                if (target && parsed.delta) {
                                    target.function.arguments += parsed.delta;
                                }
                            } else if (evtType === "response.function_call_arguments.done") {
                                const itemId = parsed.item_id;
                                const target = fullToolCalls.find(tc => tc.id === itemId) || fullToolCalls[fullToolCalls.length - 1];
                                if (target && parsed.arguments) {
                                    target.function.arguments = parsed.arguments;
                                }
                            } else if (evtType === "response.output_item.done") {
                                if (parsed.item?.type === "function_call") {
                                    const callId = parsed.item.call_id || parsed.item.id;
                                    let target = fullToolCalls.find(tc => tc.id === callId);
                                    if (!target) {
                                        target = { id: callId, type: "function", function: { name: "", arguments: "" } };
                                        fullToolCalls.push(target);
                                    }
                                    if (parsed.item.name) target.function.name = parsed.item.name;
                                    if (parsed.item.arguments) target.function.arguments = parsed.item.arguments;
                                } else if (parsed.item?.type === "message" && Array.isArray(parsed.item.content)) {
                                    for (const part of parsed.item.content) {
                                        if (part.type === "output_text" && part.text && !fullContent) {
                                            fullContent += part.text;
                                        }
                                    }
                                }
                            } else if (evtType === "response.completed") {
                                finishReason = fullToolCalls.length > 0 ? "tool_calls" : "stop";
                                isDone = true;
                                break;
                            }
                        } else {
                            // --- Standard OpenAI Chat Completions Stream Format ---
                            if (parsed.id) lastId = parsed.id;
                            if (parsed.model) modelName = parsed.model;

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
                                                    function: { name: "", arguments: "" }
                                                };
                                            }
                                            if (tc.id) fullToolCalls[idx].id = tc.id;
                                            if (tc.function?.name) fullToolCalls[idx].function.name += tc.function.name;
                                            if (tc.function?.arguments) fullToolCalls[idx].function.arguments += tc.function.arguments;
                                        }
                                    }
                                }
                            }
                        }
                    } catch (_) {}
                }
                if (isDone) break;
            }
            clearTimeout(timeout);

            // Fallback if main content empty but reasoning present
            if (!fullContent.trim() && fullReasoning.trim()) {
                fullContent = fullReasoning;
            }

            const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
            const mappedToolCalls = fullToolCalls
                .filter(Boolean)
                .map(mapOpenCodeSentinelToolCall);

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
                        ...(mappedToolCalls.length > 0 ? { tool_calls: mappedToolCalls } : {})
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
                return { ok: false, status: 504, error: `OpenCode Zen request timed out after ${timeoutMs / 1000}s` };
            }
            const causeDetail = err.cause ? (err.cause.message || err.cause.code || String(err.cause)) : "";
            const detailMsg = causeDetail ? `${err.message} (${causeDetail})` : (err.message || "Unknown network error");
            return { ok: false, status: 502, error: `OpenCode Zen upstream connection failed: ${detailMsg}` };
        }
    }
}

module.exports = OpenCodeProvider;
