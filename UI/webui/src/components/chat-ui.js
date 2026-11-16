/* =========================================================
   CHAT UI, BADGES, STREAM UPDATER & ACCORDIONS
   ========================================================= */
import { escapeHTML, wrapTablesForScroll, extractChatTitleAndContent } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { logEvent } from "../utils/logger.js";
import { state } from "../state.js";
import { chatbox } from "./chatbox.js";
import { parseMarkdown, extractThoughtAndContent, bindInteractiveCodeBlocks, renderMermaidInElement, renderMath, bindAIImageCards } from "./renderer.js";
import { saveCurrentChatState, saveStoredChats } from "../services/storage.js";
import { renderChatList } from "./side-panel.js";
import { onToolComplete } from "../tools/badge-sync.js";
import { isAndroidOrMobile } from "./aurora-theme.js";
import {
    getToolBadgeConfig,
    addToolBadge,
    showCheckpointModal,
    addCompactionBadge,
    addThoughtTrace,
    wrapHugeThoughts,
    finalizeFileEditBadges,
    addWakeupBadge
} from "./chat-tool-badges.js";
import { 
    requestScrollToBottom, 
    initScrollToBottom,
    forceReengageAutoScroll,
    detachUserScroll,
    reengageUserScroll
} from "./chat-scroll.js";
import { openImageLightbox } from "./composer-attachments.js";
import { renderPlanApprovalActions, handlePlanApprovalClick } from "./plan-hitl.js";
import { openTerminal } from "./terminal-drawer.js";
import { formatMessageWithInlineEntities } from "./inline-entity.js";
import { renderFilesChangedBar, extractTurnFilesChanged } from "./files-changed-bar.js";

export {
    renderFilesChangedBar,
    extractTurnFilesChanged,
    getToolBadgeConfig,
    addToolBadge,
    showCheckpointModal,
    addCompactionBadge,
    addThoughtTrace,
    wrapHugeThoughts,
    finalizeFileEditBadges,
    addWakeupBadge,
    requestScrollToBottom,
    initScrollToBottom,
    forceReengageAutoScroll,
    detachUserScroll,
    reengageUserScroll
};

export function createAIMessageShell() {
    const chat = document.getElementById("chat");
    const div = document.createElement("div");
    div.className = "message ai";
    div.innerHTML = `
        <div class="pre-search-content"></div>
        <div class="activity-wrapper">
            <button type="button" class="activity-toggle">
                <span class="chevron">▶</span>
                <span class="activity-label">Initializing...</span>
            </button>
            <div class="activity-collapse">
                <div class="activity-overflow">
                    <div class="activity-content">
                        <div class="search-items-container"></div>
                    </div>
                </div>
            </div>
        </div>
        <div class="final-content"></div>
        <div class="followup-suggestions" style="display: none;"></div>
        <span class="blinking-cursor"></span>
    `;

    chat.appendChild(div);
    requestScrollToBottom(chat);
    return div;
}

// Note: addToolBadge is extracted to ./chat-tool-badges.js and re-exported above.


// Note: showCheckpointModal is extracted to ./chat-tool-badges.js and re-exported above.


// Note: addCompactionBadge is extracted to ./chat-tool-badges.js and re-exported above.


// Note: addThoughtTrace and wrapHugeThoughts are extracted to ./chat-tool-badges.js and re-exported above.


/**
 * Renders a single conversation turn (user message + corresponding AI messages) into a DocumentFragment.
 */
