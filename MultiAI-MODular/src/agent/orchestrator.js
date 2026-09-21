import { MAX_TOOL_ROUNDS, MAX_TOOLS_PER_ROUND } from "../config.js";
import { state } from "../state/index.js";
import { logEvent } from "../utils/logger.js";
import { extractText, formatToolResult, extractChatTitleAndContent } from "../utils/dom.js";
import { tools, executeTool, onToolStart, onToolComplete, onToolError } from "../tools/index.js";
import { addToolBadge, addThoughtTrace, updateAIStream, finalizeStopped } from "../components/chat-ui.js";
import { saveStoredChats } from "../services/storage.js";
import { renderChatList } from "../components/side-panel.js";
import { sanitizeMessage } from "./sanitizer.js";
import { callChatModel } from "./chat-client.js";
import { extractThoughtAndContent } from "../components/renderer.js";
import { shouldCompact, compactSessionContext, compileWorkingMessages } from "./compactor.js";

function isPromissoryAnnouncement(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 250) return false;

    // Ends with colon, e.g. "Okay! Ive found the issue, lemme fix properly:"
    if (/:\s*$/.test(trimmed)) return true;

    // Starts with promissory phrasing and contains action verbs
    const promissoryStart = /^(okay|ok|i see|i found|let me|lemme|now i will|i will|proceeding to|fixing|next step|next, i will|i'll)\b/i.test(trimmed);
    const actionIntent = /\b(fix|modify|update|edit|run|check|inspect|investigate|implement|proceed|apply)\b/i.test(trimmed);

    return promissoryStart && actionIntent;
}

const TITLE_SYSTEM_PROMPT = `\n\n[CONVERSATION TITLE GENERATION]:
This is the first message of this conversation. You must generate a short, descriptive topic title for this chat (2 to 5 words, max 30 characters).
Return your response with a JSON object at the start:
{"chatname": "Short Topic Title"}
followed immediately by your normal response.`;

