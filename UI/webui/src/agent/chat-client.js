import { state } from "../state/index.js";
import { modelProviderMap } from "../components/side-panel.js";
import { sanitizeMessage, cleanErrorMessage } from "./sanitizer.js";
import { getActiveContextFilterer } from "./context-filter.js";
import { logEvent } from "../utils/logger.js";

export class StreamStallError extends Error {
    constructor(message = "Stream connection stalled: no data received within expected window.", details = {}) {
        super(message);
        this.name = "StreamStallError";
        this.isStall = true;
        this.partialText = details.partialText || "";
        this.partialContent = details.partialContent || "";
        this.accumulatedReasoning = details.accumulatedReasoning || "";
        this.toolCalls = details.toolCalls || [];
    }
}

export class StreamDroppedError extends Error {
    constructor(message = "Stream connection dropped mid-response.", details = {}) {
        super(message);
        this.name = "StreamDroppedError";
        this.isDropped = true;
        this.partialText = details.partialText || "";
        this.partialContent = details.partialContent || "";
        this.accumulatedReasoning = details.accumulatedReasoning || "";
        this.toolCalls = details.toolCalls || [];
    }
}

/**
 * Sends messages to LLM backends (either Puter.js in-browser or /api/chat backend endpoint)
 * and normalizes the response.
 *
 * @param {Array<Object>} messages
 * @param {Object} options
 * @param {string} options.model
 * @param {Array<Object>} options.tools
 * @returns {Promise<Object>}
 */
