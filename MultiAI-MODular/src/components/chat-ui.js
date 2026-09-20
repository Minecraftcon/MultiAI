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
    
    if (wrapper) {
        wrapper.style.display = "block";
        if (!element.dataset.manuallyToggled) {
            wrapper.classList.add("open");
        }
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
        label = "Sleeping…";
        detail = `${args.seconds || 1}s timer`;
    } else if (toolName === "idle") {
        icon = "hourglass";
        label = args.task_id ? "Waiting for task…" : "Idling…";
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
        const isArtifact = (args.path || "").startsWith("$ARTIFACTS/") || (args.path || "").startsWith("${ARTIFACTS}/");
        const act = args.action || (args.operations ? "batch" : (args.target !== undefined ? "replace" : (args.line !== undefined ? "inject" : "write")));
        icon = isArtifact ? "file-code" : (act === "replace" ? "edit-3" : (act === "inject" ? "plus-circle" : (act === "batch" ? "layers" : "file-edit")));
        label = isArtifact ? (act === "replace" ? "Updated artifact" : "Created artifact") : (act === "replace" ? "Replaced text" : (act === "inject" ? "Injected into file" : (act === "batch" ? "Batch modified" : "Wrote file")));
        detail = args.path || "file";
        isCommandTask = true;
    } else if (toolName === "grep_search") {
        icon = "search";
        label = "Searched code";
        const scope = args.path && args.path !== "." ? ` in ${args.path}` : "";
        detail = `"${args.query || args.pattern || ""}"${scope}`;
        isCommandTask = true;
    } else if (toolName === "search_and_replace") {
        icon = "edit-3";
        label = "Replaced text";
        detail = args.path || "file";
        isCommandTask = true;
    } else if (toolName === "run_python") {
        icon = "terminal";
        label = "Ran Python";
        const snippet = (args.code || "").trim().split("\n")[0].slice(0, 45);
        detail = snippet ? `\`${snippet}\`` : "Python snippet";
        isCommandTask = true;
    } else if (toolName === "generate_image") {
        icon = "image";
        label = "Generated image";
        detail = args.prompt || "image generation";
        isCommandTask = true;
    } else if (toolName === "get_image_status") {
        icon = "image";
        label = "Checked image";
        detail = args.task_id || "image status";
        isCommandTask = false;
    }

    const isTimer = toolName === "sleep" || toolName === "idle";
    const isCommand = toolName === "run_task";
    const hasRing = isTimer || isCommand;

    const detailLines = String(detail || "").split("\n");
    const isDetailMulti = detailLines.length > 3;
    const compactDetail = isDetailMulti
        ? detailLines.slice(0, 3).join("\n") + "\n…"
        : detail;

    const isRunTaskWithTitle = toolName === "run_task" && (args.task_name || args.name);
    const codeIconHtml = isRunTaskWithTitle 
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-code preview-icon" aria-hidden="true" style="display:inline-block; vertical-align:-2px; margin: 0 4px; opacity:0.8;"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>` 
        : ``;

    const item = document.createElement("div");
    item.className = "search-badge-item" + (hasRing ? " timer-badge" : "") + (isCommandTask ? " clickable-badge" : "") + (isDetailMulti ? " has-multiline" : "");
    if (isCommandTask) {
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        item.setAttribute("aria-expanded", "false");
        item.setAttribute("aria-label", `Toggle ${label.toLowerCase()} output`);
    }

    const isArtifact = toolName === "write_file" && ((args.path || "").startsWith("$ARTIFACTS/") || (args.path || "").startsWith("${ARTIFACTS}/"));
    if (isArtifact) {
        item.dataset.artifactPath = args.path;
        item.classList.add("artifact-badge-item");
    }

    item.innerHTML = `
        <div class="search-icon-circle ${hasRing ? 'has-timer-ring' : ''}">
            ${hasRing ? `
            <svg class="timer-ring-svg" viewBox="0 0 36 36" aria-hidden="true">
                <circle class="timer-ring-bg" cx="18" cy="18" r="17.25" />
                <circle class="timer-ring-bar" cx="18" cy="18" r="17.25" transform="rotate(-90 18 18)" />
            </svg>
            ` : ''}
            <i data-lucide="${icon}" aria-hidden="true"></i>
        </div>
        <div>
            <span class="search-label">${label}</span>
            ${codeIconHtml}
            <span class="search-query ${detailLines.length > 1 ? 'is-multiline' : ''}" data-full="${escapeHTML(detail)}" data-compact="${escapeHTML(compactDetail)}">${escapeHTML(compactDetail)}</span>
            ${isArtifact ? `
            <span class="checkpoint-badge-actions" style="margin-left: 6px;">
                <button type="button" class="checkpoint-view-btn artifact-open-btn" data-path="${escapeHTML(args.path)}" title="View artifact modal" aria-label="View artifact">
                    <i data-lucide="eye"></i>
                    <span>View</span>
                </button>
            </span>
            ` : ''}
            ${isCommandTask ? '<span class="badge-expand-chevron" aria-hidden="true">▶</span>' : ''}
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
            ? cmdLines.slice(0, 3).join("\n") + "\n…"
            : displayCmd;
        
        collapseDiv.innerHTML = `
            <div class="badge-collapse-inner">
                <div class="command-output-box">
                    <pre><div class="command-output-cmd ${isCmdMulti ? 'is-compact' : ''}" data-full="${escapeHTML(displayCmd)}" data-compact="${escapeHTML(compactCmd)}"><div class="command-cmd-text">${escapeHTML(compactCmd)}</div>${isCmdMulti ? `<div class="cmd-toggle-row"><button type="button" class="cmd-compact-toggle" aria-expanded="false"><span class="cmd-toggle-label">Expand</span> <span class="cmd-toggle-lines">(${cmdLines.length} lines)</span></button></div>` : ''}</div><hr class="command-output-sep"><div class="command-output-res"></div></pre>
                </div>
            </div>
        `;

        if (isArtifact) {
            const noteEl = document.createElement("div");
            noteEl.className = "command-output-artifact-note";
            noteEl.style.marginTop = "10px";
            noteEl.style.paddingTop = "8px";
            noteEl.style.borderTop = "1px dashed var(--border-color, rgba(255, 255, 255, 0.15))";
            noteEl.style.fontSize = "0.85em";
            noteEl.style.display = "flex";
            noteEl.style.alignItems = "center";
            noteEl.style.justifyContent = "space-between";
            noteEl.style.gap = "10px";
            noteEl.innerHTML = `
                <span><i data-lucide="file-code" style="vertical-align:-2px; margin-right:4px;"></i> Persistent Project Artifact: <code>${escapeHTML(args.path)}</code></span>
                <button type="button" class="checkpoint-view-btn artifact-open-btn" data-path="${escapeHTML(args.path)}" title="Open Artifact in Modal">
                    <i data-lucide="eye"></i>
                    <span>Open Full Document</span>
                </button>
            `;
            collapseDiv.querySelector(".badge-collapse-inner pre")?.appendChild(noteEl);
        }

        searchContainer.appendChild(collapseDiv);
        item._collapseDiv = collapseDiv;
    }

    renderIcons(item);
    chat.scrollTop = chat.scrollHeight;
    return item;
}

export async function showCheckpointModal({
    artifactPath = "",
    summaryText = "",
    checkpointNum = 1,
    sliceStartIdx = 0,
    sliceEndIdx = 0,
    tokensSaved = 0
} = {}) {
    let backdrop = document.getElementById("checkpointModalBackdrop");
    if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.id = "checkpointModalBackdrop";
        backdrop.className = "checkpoint-modal-backdrop";
        backdrop.innerHTML = `
            <div class="checkpoint-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="checkpointModalTitle">
                <div class="checkpoint-modal-header">
                    <div class="checkpoint-modal-title-group">
                        <div class="checkpoint-modal-badge"><i data-lucide="layers"></i> Checkpoint #${checkpointNum}</div>
                        <h3 id="checkpointModalTitle" class="checkpoint-modal-title">Context Checkpoint</h3>
                        <div class="checkpoint-modal-subtitle">Turns ${sliceStartIdx}–${sliceEndIdx} • Saved ~${Math.round(tokensSaved / 1000)}k tokens • Live Trajectory Retained</div>
                    </div>
                    <div class="checkpoint-modal-actions">
                        <button type="button" class="checkpoint-copy-path-btn" title="Copy Artifact Path" aria-label="Copy artifact path">
                            <i data-lucide="copy"></i>
                        </button>
                        <button type="button" class="checkpoint-modal-close-btn" title="Close" aria-label="Close modal">
                            <i data-lucide="x"></i>
                        </button>
                    </div>
                </div>
                <div class="checkpoint-modal-meta">
                    <span class="checkpoint-path-label"><i data-lucide="file-text"></i> ${escapeHTML(artifactPath || "$ARTIFACTS/checkpoint.md")}</span>
                    <span class="checkpoint-badge-status">Snapshot Stored</span>
                </div>
                <div class="checkpoint-modal-body markdown-body">
                    <div class="checkpoint-modal-loading">Loading checkpoint artifact…</div>
                </div>
                <div class="checkpoint-modal-footer">
                    <div class="checkpoint-footer-hint">
                        <span>💡 <strong>Deep History Inspection:</strong> The agent and user can read past checkpoints via <code>read_file</code> tool.</span>
                    </div>
                    <button type="button" class="checkpoint-close-footer-btn">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        const closeBtn = backdrop.querySelector(".checkpoint-modal-close-btn");
        const footerCloseBtn = backdrop.querySelector(".checkpoint-close-footer-btn");
        const closeModal = () => {
            backdrop.style.display = "none";
            backdrop.classList.remove("open");
        };

        if (closeBtn) closeBtn.addEventListener("click", closeModal);
        if (footerCloseBtn) footerCloseBtn.addEventListener("click", closeModal);
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) closeModal();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && backdrop.classList.contains("open")) {
                closeModal();
            }
        });
    }

    const titleEl = backdrop.querySelector("#checkpointModalTitle");
    const badgeEl = backdrop.querySelector(".checkpoint-modal-badge");
    const subtitleEl = backdrop.querySelector(".checkpoint-modal-subtitle");
    const pathEl = backdrop.querySelector(".checkpoint-path-label");
    const bodyEl = backdrop.querySelector(".checkpoint-modal-body");
    const copyBtn = backdrop.querySelector(".checkpoint-copy-path-btn");

    const isGenericArtifact = artifactPath && !artifactPath.includes("checkpoint_");
    const fileName = artifactPath ? artifactPath.split("/").pop() : "document.md";

    if (badgeEl) {
        badgeEl.innerHTML = isGenericArtifact 
            ? `<i data-lucide="file-code"></i> Project Artifact` 
            : `<i data-lucide="layers"></i> Checkpoint #${checkpointNum}`;
    }
    if (titleEl) {
        titleEl.textContent = isGenericArtifact 
            ? fileName 
            : `Context Checkpoint #${checkpointNum}`;
    }
    if (subtitleEl) {
        subtitleEl.textContent = isGenericArtifact 
            ? `Persistent Project Document • Saved to $ARTIFACTS/` 
            : `Turns ${sliceStartIdx}–${sliceEndIdx} • Saved ~${Math.round(tokensSaved / 1000)}k tokens • Live Trajectory Retained`;
    }
    if (pathEl) pathEl.innerHTML = `<i data-lucide="file-text"></i> ${escapeHTML(artifactPath || "$ARTIFACTS/checkpoint.md")}`;

    if (copyBtn) {
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(artifactPath);
                copyBtn.innerHTML = '<i data-lucide="check"></i>';
                renderIcons(copyBtn);
                setTimeout(() => {
                    copyBtn.innerHTML = '<i data-lucide="copy"></i>';
                    renderIcons(copyBtn);
                }, 1500);
            } catch (err) {
                console.warn("Could not copy path:", err);
            }
        };
    }

    if (bodyEl) {
        bodyEl.innerHTML = `<div style="color:var(--text-muted, #888); font-style: italic;">Loading checkpoint contents…</div>`;
    }

    renderIcons(backdrop);
    backdrop.style.display = "flex";
    backdrop.classList.add("open");

    // Fetch full markdown content from backend
    let rawContent = "";
    if (artifactPath) {
        try {
            const res = await fetch("/api/file/read", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    path: artifactPath,
                    chatId: state.currentChatId,
                    numbered: false,
                    end_line: 5000
                })
            });
            if (res.ok) {
                const data = await res.json();
                if (data && data.content) {
                    rawContent = data.content;
                }
            }
        } catch (e) {
            console.warn("Could not read artifact file over API:", e);
        }
    }

    if (!rawContent && summaryText) {
        rawContent = `# Context Checkpoint #${checkpointNum}\n\n` +
            `**Archived Turns:** ${sliceStartIdx}–${sliceEndIdx}\n` +
            `**Tokens Saved:** ~${Math.round(tokensSaved / 1000)}k\n` +
            `**Artifact File:** \`${artifactPath}\`\n\n` +
            `## Context & Discoveries Briefing\n\n${summaryText}`;
    }

    if (bodyEl) {
        bodyEl.innerHTML = parseMarkdown(rawContent || "No checkpoint artifact content found.");
        bindInteractiveCodeBlocks(bodyEl);
        renderMath(bodyEl);
        renderMermaidInElement(bodyEl);
    }
}