export function renderTurn(turn, session, compactionRef, isLastTurn) {
    const fragment = document.createDocumentFragment();
    const cp = session?.compactionState;

    // 1. Render User Message
    if (turn.userMessage) {
        const userMsg = turn.userMessage;
        const userDiv = document.createElement("div");
        userDiv.className = "message user";

        let rawText = "";
        let imgsHtml = "";

        if (typeof userMsg.content === "string") {
            rawText = userMsg.content;
        } else if (Array.isArray(userMsg.content)) {
            const textPart = userMsg.content.find(p => p.type === "text" || p.text);
            rawText = textPart ? (textPart.text || textPart.content || "") : "";
            
            const imgParts = userMsg.content.filter(p => p.type === "image_url" || p.image_url);
            if (imgParts.length > 0) {
                imgsHtml = `<div class="composer-media-strip">${imgParts.map(img => {
                    const url = img.image_url?.url || img.url || "";
                    return `<div class="msg-img-card" data-full-img="${escapeHTML(url)}"><img src="${escapeHTML(url)}" alt="Attached image"></div>`;
                }).join("")}</div>`;
            }
        } else if (userMsg.content) {
            rawText = JSON.stringify(userMsg.content);
        }

        userDiv.dataset.rawText = rawText;
        const textHtml = rawText ? `<div class="msg-bubble-text">${formatMessageWithInlineEntities(rawText)}</div>` : "";
        userDiv.innerHTML = `
            <div class="user-bubble-content">
                ${imgsHtml}
                ${textHtml}
            </div>
        `;
        fragment.appendChild(userDiv);
    }

    // 2. Render AI Turn
    if (turn.aiMessages && turn.aiMessages.length > 0) {
        const aiDiv = document.createElement("div");
        aiDiv.className = "message ai";
        aiDiv.innerHTML = `
            <div class="pre-search-content"></div>
            <div class="activity-wrapper" style="display: none;">
                <button type="button" class="activity-toggle">
                    <span class="chevron">▶</span>
                    <span class="activity-label">Activity</span>
                </button>
                <div class="activity-collapse">
                    <div class="activity-overflow">
                        <div class="activity-content">
                            <div class="search-items-container"></div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="final-content"></div>
            <div class="followup-suggestions" style="display: none;"></div>
        `;

        // If this turn was awakened by a background task or timer, display the wake-up badge at the top
        if (turn.wakeupNotice) {
            const m = turn.wakeupNotice;
            let bInfo = m.badgeInfo;
            if (!bInfo && typeof m.content === "string") {
                const isTimer = m.content.startsWith("[Timer Notification]:") || m.content.startsWith("[Background Task Timeout]:");
                const matchTask = m.content.match(/Task '([^']+)'/);
                const matchDur = m.content.match(/after ([0-9.]+)s/) || m.content.match(/\(([0-9.]+)s/);
                bInfo = {
                    taskName: matchTask ? matchTask[1] : "",
                    duration: matchDur ? matchDur[1] : "",
                    isTimer
                };
            }
            if (bInfo) {
                addWakeupBadge(aiDiv, bInfo);
            }
        }

        const preSearchContent = aiDiv.querySelector(".pre-search-content");
        const activityWrapper = aiDiv.querySelector(".activity-wrapper");
        const searchContainer = aiDiv.querySelector(".search-items-container");
        const activityLabel = aiDiv.querySelector(".activity-label");
        const finalContent = aiDiv.querySelector(".final-content");

        const toolResults = new Map();
        turn.aiMessages.forEach(m => {
            if (m.role === "tool" && m.tool_call_id) {
                toolResults.set(m.tool_call_id, m);
            }
        });

        const assistantMsgs = turn.aiMessages.filter(m => m.role === "assistant");
        const finalAssistantMsg = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1] : null;

        let totalToolCalls = 0;

        for (let i = 0; i < assistantMsgs.length; i++) {
            const aMsg = assistantMsgs[i];
            const isFinal = (aMsg === finalAssistantMsg);

            // Intermediate thoughts / reasoning traces
            if (!isFinal && aMsg.content && aMsg.content.trim()) {
                const { thoughtHtml, content } = extractThoughtAndContent(aMsg.content);
                const traceText = content || thoughtHtml || aMsg.content;
                if (traceText && traceText.trim()) {
                    addThoughtTrace(aiDiv, traceText);
                }
            }

            // Render tool badges for tool calls
            if (Array.isArray(aMsg.tool_calls) && aMsg.tool_calls.length > 0) {
                for (const tc of aMsg.tool_calls) {
                    totalToolCalls++;
                    const toolName = tc.function?.name || "tool";
                    let args = {};
                    try {
                        args = typeof tc.function?.arguments === "string" 
                            ? JSON.parse(tc.function.arguments) 
                            : (tc.function?.arguments || {});
                    } catch (_) {
                        args = {};
                    }

                    const badgeEl = addToolBadge(aiDiv, toolName, args);
                    const toolMsg = toolResults.get(tc.id);
                    let toolData = {};
                    if (toolMsg && toolMsg.content !== undefined) {
                        try {
                            toolData = typeof toolMsg.content === "string" 
                                ? JSON.parse(toolMsg.content) 
                                : toolMsg.content;
                        } catch (_) {
                            toolData = { stdout: toolMsg.content };
                        }
                    }
                    onToolComplete(toolName, args, badgeEl, toolData, { isRehydration: true });
                }
            }
        }

        // Check if context compaction occurred up to this turn
        if (cp && cp.summary && compactionRef && !compactionRef.rendered) {
            const lastMsg = turn.aiMessages[turn.aiMessages.length - 1];
            const lastIdx = Array.isArray(session.messages) ? session.messages.indexOf(lastMsg) : -1;
            if (lastIdx >= (cp.sliceEndIdx || 0) || isLastTurn) {
                compactionRef.rendered = true;
                const cBadge = addCompactionBadge(aiDiv, {
                    checkpointNum: cp.checkpointNum || 1,
                    sliceStartIdx: cp.sliceStartIdx || 0,
                    sliceEndIdx: cp.sliceEndIdx || 0,
                    tokensSaved: cp.tokensSaved || 0
                });
                cBadge.update({
                    status: "success",
                    artifactPath: cp.artifactPath,
                    summaryText: cp.summary,
                    checkpointNum: cp.checkpointNum || 1,
                    sliceStartIdx: cp.sliceStartIdx || 0,
                    sliceEndIdx: cp.sliceEndIdx || 0,
                    tokensSaved: cp.tokensSaved || 0
                });
            }
        }

        // Render final assistant message
        if (finalAssistantMsg) {
            if (finalAssistantMsg.isError || finalAssistantMsg.error) {
                const errObj = finalAssistantMsg.error || {};
                const cleanErr = errObj.message || (typeof finalAssistantMsg.content === "string" ? finalAssistantMsg.content.replace(/^\[Error:\s*/i, "").replace(/\]$/, "") : "Request could not be succeeded");
                const codeLabel = errObj.statusCode ? ` [HTTP ${errObj.statusCode}]` : (errObj.code ? ` [${errObj.code}]` : "");
                aiDiv.dataset.isError = "true";
                aiDiv.dataset.rawText = finalAssistantMsg.content || cleanErr;

                finalContent.innerHTML = `
                    <div class="ai-error-notice">
                        <span class="ai-error-badge"><i data-lucide="alert-circle"></i> Request could not be succeeded${codeLabel}</span>
                        <span class="ai-error-text">${escapeHTML(cleanErr)}</span>
                    </div>
                `;
                renderIcons(finalContent);
            } else {
                const rawText = finalAssistantMsg.content || "";
                aiDiv.dataset.rawText = rawText;

                const { thoughtHtml, content, followups } = extractThoughtAndContent(rawText);
                
                if (thoughtHtml) {
                    preSearchContent.innerHTML = thoughtHtml;
                    preSearchContent.querySelectorAll(".thought-box").forEach(tb => {
                        tb.open = false;
                    });
                    wrapTablesForScroll(preSearchContent);
                    renderIcons(preSearchContent);
                }

                if (content) {
                    finalContent.innerHTML = parseMarkdown(content);
                    wrapTablesForScroll(finalContent);
                    renderIcons(finalContent);
                    bindAIImageCards(finalContent);
                } else if (totalToolCalls === 0) {
                    finalContent.innerHTML = "<em>(Empty response)</em>";
                }

                if (Array.isArray(followups) && followups.length > 0) {
                    renderFollowupSuggestions(aiDiv, followups, true);
                }
                renderPlanApprovalActions(aiDiv, rawText, true, session);
            }
        }

        // Only render files changed review bar if the turn is finished (not actively generating)
        const isChatGenerating = Boolean(session?.id ? state.activeGenerations[session.id]?.isGenerating : state.activeGenerations[state.currentChatId]?.isGenerating);
        const isTurnInProgress = isLastTurn && isChatGenerating;

        if (!isTurnInProgress) {
            const turnFiles = extractTurnFilesChanged(turn, finalAssistantMsg);
            if (turnFiles && turnFiles.length > 0) {
                renderFilesChangedBar(aiDiv, turnFiles, finalAssistantMsg);
            }
        }

        if (searchContainer && searchContainer.children.length > 0) {
            activityWrapper.style.display = "block";
            const hasCommentary = Boolean(searchContainer.querySelector(".activity-thought-item"));
            if (hasCommentary) {
                activityWrapper.classList.add("open");
            } else {
                activityWrapper.classList.remove("open");
            }
            activityLabel.textContent = totalToolCalls > 0 
                ? `Executed ${totalToolCalls} action${totalToolCalls > 1 ? "s" : ""}` 
                : `Activity`;
        } else {
            activityWrapper.style.display = "none";
        }

        finalizeFileEditBadges(aiDiv);
        fragment.appendChild(aiDiv);
    }

    return fragment;
}

