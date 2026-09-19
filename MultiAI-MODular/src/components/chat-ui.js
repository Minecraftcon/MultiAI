/* =========================================================
   CHAT UI, BADGES, STREAM UPDATER & ACCORDIONS
   ========================================================= */
import { escapeHTML, wrapTablesForScroll } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { logEvent } from "../utils/logger.js";
import { state } from "../state.js";
import { chatbox } from "./chatbox.js";
import { parseMarkdown, extractThoughtAndContent, bindInteractiveCodeBlocks, renderMermaidInElement, renderMath, bindAIImageCards } from "./renderer.js";

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

export function addToolBadge(element, toolName, args) {
    const chat = document.getElementById("chat");
    const wrapper = element.querySelector(".activity-wrapper");
    const searchContainer = element.querySelector(".search-items-container");
    
    if (wrapper.style.display !== "block") {
        wrapper.style.display = "block";
        wrapper.classList.add("open");
    }

    let icon = "terminal";
    let label = "Executed";
    let detail = "";
    let isCommandTask = false;

    if (toolName === "web_search") {
        icon = "search";
        label = "Searched for";
        detail = args.query || args.search || "web query";
    } else if (toolName === "fetch_web_content" || toolName === "web_fetch") {
        icon = "globe";
        label = "Fetched";
        const urlList = Array.isArray(args.urls) ? args.urls : (args.url ? [args.url] : []);
        detail = urlList.length === 1 ? urlList[0] : (urlList.length > 1 ? `${urlList.length} pages (${urlList[0]}...)` : "web content");
        isCommandTask = true;
    } else if (toolName === "run_task") {
        icon = "play";
        label = "Ran command";
        const taskName = args.task_name || args.name;
        detail = taskName || args.command || "task command";
        isCommandTask = true;
    } else if (toolName === "task_stdout") {
        icon = "file-text";
        label = "Checked task";
        detail = args.task_id || "task output";
        isCommandTask = true;
    } else if (toolName === "task_send_input") {
        icon = "keyboard";
        const isKeycode = args.type === "keycode" || !!args.combination;
        label = isKeycode ? "Sent key" : "Sent input";
        const val = isKeycode ? (args.combination || "key") : (args.field !== undefined ? args.field : (args.input_string || ""));
        detail = `${args.task_id}: ${val}`;
        isCommandTask = true;
    } else if (toolName === "task_kill") {
        icon = "octagon";
        label = "Killed task";
        detail = args.task_id || "process";
    } else if (toolName === "sleep") {
        icon = "clock";
        label = "Sleeping...";
        detail = `${args.seconds || 1}s timer`;
    } else if (toolName === "idle") {
        icon = "hourglass";
        label = args.task_id ? "Waiting for task..." : "Idling...";
        const targetTask = args.task_id ? ` (${args.task_id})` : "";
        detail = args.reason ? `${args.reason}${targetTask}` : `${args.seconds || 5}s timer${targetTask}`;
        isCommandTask = true;
    } else if (toolName === "read_file") {
        icon = args.action === "view" ? "eye" : (args.action === "info" ? "info" : "file-text");
        label = args.action === "view" ? "Viewed file" : (args.action === "info" ? "File info" : "Read file");
        const lineSpan = (args.start_line || args.end_line) ? ` (lines ${args.start_line || 1}-${args.end_line || "end"})` : "";
        detail = `${args.path || "file"}${lineSpan}`;
        isCommandTask = true;
    } else if (toolName === "write_file") {
        const act = args.action || (args.operations ? "batch" : (args.target !== undefined ? "replace" : (args.line !== undefined ? "inject" : "write")));
        icon = act === "replace" ? "edit-3" : (act === "inject" ? "plus-circle" : (act === "batch" ? "layers" : "file-edit"));
        label = act === "replace" ? "Replaced text" : (act === "inject" ? "Injected into file" : (act === "batch" ? "Batch modified" : "Wrote file"));
        detail = args.path || "file";
        isCommandTask = true;
    } else if (toolName === "generate_image") {
        icon = "image";
        label = "Generated image";
        detail = args.prompt || "image generation";
        isCommandTask = true;
    } else if (toolName === "end") {
        icon = "check-circle";
        label = "Completed task";
        detail = "Delivered final answer";
    }

    const isTimer = toolName === "sleep" || toolName === "idle";
    const isCommand = toolName === "run_task";
    const hasRing = isTimer || isCommand;

    const detailLines = String(detail || "").split("\n");
    const isDetailMulti = detailLines.length > 3;
    const compactDetail = isDetailMulti
        ? detailLines.slice(0, 3).join("\n") + "\n..."
        : detail;

    const isRunTaskWithTitle = toolName === "run_task" && (args.task_name || args.name);
    const codeIconHtml = isRunTaskWithTitle 
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-code preview-icon" style="display:inline-block; vertical-align:-2px; margin: 0 4px; opacity:0.8;"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>` 
        : ``;

    const item = document.createElement("div");
    item.className = "search-badge-item" + (hasRing ? " timer-badge" : "") + (isCommandTask ? " clickable-badge" : "") + (isDetailMulti ? " has-multiline" : "");

    item.innerHTML = `
        <div class="search-icon-circle ${hasRing ? 'has-timer-ring' : ''}">
            ${hasRing ? `
            <svg class="timer-ring-svg" viewBox="0 0 36 36">
                <circle class="timer-ring-bg" cx="18" cy="18" r="17.25" />
                <circle class="timer-ring-bar" cx="18" cy="18" r="17.25" transform="rotate(-90 18 18)" />
            </svg>
            ` : ''}
            <i data-lucide="${icon}"></i>
        </div>
        <div>
            <span class="search-label">${label}</span>
            ${codeIconHtml}
            <span class="search-query ${detailLines.length > 1 ? 'is-multiline' : ''}" data-full="${escapeHTML(detail)}" data-compact="${escapeHTML(compactDetail)}">${escapeHTML(compactDetail)}</span>
            ${isCommandTask ? '<span class="badge-expand-chevron">▶</span>' : ''}
        </div>
    `;

    searchContainer.appendChild(item);

    if (isCommandTask) {
        const collapseDiv = document.createElement("div");
        collapseDiv.className = "badge-collapse";
        
        let displayCmd = "";
        if (toolName === "write_file") {
            const act = args.action || (args.operations ? "batch" : (args.target !== undefined ? "replace" : (args.line !== undefined ? "inject" : "write")));
            if (act === "replace") {
                displayCmd = `Replace in ${args.path || "file"}:\nTarget: ${args.target ?? ""}\nReplacement: ${args.replacement ?? ""}`;
            } else if (act === "inject") {
                displayCmd = `Inject at line ${args.line || 1} in ${args.path || "file"}:\n${args.content ?? ""}`;
            } else if (act === "batch") {
                displayCmd = `Batch operations (${(args.operations || []).length}) on ${args.path || "file"}`;
            } else {
                displayCmd = `Write to ${args.path || "file"}`;
            }
        } else if (toolName === "read_file") {
            const span = (args.start_line || args.end_line) ? ` (lines ${args.start_line || 1}-${args.end_line || "end"})` : "";
            displayCmd = `${(args.action || "read").toUpperCase()}: ${args.path || "file"}${span}`;
        } else if (toolName === "idle") {
            displayCmd = `Idle timer: ${args.seconds || 5}s${args.task_id ? ` (wake on ${args.wake_on || "exit"}: ${args.task_id})` : ""}`;
        } else {
            displayCmd = args.command || args.input_string || (Array.isArray(args.urls) ? args.urls.join("\n") : args.url) || (args.task_id ? `Task: ${args.task_id}` : "Task execution");
        }
        const cmdLines = String(displayCmd || "").split("\n");
        const isCmdMulti = cmdLines.length > 3;
        const compactCmd = isCmdMulti
            ? cmdLines.slice(0, 3).join("\n") + "\n..."
            : displayCmd;
        
        collapseDiv.innerHTML = `
            <div class="badge-collapse-inner">
                <div class="command-output-box">
                    <pre><div class="command-output-cmd ${isCmdMulti ? 'is-compact' : ''}" data-full="${escapeHTML(displayCmd)}" data-compact="${escapeHTML(compactCmd)}"><div class="command-cmd-text">${escapeHTML(compactCmd)}</div>${isCmdMulti ? `<div class="cmd-toggle-row"><button type="button" class="cmd-compact-toggle" aria-expanded="false"><span class="cmd-toggle-label">Expand</span> <span class="cmd-toggle-lines">(${cmdLines.length} lines)</span></button></div>` : ''}</div><hr class="command-output-sep"><div class="command-output-res"></div></pre>
                </div>
            </div>
        `;
        searchContainer.appendChild(collapseDiv);
        item._collapseDiv = collapseDiv;
    }

    renderIcons(item);
    chat.scrollTop = chat.scrollHeight;
    return item;
}