export function addCompactionBadge(element, { messagesCount = 0, tokensBefore = 0 } = {}) {
    const chat = document.getElementById("chat");
    const wrapper = element.querySelector(".activity-wrapper");
    const searchContainer = element.querySelector(".search-items-container");

    if (wrapper) {
        wrapper.style.display = "block";
        if (!element.dataset.manuallyToggled) {
            wrapper.classList.add("open");
        }
    }

    const item = document.createElement("div");
    item.className = "search-badge-item timer-badge clickable-badge compaction-badge-item";
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.setAttribute("aria-expanded", "false");
    item.setAttribute("aria-label", "Toggle context checkpoint briefing");
    item.setAttribute("aria-live", "polite");

    const compactDetail = `Archiving context slice (~${Math.round(tokensBefore / 1000)}k total tokens)…`;

    item.innerHTML = `
        <div class="search-icon-circle has-timer-ring">
            <svg class="timer-ring-svg" viewBox="0 0 36 36" aria-hidden="true">
                <circle class="timer-ring-bg" cx="18" cy="18" r="17.25" />
                <circle class="timer-ring-bar" cx="18" cy="18" r="17.25" transform="rotate(-90 18 18)" style="stroke-dasharray: 108.39; stroke-dashoffset: 54; animation: timer-ring-spin 1.2s linear infinite; transform-origin: 18px 18px;" />
            </svg>
            <i data-lucide="layers" aria-hidden="true"></i>
        </div>
        <div class="compaction-badge-content">
            <span class="search-label">Checkpoint</span>
            <span class="search-query" data-full="${escapeHTML(compactDetail)}" data-compact="${escapeHTML(compactDetail)}">${escapeHTML(compactDetail)}</span>
            <span class="badge-expand-chevron" aria-hidden="true">▶</span>
        </div>
    `;

    searchContainer.appendChild(item);

    const collapseDiv = document.createElement("div");
    collapseDiv.className = "badge-collapse";
    collapseDiv.innerHTML = `
        <div class="badge-collapse-inner">
            <div class="command-output-box">
                <pre><div class="command-output-cmd"><div class="command-cmd-text">Context Checkpoint Briefing</div></div><hr class="command-output-sep"><div class="command-output-res">Distilling context briefing and archiving checkpoint…</div></pre>
            </div>
        </div>
    `;
    searchContainer.appendChild(collapseDiv);
    item._collapseDiv = collapseDiv;

    renderIcons(item);
    chat.scrollTop = chat.scrollHeight;

    return {
        item,
        collapseDiv,
        update({ status, summaryText, tokensSaved = 0, messagesCount = 0, artifactPath = null, checkpointNum = null, sliceStartIdx = 0, sliceEndIdx = 0, error = null, isEmergencyTrim = false }) {
            const ringBar = item.querySelector(".timer-ring-bar");
            if (ringBar) {
                ringBar.style.animation = "none";
            }

            if (status === "completed") {
                item.classList.add("timer-finished");
                if (isEmergencyTrim) {
                    item.classList.add("emergency-trim-badge");
                }

                const labelEl = item.querySelector(".search-label");
                if (labelEl) {
                    labelEl.textContent = isEmergencyTrim
                        ? (checkpointNum ? `Emergency Trim #${checkpointNum}` : "Emergency Trim")
                        : (checkpointNum ? `Checkpoint #${checkpointNum}` : "Checkpoint");
                }

                const queryEl = item.querySelector(".search-query");
                const savedStr = tokensSaved > 0 ? `Saved ~${Math.round(tokensSaved / 1000)}k tokens` : `Distilled`;
                const finalDesc = sliceEndIdx > 0
                    ? `${isEmergencyTrim ? "Emergency Trimmed" : "Archived"} Turns ${sliceStartIdx}–${sliceEndIdx} (${savedStr}) • Trajectory Retained`
                    : `Reduced ${messagesCount} turns (${savedStr})`;
                if (queryEl) {
                    queryEl.textContent = finalDesc;
                    queryEl.dataset.full = finalDesc;
                    queryEl.dataset.compact = finalDesc;
                }

                const cmdTitle = collapseDiv.querySelector(".command-cmd-text");
                if (cmdTitle) {
                    cmdTitle.textContent = isEmergencyTrim
                        ? `Emergency Checkpoint #${checkpointNum || 1} (Turns ${sliceStartIdx}–${sliceEndIdx}, ${savedStr})`
                        : `Checkpoint #${checkpointNum || 1} Briefing (Turns ${sliceStartIdx}–${sliceEndIdx}, ${savedStr})`;
                }

                const resEl = collapseDiv.querySelector(".command-output-res");
                if (resEl && summaryText) {
                    resEl.textContent = summaryText;
                }

                // Store metadata on dataset for persistence
                item.dataset.artifactPath = artifactPath || "";
                item.dataset.checkpointNum = String(checkpointNum || 1);
                item.dataset.sliceStart = String(sliceStartIdx || 0);
                item.dataset.sliceEnd = String(sliceEndIdx || 0);
                item.dataset.tokensSaved = String(tokensSaved || 0);

                const fileName = artifactPath ? artifactPath.split("/").pop() : `checkpoint_${Date.now()}.md`;

                let actionContainer = item.querySelector(".checkpoint-badge-actions");
                if (!actionContainer) {
                    actionContainer = document.createElement("span");
                    actionContainer.className = "checkpoint-badge-actions";
                    item.querySelector(".compaction-badge-content")?.appendChild(actionContainer);
                }
                actionContainer.innerHTML = `
                    <button type="button" class="checkpoint-view-btn" data-path="${escapeHTML(artifactPath || '')}" data-checkpoint-num="${checkpointNum || 1}" data-slice-start="${sliceStartIdx}" data-slice-end="${sliceEndIdx}" data-tokens-saved="${tokensSaved}" title="View checkpoint artifact modal" aria-label="View checkpoint artifact">
                        <i data-lucide="file-text"></i>
                        <span>${escapeHTML(fileName)}</span>
                        <span class="checkpoint-pill-tag">View</span>
                    </button>
                `;

                if (artifactPath) {
                    let noteEl = collapseDiv.querySelector(".command-output-artifact-note");
                    if (!noteEl) {
                        noteEl = document.createElement("div");
                        noteEl.className = "command-output-artifact-note";
                        noteEl.style.marginTop = "10px";
                        noteEl.style.paddingTop = "8px";
                        noteEl.style.borderTop = "1px dashed var(--border-color, rgba(255, 255, 255, 0.15))";
                        noteEl.style.fontSize = "0.85em";
                        noteEl.style.opacity = "0.9";
                        noteEl.style.display = "flex";
                        noteEl.style.alignItems = "center";
                        noteEl.style.justifyContent = "space-between";
                        noteEl.style.gap = "10px";
                        collapseDiv.querySelector(".badge-collapse-inner pre")?.appendChild(noteEl);
                    }
                    noteEl.innerHTML = `
                        <div>
                            <span style="color:var(--text-muted, #aaa);">Permanent Snapshot:</span>
                            <code style="color:#60a5fa; cursor:pointer;" class="checkpoint-artifact-link" data-path="${escapeHTML(artifactPath)}" data-checkpoint-num="${checkpointNum || 1}" data-slice-start="${sliceStartIdx}" data-slice-end="${sliceEndIdx}" data-tokens-saved="${tokensSaved}" title="Click to view">${escapeHTML(artifactPath)}</code>
                        </div>
                        <button type="button" class="checkpoint-open-doc-btn" data-path="${escapeHTML(artifactPath)}" data-checkpoint-num="${checkpointNum || 1}" data-slice-start="${sliceStartIdx}" data-slice-end="${sliceEndIdx}" data-tokens-saved="${tokensSaved}" style="background:#2563eb; color:#fff; border:none; border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer;">Open Document</button>
                    `;
                }

                renderIcons(item);
                renderIcons(collapseDiv);
            } else if (status === "failed") {
                item.classList.add("timer-finished");

                const labelEl = item.querySelector(".search-label");
                if (labelEl) labelEl.textContent = "Checkpoint";

                const queryEl = item.querySelector(".search-query");
                if (queryEl) {
                    const failText = error ? `Skipped (${error})` : `Skipped — maintained full context`;
                    queryEl.textContent = failText;
                    queryEl.dataset.full = failText;
                    queryEl.dataset.compact = failText;
                }

                const resEl = collapseDiv.querySelector(".command-output-res");
                if (resEl) {
                    resEl.textContent = error || "Checkpoint skipped. Context maintained without changes.";
                }
            }
            saveCurrentChatState();
            chat.scrollTop = chat.scrollHeight;
        }
    };
}