/**
 * Accurately reconstructs and renders past conversation history from session.messages.
 * Groups multi-round tool executions and assistant steps into structured, clean message turns.
 * On mobile browsers, optimizes DOM size by rendering only visible parts on demand.
 */
export function renderSessionMessages(session, chat) {
    if (!chat || !session) return;
    chat.innerHTML = "";

    if (session.isSubagent && session.parentChatId) {
        const parentSession = state.chatSessions ? state.chatSessions[session.parentChatId] : null;
        const parentTitle = parentSession?.title || "Main Conversation";
        const prettyType = (session.subagentType || "subagent").charAt(0).toUpperCase() + (session.subagentType || "subagent").slice(1);
        const header = document.createElement("div");
        header.className = "subagent-chat-view-header";
        header.innerHTML = `
            <button type="button" class="subagent-back-btn" id="subagentHeaderBackBtn" title="Back to main conversation">
                <i data-lucide="arrow-left"></i>
                <span>Back to <strong>${escapeHTML(parentTitle)}</strong></span>
            </button>
            <div class="subagent-header-meta">
                <span class="subagent-persona-chip ${escapeHTML(session.subagentType || '')}">${escapeHTML(prettyType)}</span>
                <span class="subagent-status-tag ${session.subagentStatus === 'running' ? 'running' : 'completed'}">${session.subagentStatus === 'running' ? 'Running' : 'Completed'}</span>
            </div>
        `;
        const backBtn = header.querySelector("#subagentHeaderBackBtn");
        if (backBtn) {
            backBtn.addEventListener("click", () => {
                import("./chat-history-list.js").then(m => m.switchToChat(session.parentChatId));
            });
        }
        chat.appendChild(header);
    }

    const messages = Array.isArray(session.messages) ? session.messages : [];
    const nonSystem = messages.filter(m => m && m.role !== "system" && !(m.role === "user" && typeof m.content === "string" && m.content.startsWith("[System Notice]:")));
    if (nonSystem.length === 0) {
        if (session.isSubagent) {
            const prettyType = (session.subagentType || "subagent").charAt(0).toUpperCase() + (session.subagentType || "subagent").slice(1);
            const hint = document.createElement("div");
            hint.className = "subagent-empty-chat-hint";
            hint.innerHTML = `
                <div class="subagent-empty-chat-title">Chat with ${escapeHTML(prettyType)} Subagent</div>
                <div class="subagent-empty-chat-sub">This subagent is bound to your conversation. You can send instructions, inspect generated output, or ask it to make changes.</div>
            `;
            chat.appendChild(hint);
        }
        return;
    }

    // Group into turns: each turn starts with a user message, followed by all corresponding AI turns (assistant + tool)
    const turns = [];
    let currentTurn = null;

    for (let i = 0; i < nonSystem.length; i++) {
        const m = nonSystem[i];
        if (m.role === "user") {
            const isWakeupNotice = Boolean(m.isNotification || (typeof m.content === "string" && (
                m.content.startsWith("[Background Task Notification]:") || 
                m.content.startsWith("[Timer Notification]:") || 
                m.content.startsWith("[Background Task Timeout]:")
            )));

            if (isWakeupNotice) {
                if (currentTurn) {
                    turns.push(currentTurn);
                }
                currentTurn = { userMessage: null, aiMessages: [], wakeupNotice: m };
                continue;
            }

            if (currentTurn) {
                turns.push(currentTurn);
            }
            currentTurn = { userMessage: m, aiMessages: [] };
        } else {
            if (!currentTurn) {
                currentTurn = { userMessage: null, aiMessages: [] };
            }
            currentTurn.aiMessages.push(m);
        }
    }
    if (currentTurn) {
        turns.push(currentTurn);
    }

    const isMobile = isAndroidOrMobile();
    const limitMobileTurns = state.config?.Mobile?.LimitVisibleTurns !== false;
    const configuredLimit = parseInt(state.config?.Mobile?.VisibleTurns, 10);
    const visibleLimit = (!isNaN(configuredLimit) && configuredLimit > 0) ? configuredLimit : 15;

    const compactionRef = { rendered: false };

    // On mobile devices only: limit initial rendering to visible parts if enabled
    if (isMobile && limitMobileTurns && turns.length > visibleLimit) {
        let startIndex = turns.length - visibleLimit;

        // Render the most recent visibleLimit turns
        const fragment = document.createDocumentFragment();
        for (let i = startIndex; i < turns.length; i++) {
            fragment.appendChild(renderTurn(turns[i], session, compactionRef, i === turns.length - 1));
        }

        // Create container for loading earlier turns
        const loadEarlierContainer = document.createElement("div");
        loadEarlierContainer.className = "load-earlier-container";

        const loadEarlierBtn = document.createElement("button");
        loadEarlierBtn.className = "load-earlier-btn";
        loadEarlierBtn.type = "button";
        loadEarlierBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
            <span>Load earlier messages <span class="load-earlier-count">(${startIndex} remaining)</span></span>
        `;

        loadEarlierBtn.addEventListener("click", () => {
            if (startIndex <= 0) return;
            const batchSize = Math.min(startIndex, visibleLimit);
            const newStartIndex = startIndex - batchSize;
            const batchFragment = document.createDocumentFragment();

            for (let i = newStartIndex; i < startIndex; i++) {
                batchFragment.appendChild(renderTurn(turns[i], session, compactionRef, i === turns.length - 1));
            }

            const prevScrollHeight = chat.scrollHeight;
            const prevScrollTop = chat.scrollTop;

            if (loadEarlierContainer.nextSibling) {
                chat.insertBefore(batchFragment, loadEarlierContainer.nextSibling);
            } else {
                chat.appendChild(batchFragment);
            }

            // Anchor scroll position seamlessly so viewport doesn't jump
            const newScrollHeight = chat.scrollHeight;
            chat.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);

            startIndex = newStartIndex;
            if (startIndex <= 0) {
                loadEarlierContainer.remove();
            } else {
                const countSpan = loadEarlierBtn.querySelector(".load-earlier-count");
                if (countSpan) {
                    countSpan.textContent = `(${startIndex} remaining)`;
                }
            }
        });

        loadEarlierContainer.appendChild(loadEarlierBtn);
        chat.appendChild(loadEarlierContainer);
        chat.appendChild(fragment);
    } else {
        // Desktop or under limit: full eager render as usual
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < turns.length; i++) {
            fragment.appendChild(renderTurn(turns[i], session, compactionRef, i === turns.length - 1));
        }
        chat.appendChild(fragment);
    }
}

const activeStreamers = new WeakMap();

/**
 * Clears any in-progress streamed content from an AI message element's finalContent
 * and detaches its streamer so subsequent streaming starts fresh. Used when a model
 * response contains tool calls: the intermediate text is rendered via addThoughtTrace
 * inside the activity area (above final-content), so any text already streamed into
 * final-content must be removed to avoid it appearing duplicated at the bottom.
 */
export function clearAIStream(element) {
    if (!element) return;
    const streamer = activeStreamers.get(element);
    if (streamer) {
        streamer.stop();
        activeStreamers.delete(element);
    }
    const finalContent = element.querySelector(".final-content");
    if (finalContent) {
        finalContent.innerHTML = "";
    }
}

/**
 * Attaches the blinking cursor inline right after the last character of text
 * inside the active block element, so it flows dynamically with the streaming response.
 */
function attachStreamingCursor(container, cursor) {
    if (!container || !cursor) return;

    cursor.remove();

    let target = container.lastElementChild;
    if (!target) {
        container.appendChild(cursor);
        return;
    }

    // Traverse down block containers to find the leaf block element
    while (target) {
        const tag = target.tagName ? target.tagName.toLowerCase() : "";
        if (tag === "ul" || tag === "ol") {
            target = target.lastElementChild || target;
            continue;
        }
        if (tag === "blockquote") {
            if (target.lastElementChild) {
                target = target.lastElementChild;
                continue;
            }
        }
        if (tag === "pre") {
            const codeEl = target.querySelector("code");
            if (codeEl) {
                target = codeEl;
            }
            break;
        }
        if (tag === "li") {
            if (target.lastElementChild && target.lastElementChild.tagName && target.lastElementChild.tagName.toLowerCase() === "p") {
                target = target.lastElementChild;
                continue;
            }
        }
        if (tag === "table" || tag === "div") {
            if (target.lastElementChild) {
                target = target.lastElementChild;
                continue;
            }
        }
        break;
    }

    if (target) {
        target.appendChild(cursor);
    } else {
        container.appendChild(cursor);
    }
}

class StreamBatchRenderer {
    constructor(element, finalContent, cursor) {
        this.element = element;
        this.finalContent = finalContent;
        this.cursor = cursor;
        this.pendingText = "";
        this.isDone = false;
        this.isStopped = false;
        this.rafId = null;
        this.lastRenderTime = 0;
        this.resolvePromise = null;
        this.promise = new Promise(resolve => {
            this.resolvePromise = resolve;
        });

        this.finalContent.innerHTML = "";
        if (this.cursor) {
            attachStreamingCursor(this.finalContent, this.cursor);
        }
    }

    append(newText) {
        if (!newText || this.isStopped) return;
        this.pendingText = newText;
        if (!this.rafId) {
            this.rafId = requestAnimationFrame((now) => {
                this.rafId = null;
                // Throttle markdown re-parsing to ~32ms (~30 FPS) while actively streaming.
                // On mobile devices, re-parsing large markdown trees every 16ms (60 FPS) chokes
                // the CPU and causes frame drops, whereas ~30 FPS is completely smooth and imperceptible.
                const elapsed = (now || performance.now()) - this.lastRenderTime;
                if (elapsed < 32 && !this.isDone) {
                    this.rafId = requestAnimationFrame((nextNow) => {
                        this.rafId = null;
                        this.renderFrame(nextNow || performance.now());
                    });
                    return;
                }
                this.renderFrame(now || performance.now());
            });
        }
    }

    renderFrame(now = performance.now()) {
        if (this.isStopped) return;
        if (!this.pendingText) return;
        this.lastRenderTime = now;

        // Auto-close unclosed code block fences (```)
        let safe = this.pendingText;
        const codeBlockCount = (safe.match(/```/g) || []).length;
        if (codeBlockCount % 2 !== 0) {
            safe += "\n```";
        }
        // Auto-close unclosed inline code (`)
        const lastLine = safe.split("\n").pop() || "";
        const backtickCount = (lastLine.match(/`/g) || []).length;
        if (backtickCount % 2 !== 0) {
            safe += "`";
        }

        const html = parseMarkdown(safe);
        if (this.isStopped) return;

        this.finalContent.innerHTML = html;
        if (html.includes("<table")) {
            wrapTablesForScroll(this.finalContent);
        }

        if (this.cursor && !this.isDone) {
            attachStreamingCursor(this.finalContent, this.cursor);
        }

        const chat = document.getElementById("chat");
        if (chat) requestScrollToBottom(chat, false);
    }

    markDone(onFinish) {
        this.isDone = true;
        this.onFinish = onFinish;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.cursor) {
            this.cursor.remove();
        }
        this.renderFrame(performance.now());
        this.finalize();
        return this.promise;
    }

    stop() {
        this.isStopped = true;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.cursor) {
            this.cursor.remove();
        }
        if (this.resolvePromise) {
            this.resolvePromise();
        }
    }

    finalize() {
        if (this.isStopped) return;
        if (this.onFinish) {
            this.onFinish();
        }
        if (this.resolvePromise) {
            this.resolvePromise();
        }
    }
}

