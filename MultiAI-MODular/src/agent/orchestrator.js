import { MAX_TOOL_ROUNDS, MAX_TOOLS_PER_ROUND } from "../config.js";
import { state } from "../state/index.js";
import { logEvent } from "../utils/logger.js";
import { extractText, formatToolResult, extractChatTitleAndContent } from "../utils/dom.js";
import { tools, executeTool } from "../tools/index.js";
import { addToolBadge, addThoughtTrace, updateAIStream, finalizeStopped } from "../components/chat-ui.js";
import { saveStoredChats } from "../services/storage.js";
import { renderChatList } from "../components/side-panel.js";
import { sanitizeMessage } from "./sanitizer.js";
import { callChatModel } from "./chat-client.js";

function isPromissoryText(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 350) return false;

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
    let promissoryRetries = 0;

    logEvent("REQUEST_START", { chatId, model: selectedModel, userText, isFirstUserTurn });

    const maxRounds = state.config?.Agent?.MaxToolRounds || MAX_TOOL_ROUNDS;
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

                // Promissory Guard: if the model announced intent (e.g. "Okay! Ive found the issue, lemme fix properly:")
                // without executing tools, continue the loop rather than halting prematurely.
                const isPromissory = isPromissoryText(finalDisplay);
                if (isPromissory && (hasRunTools || round > 0) && round < 10 && promissoryRetries < 2) {
                    promissoryRetries++;
                    logEvent("PROMISSORY_CONTINUE", { round, model: selectedModel, text: finalDisplay });
                    addThoughtTrace(currentAIMessage, finalDisplay);
                    session.messages.push({
                        role: "user",
                        content: "Proceed with the action. Execute the required tool call or call 'end' with your final_answer."
                    });
                    state.messages = session.messages;
                    saveStoredChats();
                    continue;
                }

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

            // Route intermediate thoughts and explanations into Activity accordion trace
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

                // Handle task completion and final answer via 'end' tool
                if (toolName === "end") {
                    addToolBadge(currentAIMessage, toolName, args);
                    const finalAnswer = args.final_answer || roundText || "Task completed successfully.";
                    let finalDisplay = finalAnswer.trim();

                    session.messages.push({
                        role: "tool",
                        tool_call_id: call.id,
                        name: "end",
                        content: JSON.stringify({ status: "completed" })
                    });
                    session.messages.push({
                        role: "assistant",
                        content: finalDisplay
                    });
                    state.messages = session.messages;
                    saveStoredChats();

                    if (isFirstUserTurn) {
                        const extracted = extractChatTitleAndContent(finalDisplay);
                        if (extracted.title) {
                            session.title = extracted.title.slice(0, 36);
                            saveStoredChats();
                            renderChatList();
                        }
                        if (extracted.content !== undefined && extracted.content !== null && extracted.title) {
                            finalDisplay = extracted.content;
                            session.messages[session.messages.length - 1].content = finalDisplay;
                            state.messages = session.messages;
                            saveStoredChats();
                        }
                    }

                    logEvent("REQUEST_FINAL_END_TOOL", {
                        chatId,
                        model: selectedModel,
                        userText,
                        finalTextLength: finalDisplay.length,
                        elapsedSeconds: ((Date.now() - overallStartTime) / 1000).toFixed(1)
                    });

                    updateAIStream(currentAIMessage, finalDisplay, true, overallStartTime, true);
                    const chat = document.getElementById("chat");
                    if (chat) session.chatHtml = chat.innerHTML;
                    session.updatedAt = Date.now();
                    return;
                }

                stageStatus = `Running ${toolName}`;
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

            // Loop >= 10 safeguard: Prompt model to finalize at round 10
            if (round === 9) {
                session.messages.push({
                    role: "system",
                    content: "Notice: You have reached turn 10. Conclude your actions and call the 'end' tool with your complete 'final_answer' now."
                });
                state.messages = session.messages;
                saveStoredChats();
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
