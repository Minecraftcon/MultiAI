import { state } from "../state/index.js";
import { modelProviderMap } from "../components/side-panel.js";
import { sanitizeMessage, cleanErrorMessage } from "./sanitizer.js";
import { getActiveContextFilterer } from "./context-filter.js";

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
export async function callChatModel(messages, { model, tools, signal, onChunk } = {}) {
    let effectiveModel = model;
    if (effectiveModel === "dots-3-note-preview:free") {
        effectiveModel = "dots-studio/dots-3-note-preview:free";
    }

    const modelSelect = typeof document !== "undefined" ? document.getElementById("modelSelect") : null;
    const selectedOption = modelSelect?.selectedOptions?.[0];
    const currentSession = (state.currentChatId && state.chatSessions[state.currentChatId]) ? state.chatSessions[state.currentChatId] : null;

    // 1. First priority: explicitly registered provider in modelProviderMap
    const mappedProvider = modelProviderMap[model] || modelProviderMap[effectiveModel];

    // 2. Second priority: active provider from the modelSelect dropdown option
    const providerFromSelect = (selectedOption && selectedOption.value === model) ? selectedOption.dataset.provider : null;

    // 3. Fallback: currentSession provider only if it matches the active model's mapped provider or no mapped provider exists
    const sessionProvider = (currentSession?.provider && (!mappedProvider || currentSession.provider === mappedProvider))
        ? currentSession.provider
        : null;

    // Prioritize explicit model mappings over stale session or blind prefix heuristics
    const provider = mappedProvider || providerFromSelect || sessionProvider || (
        (typeof model === "string" && (
            (model.startsWith("claude-") && !mappedProvider) ||
            (model.startsWith("gpt-") && !mappedProvider && !model.includes("oss")) ||
            (model.startsWith("deepseek-") && !mappedProvider && !model.includes("free") && !model.includes("v4"))
        )) ? "puter" : null
    );

    const rawCleaned = Array.isArray(messages) ? messages.map(sanitizeMessage).filter(Boolean) : [];
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

    // Stream when onChunk callback is provided
    const shouldStream = Boolean(onChunk);

    let res;
    try {
        res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                provider,
                messages: cleanedMessages,
                tools,
                stream: shouldStream
            }),
            signal: activeSignal
        });
    } catch (netErr) {
        if (netErr.name === "AbortError" || activeSignal?.aborted) {
            const err = new Error("Generation stopped by user");
            err.name = "AbortError";
            throw err;
        }
        const err = new Error("Network connection failed or backend server unreachable.");
        err.statusCode = 0;
        throw err;
    }

    // Intercept ANY HTTP status code other than 200 OK (e.g. 429, 400, 401, 403, 404, 500, 502, 503)
    if (!res.ok) {
        let rawErr = "";
        try {
            const errorText = await res.text();
            try {
                const parsed = JSON.parse(errorText);
                rawErr = parsed.error || parsed.message || errorText;
            } catch (_) {
                rawErr = errorText;
            }
        } catch (_) {}

        if (!rawErr || !rawErr.trim()) {
            rawErr = `HTTP error ${res.status}: ${res.statusText || "Request failed"}`;
        }
        const cleanErr = cleanErrorMessage(rawErr);
        const err = new Error(cleanErr);
        err.statusCode = res.status;
        err.rawError = rawErr;
        throw err;
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let accumulatedContent = "";
        let accumulatedReasoning = "";
        const toolCallsMap = {};
        let buffer = "";

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith("data:")) continue;
                    const dataStr = trimmed.replace(/^data:\s*/, "");
                    if (dataStr === "[DONE]") break;
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
                            }
                        }
                    } catch (_) {}
                }
            }
        } catch (streamErr) {
            if (accumulatedContent || Object.keys(toolCallsMap).length > 0) {
                console.warn("[STREAM RECOVERY] Stream interrupted prematurely:", streamErr.message);
                accumulatedContent += `\n\n*(Stream connection interrupted: ${streamErr.message})*`;
            } else {
                throw streamErr;
            }
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