export function updateAIStream(element, fullText, isDone, startTime, hasTools) {
    const chat = document.getElementById("chat");
    const activityWrapper = element.querySelector(".activity-wrapper");
    const activityLabel = element.querySelector(".activity-label");
    const preSearchContent = element.querySelector(".pre-search-content");
    const finalContent = element.querySelector(".final-content");
    const cursor = element.querySelector(".blinking-cursor");

    const answerText = fullText || "";
    element.dataset.rawText = answerText;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (isDone) {
        if (activityLabel) activityLabel.textContent = `Worked for ${elapsed} seconds`;
        const hasCommentary = activityWrapper && Boolean(activityWrapper.querySelector(".activity-thought-item"));
        if (!hasCommentary && activityWrapper && activityWrapper.classList.contains("open") && !element.dataset.manuallyToggled) {
            activityWrapper.classList.remove("open");
        }
    } else if (activityLabel && !activityLabel.textContent.trim()) {
        activityLabel.textContent = `Working... (${elapsed}s)`;
    }

    if (!answerText.trim()) {
        if (isDone) {
            if (cursor) cursor.remove();
            finalizeFileEditBadges(element);
            if (hasTools) {
                finalContent.innerHTML = "<em>(Command execution completed without trailing commentary)</em>";
            } else {
                finalContent.innerHTML = "<em>(The model returned an empty response)</em>";
            }
            requestScrollToBottom(chat, true);
        }
        return Promise.resolve();
    }

    const { thoughtHtml, content, title: extractedTitle, followups: extractedFollowups } = extractThoughtAndContent(answerText);
    const followups = extractedFollowups || [];
    element.dataset.rawText = content ? content.trim() : answerText;
    const sanitizedThought = thoughtHtml || "";

    if (extractedTitle) {
        element.dataset.streamedTitle = extractedTitle;
        if (state.currentChatId && state.chatSessions[state.currentChatId]) {
            const session = state.chatSessions[state.currentChatId];
            const firstUserMsg = session.messages && session.messages.find(m => m.role === "user");
            const firstUserText = (firstUserMsg && typeof firstUserMsg.content === "string") ? firstUserMsg.content.trim() : "";
            const isDefaultTitle = !session.title || session.title === "New Chat" || session.title === "Conversation" || session.title.startsWith(firstUserText.slice(0, 30));
            if (isDefaultTitle) {
                const newTitle = extractedTitle.slice(0, 36);
                if (session.title !== newTitle) {
                    session.title = newTitle;
                    saveStoredChats();
                    renderChatList();
                }
            }
        }
    }

    const isStreamingEnabled = state.config?.Agent?.StreamResponse !== false;
    let streamer = activeStreamers.get(element);
    const shouldSyncParse = !isStreamingEnabled || (!streamer && isDone) || isDone;
    const sanitizedRest = (shouldSyncParse && content) ? parseMarkdown(content) : "";

    if (sanitizedThought) {
        if (element._lastRenderedThought !== sanitizedThought) {
            const prevDetails = preSearchContent.querySelector(".thought-box");
            const wasUserClosed = prevDetails && (!prevDetails.open || prevDetails.dataset.userToggled === "closed");
            const wasExpanded = Boolean(preSearchContent.querySelector(".thought-collapsible.is-expanded"));

            preSearchContent.innerHTML = sanitizedThought;
            if (sanitizedThought.includes("<table")) {
                wrapTablesForScroll(preSearchContent);
            }

            const newDetails = preSearchContent.querySelector(".thought-box");
            if (newDetails) {
                const wasUserOpened = prevDetails && prevDetails.dataset.userToggled === "open";
                const hasStreamingTools = Boolean(element._streamingToolBadges && element._streamingToolBadges.size > 0);
                const isThinkingActive = !isDone && !hasTools && !hasStreamingTools && (!content || !content.trim());
                if (wasUserOpened) {
                    newDetails.open = true;
                    newDetails.dataset.userToggled = "open";
                } else if (wasUserClosed || !isThinkingActive) {
                    newDetails.open = false;
                    if (wasUserClosed) newDetails.dataset.userToggled = "closed";
                } else {
                    newDetails.open = true;
                }
            }

            const newCollapsible = preSearchContent.querySelector(".thought-collapsible");
            if (newCollapsible && wasExpanded) {
                newCollapsible.classList.add("is-expanded");
                const btn = newCollapsible.querySelector(".thought-expand-btn");
                if (btn) {
                    btn.setAttribute("aria-expanded", "true");
                    btn.innerHTML = `<span class="thought-expand-icon" aria-hidden="true">▴</span> collapse`;
                }
            }

            element._lastRenderedThought = sanitizedThought;
            if (isDone) renderIcons(preSearchContent);
        }
    } else {
        if (preSearchContent.innerHTML) {
            preSearchContent.innerHTML = "";
            element._lastRenderedThought = "";
        }
    }

    // Auto-collapse thought box once thinking concludes or tools execute
    if (sanitizedThought && (!isDone || hasTools || (content && content.trim()))) {
        const details = preSearchContent.querySelector(".thought-box");
        if (details && details.open && details.dataset.userToggled !== "open") {
            const isThinkingActive = !isDone && !hasTools && (!content || !content.trim());
            if (!isThinkingActive) {
                details.open = false;
            }
        }
    }

    if (!content || !content.trim()) {
        if (isDone) {
            if (cursor) cursor.remove();
            finalizeFileEditBadges(element);
            renderFollowupSuggestions(element, followups, isDone);
            renderPlanApprovalActions(element, answerText, isDone);
            requestScrollToBottom(chat, true);
        }
        return Promise.resolve();
    }

    if (!isStreamingEnabled || (!streamer && isDone)) {
        if (streamer) {
            streamer.stop();
            activeStreamers.delete(element);
        }
        if (sanitizedRest) {
            finalContent.innerHTML = sanitizedRest;
            wrapTablesForScroll(finalContent);
            if (isDone) {
                renderIcons(finalContent);
                bindAIImageCards(finalContent);
            }
        } else {
            finalContent.innerHTML = "";
        }

        if (isDone) {
            if (cursor) cursor.remove();
            finalizeFileEditBadges(element);

            renderFollowupSuggestions(element, followups, true);
            renderPlanApprovalActions(element, answerText, true);

            // Clean up any empty thought boxes and finalize duration
            element.querySelectorAll(".thought-box").forEach(tb => {
                const contentEl = tb.querySelector(".thought-content");
                const textInside = contentEl ? (contentEl.textContent || "").trim() : (tb.textContent || "").trim();
                if (!textInside) {
                    tb.remove();
                    return;
                }
                const lbl = tb.querySelector(".thought-label");
                if (lbl && (lbl.textContent.includes("{}") || lbl.textContent.includes("a few seconds"))) {
                    lbl.textContent = `Thought for ${elapsed} seconds`;
                }
                if (tb.dataset.userToggled !== "open") {
                    tb.open = false;
                }
            });

            wrapHugeThoughts(element);

            element.querySelectorAll("a").forEach(link => {
                link.target = "_blank";
                link.rel = "noopener noreferrer";
            });

            bindInteractiveCodeBlocks(element);
            renderMermaidInElement(element);
            renderMath(element);
            bindAIImageCards(element);
            requestScrollToBottom(chat, true);
        } else {
            requestScrollToBottom(chat, false);
        }
        return Promise.resolve();
    }

    if (!streamer) {
        streamer = new StreamBatchRenderer(element, finalContent, cursor);
        activeStreamers.set(element, streamer);
    }

    streamer.append(content);

    if (isDone) {
        return streamer.markDone(() => {
            activeStreamers.delete(element);
            if (sanitizedRest) {
                finalContent.innerHTML = sanitizedRest;
                wrapTablesForScroll(finalContent);
                renderIcons(finalContent);
                bindAIImageCards(finalContent);
            }
            if (cursor) cursor.remove();
            finalizeFileEditBadges(element);

            renderFollowupSuggestions(element, followups, true);
            renderPlanApprovalActions(element, answerText, true);

            // Clean up any empty thought boxes and finalize duration
            element.querySelectorAll(".thought-box").forEach(tb => {
                const contentEl = tb.querySelector(".thought-content");
                const textInside = contentEl ? (contentEl.textContent || "").trim() : (tb.textContent || "").trim();
                if (!textInside) {
                    tb.remove();
                    return;
                }
                const lbl = tb.querySelector(".thought-label");
                if (lbl && (lbl.textContent.includes("{}") || lbl.textContent.includes("a few seconds"))) {
                    lbl.textContent = `Thought for ${elapsed} seconds`;
                }
                if (tb.dataset.userToggled !== "open") {
                    tb.open = false;
                }
            });

            wrapHugeThoughts(element);

            element.querySelectorAll("a").forEach(link => {
                link.target = "_blank";
                link.rel = "noopener noreferrer";
            });

            bindInteractiveCodeBlocks(element);
            renderMermaidInElement(element);
            renderMath(element);
            bindAIImageCards(element);
            requestScrollToBottom(chat, true);
        });
    } else {
        return Promise.resolve();
    }
}