export function addThoughtTrace(element, text) {
    if (!text || !text.trim()) return null;
    const chat = document.getElementById("chat");
    const wrapper = element.querySelector(".activity-wrapper");
    const searchContainer = element.querySelector(".search-items-container");

    if (wrapper.style.display !== "block") {
        wrapper.style.display = "block";
        wrapper.classList.add("open");
    }

    const item = document.createElement("div");
    item.className = "activity-thought-item";
    item.innerHTML = `<div class="activity-thought-text">${escapeHTML(text.trim())}</div>`;

    searchContainer.appendChild(item);
    chat.scrollTop = chat.scrollHeight;
    return item;
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
        if (activityWrapper.classList.contains("open") && !element.dataset.manuallyToggled) {
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
        const sanitizedThought = thoughtHtml ? parseMarkdown(thoughtHtml) : "";
        const sanitizedRest = content ? parseMarkdown(content) : "";

        if (hasTools) {
            if (sanitizedThought) {
                preSearchContent.innerHTML = sanitizedThought;
                wrapTablesForScroll(preSearchContent);
                renderIcons(preSearchContent);
            } else {
                preSearchContent.innerHTML = "";
            }
            finalContent.innerHTML = sanitizedRest;
            wrapTablesForScroll(finalContent);
            renderIcons(finalContent);
            bindAIImageCards(finalContent);
        } else {
            const combined = sanitizedThought ? `${sanitizedThought}\n${sanitizedRest}` : sanitizedRest;
            preSearchContent.innerHTML = combined;
            wrapTablesForScroll(preSearchContent);
            renderIcons(preSearchContent);
            bindAIImageCards(preSearchContent);
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

        element.querySelectorAll("a").forEach(link => {
            link.target = "_blank";
            link.rel = "noopener noreferrer";
        });

        bindInteractiveCodeBlocks(element);
        renderMermaidInElement(element);
        renderMath(element);
        bindAIImageCards(element);
    }

    chat.scrollTop = chat.scrollHeight;
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

        const cmdBadge = e.target.closest(".search-badge-item.clickable-badge");
        if (cmdBadge) {
            cmdBadge.classList.toggle("open");
            saveCurrentChatState();
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
}
