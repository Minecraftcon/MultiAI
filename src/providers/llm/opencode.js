// Pluggable Provider for OpenCode (Local Daemon & CLI with Cloud Fallback)
// Bridges MultiAI to OpenCode v2's local authenticated runtime and service daemon,
// eliminating 429 client-detection gate errors on free models (MiMo, DeepSeek, GLM, Nemotron, etc.).

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const BaseProvider = require("./base");

// OpenCode core agent tools mapping
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
 * Checks if a model requires the Responses protocol on cloud endpoints
 */
function isResponsesProtocolModel(model) {
    const clean = (model || "").toLowerCase().replace(/^(opencode|opencode[-_]?zen):/i, "").trim();
    return clean.includes("muse-") || clean.startsWith("gpt-5") || clean.startsWith("gpt-6") || clean.startsWith("grok");
}

let lastTimestamp = 0;
let counter = 0;

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
    if (!tc) return tc;
    const name = tc.function?.name || tc.name || tc.tool;
    let args = {};
    try {
        const rawArgs = tc.function?.arguments || tc.arguments || tc.input || tc.state?.input;
        args = typeof rawArgs === "string" ? JSON.parse(rawArgs || "{}") : (rawArgs || {});
    } catch (_) {
        args = {};
    }

    const id = tc.id || ("call_" + Math.random().toString(36).substring(2, 9));

    if (name === "todowrite" || name === "write_todos") {
        return { id, type: "function", function: { name: "write_todos", arguments: JSON.stringify(args) } };
    }
    if (name === "bash" || name === "shell" || name === "run_task") {
        return {
            id,
            type: "function",
            function: {
                name: "run_task",
                arguments: JSON.stringify({
                    command: args.command || "",
                    task_name: args.task_name || "Run shell command"
                })
            }
        };
    }
    if (name === "read" || name === "read_file") {
        return {
            id,
            type: "function",
            function: {
                name: "read_file",
                arguments: JSON.stringify({ path: args.filePath || args.path || "" })
            }
        };
    }
    if (name === "write" || name === "write_file") {
        return {
            id,
            type: "function",
            function: {
                name: "write_file",
                arguments: JSON.stringify({ path: args.filePath || args.path || "", content: args.content || "" })
            }
        };
    }
    if (name === "edit" || name === "replace_file_content") {
        return {
            id,
            type: "function",
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
    if (name === "websearch" || name === "web_search") {
        return {
            id,
            type: "function",
            function: {
                name: "web_search",
                arguments: JSON.stringify({ query: args.query || "" })
            }
        };
    }
    return {
        id,
        type: "function",
        function: {
            name: name || "unknown_tool",
            arguments: JSON.stringify(args)
        }
    };
}

/**
 * Normalizes user/model string into clean OpenCode model identifier
 */
function normalizeOpenCodeModel(model, fallback = "mimo-v2.6-flash-free") {
    if (!model) return fallback;
    const clean = String(model)
        .replace(/^(opencode|opencode[-_]?zen):/i, "")
        .replace(/^opencode\//i, "")
        .trim();
    return clean || fallback;
}

/**
 * Reads OpenCode service configuration from state directory
 */
function getOpenCodeService() {
    try {
        const home = process.env.HOME || "";
        const stateHome = process.env.XDG_STATE_HOME || path.join(home, ".local", "state");
        const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");

        const candidates = [
            path.join(stateHome, "opencode", "service.json"),
            path.join(configHome, "opencode", "service.json")
        ];

        for (const p of candidates) {
            if (fs.existsSync(p)) {
                const raw = fs.readFileSync(p, "utf8");
                const data = JSON.parse(raw);
                if (data?.url) return data;
            }
        }
    } catch (_) {}
    return null;
}

/**
 * Pings the local OpenCode daemon to ensure it is actively accepting connections
 */
async function pingOpenCodeService(service) {
    if (!service?.url) return false;
    try {
        const auth = service.password
            ? ("Basic " + Buffer.from(`opencode:${service.password}`).toString("base64"))
            : undefined;
        const res = await fetch(`${service.url}/api/info`, {
            headers: auth ? { Authorization: auth } : {},
            signal: AbortSignal.timeout(1500)
        });
        return res.ok;
    } catch (_) {
        return false;
    }
}

/**
 * Finds the OpenCode CLI executable path on the system
 */
function getOpenCodeCliPath() {
    if (process.env.OPENCODE_BIN && fs.existsSync(process.env.OPENCODE_BIN)) {
        return process.env.OPENCODE_BIN;
    }
    const home = process.env.HOME || "";
    const defaultBin = path.join(home, ".opencode", "bin", "opencode");
    if (fs.existsSync(defaultBin)) {
        return defaultBin;
    }
    return "opencode";
}

/**
 * Safely deletes a temporary session on the local daemon
 */
async function deleteOpenCodeSession(service, sessionId) {
    if (!service?.url || !sessionId) return;
    try {
        const auth = service.password
            ? ("Basic " + Buffer.from(`opencode:${service.password}`).toString("base64"))
            : undefined;
        await fetch(`${service.url}/api/session/${sessionId}`, {
            method: "DELETE",
            headers: auth ? { Authorization: auth } : {},
            signal: AbortSignal.timeout(2000)
        });
    } catch (_) {}
}

/**
 * Formats conversation messages into a clean, context-rich prompt string for OpenCode
 */
function formatMessagesToOpenCodePrompt(messages = [], tools = []) {
    if (!Array.isArray(messages) || messages.length === 0) return "";

    // Single message fast-path
    if (messages.length === 1 && (!tools || tools.length === 0)) {
        const m = messages[0];
        return typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    }

    const sections = [];

    // Optional tool capabilities preamble
    if (Array.isArray(tools) && tools.length > 0) {
        const toolList = tools.map(t => {
            const fn = t.function || t;
            return `- ${fn.name}: ${fn.description || ""}\n  Parameters: ${JSON.stringify(fn.parameters || {})}`;
        }).join("\n");
        sections.push(`[Available Tools]\nYou have access to the following functions:\n${toolList}\n\nTo use a tool, invoke it with appropriate arguments.`);
    }

    for (const msg of messages) {
        if (!msg) continue;
        const role = msg.role;
        const content = typeof msg.content === "string"
            ? msg.content
            : (msg.content ? JSON.stringify(msg.content) : "");

        if (role === "system") {
            sections.push(`[System Instructions]:\n${content}`);
        } else if (role === "user") {
            sections.push(`[User]:\n${content}`);
        } else if (role === "assistant") {
            let asst = `[Assistant]:\n${content || ""}`;
            if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                const toolCallsStr = msg.tool_calls.map(tc => {
                    const fn = tc.function || tc;
                    return `Action: ${fn.name}(${typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {})})`;
                }).join("\n");
                asst += `\n${toolCallsStr}`;
            }
            sections.push(asst);
        } else if (role === "tool") {
            sections.push(`[Tool Result (${msg.name || "action"})]:\n${content}`);
        }
    }

    return sections.join("\n\n");
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
            "User-Agent": "opencode/2.2.5",
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
        const cleanModel = normalizeOpenCodeModel(model, config.model);
        const normalized = this.normalizeMessages(msgsToNormalize, supportsTools, supportsVision);
        const useResponses = isResponsesProtocolModel(cleanModel);

        if (useResponses) {
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

        const payload = {
            model: cleanModel,
            messages: normalized,
            stream: true
        };

        if (config.default_max_tokens) {
            payload.max_tokens = config.default_max_tokens;
        }

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
     * Primary chat handler supporting local OpenCode daemon, local CLI subprocess,
     * and fallback to remote cloud endpoints.
     */
    async handleChat({ model, apiKey, providerConfig = {}, messages, tools, tool_choice, options = {} }) {
        const cleanModel = normalizeOpenCodeModel(model, providerConfig.model);

        // 1. Try local OpenCode background daemon
        const service = getOpenCodeService();
        if (service && (await pingOpenCodeService(service))) {
            const daemonResult = await this.executeViaDaemon({
                service,
                cleanModel,
                messages,
                tools,
                options
            });
            if (daemonResult.ok) {
                const parsed = this.parseResponse(daemonResult.data);
                return { status: 200, message: parsed.message };
            }
        }

        // 2. Try local OpenCode CLI subprocess
        const cliPath = getOpenCodeCliPath();
        if (cliPath) {
            const cliResult = await this.executeViaCli({
                cliPath,
                cleanModel,
                messages,
                tools,
                options
            });
            if (cliResult.ok) {
                const parsed = this.parseResponse(cliResult.data);
                return { status: 200, message: parsed.message };
            }
        }

        // 3. Fallback to standard BaseProvider execution (direct cloud API)
        return super.handleChat({ model, apiKey, providerConfig, messages, tools, tool_choice, options });
    }

    /**
     * Streaming chat handler routing deltas in real-time to the client response.
     */
    async handleChatStream({ model, apiKey, providerConfig = {}, messages, tools, tool_choice, options = {}, req, res }) {
        const cleanModel = normalizeOpenCodeModel(model, providerConfig.model);

        // 1. Try streaming via local OpenCode background service
        const service = getOpenCodeService();
        if (service && (await pingOpenCodeService(service))) {
            const streamResult = await this.streamViaDaemon({
                service,
                cleanModel,
                messages,
                tools,
                options,
                req,
                res
            });
            if (streamResult.ok) return { status: 200 };
        }

        // 2. Try streaming via local OpenCode CLI subprocess
        const cliPath = getOpenCodeCliPath();
        if (cliPath) {
            const streamResult = await this.streamViaCli({
                cliPath,
                cleanModel,
                messages,
                tools,
                options,
                req,
                res
            });
            if (streamResult.ok) return { status: 200 };
        }

        // 3. Fallback to standard BaseProvider HTTP streaming
        return super.handleChatStream({ model, apiKey, providerConfig, messages, tools, tool_choice, options, req, res });
    }

    /**
     * Executes a non-streaming turn via the local OpenCode daemon
     */
    async executeViaDaemon({ service, cleanModel, messages, tools, options = {} }) {
        const startTime = Date.now();
        const timeoutMs = options.timeoutMs || 300000;
        const promptText = formatMessagesToOpenCodePrompt(messages, tools);
        const auth = service.password
            ? ("Basic " + Buffer.from(`opencode:${service.password}`).toString("base64"))
            : undefined;
        const headers = { "Content-Type": "application/json" };
        if (auth) headers["Authorization"] = auth;

        let sessionId = null;
        try {
            // Create session
            const sessRes = await fetch(`${service.url}/api/session`, {
                method: "POST",
                headers,
                body: JSON.stringify({ title: `MultiAI Turn (${cleanModel})` }),
                signal: AbortSignal.timeout(10000)
            });
            if (!sessRes.ok) throw new Error(`Failed to create session: HTTP ${sessRes.status}`);
            const sessData = await sessRes.json();
            sessionId = sessData?.data?.id;
            if (!sessionId) throw new Error("No session ID returned by daemon");

            // Set model for session
            await fetch(`${service.url}/api/session/${sessionId}/model`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    model: { id: cleanModel, providerID: "opencode" }
                }),
                signal: AbortSignal.timeout(10000)
            });

            // Send prompt
            const promptRes = await fetch(`${service.url}/api/session/${sessionId}/prompt`, {
                method: "POST",
                headers,
                body: JSON.stringify({ text: promptText }),
                signal: AbortSignal.timeout(15000)
            });
            if (!promptRes.ok) throw new Error(`Prompt rejected: HTTP ${promptRes.status}`);

            // Poll for completion
            const deadline = Date.now() + timeoutMs;
            let assistantMsg = null;
            let errorMsg = null;

            while (Date.now() < deadline) {
                if (options.signal?.aborted) throw new Error("Client cancelled request");
                await new Promise(r => setTimeout(r, 250));

                const msgRes = await fetch(`${service.url}/api/session/${sessionId}/message`, {
                    headers: auth ? { Authorization: auth } : {},
                    signal: AbortSignal.timeout(5000)
                });
                if (!msgRes.ok) continue;

                const msgData = await msgRes.json();
                const items = msgData?.data || [];

                // Check for failure
                const failedItem = items.find(m => m.outcome === "failed" || m.finish === "error" || m.error);
                if (failedItem?.error?.message) {
                    errorMsg = failedItem.error.message;
                    break;
                }

                const found = items.find(m => m.type === "assistant" && m.time?.completed);
                if (found) {
                    assistantMsg = found;
                    break;
                }
            }

            if (errorMsg) {
                return { ok: false, status: 400, error: `OpenCode daemon error: ${errorMsg}` };
            }
            if (!assistantMsg) {
                return { ok: false, status: 504, error: "OpenCode daemon turn timed out" };
            }

            let fullContent = "";
            let fullReasoning = "";
            const toolCalls = [];

            for (const part of (assistantMsg.content || [])) {
                if (part.type === "reasoning" && part.text) {
                    fullReasoning += part.text;
                } else if (part.type === "text" && part.text) {
                    fullContent += part.text;
                } else if (part.type === "tool") {
                    toolCalls.push(mapOpenCodeSentinelToolCall(part));
                }
            }

            if (!fullContent && fullReasoning) {
                fullContent = fullReasoning;
            }

            const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
            const assembled = {
                id: assistantMsg.id || ("opencode-" + Date.now()),
                model: cleanModel,
                object: "chat.completion",
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: fullContent,
                        reasoning_content: fullReasoning,
                        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
                    },
                    finish_reason: assistantMsg.finish || "stop"
                }],
                _durationSec: elapsedSec
            };

            return { ok: true, status: 200, data: assembled };
        } catch (err) {
            return { ok: false, status: 502, error: `OpenCode daemon execution error: ${err.message}` };
        } finally {
            if (sessionId) {
                deleteOpenCodeSession(service, sessionId).catch(() => {});
            }
        }
    }

    /**
     * Streams real-time tokens and reasoning deltas from the local OpenCode daemon
     */
    async streamViaDaemon({ service, cleanModel, messages, tools, options = {}, req, res }) {
        const promptText = formatMessagesToOpenCodePrompt(messages, tools);
        const auth = service.password
            ? ("Basic " + Buffer.from(`opencode:${service.password}`).toString("base64"))
            : undefined;
        const headers = { "Content-Type": "application/json" };
        if (auth) headers["Authorization"] = auth;

        let sessionId = null;
        let eventReq = null;

        try {
            // Create session
            const sessRes = await fetch(`${service.url}/api/session`, {
                method: "POST",
                headers,
                body: JSON.stringify({ title: `MultiAI Stream (${cleanModel})` }),
                signal: AbortSignal.timeout(10000)
            });
            if (!sessRes.ok) return { ok: false };
            const sessData = await sessRes.json();
            sessionId = sessData?.data?.id;
            if (!sessionId) return { ok: false };

            // Switch model
            await fetch(`${service.url}/api/session/${sessionId}/model`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    model: { id: cleanModel, providerID: "opencode" }
                }),
                signal: AbortSignal.timeout(10000)
            });

            // Prepare SSE headers on response
            res.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            });
            if (res.socket) res.socket.setNoDelay(true);
            if (typeof res.flushHeaders === "function") res.flushHeaders();

            const parsedUrl = new URL(service.url);

            const writeDelta = (deltaObj, finishReason = null) => {
                const chunk = {
                    choices: [{
                        index: 0,
                        delta: deltaObj,
                        finish_reason: finishReason
                    }]
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                if (typeof res.flush === "function") res.flush();
            };

            await new Promise((resolve, reject) => {
                let finished = false;
                let overallTimeout = null;

                const finishStream = (err) => {
                    if (finished) return;
                    finished = true;
                    if (overallTimeout) clearTimeout(overallTimeout);
                    if (eventReq) {
                        try { eventReq.destroy(); } catch (_) {}
                    }
                    if (err) reject(err);
                    else resolve();
                };

                if (req) {
                    req.on("close", () => finishStream());
                }

                eventReq = http.request({
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port,
                    path: "/api/event",
                    method: "GET",
                    auth: `opencode:${service.password || ""}`
                }, evtRes => {
                    let buf = "";
                    evtRes.on("data", chunk => {
                        buf += chunk.toString("utf8");
                        const lines = buf.split("\n");
                        buf = lines.pop();

                        for (const line of lines) {
                            if (!line.startsWith("data: ")) continue;
                            try {
                                const evt = JSON.parse(line.slice(6));
                                if (evt.data?.sessionID !== sessionId) continue;

                                if (evt.type === "session.reasoning.delta" && evt.data?.delta) {
                                    writeDelta({ reasoning_content: evt.data.delta });
                                } else if (evt.type === "session.text.delta" && evt.data?.delta) {
                                    writeDelta({ content: evt.data.delta });
                                } else if (evt.type === "session.execution.succeeded" || evt.type === "session.step.ended") {
                                    writeDelta({}, "stop");
                                    res.write("data: [DONE]\n\n");
                                    res.end();
                                    finishStream();
                                } else if (evt.type === "session.step.failed" || evt.type === "session.execution.failed") {
                                    const errMsg = evt.data?.error?.message || "Execution failed";
                                    writeDelta({ content: `\n[OpenCode error: ${errMsg}]` }, "stop");
                                    res.write("data: [DONE]\n\n");
                                    res.end();
                                    finishStream();
                                }
                            } catch (_) {}
                        }
                    });

                    evtRes.on("error", err => finishStream(err));
                    evtRes.on("end", () => finishStream());
                });

                eventReq.on("error", err => finishStream(err));
                eventReq.end();

                // Dispatch prompt
                setTimeout(() => {
                    fetch(`${service.url}/api/session/${sessionId}/prompt`, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ text: promptText }),
                        signal: AbortSignal.timeout(15000)
                    }).catch(err => finishStream(err));
                }, 100);

                // Overall timeout
                overallTimeout = setTimeout(() => {
                    if (!finished) {
                        res.write("data: [DONE]\n\n");
                        res.end();
                        finishStream();
                    }
                }, options.timeoutMs || 300000);
            });

            return { ok: true };
        } catch (_) {
            return { ok: false };
        } finally {
            if (sessionId) {
                deleteOpenCodeSession(service, sessionId).catch(() => {});
            }
        }
    }

    /**
     * Executes non-streaming prompt via local OpenCode CLI subprocess
     */
    async executeViaCli({ cliPath, cleanModel, messages, tools, options = {} }) {
        const startTime = Date.now();
        const promptText = formatMessagesToOpenCodePrompt(messages, tools);

        return new Promise((resolve) => {
            const child = spawn(cliPath, [
                "run",
                "--format", "json",
                "--thinking",
                "-m", `opencode/${cleanModel}`
            ], {
                stdio: ["pipe", "pipe", "pipe"]
            });

            let fullContent = "";
            let fullReasoning = "";
            const toolCalls = [];
            let finishReason = "stop";
            let stdoutBuf = "";
            let stderrBuf = "";

            child.stdout.on("data", chunk => {
                stdoutBuf += chunk.toString("utf8");
                const lines = stdoutBuf.split("\n");
                stdoutBuf = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (parsed.type === "reasoning" && parsed.part?.text) {
                            fullReasoning += parsed.part.text;
                        } else if (parsed.type === "text" && parsed.part?.text) {
                            fullContent += parsed.part.text;
                        } else if (parsed.type === "tool_use" && parsed.part) {
                            toolCalls.push(mapOpenCodeSentinelToolCall(parsed.part));
                        } else if (parsed.type === "step_finish") {
                            finishReason = parsed.part?.reason || "stop";
                        }
                    } catch (_) {}
                }
            });

            child.stderr.on("data", chunk => {
                stderrBuf += chunk.toString("utf8");
            });

            child.on("close", code => {
                if (!fullContent && fullReasoning) {
                    fullContent = fullReasoning;
                }

                if (!fullContent && code !== 0) {
                    resolve({
                        ok: false,
                        status: 502,
                        error: `OpenCode CLI failed (exit ${code}): ${stderrBuf.slice(0, 300)}`
                    });
                    return;
                }

                const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
                const assembled = {
                    id: "opencode-cli-" + Date.now(),
                    model: cleanModel,
                    object: "chat.completion",
                    choices: [{
                        index: 0,
                        message: {
                            role: "assistant",
                            content: fullContent,
                            reasoning_content: fullReasoning,
                            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
                        },
                        finish_reason: finishReason
                    }],
                    _durationSec: elapsedSec
                };

                resolve({ ok: true, status: 200, data: assembled });
            });

            child.on("error", err => {
                resolve({ ok: false, status: 502, error: `Failed to spawn OpenCode CLI: ${err.message}` });
            });

            child.stdin.end(promptText, "utf8");
        });
    }

    /**
     * Streams prompt output via local OpenCode CLI subprocess
     */
    async streamViaCli({ cliPath, cleanModel, messages, tools, options = {}, req, res }) {
        const promptText = formatMessagesToOpenCodePrompt(messages, tools);

        return new Promise((resolve) => {
            const child = spawn(cliPath, [
                "run",
                "--format", "json",
                "--thinking",
                "-m", `opencode/${cleanModel}`
            ], {
                stdio: ["pipe", "pipe", "pipe"]
            });

            res.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            });
            if (res.socket) res.socket.setNoDelay(true);
            if (typeof res.flushHeaders === "function") res.flushHeaders();

            const writeDelta = (deltaObj, finishReason = null) => {
                const chunk = {
                    choices: [{
                        index: 0,
                        delta: deltaObj,
                        finish_reason: finishReason
                    }]
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                if (typeof res.flush === "function") res.flush();
            };

            if (req) {
                req.on("close", () => {
                    try { child.kill("SIGTERM"); } catch (_) {}
                });
            }

            let stdoutBuf = "";
            child.stdout.on("data", chunk => {
                stdoutBuf += chunk.toString("utf8");
                const lines = stdoutBuf.split("\n");
                stdoutBuf = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (parsed.type === "reasoning" && parsed.part?.text) {
                            writeDelta({ reasoning_content: parsed.part.text });
                        } else if (parsed.type === "text" && parsed.part?.text) {
                            writeDelta({ content: parsed.part.text });
                        } else if (parsed.type === "step_finish") {
                            writeDelta({}, parsed.part?.reason || "stop");
                        }
                    } catch (_) {}
                }
            });

            child.on("close", () => {
                res.write("data: [DONE]\n\n");
                res.end();
                resolve({ ok: true });
            });

            child.on("error", err => {
                if (!res.headersSent) {
                    resolve({ ok: false, error: err.message });
                } else {
                    res.write("data: [DONE]\n\n");
                    res.end();
                    resolve({ ok: true });
                }
            });

            child.stdin.end(promptText, "utf8");
        });
    }

    /**
     * Fallback send() implementation for direct HTTP callers
     */
    async send(args) {
        const { endpoint, headers, payload, timeoutMs = 300000, signal } = args;
        const cleanModel = normalizeOpenCodeModel(payload?.model);

        // If local daemon is alive, fulfill send() via daemon to avoid 429
        const service = getOpenCodeService();
        if (service && (await pingOpenCodeService(service))) {
            const daemonRes = await this.executeViaDaemon({
                service,
                cleanModel,
                messages: payload.messages || [],
                tools: payload.tools || [],
                options: { timeoutMs, signal }
            });
            if (daemonRes.ok) return daemonRes;
        }

        // If CLI is available, fulfill send() via CLI
        const cliPath = getOpenCodeCliPath();
        if (cliPath) {
            const cliRes = await this.executeViaCli({
                cliPath,
                cleanModel,
                messages: payload.messages || [],
                tools: payload.tools || [],
                options: { timeoutMs, signal }
            });
            if (cliRes.ok) return cliRes;
        }

        // Otherwise standard HTTP
        return super.send(args);
    }
}

module.exports = OpenCodeProvider;