export function renderFollowupSuggestions(element, followups, isDone) {
    if (!element) return;
    let container = element.querySelector(".followup-suggestions");
    const barContainer = element.querySelector(".files-changed-bar-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "followup-suggestions";
        container.style.display = "none";
        const cursor = element.querySelector(".blinking-cursor");
        if (barContainer && barContainer.parentNode === element) {
            element.insertBefore(container, barContainer);
        } else if (cursor) {
            element.insertBefore(container, cursor);
        } else {
            element.appendChild(container);
        }
    } else if (barContainer && barContainer.parentNode === element) {
        if (container.nextSibling !== barContainer) {
            if (container.nextSibling) {
                element.insertBefore(barContainer, container.nextSibling);
            } else {
                element.appendChild(barContainer);
            }
        }
    }

    if (isDone && Array.isArray(followups) && followups.length > 0) {
        container.innerHTML = followups.map(q => `
            <button type="button" class="followup-item" data-question="${escapeHTML(q)}" aria-label="Ask: ${escapeHTML(q)}">
                <i data-lucide="corner-down-right" class="followup-icon"></i>
                <span class="followup-text">${escapeHTML(q)}</span>
            </button>
        `).join("");
        container.style.display = "flex";
        renderIcons(container);
    } else if (isDone) {
        container.style.display = "none";
        container.innerHTML = "";
    }
}