export function addThoughtTrace(element, text) {
    if (!text || !text.trim()) return null;
    const chat = document.getElementById("chat");
    const wrapper = element.querySelector(".activity-wrapper");
    const searchContainer = element.querySelector(".search-items-container");

    if (wrapper) {
        wrapper.style.display = "block";
        if (!element.dataset.manuallyToggled) {
            wrapper.classList.add("open");
        }
    }

    // Strip synthetic <think> tags so CommonMark does not treat content as unparsed HTML block
    const cleanText = text.replace(/<\/?think>/gi, "").trim();
    if (!cleanText) return null;

    const item = document.createElement("div");
    item.className = "activity-thought-item";
    let renderedHtml = cleanText;
    if (typeof marked !== "undefined" && typeof marked.parse === "function") {
        try {
            renderedHtml = marked.parse(cleanText);
        } catch {
            renderedHtml = parseMarkdown(cleanText);
        }
    } else {
        renderedHtml = parseMarkdown(cleanText);
    }

    const isHuge = cleanText.length > 350 || cleanText.split("\n").length > 5;
    if (isHuge) {
        item.classList.add("thought-collapsible");
        item.innerHTML = `
            <div class="thought-collapsed-body">
                ${renderedHtml}
            </div>
            <button type="button" class="thought-expand-btn" aria-expanded="false">
                <span class="thought-expand-icon" aria-hidden="true">…</span> expand
            </button>
        `;
    } else {
        item.innerHTML = renderedHtml;
    }

    searchContainer.appendChild(item);
    chat.scrollTop = chat.scrollHeight;
    return item;
}

