/* =========================================================
   CHAT UI, BADGES, STREAM UPDATER & ACCORDIONS
   ========================================================= */
import { escapeHTML, wrapTablesForScroll } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { logEvent } from "../utils/logger.js";
import { state } from "../state.js";
import { chatbox } from "./chatbox.js";
import { parseMarkdown, extractThoughtAndContent, bindInteractiveCodeBlocks, renderMermaidInElement, renderMath, bindAIImageCards } from "./renderer.js";
import { saveCurrentChatState } from "../services/storage.js";
import { onToolComplete } from "../tools/badge-sync.js";
import { isAndroidOrMobile } from "./aurora-theme.js";
import {
    getToolBadgeConfig,
    addToolBadge,
    showCheckpointModal,
    addCompactionBadge,
    addThoughtTrace,
    wrapHugeThoughts
} from "./chat-tool-badges.js";

export {
    getToolBadgeConfig,
    addToolBadge,
    showCheckpointModal,
    addCompactionBadge,
    addThoughtTrace,
    wrapHugeThoughts
};

let streamScrollRafId = null;

export function requestScrollToBottom(chat, force = false) {
    if (!chat) return;
    if (force) {
        if (streamScrollRafId) {
            cancelAnimationFrame(streamScrollRafId);
            streamScrollRafId = null;
        }
        chat.scrollTop = chat.scrollHeight;
        return;
    }
    if (streamScrollRafId) return;
    streamScrollRafId = requestAnimationFrame(() => {
        streamScrollRafId = null;
        const isNearBottom = (chat.scrollHeight - chat.scrollTop - chat.clientHeight) < 140;
        if (isNearBottom) {
            chat.scrollTop = chat.scrollHeight;
        }
    });
}

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
    chat.scrollTop = chat.scrollHeight;
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
        const textHtml = rawText ? `<div class="msg-bubble-text">${escapeHTML(rawText)}</div>` : "";
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
                    onToolComplete(toolName, args, badgeEl, toolData);
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
            const rawText = finalAssistantMsg.content || "";
            aiDiv.dataset.rawText = rawText;

            const { thoughtHtml, content, followups } = extractThoughtAndContent(rawText);
            
            if (thoughtHtml) {
                preSearchContent.innerHTML = thoughtHtml;
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
        }

        if (searchContainer && searchContainer.children.length > 0) {
            activityWrapper.style.display = "block";
            activityWrapper.classList.remove("open");
            activityLabel.textContent = totalToolCalls > 0 
                ? `Executed ${totalToolCalls} action${totalToolCalls > 1 ? "s" : ""}` 
                : `Activity`;
        } else {
            activityWrapper.style.display = "none";
        }

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

    const messages = Array.isArray(session.messages) ? session.messages : [];
    if (messages.length === 0) return;

    // Filter out system prompt messages from visible dialogue
    const nonSystem = messages.filter(m => m && m.role !== "system");
    if (nonSystem.length === 0) return;

    // Group into turns: each turn starts with a user message, followed by all corresponding AI turns (assistant + tool)
    const turns = [];
    let currentTurn = null;

    for (let i = 0; i < nonSystem.length; i++) {
        const m = nonSystem[i];
        if (m.role === "user") {
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

export function updateAIStream(element, fullText, isDone, startTime, hasTools) {
    const chat = document.getElementById("chat");
    const activityWrapper = element.querySelector(".activity-wrapper");
    const activityLabel = element.querySelector(".activity-label");
    const preSearchContent = element.querySelector(".pre-search-content");
    const finalContent = element.querySelector(".final-content");
    const cursor = element.querySelector(".blinking-cursor");

    const answerText = fullText;
    element.dataset.rawText = answerText;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (isDone) {
        activityLabel.textContent = `Worked for ${elapsed} seconds`;
        if (activityWrapper && activityWrapper.classList.contains("open") && !element.dataset.manuallyToggled) {
            activityWrapper.classList.remove("open");
        }
    } else {
        activityLabel.textContent = `Working... (${elapsed}s)`;
    }

    let followups = [];
    if (answerText.trim()) {
        const { thoughtHtml, content, followups: extractedFollowups } = extractThoughtAndContent(answerText);
        followups = extractedFollowups || [];
        element.dataset.rawText = content ? content.trim() : answerText;
        const sanitizedThought = thoughtHtml || "";
        const sanitizedRest = content ? parseMarkdown(content) : "";

        // Check if there are any activity badges (tools, compaction checkpoints, etc.)
        const searchContainer = element.querySelector(".search-items-container");
        const hasActivity = hasTools || Boolean(searchContainer && searchContainer.children.length > 0) || (activityWrapper && activityWrapper.style.display === "block");

        if (sanitizedThought) {
            preSearchContent.innerHTML = sanitizedThought;
            wrapTablesForScroll(preSearchContent);
            if (isDone) renderIcons(preSearchContent);
        } else {
            preSearchContent.innerHTML = "";
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
    } else if (isDone) {
        if (hasTools) {
            finalContent.innerHTML = "<em>(Command execution completed without trailing commentary)</em>";
        } else {
            finalContent.innerHTML = "<em>(The model returned an empty response)</em>";
        }
    }

    if (isDone) {
        if (cursor) cursor.remove();

        renderFollowupSuggestions(element, followups, isDone);

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
}

export function renderFollowupSuggestions(element, followups, isDone) {
    if (!element) return;
    let container = element.querySelector(".followup-suggestions");
    if (!container) {
        container = document.createElement("div");
        container.className = "followup-suggestions";
        container.style.display = "none";
        const cursor = element.querySelector(".blinking-cursor");
        if (cursor) {
            element.insertBefore(container, cursor);
        } else {
            element.appendChild(container);
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

    const targetContent = hasTools ? finalContent : (preContent || finalContent);
    if (targetContent) {
        const text = targetContent.innerHTML.trim();
        if (!text) {
            targetContent.innerHTML = "<em>(Generation stopped)</em>";
        } else {
            targetContent.innerHTML += "<p><em>(Generation stopped)</em></p>";
        }
    }
    element.dataset.rawText = (targetContent?.innerText || targetContent?.textContent || "").trim();
    chat.scrollTop = chat.scrollHeight;
}

export function initChatDelegation() {
    const chat = document.getElementById("chat");
    if (!chat) return;

    chat.addEventListener("click", (e) => {
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

        const cmdToggle = e.target.closest(".cmd-compact-toggle");
        if (cmdToggle) {
            e.stopPropagation();
            const cmdBox = cmdToggle.closest(".command-output-cmd");
            if (cmdBox) {
                const isExpanded = cmdBox.classList.contains("is-expanded");
                const textEl = cmdBox.querySelector(".command-cmd-text");
                const labelEl = cmdToggle.querySelector(".cmd-toggle-label");
                const linesEl = cmdToggle.querySelector(".cmd-toggle-lines");

                if (isExpanded) {
                    cmdBox.classList.remove("is-expanded");
                    cmdBox.classList.add("is-compact");
                    if (textEl) textEl.textContent = cmdBox.dataset.compact || "";
                    if (labelEl) labelEl.textContent = "Expand";
                    if (linesEl) linesEl.style.display = "";
                    cmdToggle.setAttribute("aria-expanded", "false");
                } else {
                    cmdBox.classList.remove("is-compact");
                    cmdBox.classList.add("is-expanded");
                    if (textEl) textEl.textContent = cmdBox.dataset.full || "";
                    if (labelEl) labelEl.textContent = "Collapse";
                    if (linesEl) linesEl.style.display = "none";
                    cmdToggle.setAttribute("aria-expanded", "true");
                }
                saveCurrentChatState();
            }
            return;
        }

        const viewBtn = e.target.closest(".checkpoint-view-btn, .checkpoint-open-doc-btn, .checkpoint-artifact-link");
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

            showCheckpointModal({
                artifactPath,
                summaryText,
                checkpointNum,
                sliceStartIdx,
                sliceEndIdx,
                tokensSaved
            });
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
                let lb = document.getElementById("imageLightbox");
                if (!lb) {
                    lb = document.createElement("div");
                    lb.id = "imageLightbox";
                    lb.className = "image-lightbox";
                    lb.innerHTML = `
                        <div class="lightbox-backdrop"></div>
                        <div class="lightbox-container">
                            <button type="button" class="lightbox-close" aria-label="Close image"><i data-lucide="x"></i></button>
                            <img id="lightboxImg" src="" alt="Full preview">
                        </div>
                    `;
                    document.body.appendChild(lb);
                    renderIcons(lb);
                    lb.querySelector(".lightbox-backdrop").addEventListener("click", () => lb.classList.remove("active"));
                    lb.querySelector(".lightbox-close").addEventListener("click", () => lb.classList.remove("active"));
                }
                const img = lb.querySelector("#lightboxImg");
                if (img) img.src = fullImg;
                lb.classList.add("active");
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

export function initScrollToBottom() {
    const chat = document.getElementById("chat");
    const btn = document.getElementById("scrollToBottomBtn");
    if (!chat || !btn) return;

    renderIcons(btn);

    // Dynamic height tracking of composer so button floats cleanly above it
    const inputArea = document.getElementById("inputArea");
    const updateComposerHeight = () => {
        if (!inputArea || !btn) return;
        const rect = inputArea.getBoundingClientRect();
        const height = Math.round(rect.height || inputArea.offsetHeight || 94);
        btn.style.bottom = `${height + 22}px`;
    };

    if (inputArea && typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => {
            updateComposerHeight();
        });
        ro.observe(inputArea);
    }
    updateComposerHeight();

    const SCROLL_THRESHOLD = 90; // pixels from bottom before affordance appears
    let isTicking = false;

    function updateVisibility() {
        const appShell = document.getElementById("appShell");
        const isStartPage = appShell?.classList.contains("is-start-page");
        if (isStartPage) {
            btn.classList.remove("visible");
            return;
        }

        const distanceFromBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
        const hasScrollableContent = chat.scrollHeight > chat.clientHeight + 60;

        if (hasScrollableContent && distanceFromBottom > SCROLL_THRESHOLD) {
            btn.classList.add("visible");
        } else {
            btn.classList.remove("visible");
        }
    }

    // Passive scroll listener with requestAnimationFrame throttling
    chat.addEventListener("scroll", () => {
        if (!isTicking) {
            window.requestAnimationFrame(() => {
                updateVisibility();
                isTicking = false;
            });
            isTicking = true;
        }
    }, { passive: true });

    // Ensure bottom sentinel exists and is observed
    let sentinel = document.getElementById("chatBottomSentinel");
    let observer = null;
    const ensureSentinel = () => {
        if (!sentinel || !chat.contains(sentinel)) {
            sentinel = document.getElementById("chatBottomSentinel");
            if (!sentinel) {
                sentinel = document.createElement("div");
                sentinel.id = "chatBottomSentinel";
                sentinel.className = "chat-bottom-sentinel";
                sentinel.setAttribute("aria-hidden", "true");
                chat.appendChild(sentinel);
            }
            if (observer && sentinel) {
                observer.observe(sentinel);
            }
        }
    };

    if (typeof IntersectionObserver !== "undefined") {
        observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    btn.classList.remove("visible");
                } else {
                    updateVisibility();
                }
            }
        }, { root: chat, threshold: 0.1 });
    }
    ensureSentinel();

    // Scroll to bottom on click (instant on mobile to prevent animation thrashing)
    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isMobile = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches ||
                         document.documentElement.classList.contains("is-android");
        const scrollBehavior = isMobile ? "auto" : "smooth";
        chat.scrollTo({
            top: chat.scrollHeight,
            behavior: scrollBehavior
        });
        btn.classList.remove("visible");

        // Follow-up checks in case any dynamic content or code blocks render during scroll
        const ensureAtEnd = () => {
            const distance = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
            if (distance > 30) {
                chat.scrollTo({
                    top: chat.scrollHeight,
                    behavior: scrollBehavior
                });
            }
        };
        if ("onscrollend" in window) {
            chat.addEventListener("scrollend", ensureAtEnd, { once: true });
        }
        setTimeout(ensureAtEnd, isMobile ? 50 : 350);
        setTimeout(ensureAtEnd, isMobile ? 120 : 750);
    });

    // Update whenever chat session changes or messages update
    document.addEventListener("chatsUpdated", () => {
        ensureSentinel();
        updateComposerHeight();
        setTimeout(updateVisibility, 80);
    });

    // MutationObserver on chat to ensure sentinel stays at bottom
    if (typeof MutationObserver !== "undefined") {
        const mutationObserver = new MutationObserver(() => {
            ensureSentinel();
            if (sentinel && sentinel.nextElementSibling) {
                chat.appendChild(sentinel);
            }
            updateVisibility();
        });
        mutationObserver.observe(chat, { childList: true, subtree: false });
    }

    // Initial check
    setTimeout(() => {
        updateComposerHeight();
        updateVisibility();
    }, 150);
}