export async function callChatModel(messages, { model, provider: explicitProvider, tools, signal, onChunk, onToolChunk, system_server } = {}) {
    const modelSelect = typeof document !== "undefined" ? document.getElementById("modelSelect") : null;
    const selectedOption = modelSelect?.selectedOptions?.[0];
    const currentSession = (state.currentChatId && state.chatSessions[state.currentChatId]) ? state.chatSessions[state.currentChatId] : null;

    let effectiveModel = model || currentSession?.model || modelSelect?.value || "gemini-2.5-flash";
    if (effectiveModel === "dots-3-note-preview:free") {
        effectiveModel = "dots-studio/dots-3-note-preview:free";
    }

    const providerFromSelect = (selectedOption && (selectedOption.value === effectiveModel || !model)) ? selectedOption.dataset.provider : null;
    const mappedProvider = modelProviderMap[effectiveModel];
    const provider = explicitProvider || providerFromSelect || currentSession?.provider || mappedProvider || (
        (typeof effectiveModel === "string" && (effectiveModel.startsWith("claude-") || effectiveModel.startsWith("gpt-") || effectiveModel.startsWith("deepseek-"))) ? "puter" : null
    );

    let rawCleaned = Array.isArray(messages) ? messages.map(sanitizeMessage).filter(Boolean) : [];
    if (system_server && provider === "puter") {
        const serverStr = typeof system_server === "string" ? system_server : JSON.stringify(system_server);
        rawCleaned = rawCleaned.map((m, idx) => {
            if (idx === 0 && m.role === "system") {
                return { ...m, content: `${m.content}\n\n<system_server>\n${serverStr}\n</system_server>` };
            }
            return m;
        });
    }

    const filterer = getActiveContextFilterer();
    const cleanedMessages = filterer.filterMessages(rawCleaned);

    if (provider === "puter") {
        if (typeof puter === "undefined" || !puter?.ai?.chat) {
            const err = new Error("Puter client library is not loaded.");
            err.statusCode = 503;
            throw err;
        }
        try {
            const shouldStream = Boolean(onChunk && (!tools || tools.length === 0));
            const puterRes = await puter.ai.chat(cleanedMessages, {
                model: effectiveModel,
                tools,
                stream: shouldStream
            });

            if (shouldStream && puterRes && typeof puterRes[Symbol.asyncIterator] === "function") {
                let accumulated = "";
                for await (const part of puterRes) {
                    const textChunk = part?.text || (typeof part === "string" ? part : "");
                    if (textChunk) {
                        accumulated += textChunk;
                        if (onChunk) onChunk(textChunk, accumulated);
                    }
                }
                return {
                    message: {
                        role: "assistant",
                        content: accumulated
                    }
                };
            }

            if (!puterRes || puterRes.error) {
                const cleanErr = cleanErrorMessage(puterRes?.error || "Puter model returned no response");
                const err = new Error(cleanErr);
                err.statusCode = 400;
                throw err;
            }
            return puterRes;
        } catch (err) {
            const cleanErr = cleanErrorMessage(err?.message || (typeof err === "object" ? JSON.stringify(err) : String(err)));
            const e = new Error(cleanErr);
            e.statusCode = err?.statusCode || 400;
            throw e;
        }
    }

    const activeSignal = signal || (state.currentChatId && state.activeGenerations[state.currentChatId]?.abortController?.signal);

    // Composite abort controller to abort stream either on user cancellation or watchdog timeout
    const streamController = new AbortController();
    let currentReader = null;
    let watchdogTimer = null;

    const disarmWatchdog = () => {
        if (watchdogTimer) {
            clearTimeout(watchdogTimer);
            watchdogTimer = null;
        }
    };

    const onParentAbort = () => {
        disarmWatchdog();
        try {
            if (currentReader) {
                currentReader.cancel("Generation stopped by user").catch(() => {});
            }
        } catch (_) {}
        try {
            streamController.abort();
        } catch (_) {}
    };
    if (activeSignal) {
        if (activeSignal.aborted) {
            const err = new Error("Generation stopped by user");
            err.name = "AbortError";
            throw err;
        }
        activeSignal.addEventListener("abort", onParentAbort, { once: true });
    }

    // Stream when onChunk callback is provided
    const shouldStream = Boolean(onChunk);

    let accumulatedContent = "";
    let accumulatedReasoning = "";
    const toolCallsMap = {};
    let buffer = "";

    // Client-side Dead Man's Watchdog (Stall Detection)
    const initialTimeoutMs = Number(state.config?.Agent?.StreamInitialTimeoutMs) || 45000;
    const stallTimeoutMs = Number(state.config?.Agent?.StreamStallTimeoutMs) || 20000;
    let isStalled = false;

    const armWatchdog = (timeoutMs) => {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        watchdogTimer = setTimeout(() => {
            isStalled = true;
            logEvent("STREAM_STALL_WATCHDOG_TRIGGERED", {
                model: effectiveModel,
                timeoutMs,
                receivedContentLength: accumulatedContent.length,
                receivedReasoningLength: accumulatedReasoning.length
            });
            try {
                if (currentReader) {
                    currentReader.cancel("Stream stalled: no data received within timeout window").catch(() => {});
                }
            } catch (_) {}
            try {
                const stallReason = new Error("Stream connection stalled");
                stallReason.isStall = true;
                streamController.abort(stallReason);
            } catch (_) {}
        }, timeoutMs);
    };

    // Arm watchdog immediately so stalls before HTTP headers arrive are intercepted
    armWatchdog(initialTimeoutMs);

    let res;
    try {
        res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: effectiveModel,
                provider,
                messages: cleanedMessages,
                tools,
                stream: shouldStream,
                system_server
            }),
            signal: streamController.signal
        });
    } catch (netErr) {
        disarmWatchdog();
        if (activeSignal) {
            activeSignal.removeEventListener("abort", onParentAbort);
        }
        if (activeSignal?.aborted || (netErr.name === "AbortError" && !isStalled && !streamController.signal.reason?.isStall)) {
            const err = new Error("Generation stopped by user");
            err.name = "AbortError";
            throw err;
        }
        if (isStalled || streamController.signal.reason?.isStall) {
            throw new StreamStallError("Stream connection stalled: initial response timed out before headers arrived.", {
                partialText: "",
                partialContent: "",
                accumulatedReasoning: "",
                toolCalls: []
            });
        }
        const err = new Error("Network connection failed or backend server unreachable.");
        err.statusCode = 0;
        throw err;
    }

    // Intercept ANY HTTP status code other than 200 OK (e.g. 429, 400, 401, 403, 404, 500, 502, 503)
    if (!res.ok) {
        disarmWatchdog();
        if (activeSignal) {
            activeSignal.removeEventListener("abort", onParentAbort);
        }
        const errorData = await res.json().catch(() => ({}));
        const rawErr = errorData.error || `HTTP error ${res.status}: ${res.statusText || "Request failed"}`;
        const cleanErr = cleanErrorMessage(rawErr);
        const err = new Error(cleanErr);
        err.statusCode = res.status;
        err.rawError = rawErr;
        throw err;
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        currentReader = reader;
        const decoder = new TextDecoder("utf-8");

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    disarmWatchdog();
                    break;
                }

                // Chunks received: reset watchdog for next expected chunk
                if (value && value.length > 0) {
                    armWatchdog(stallTimeoutMs);
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith("data:")) continue;
                    const dataStr = trimmed.replace(/^data:\s*/, "");
                    if (dataStr === "[DONE]") {
                        disarmWatchdog();
                        break;
                    }
                    try {
                        const parsed = JSON.parse(dataStr);
                        const choice = parsed.choices?.[0] || parsed;
                        const delta = choice?.delta || choice;
                        if (!delta) continue;

                        // 1. Thinking / Reasoning delta (DeepSeek-R1, OpenRouter, Qwen, o1/o3, etc.)
                        const reasoningDelta = delta.reasoning_content || delta.reasoning || "";
                        if (reasoningDelta) {
                            accumulatedReasoning += reasoningDelta;
                            const isReasoningStreamEnabled = state.config?.Agent?.StreamReasoning !== false;
                            if (isReasoningStreamEnabled && onChunk) {
                                const fullDisplay = `<think>\n${accumulatedReasoning}\n</think>\n\n${accumulatedContent}`;
                                onChunk(reasoningDelta, fullDisplay);
                            }
                        }

                        // 2. Content delta
                        const contentDelta = delta.content || (typeof delta.text === "string" ? delta.text : "");
                        if (contentDelta) {
                            accumulatedContent += contentDelta;
                            const isReasoningStreamEnabled = state.config?.Agent?.StreamReasoning !== false;
                            const fullDisplay = (accumulatedReasoning && isReasoningStreamEnabled)
                                ? `<think>\n${accumulatedReasoning}\n</think>\n\n${accumulatedContent}`
                                : accumulatedContent;
                            if (onChunk) onChunk(contentDelta, fullDisplay);
                        }

                        // 3. Tool Calls streaming delta aggregation
                        if (Array.isArray(delta.tool_calls)) {
                            for (const tc of delta.tool_calls) {
                                const idx = typeof tc.index === "number" ? tc.index : 0;
                                if (!toolCallsMap[idx]) {
                                    toolCallsMap[idx] = {
                                        id: tc.id || ("call_" + Math.random().toString(36).slice(2, 10)),
                                        type: tc.type || "function",
                                        function: {
                                            name: tc.function?.name || "",
                                            arguments: tc.function?.arguments || ""
                                        }
                                    };
                                } else {
                                    if (tc.id) toolCallsMap[idx].id = tc.id;
                                    if (tc.function?.name) toolCallsMap[idx].function.name += tc.function.name;
                                    if (tc.function?.arguments) toolCallsMap[idx].function.arguments += tc.function.arguments;
                                }
                                const sig = tc.thoughtSignature || tc.thought_signature || tc.function?.thoughtSignature || tc.function?.thought_signature;
                                if (sig) {
                                    toolCallsMap[idx].thoughtSignature = sig;
                                    toolCallsMap[idx].thought_signature = sig;
                                }

                                if (onToolChunk) {
                                    onToolChunk({
                                        index: idx,
                                        id: toolCallsMap[idx].id,
                                        name: toolCallsMap[idx].function.name,
                                        deltaName: tc.function?.name || "",
                                        deltaArgs: tc.function?.arguments || "",
                                        accumulatedArgs: toolCallsMap[idx].function.arguments
                                    });
                                }
                            }
                        }
                    } catch (_) {}
                }
            }
        } catch (streamErr) {
            disarmWatchdog();
            const finalContent = accumulatedReasoning
                ? `<think>\n${accumulatedReasoning}\n</think>\n\n${accumulatedContent}`.trim()
                : accumulatedContent;
            const finalTools = Object.keys(toolCallsMap)
                .sort((a, b) => Number(a) - Number(b))
                .map(k => toolCallsMap[k])
                .filter(tc => Boolean(tc.function?.name));

            if (activeSignal?.aborted || (streamErr.name === "AbortError" && !isStalled && !streamController.signal.reason?.isStall)) {
                const err = new Error("Generation stopped by user");
                err.name = "AbortError";
                throw err;
            }

            if (isStalled || streamController.signal.reason?.isStall) {
                throw new StreamStallError("Stream connection stalled: no data received from server within expected window.", {
                    partialText: finalContent,
                    partialContent: accumulatedContent,
                    accumulatedReasoning,
                    toolCalls: finalTools
                });
            }

            // Connection severed mid-stream
            throw new StreamDroppedError("Stream connection dropped mid-response.", {
                partialText: finalContent,
                partialContent: accumulatedContent,
                accumulatedReasoning,
                toolCalls: finalTools
            });
        } finally {
            disarmWatchdog();
            if (activeSignal) {
                activeSignal.removeEventListener("abort", onParentAbort);
            }
        }

        if (activeSignal?.aborted) {
            const err = new Error("Generation stopped by user");
            err.name = "AbortError";
            throw err;
        }

        if (isStalled || streamController.signal.reason?.isStall) {
            const finalContent = accumulatedReasoning
                ? `<think>\n${accumulatedReasoning}\n</think>\n\n${accumulatedContent}`.trim()
                : accumulatedContent;
            const finalTools = Object.keys(toolCallsMap)
                .sort((a, b) => Number(a) - Number(b))
                .map(k => toolCallsMap[k])
                .filter(tc => Boolean(tc.function?.name));

            throw new StreamStallError("Stream connection stalled: no data received from server within expected window.", {
                partialText: finalContent,
                partialContent: accumulatedContent,
                accumulatedReasoning,
                toolCalls: finalTools
            });
        }

        const finalToolCalls = Object.keys(toolCallsMap)
            .sort((a, b) => Number(a) - Number(b))
            .map(k => toolCallsMap[k])
            .filter(tc => Boolean(tc.function?.name));

        const finalContent = accumulatedReasoning
            ? `<think>\n${accumulatedReasoning}\n</think>\n\n${accumulatedContent}`.trim()
            : accumulatedContent;

        return {
            message: {
                role: "assistant",
                content: finalContent,
                tool_calls: finalToolCalls.length > 0 ? finalToolCalls : undefined
            }
        };
    }

    const data = await res.json().catch(() => null);
    if (!data) {
        const err = new Error("Invalid or empty response from server.");
        err.statusCode = 502;
        throw err;
    }

    // Intercept if response contains an error payload even when HTTP status is 200
    if (data.error) {
        const cleanErr = cleanErrorMessage(data.error);
        const err = new Error(cleanErr);
        err.statusCode = data.status || 400;
        err.rawError = data.error;
        throw err;
    }

    // Intercept if response is not an actual response (no message content or tool calls)
    if (!data.message && !data.choices && !data.content) {
        const err = new Error("Model returned no message in response.");
        err.statusCode = 204;
        throw err;
    }

    return data;
}