export function wrapHugeThoughts(root) {
    if (!root) return;

    // Check .activity-thought-item
    root.querySelectorAll(".activity-thought-item:not(.thought-collapsible)").forEach(item => {
        const text = item.textContent || "";
        if (text.length > 350 || text.split("\n").length > 5) {
            item.classList.add("thought-collapsible");
            item.innerHTML = `
                <div class="thought-collapsed-body">
                    ${item.innerHTML}
                </div>
                <button type="button" class="thought-expand-btn" aria-expanded="false">
                    <span class="thought-expand-icon" aria-hidden="true">…</span> expand
                </button>
            `;
        }
    });

    // Check .thought-content inside .thought-box
    root.querySelectorAll(".thought-box .thought-content:not(.thought-collapsible)").forEach(contentEl => {
        const text = contentEl.textContent || "";
        if (text.length > 400 || text.split("\n").length > 6) {
            contentEl.classList.add("thought-collapsible");
            contentEl.innerHTML = `
                <div class="thought-collapsed-body">
                    ${contentEl.innerHTML}
                </div>
                <button type="button" class="thought-expand-btn" aria-expanded="false">
                    <span class="thought-expand-icon" aria-hidden="true">…</span> expand
                </button>
            `;
        }
    });
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

        wrapHugeThoughts(element);

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
}