export function finalizeStopped(element, startTime, hasTools) {
    const chat = document.getElementById("chat");
    logEvent("GENERATION_STOPPED_BY_USER", { elapsed: ((Date.now() - startTime) / 1000).toFixed(1) });

    const streamer = activeStreamers.get(element);
    if (streamer) {
        streamer.stop();
        activeStreamers.delete(element);
    }

    const cursor = element.querySelector(".blinking-cursor");
    if (cursor) cursor.remove();

    const finalContent = element.querySelector(".final-content");
    const preContent = element.querySelector(".pre-search-content");
    const activityWrapper = element.querySelector(".activity-wrapper");
    const activityLabel = element.querySelector(".activity-label");

    if (activityLabel) {
        activityLabel.textContent = `Stopped after ${((Date.now() - startTime) / 1000).toFixed(1)}s`;
    }
    if (activityWrapper && activityWrapper.classList.contains("open") && !element.dataset.manuallyToggled) {
        activityWrapper.classList.remove("open");
    }
    finalizeFileEditBadges(element);

    // Apply any streamed title to session if available
    const titleToUse = element.dataset.streamedTitle || extractChatTitleAndContent(element.dataset.rawText || "").title;
    if (titleToUse && state.currentChatId && state.chatSessions[state.currentChatId]) {
        const session = state.chatSessions[state.currentChatId];
        const firstUserMsg = session.messages && session.messages.find(m => m.role === "user");
        const firstUserText = (firstUserMsg && typeof firstUserMsg.content === "string") ? firstUserMsg.content.trim() : "";
        const isDefaultTitle = !session.title || session.title === "New Chat" || session.title === "Conversation" || session.title.startsWith(firstUserText.slice(0, 30));
        if (isDefaultTitle) {
            session.title = titleToUse.slice(0, 36);
            saveStoredChats();
            renderChatList();
        }
    }

    // Always append (Generation stopped) to finalContent, never inside preContent reasoning
    if (finalContent) {
        // Strip any residual chatname JSON if present
        const text = finalContent.innerHTML.trim();
        const extracted = extractChatTitleAndContent(text);
        if (extracted.title) {
            finalContent.innerHTML = extracted.content;
        }
        const updatedText = finalContent.innerHTML.trim();
        if (!updatedText) {
            finalContent.innerHTML = "<em>(Generation stopped)</em>";
        } else {
            finalContent.innerHTML += "<p><em>(Generation stopped)</em></p>";
        }
        element.dataset.rawText = (finalContent.innerText || finalContent.textContent || "").trim();
    }
    requestScrollToBottom(chat);
}

