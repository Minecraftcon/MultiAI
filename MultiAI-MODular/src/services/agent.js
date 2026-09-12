import { MAX_TOOL_ROUNDS, MAX_TOOLS_PER_ROUND } from "../config.js";
import { state } from "../state.js";
import { logEvent } from "../utils/logger.js";
import { extractText, formatToolResult, extractChatTitleAndContent } from "../utils/dom.js";
import { tools, executeTool } from "./tools.js";
import { addToolBadge, updateAIStream, finalizeStopped } from "../components/chat-ui.js";
import { saveStoredChats } from "./storage.js";
import { renderChatList, modelProviderMap } from "../components/side-panel.js";

const TITLE_SYSTEM_PROMPT = `\n\n[CONVERSATION TITLE GENERATION]:
This is the first message of this conversation. You must generate a short, descriptive topic title for this chat (2 to 5 words, max 30 characters).
Return your response with a JSON object at the start:
{"chatname": "Short Topic Title"}
followed immediately by your normal response.`;

export function sanitizeMessage(msg) {
    if (!msg || typeof msg !== "object") return null;
    const role = msg.role || "user";
    if (role === "assistant") {
        const clean = {
            role: "assistant",
            content: typeof msg.content === "string" ? msg.content : (msg.content === null ? null : extractText(msg))
        };
        if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            clean.tool_calls = msg.tool_calls.map(tc => {
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
        return clean;
    }
    if (role === "tool") {
        return {
            role: "tool",
            name: msg.name ? String(msg.name) : undefined,
            tool_call_id: String(msg.tool_call_id || ""),
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
    }
    if (role === "user") {
        if (Array.isArray(msg.content)) {
            return {
                role: "user",
                content: msg.content.map(p => {
                    if (p.type === "text") return { type: "text", text: String(p.text || "") };
                    if (p.type === "image_url") return { type: "image_url", image_url: { url: String(p.image_url?.url || "") } };
                    return p;
                })
            };
        }
        return {
            role: "user",
            content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
        };
    }
    return {
        role,
        content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
    };
}

export function cleanErrorMessage(raw) {
    if (!raw) return "Request could not be completed";
    let str = typeof raw === "string" ? raw : (raw.message || JSON.stringify(raw));

    // Extract JSON error payload if embedded
    const firstBrace = str.indexOf("{");
    const lastBrace = str.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
            const parsed = JSON.parse(str.slice(firstBrace, lastBrace + 1));
            if (parsed.error?.message) {
                return parsed.error.message;
            }
            if (parsed.message) {
                return parsed.message;
            }
        } catch (_) {}
    }

    str = str.replace(/^Error:\s*/i, "").trim();
    return str;
}

async function callChatModel(messages, { model, tools }) {
    let effectiveModel = model;
    if (effectiveModel === "dots-3-note-preview:free") {
        effectiveModel = "dots-studio/dots-3-note-preview:free";
    }

    const modelSelect = typeof document !== "undefined" ? document.getElementById("modelSelect") : null;
    const selectedOption = modelSelect?.selectedOptions?.[0];
    const providerFromSelect = (selectedOption && selectedOption.value === model) ? selectedOption.dataset.provider : null;
    const currentSession = (state.currentChatId && state.chatSessions[state.currentChatId]) ? state.chatSessions[state.currentChatId] : null;

    const provider = providerFromSelect || currentSession?.provider || modelProviderMap[model] || modelProviderMap[effectiveModel] || (
        (typeof model === "string" && (model.includes("free") || model.includes("dots") || model.startsWith("claude-") || model.startsWith("gpt-") || model.startsWith("deepseek-"))) ? "puter" : null
    );

    const cleanedMessages = Array.isArray(messages) ? messages.map(sanitizeMessage).filter(Boolean) : [];

    if (provider === "puter") {
        if (typeof puter === "undefined" || !puter?.ai?.chat) {
            const err = new Error("Puter client library is not loaded.");
            err.statusCode = 503;
            throw err;
        }
        try {
            const puterRes = await puter.ai.chat(cleanedMessages, { model: effectiveModel, tools });
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

    let res;
    try {
        res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                provider,
                messages: cleanedMessages,
                tools
            })
        });
    } catch (netErr) {
        const err = new Error("Network connection failed or backend server unreachable.");
        err.statusCode = 0;
        throw err;
    }

    // Intercept ANY HTTP status code other than 200 OK (e.g. 429, 400, 401, 403, 404, 500, 502, 503)
    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const rawErr = errorData.error || `HTTP error ${res.status}: ${res.statusText || "Request failed"}`;
        const cleanErr = cleanErrorMessage(rawErr);
        const err = new Error(cleanErr);
        err.statusCode = res.status;
        err.rawError = rawErr;
        throw err;
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



