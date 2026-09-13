/* =========================================================
   CHAT UI, BADGES, STREAM UPDATER & ACCORDIONS
   ========================================================= */
import { escapeHTML, wrapTablesForScroll } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { logEvent } from "../utils/logger.js";
import { saveCurrentChatState } from "../services/storage.js";
import { parseMarkdown, bindInteractiveCodeBlocks, renderMermaidInElement, renderMath } from "./renderer.js";

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
        detail = args.command || "task command";
        isCommandTask = true;
    } else if (toolName === "task_stdout") {
        icon = "file-text";
        label = "Checked task";
        detail = args.task_id || "task output";
        isCommandTask = true;
    } else if (toolName === "task_send_input") {
        icon = "keyboard";
        label = "Sent input";
        detail = `${args.task_id}: ${args.input_string || ""}`;
        isCommandTask = true;
    } else if (toolName === "task_kill") {
        icon = "octagon";
        label = "Killed task";
        detail = args.task_id || "process";
    } else if (toolName === "sleep") {
        icon = "clock";
        label = "Sleeping...";
        detail = `${args.seconds || 1}s timer`;
    }

    const isTimer = toolName === "sleep";
    const isCommand = toolName === "run_task";
    const hasRing = isTimer || isCommand;

    const detailLines = String(detail || "").split("\n");
    const isDetailMulti = detailLines.length > 3;
    const compactDetail = isDetailMulti
        ? detailLines.slice(0, 3).join("\n") + "\n..."
        : detail;

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
            <span class="search-query ${detailLines.length > 1 ? 'is-multiline' : ''}" data-full="${escapeHTML(detail)}" data-compact="${escapeHTML(compactDetail)}">${escapeHTML(compactDetail)}</span>
            ${isCommandTask ? '<span class="badge-expand-chevron">▶</span>' : ''}
        </div>
    `;

    searchContainer.appendChild(item);

    if (isCommandTask) {
        const collapseDiv = document.createElement("div");
        collapseDiv.className = "badge-collapse";
        
        const displayCmd = args.command || args.input_string || (Array.isArray(args.urls) ? args.urls.join("\n") : args.url) || `Task: ${args.task_id}`;
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

    if (answerText.trim()) {
        const sanitized = parseMarkdown(answerText);

        if (hasTools) {
            finalContent.innerHTML = sanitized;
            wrapTablesForScroll(finalContent);
            renderIcons(finalContent);
        } else {
            preSearchContent.innerHTML = sanitized;
            wrapTablesForScroll(preSearchContent);
            renderIcons(preSearchContent);
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

        element.querySelectorAll("a").forEach(link => {
            link.target = "_blank";
            link.rel = "noopener noreferrer";
        });

        bindInteractiveCodeBlocks(element);
        renderMermaidInElement(element);
        renderMath(element);
    }

    chat.scrollTop = chat.scrollHeight;
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

        const imgCard = e.target.closest(".msg-img-card");
        if (imgCard) {
            const fullImg = imgCard.dataset.fullImg || imgCard.querySelector("img")?.src;
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