export function finalizeStalled(element, startTime, hasTools, errorInfo) {
    const chat = document.getElementById("chat");
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logEvent("GENERATION_STREAM_STALLED", { elapsed, error: errorInfo?.message, isStall: errorInfo?.isStall });

    const streamer = activeStreamers.get(element);
    if (streamer) {
        streamer.stop();
        activeStreamers.delete(element);
    }

    const cursor = element.querySelector(".blinking-cursor");
    if (cursor) cursor.remove();

    const finalContent = element.querySelector(".final-content");
    const activityWrapper = element.querySelector(".activity-wrapper");
    const activityLabel = element.querySelector(".activity-label");

    if (activityLabel) {
        activityLabel.textContent = `Stalled after ${elapsed}s`;
    }
    if (activityWrapper && activityWrapper.classList.contains("open") && !element.dataset.manuallyToggled) {
        activityWrapper.classList.remove("open");
    }
    finalizeFileEditBadges(element);

    // Apply any streamed title to session if available
    const titleToUse = element.dataset.streamedTitle || extractChatTitleAndContent(element.dataset.rawText || "").title;
    if (titleToUse && state.currentChatId && state.chatSessions[state.currentChatId]) {
        const session = state.chatSessions[state.currentChatId];
        const firstUserMsg = session.messages && session.messages.find(m => m.role === "user");
        const firstUserText = (firstUserMsg && typeof firstUserMsg.content === "string") ? firstUserMsg.content.trim() : "";
        const isDefaultTitle = !session.title || session.title === "New Chat" || session.title === "Conversation" || session.title.startsWith(firstUserText.slice(0, 30));
        if (isDefaultTitle) {
            session.title = titleToUse.slice(0, 36);
            saveStoredChats();
            renderChatList();
        }
    }

    if (finalContent) {
        const partialRaw = errorInfo?.partialText || (element.dataset.rawText || "").trim();
        const extracted = extractChatTitleAndContent(partialRaw);
        const cleanContent = extracted.content || partialRaw;

        if (cleanContent) {
            finalContent.innerHTML = parseMarkdown(cleanContent);
            wrapTablesForScroll(finalContent);
            finalContent.innerHTML += `
                <div class="stream-interrupted-banner" role="status" aria-live="polite">
                    <span class="stream-interrupted-info">
                        <span class="stream-interrupted-badge">Connection stalled</span>
                        <span class="stream-interrupted-desc">Stream stalled mid-response. Output preserved.</span>
                    </span>
                </div>
            `;
            element.dataset.rawText = cleanContent;
        } else {
            finalContent.innerHTML = `
                <div class="ai-error-notice" role="alert">
                    <span class="ai-error-badge"><i data-lucide="wifi-off"></i> Connection timed out</span>
                    <span class="ai-error-text">No response was received from the server within the expected window (${elapsed}s). Please verify your connection or try again.</span>
                </div>
            `;
            renderIcons(finalContent);
            element.dataset.rawText = "";
        }
    }
    requestScrollToBottom(chat);
}