export async function runAgent(userText, currentAIMessage, chatId, images = []) {
    const genState = state.activeGenerations[chatId];
    if (!genState || genState.abortRequested) {
        finalizeStopped(currentAIMessage, Date.now(), false);
        return;
    }

    const session = state.chatSessions[chatId];
    if (!session) return;

    const modelSelect = document.getElementById("modelSelect");

    let userContent = userText;
    if (images && images.length > 0) {
        userContent = [
            { type: "text", text: userText || "Please analyze the attached image(s)." },
            ...images.map(img => ({
                type: "image_url",
                image_url: { url: img.dataUrl }
            }))
        ];
    }

    session.messages.push({ role: "user", content: userContent });
    state.messages = session.messages;
    saveStoredChats();
    const isFirstUserTurn = session.messages.filter(m => m.role === "user").length === 1;

    if (isFirstUserTurn && session.messages[0]?.role === "system") {
        session.messages[0].content = state.activeSystemPrompt + TITLE_SYSTEM_PROMPT;
    }

    const selectedModel = session.model || (modelSelect ? modelSelect.value : "gemini-2.5-flash");
    const overallStartTime = Date.now();
    let hasRunTools = false;
    let emptyRetryUsed = false;

    logEvent("REQUEST_START", { chatId, model: selectedModel, userText, isFirstUserTurn });

    try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            if (genState.abortRequested) {
                finalizeStopped(currentAIMessage, overallStartTime, hasRunTools);
                return;
            }

            const activityLabel = currentAIMessage.querySelector(".activity-label");
            if (activityLabel) {
                activityLabel.textContent = round === 0 ? "Working..." : `Working... (reasoning round ${round + 1})`;
            }

            let response;
            try {
                if (genState.abortRequested) {
                    finalizeStopped(currentAIMessage, overallStartTime, hasRunTools);
                    return;
                }
                response = await callChatModel(session.messages, { model: selectedModel, tools: tools });
            } catch (err) {
                if (genState.abortRequested || err.message === "Generation stopped by user") {
                    finalizeStopped(currentAIMessage, overallStartTime, hasRunTools);
                    return;
                }
                logEvent("CHAT_CALL_ERROR", { round, model: selectedModel, error: String(err && err.message || err) });
                throw err;
            }

            if (genState.abortRequested) {
                finalizeStopped(currentAIMessage, overallStartTime, hasRunTools);
                return;
            }

            const rawAssistantMessage = response?.message;
            if (!rawAssistantMessage) {
                logEvent("NO_ASSISTANT_MESSAGE", { round, model: selectedModel, rawResponsePreview: JSON.stringify(response).slice(0, 300) });
                throw new Error("Model returned no message");
            }

            const assistantMessage = sanitizeMessage(rawAssistantMessage);
            session.messages.push(assistantMessage);
            state.messages = session.messages;
            saveStoredChats();

            const toolCalls = assistantMessage.tool_calls || [];
            const roundText = extractText(response);

            logEvent("ROUND_COMPLETE", {
                round,
                chatId,
                model: selectedModel,
                roundTextLength: roundText.length,
                toolCallCount: toolCalls.length
            });

            if (toolCalls.length === 0) {
                let finalDisplay = roundText.trim();

                if (isFirstUserTurn) {
                    const extracted = extractChatTitleAndContent(finalDisplay);
                    if (extracted.title) {
                        session.title = extracted.title.slice(0, 36);
                        saveStoredChats();
                        renderChatList();
                    }
                    if (extracted.content !== undefined && extracted.content !== null && extracted.title) {
                        finalDisplay = extracted.content;
                        if (session.messages.length > 0) {
                            const lastMsg = session.messages[session.messages.length - 1];
                            if (lastMsg.role === "assistant") {
                                lastMsg.content = finalDisplay;
                            }
                        }
                    }
                }

                if (!emptyRetryUsed && !hasRunTools && finalDisplay.length === 0) {
                    emptyRetryUsed = true;
                    logEvent("EMPTY_REPLY_RETRY", { model: selectedModel, userText, round });
                    session.messages.push({
                        role: "system",
                        content: "Your previous reply was empty. Provide an immediate direct answer or perform the required tool action."
                    });
                    continue;
                }

                if (finalDisplay.length === 0) {
                    const err = new Error("Model returned an empty response.");
                    err.statusCode = 204;
                    throw err;
                }

                logEvent("REQUEST_FINAL", {
                    chatId,
                    model: selectedModel,
                    userText,
                    hasRunTools,
                    finalTextLength: finalDisplay.length,
                    elapsedSeconds: ((Date.now() - overallStartTime) / 1000).toFixed(1)
                });
                updateAIStream(currentAIMessage, finalDisplay, true, overallStartTime, hasRunTools);
                const chat = document.getElementById("chat");
                if (chat) session.chatHtml = chat.innerHTML;
                session.updatedAt = Date.now();
                state.messages = session.messages;
                saveStoredChats();
                return;
            }

        hasRunTools = true;
        const calls = toolCalls.slice(0, MAX_TOOLS_PER_ROUND);

        for (let i = 0; i < calls.length; i++) {
            if (genState.abortRequested) {
                finalizeStopped(currentAIMessage, overallStartTime, hasRunTools);
                return;
            }

            const call = calls[i];
            const toolName = call.function?.name;
            let args = {};

            try {
                args = JSON.parse(call.function?.arguments || "{}");
            } catch (err) {
                args = {};
            }

            const badgeEl = addToolBadge(currentAIMessage, toolName, args);

            try {
                const result = await executeTool(toolName, args, badgeEl, genState);
                if (genState.abortRequested) {
                    finalizeStopped(currentAIMessage, overallStartTime, hasRunTools);
                    return;
                }
                logEvent("TOOL_RESULT", { toolName, args, resultPreview: JSON.stringify(result).slice(0, 500) });
                session.messages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    name: toolName,
                    content: formatToolResult(result)
                });
                state.messages = session.messages;
                saveStoredChats();
            } catch (error) {
                if (genState.abortRequested || error.message === "Generation stopped by user") {
                    finalizeStopped(currentAIMessage, overallStartTime, hasRunTools);
                    return;
                }
                logEvent("TOOL_ERROR", { toolName, args, error: String(error && error.message || error) });
                session.messages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    name: toolName,
                    content: JSON.stringify({ error: error.message })
                });
                state.messages = session.messages;
                saveStoredChats();
            }
        }

        if (genState.abortRequested) {
            finalizeStopped(currentAIMessage, overallStartTime, hasRunTools);
            return;
        }

        if (toolCalls.length > MAX_TOOLS_PER_ROUND) {
            session.messages.push({
                role: "tool",
                content: JSON.stringify({ error: `Maximum of ${MAX_TOOLS_PER_ROUND} tool calls per round reached.` })
            });
        }
    }

    logEvent("MAX_TOOL_ROUNDS_REACHED", { model: selectedModel, userText });
    updateAIStream(currentAIMessage, "*(Max reasoning rounds reached)*", true, overallStartTime, true);
    } finally {
        if (isFirstUserTurn && session.messages[0]?.role === "system") {
            session.messages[0].content = state.activeSystemPrompt;
        }
    }
}