/**
 * Orchestrates multi-turn AI reasoning, streaming, tool executions, and state updates.
 *
 * @param {string} userText
 * @param {HTMLElement} currentAIMessage
 * @param {string} chatId
 * @param {Array<Object>} [images]
 */
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
    let emptyAfterToolsRetries = 0;
    let promissoryRetries = 0;
    const fileReadCounts = new Map();

    logEvent("REQUEST_START", { chatId, model: selectedModel, userText, isFirstUserTurn });

    const configuredRounds = state.config?.Agent?.MaxToolRounds;
    const maxRounds = (configuredRounds === 0 || configuredRounds === "0" || configuredRounds === "unlimited" || configuredRounds === undefined)
        ? Infinity
        : (Number(configuredRounds) > 0 ? Number(configuredRounds) : Infinity);
    let stageStatus = "Thinking";
    const statusTimer = setInterval(() => {
        const activityLabel = currentAIMessage.querySelector(".activity-label");
        if (activityLabel) {
            const sec = ((Date.now() - overallStartTime) / 1000).toFixed(1);
            activityLabel.textContent = `${stageStatus}... (${sec}s)`;
        }
    }, 100);

    try {
        for (let round = 0; round < maxRounds; round++) {
            if (genState.abortRequested) {
                finalizeStopped(currentAIMessage, overallStartTime, hasRunTools);
                return;
            }

            // Automatic context compaction via model if conversation exceeds or is within 25k of native limit
            if (shouldCompact(session, { model: selectedModel })) {
                await compactSessionContext({
                    session,
                    currentAIMessage,
                    selectedModel,
                    genState,
                    overallStartTime
                });
                if (genState.abortRequested) {
                    finalizeStopped(currentAIMessage, overallStartTime, hasRunTools);
                    return;
                }
            }

            stageStatus = round === 0 ? "Thinking" : `Synthesizing (round ${round + 1})`;
            const activityLabel = currentAIMessage.querySelector(".activity-label");
            if (activityLabel) {
                const sec = ((Date.now() - overallStartTime) / 1000).toFixed(1);
                activityLabel.textContent = `${stageStatus}... (${sec}s)`;
            }

            let response;
            try {
                if (genState.abortRequested) {
                    finalizeStopped(currentAIMessage, overallStartTime, hasRunTools);
                    return;
                }
                const workingMessages = compileWorkingMessages(session);
                response = await callChatModel(workingMessages, {
                    model: selectedModel,
                    tools: tools,
                    signal: genState?.abortController?.signal
                });
            } catch (err) {
                if (genState.abortRequested || err.name === "AbortError" || err.message === "Generation stopped by user") {
                    finalizeStopped(currentAIMessage, overallStartTime, hasRunTools);
                    return;
                }
                // Emergency context compaction if upstream model rejects due to genuine context window limits
                if (/prompt exceeds max length|context length|context window|too many tokens|token limit|maximum context|1214/i.test(err.message || "")) {
                    logEvent("CONTEXT_LIMIT_TRIGGER_COMPACT", { round, model: selectedModel, error: err.message });
                    const compacted = await compactSessionContext({
                        session,
                        currentAIMessage,
                        selectedModel,
                        genState,
                        overallStartTime
                    });
                    if (compacted && !genState.abortRequested) {
                        try {
                            stageStatus = `Synthesizing (round ${round + 1})`;
                            const workingMessagesRetry = compileWorkingMessages(session);
                            response = await callChatModel(workingMessagesRetry, {
                                model: selectedModel,
                                tools: tools,
                                signal: genState?.abortController?.signal
                            });
                        } catch (retryErr) {
                            logEvent("CHAT_CALL_RETRY_ERROR", { round, model: selectedModel, error: String(retryErr && retryErr.message || retryErr) });
                            throw retryErr;
                        }
                    } else {
                        throw err;
                    }
                } else {
                    logEvent("CHAT_CALL_ERROR", { round, model: selectedModel, error: String(err && err.message || err) });
                    throw err;
                }
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
            let roundText = extractText(response);

            // Strip conversation title JSON if present in any round
            if (roundText) {
                const extractedTitle = extractChatTitleAndContent(roundText);
                if (extractedTitle.title) {
                    const isDefaultTitle = !session.title || session.title === "New Chat" || session.title === "Conversation" || session.title === (userText || "").trim().slice(0, 34);
                    if (isDefaultTitle) {
                        session.title = extractedTitle.title.slice(0, 36);
                        saveStoredChats();
                        renderChatList();
                    }
                    roundText = extractedTitle.content;
                    assistantMessage.content = roundText;
                    state.messages = session.messages;
                    saveStoredChats();

                    // Remove title generation instruction from system prompt once handled
                    if (session.messages[0]?.role === "system" && session.messages[0].content.includes(TITLE_SYSTEM_PROMPT)) {
                        session.messages[0].content = state.activeSystemPrompt;
                    }
                }
            }

            logEvent("ROUND_COMPLETE", {
                round,
                chatId,
                model: selectedModel,
                roundTextLength: roundText.length,
                toolCallCount: toolCalls.length
            });

            if (toolCalls.length === 0) {
                let finalDisplay = roundText.trim();

                // If the response is purely reasoning/thinking with no answer content during an agent loop,
                // route to activity thought trace and prompt the model to proceed with action or final response
                const { thoughtHtml, content: actualContent } = extractThoughtAndContent(finalDisplay);
                if ((hasRunTools || round > 0) && thoughtHtml && !actualContent && (maxRounds === Infinity || round < maxRounds - 1)) {
                    addThoughtTrace(currentAIMessage, finalDisplay);
                    session.messages.push({
                        role: "user",
                        content: "Continue with the required action or state your final response."
                    });
                    state.messages = session.messages;
                    saveStoredChats();
                    continue;
                }

                // If the model merely announced an action intent without calling tools
                // (e.g. "Okay! Ive found the issue, lemme fix properly:"), route to activity trace and continue
                const isPromissory = isPromissoryAnnouncement(finalDisplay);
                if (isPromissory && (hasRunTools || round > 0) && round < 10 && promissoryRetries < 2) {
                    promissoryRetries++;
                    logEvent("PROMISSORY_CONTINUE", { round, model: selectedModel, text: finalDisplay });
                    addThoughtTrace(currentAIMessage, finalDisplay);
                    session.messages.push({
                        role: "user",
                        content: "Proceed with the action."
                    });
                    state.messages = session.messages;
                    saveStoredChats();
                    continue;
                }



                // If model returns an empty completion after tools have executed:
                // Remove the empty assistant message so it doesn't pollute history,
                // and re-send the tool results to the model before the empty call happened.
                if (hasRunTools && finalDisplay.length === 0 && emptyAfterToolsRetries < 2) {
                    emptyAfterToolsRetries++;
                    logEvent("EMPTY_AFTER_TOOLS_RETRY", { model: selectedModel, round, attempt: emptyAfterToolsRetries });

                    // Pop the empty assistant message off session.messages
                    if (session.messages.length > 0 && session.messages[session.messages.length - 1].role === "assistant") {
                        session.messages.pop();
                    }

                    if (emptyAfterToolsRetries === 1) {
                        // First retry: silently re-send the tool results directly as they were before the empty call
                        stageStatus = "Re-synthesizing tool results";
                        state.messages = session.messages;
                        saveStoredChats();
                        continue;
                    } else {
                        // Second retry: nudge model to write the summary if it was unsure
                        stageStatus = "Synthesizing final answer";
                        session.messages.push({
                            role: "user",
                            content: "All requested tool actions have finished executing. Please provide a clear summary of the results and your final answer."
                        });
                        state.messages = session.messages;
                        saveStoredChats();
                        continue;
                    }
                }

                if (!emptyRetryUsed && finalDisplay.length === 0) {
                    emptyRetryUsed = true;
                    logEvent("EMPTY_REPLY_RETRY", { model: selectedModel, userText, round, hasRunTools });
                    const retryPrompt = hasRunTools
                        ? "All requested tool actions have finished executing. Please provide a clear summary of the results and your final answer."
                        : "Your previous reply was empty. Provide an immediate direct answer or perform the required tool action.";
                    session.messages.push({
                        role: "user",
                        content: retryPrompt
                    });
                    state.messages = session.messages;
                    saveStoredChats();
                    continue;
                }

                if (finalDisplay.length === 0 && !hasRunTools) {
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
            emptyRetryUsed = false;
            emptyAfterToolsRetries = 0;

            // Render live intermediate reasoning along the timeline line
            if (roundText && roundText.trim()) {
                addThoughtTrace(currentAIMessage, roundText);
            }

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

                stageStatus = `Running ${toolName}`;
                const badgeEl = addToolBadge(currentAIMessage, toolName, args);

                let result;
                const filePath = args.path || args.file_path;
                if (toolName === "read_file" && filePath) {
                    // Track per slice so pagination (e.g. lines 1-400 vs 401-800) is never falsely blocked
                    const sliceKey = `${filePath}:${args.action || "read"}:${args.start_line || 1}:${args.end_line || "all"}`;
                    const count = (fileReadCounts.get(sliceKey) || 0) + 1;
                    fileReadCounts.set(sliceKey, count);
                    if (count > 5) {
                        result = {
                            path: filePath,
                            status: "already_inspected",
                            note: `[Anti-Loop Notice]: The exact same slice of "${filePath}" (lines ${args.start_line || 1}–${args.end_line || "end"}) has already been read ${count - 1} times previously in this session without modifications. Its contents are available in your conversation context. Do NOT re-read the identical slice; proceed with your edits or actions.`
                        };
                    }
                } else if (toolName === "write_file" || toolName === "search_and_replace") {
                    if (filePath) {
                        for (const key of fileReadCounts.keys()) {
                            if (key.startsWith(filePath + ":")) fileReadCounts.delete(key);
                        }
                    }
                }

                try {
                    if (!result) {
                        result = await executeTool(toolName, args, badgeEl, genState);
                    } else {
                        onToolStart(toolName, args, badgeEl);
                        onToolComplete(toolName, args, badgeEl, result);
                    }
                    if (genState.abortRequested) {
                        // Fill synthetic cancelled results for remaining tool calls
                        const remainingCalls = calls.slice(i + 1);
                        for (const remainingCall of remainingCalls) {
                            session.messages.push({
                                role: "tool",
                                tool_call_id: remainingCall.id,
                                name: remainingCall.function?.name,
                                content: JSON.stringify({ error: "Execution cancelled by user" })
                            });
                        }
                        state.messages = session.messages;
                        saveStoredChats();
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
                        // Push synthetic cancelled results for the current tool and any remaining ones
                        // so the message history stays structurally valid (assistant N tool_calls = N tool results)
                        const remainingCalls = calls.slice(i);
                        for (const remainingCall of remainingCalls) {
                            session.messages.push({
                                role: "tool",
                                tool_call_id: remainingCall.id,
                                name: remainingCall.function?.name,
                                content: JSON.stringify({ error: "Execution cancelled by user" })
                            });
                        }
                        state.messages = session.messages;
                        saveStoredChats();
                        finalizeStopped(currentAIMessage, overallStartTime, hasRunTools);
                        return;
                    }
                    onToolError(toolName, badgeEl, error);
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
        clearInterval(statusTimer);
        if (isFirstUserTurn && session.messages[0]?.role === "system") {
            session.messages[0].content = state.activeSystemPrompt;
        }
    }
}