export function initChatDelegation() {
    const chat = document.getElementById("chat");
    if (!chat) return;

    chat.addEventListener("click", (e) => {
        if (handlePlanApprovalClick(e)) {
            return;
        }

        const followupBtn = e.target.closest(".followup-item");
        if (followupBtn) {
            const question = followupBtn.dataset.question;
            if (question) {
                if (state.currentChatId && state.activeGenerations[state.currentChatId]?.isGenerating) {
                    return;
                }
                chatbox.setValue(question);
                chatbox.triggerSend();
            }
            return;
        }

        const actToggle = e.target.closest(".activity-toggle");
        if (actToggle) {
            const wrapper = actToggle.closest(".activity-wrapper");
            if (wrapper) {
                wrapper.classList.toggle("open");
                const parentAi = wrapper.closest(".message.ai");
                if (parentAi) {
                    parentAi.dataset.manuallyToggled = "true";
                }
                saveCurrentChatState();
            }
            return;
        }

        const ptyBtn = e.target.closest(".badge-open-pty-btn");
        if (ptyBtn) {
            e.stopPropagation();
            e.preventDefault();
            const cmdBox = ptyBtn.closest(".command-output-cmd");
            const cmd = cmdBox?.dataset?.full || cmdBox?.dataset?.compact || cmdBox?.querySelector(".command-cmd-text")?.textContent || "";
            openTerminal({ command: cmd });
            return;
        }

        const cmdToggle = e.target.closest(".cmd-compact-toggle");
        if (cmdToggle) {
            e.stopPropagation();
            const cmdBox = cmdToggle.closest(".command-output-cmd");
            if (cmdBox) {
                const isExpanded = cmdBox.classList.contains("is-expanded");
                const textEl = cmdBox.querySelector(".command-cmd-text");
                const labelEl = cmdToggle.querySelector(".cmd-toggle-label");
                const linesEl = cmdToggle.querySelector(".cmd-toggle-lines");
                const isShell = cmdBox.dataset.isShell === "true";

                if (isExpanded) {
                    cmdBox.classList.remove("is-expanded");
                    cmdBox.classList.add("is-compact");
                    if (textEl) {
                        const raw = cmdBox.dataset.compact || "";
                        textEl.innerHTML = escapeHTML(raw);
                    }
                    if (labelEl) labelEl.textContent = "Expand";
                    if (linesEl) linesEl.style.display = "";
                    cmdToggle.setAttribute("aria-expanded", "false");
                } else {
                    cmdBox.classList.remove("is-compact");
                    cmdBox.classList.add("is-expanded");
                    if (textEl) {
                        const raw = cmdBox.dataset.full || "";
                        textEl.innerHTML = escapeHTML(raw);
                    }
                    if (labelEl) labelEl.textContent = "Collapse";
                    if (linesEl) linesEl.style.display = "none";
                    cmdToggle.setAttribute("aria-expanded", "true");
                }
                saveCurrentChatState();
            }
            return;
        }

        const viewBtn = e.target.closest(".checkpoint-view-btn, .checkpoint-open-doc-btn, .checkpoint-artifact-link, .artifact-open-btn");
        if (viewBtn) {
            e.stopPropagation();
            const badge = viewBtn.closest(".search-badge-item.clickable-badge") || viewBtn.closest(".badge-collapse")?.previousElementSibling;
            const artifactPath = viewBtn.dataset.path || badge?.dataset?.artifactPath || "";
            const checkpointNum = parseInt(viewBtn.dataset.checkpointNum || badge?.dataset?.checkpointNum || "1", 10);
            const sliceStartIdx = parseInt(viewBtn.dataset.sliceStart || badge?.dataset?.sliceStart || "0", 10);
            const sliceEndIdx = parseInt(viewBtn.dataset.sliceEnd || badge?.dataset?.sliceEnd || "0", 10);
            const tokensSaved = parseInt(viewBtn.dataset.tokensSaved || badge?.dataset?.tokensSaved || "0", 10);
            const collapse = badge?._collapseDiv || badge?.nextElementSibling;
            const summaryText = collapse?.querySelector?.(".command-output-res")?.textContent || "";

            if (artifactPath && window.rightPanel) {
                window.rightPanel.open();
                window.rightPanel.openFileTab(artifactPath);
            } else {
                showCheckpointModal({
                    artifactPath,
                    summaryText,
                    checkpointNum,
                    sliceStartIdx,
                    sliceEndIdx,
                    tokensSaved
                });
            }
            return;
        }

        const cmdBadge = e.target.closest(".search-badge-item.clickable-badge");
        if (cmdBadge) {
            const isOpen = cmdBadge.classList.toggle("open");
            cmdBadge.setAttribute("aria-expanded", isOpen ? "true" : "false");
            if (isOpen) {
                const collapse = cmdBadge.nextElementSibling;
                const pre = collapse?.querySelector?.("pre");
                if (pre) pre.scrollTop = 0;
            }
            saveCurrentChatState();
            return;
        }

        const thoughtSummary = e.target.closest(".thought-summary");
        if (thoughtSummary) {
            const details = thoughtSummary.closest(".thought-box");
            if (details) {
                setTimeout(() => {
                    details.dataset.userToggled = details.open ? "open" : "closed";
                    saveCurrentChatState();
                }, 0);
            }
        }

        const thoughtExpandBtn = e.target.closest(".thought-expand-btn");
        if (thoughtExpandBtn) {
            e.stopPropagation();
            const collapsible = thoughtExpandBtn.closest(".thought-collapsible");
            if (collapsible) {
                const isExpanded = collapsible.classList.toggle("is-expanded");
                thoughtExpandBtn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
                thoughtExpandBtn.innerHTML = isExpanded
                    ? `<span class="thought-expand-icon" aria-hidden="true">▴</span> collapse`
                    : `<span class="thought-expand-icon" aria-hidden="true">…</span> expand`;
                saveCurrentChatState();
            }
            return;
        }

        const imgTarget = e.target.closest(".ai-img-frame") ||
                          e.target.closest(".msg-img-card") || 
                          (e.target.tagName === "IMG" && e.target.closest(".message") && !e.target.closest(".activity-item, .search-badge-item"));
        if (imgTarget) {
            const imgEl = imgTarget.tagName === "IMG" ? imgTarget : imgTarget.querySelector("img");
            const fullImg = imgTarget.dataset?.src || imgTarget.dataset?.fullImg || imgEl?.src;
            if (fullImg) {
                openImageLightbox(fullImg);
            }
            return;
        }
    });

    chat.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            const badge = e.target.closest(".search-badge-item.clickable-badge");
            if (badge && e.target === badge) {
                e.preventDefault();
                const isOpen = badge.classList.toggle("open");
                badge.setAttribute("aria-expanded", isOpen ? "true" : "false");
                if (isOpen) {
                    const collapse = badge.nextElementSibling;
                    const pre = collapse?.querySelector?.("pre");
                    if (pre) pre.scrollTop = 0;
                }
                saveCurrentChatState();
            }
        }
    });

    initScrollToBottom();
}
