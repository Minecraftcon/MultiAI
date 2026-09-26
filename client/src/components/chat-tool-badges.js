/* =========================================================
   CHAT TOOL BADGES, COMPACTION BADGES & CHECKPOINT MODAL
   ========================================================= */
import { escapeHTML } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { state } from "../state.js";
import { parseMarkdown, bindInteractiveCodeBlocks, renderMermaidInElement, renderMath } from "./renderer.js";
import { saveCurrentChatState } from "../services/storage.js";
import { requestScrollToBottom } from "./chat-ui.js";

/**
 * Resolves tool configuration, icon, label, and detail strings for a given tool execution.
 * Pure function to enable characterization testing and decoupled UI rendering.
 */
export function getToolBadgeConfig(toolName, args = {}) {
    let icon = "terminal";
    let label = "Executed";
    let detail = "";
    let isCommandTask = false;

    if (toolName === "web_search") {
        const isFetch = String(args.type || "").toLowerCase() === "fetch" || /^https?:\/\//i.test(args.query || "");
        icon = isFetch ? "globe" : "search";
        label = isFetch ? "Fetched" : "Searched for";
        detail = args.query || args.url || args.search || "web query";
        isCommandTask = true;
    } else if (toolName === "fetch_web_content" || toolName === "web_fetch") {
        icon = "globe";
        label = "Fetched";
        const urlList = Array.isArray(args.urls) ? args.urls : (args.url ? [args.url] : (args.query ? [args.query] : []));
        detail = urlList.length === 1 ? urlList[0] : (urlList.length > 1 ? `${urlList.length} pages (${urlList[0]}...)` : "web content");
        isCommandTask = true;
    } else if (toolName === "run_task" || toolName === "run_command") {
        icon = "play";
        label = "Ran command";
        const taskName = args.task_name || args.name;
        detail = taskName || args.command || "task command";
        isCommandTask = true;
    } else if (toolName === "manage_tasks" || toolName === "manage_task") {
        const action = (args.action || args.subcommand || "").toLowerCase();
        const taskId = args.task_id || args.id || "task";
        if (action === "kill_task" || action === "kill") {
            icon = "octagon";
            label = "Killed task";
            detail = taskId;
        } else {
            icon = "keyboard";
            const val = args.input !== undefined ? args.input : (args.text !== undefined ? args.text : (args.key || ""));
            const isKey = typeof val === "string" && (/^(ctrl|alt|control|shift)[\+\-\s]/i.test(val.trim()) || ["enter", "esc", "escape", "tab"].includes(val.trim().toLowerCase()));
            label = isKey ? "Sent key" : "Sent input";
            detail = `${taskId}: ${val}`;
        }
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
    } else if (toolName === "schedule") {
        icon = "clock";
        const hasTask = Boolean(args.task || args.task_id);
        label = hasTask ? "Scheduled task…" : "Scheduled timer…";
        const targetTask = hasTask ? ` (${args.task || args.task_id})` : "";
        const duration = args.time ?? args.sleep_time ?? args.seconds ?? 5;
        detail = args.reason ? `${args.reason}${targetTask}` : `${duration}s timer${targetTask}`;
        isCommandTask = true;
    } else if (toolName === "idle") {
        icon = "hourglass";
        label = args.task_id ? "Waiting for task…" : "Idling…";
        const targetTask = args.task_id ? ` (${args.task_id})` : "";
        detail = args.reason ? `${args.reason}${targetTask}` : `${args.seconds || 5}s timer${targetTask}`;
        isCommandTask = true;
    } else if (toolName === "read_file") {
        const filePath = args.path || args.AbsolutePath || args.file_path || args.target_file || "";
        const isImg = /\.(png|jpe?g|webp|gif|svg|bmp|ico|tiff?)$/i.test(filePath) 
            || args.type === "image" 
            || (typeof args.mime === "string" && args.mime.startsWith("image/"));
        if (isImg) {
            icon = "image";
            label = "Viewed Image";
            detail = filePath || "image";
        } else {
            icon = "file-text";
            label = "Read file";
            const start = args.start_line !== undefined ? args.start_line : args.StartLine;
            const end = args.end_line !== undefined ? args.end_line : args.EndLine;
            const offset = args.content_offset !== undefined ? args.content_offset : (args.ContentOffset !== undefined ? args.ContentOffset : args.offset);
            const lineSpan = (start || end) ? ` (lines ${start || 1}-${end || "end"})` : "";
            const offsetSpan = offset ? ` [offset: ${offset}]` : "";
            detail = `${filePath || "file"}${lineSpan}${offsetSpan}`;
        }
        isCommandTask = true;
    } else if (toolName === "list_dir") {
        icon = "folder";
        label = "Listed directory";
        detail = args.DirectoryPath || args.path || args.dir_path || args.dirPath || ".";
        isCommandTask = true;
    } else if (toolName === "write_file") {
        const isArtifact = (args.path || "").startsWith("$ARTIFACTS/") || (args.path || "").startsWith("${ARTIFACTS}/");
        icon = isArtifact ? "file-code" : "file-edit";
        label = isArtifact ? "Wrote artifact" : "Wrote file";
        detail = args.path || "file";
        isCommandTask = true;
    } else if (toolName === "grep_search") {
        icon = "search";
        label = "Searched code";
        const targetPath = args.SearchPath || args.path || args.search_path || "";
        const scope = targetPath && targetPath !== "." ? ` in ${targetPath}` : "";
        const queryTerm = args.Query !== undefined ? args.Query : (args.query || args.pattern || "");
        detail = `"${queryTerm}"${scope}`;
        isCommandTask = true;
    } else if (toolName === "replace_file_content" || toolName === "search_and_replace") {
        icon = "edit-3";
        label = "Edited file";
        const lineSpan = (args.start_line || args.end_line) ? ` (lines ${args.start_line || 1}-${args.end_line || "end"})` : "";
        detail = `${args.path || "file"}${lineSpan}${args.description ? ` - ${args.description}` : ""}`;
        isCommandTask = true;
    } else if (toolName === "multi_replace_file_content") {
        icon = "edit-3";
        label = "Multi-edited file";
        const count = Array.isArray(args.replacement_chunks) ? ` (${args.replacement_chunks.length} chunks)` : "";
        detail = `${args.path || "file"}${count}${args.description ? ` - ${args.description}` : ""}`;
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

    const isTimer = toolName === "sleep" || toolName === "idle" || toolName === "schedule";
    const isCommand = toolName === "run_task" || toolName === "run_command";
    const hasRing = isTimer || isCommand;

    const detailLines = String(detail || "").split("\n");
    const isDetailMulti = detailLines.length > 3;
    const compactDetail = isDetailMulti
        ? detailLines.slice(0, 3).join("\n") + "\n…"
        : detail;

    const isRunTaskWithTitle = (toolName === "run_task" || toolName === "run_command") && (args.task_name || args.name);
    const isArtifact = toolName === "write_file" && ((args.path || "").startsWith("$ARTIFACTS/") || (args.path || "").startsWith("${ARTIFACTS}/"));

    let displayCmd = "";
    if (toolName === "write_file") {
        displayCmd = `Write to ${args.path || "file"}`;
    } else if (toolName === "replace_file_content" || toolName === "search_and_replace") {
        displayCmd = `EDIT: ${args.path || "file"}${args.description ? ` (${args.description})` : ""}`;
    } else if (toolName === "multi_replace_file_content") {
        displayCmd = `MULTI-EDIT: ${args.path || "file"}${args.description ? ` (${args.description})` : ""}`;
    } else if (toolName === "list_dir") {
        displayCmd = `LIST DIR: ${args.DirectoryPath || args.path || args.dir_path || "."}`;
    } else if (toolName === "read_file") {
        const filePath = args.path || args.AbsolutePath || args.file_path || args.target_file || "";
        const isImg = /\.(png|jpe?g|webp|gif|svg|bmp|ico|tiff?)$/i.test(filePath) 
            || args.type === "image" 
            || (typeof args.mime === "string" && args.mime.startsWith("image/"));
        if (isImg) {
            displayCmd = `VIEW IMAGE: ${filePath || "image"}`;
        } else {
            const span = (args.start_line || args.end_line) ? ` (lines ${args.start_line || 1}-${args.end_line || "end"})` : "";
            displayCmd = `READ: ${filePath || "file"}${span}`;
        }
    } else if (toolName === "schedule" || toolName === "idle") {
        const duration = args.time ?? args.sleep_time ?? args.seconds ?? 5;
        const taskInfo = (args.task || args.task_id) ? ` (hooked on ${args.task || args.task_id}, wake: ${args.wake_on || "exit"})` : "";
        displayCmd = `Schedule timer: ${duration}s${taskInfo}${args.reason ? ` - ${args.reason}` : ""}${args.end_response ? `\nEnd response: ${args.end_response}` : ""}`;
    } else {
        displayCmd = args.command || args.input_string || (Array.isArray(args.urls) ? args.urls.join("\n") : args.url) || (args.task_id ? `Task: ${args.task_id}` : "Task execution");
    }

    const cmdLines = String(displayCmd || "").split("\n");
    const isCmdMulti = cmdLines.length > 3;
    const compactCmd = isCmdMulti
        ? cmdLines.slice(0, 3).join("\n") + "\n…"
        : displayCmd;

    return {
        icon,
        label,
        detail,
        compactDetail,
        isDetailMulti,
        detailLines,
        isCommandTask,
        isTimer,
        isCommand,
        hasRing,
        isArtifact,
        isRunTaskWithTitle,
        displayCmd,
        compactCmd,
        isCmdMulti,
        cmdLines
    };
}

/**
 * Creates and appends a tool execution badge into the message container.
 */
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

    const config = getToolBadgeConfig(toolName, args);
    const {
        icon,
        label,
        detail,
        compactDetail,
        isDetailMulti,
        detailLines,
        isCommandTask,
        hasRing,
        isArtifact,
        isRunTaskWithTitle,
        displayCmd,
        compactCmd,
        isCmdMulti,
        cmdLines
    } = config;

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
            <span class="checkpoint-badge-actions">
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
    if (chat) chat.scrollTop = chat.scrollHeight;
    return item;
}

/**
 * Displays the persistent artifact or context checkpoint modal dialog.
 */
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
                        <div class="checkpoint-modal-subtitle">Turns ${sliceStartIdx}–${sliceEndIdx} • Saved ~${Math.round(tokensSaved / 1000)}k tokens</div>
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
                    <span class="checkpoint-path-label"><i data-lucide="file-text"></i> Loading path…</span>
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
            : `Turns ${sliceStartIdx}–${sliceEndIdx} • Saved ~${Math.round(tokensSaved / 1000)}k tokens`;
    }

    // Resolve full absolute path on disk
    let absolutePath = artifactPath || "";
    const activeChatId = state?.currentChatId;
    const ws = activeChatId && state?.chatSessions?.[activeChatId]?.workspace;
    const defaultFilename = checkpointNum ? `checkpoint_${checkpointNum}.md` : "checkpoint.md";

    if (absolutePath && absolutePath.startsWith("/") && !absolutePath.includes("$ARTIFACTS") && !absolutePath.includes("$SCRATCH")) {
        // Already a clean absolute path
    } else if (ws?.artifactsDir) {
        const rel = absolutePath ? absolutePath.replace(/^\$\{?ARTIFACTS\}?[/\\]?/, "") : defaultFilename;
        absolutePath = `${ws.artifactsDir.replace(/[/\\]+$/, "")}/${rel || defaultFilename}`;
    } else {
        const candidate = absolutePath || `$ARTIFACTS/${defaultFilename}`;
        try {
            const resolveRes = await fetch("/api/file/resolve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: candidate, chatId: activeChatId })
            });
            if (resolveRes.ok) {
                const resolveData = await resolveRes.json();
                if (resolveData?.resolved_path) {
                    absolutePath = resolveData.resolved_path;
                }
            }
        } catch (_) {}
    }

    if (!absolutePath) {
        const root = state?.hostSystemInfo?.storageRoot || (state?.hostSystemInfo?.homedir ? `${state.hostSystemInfo.homedir}/.MultiAI` : "");
        if (root && activeChatId) {
            const d = new Date();
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            const rel = artifactPath ? artifactPath.replace(/^\$\{?ARTIFACTS\}?[/\\]?/, "") : defaultFilename;
            absolutePath = `${root}/chat_conversations/${dateStr}/chats/${activeChatId}/artifacts/${rel || defaultFilename}`;
        } else {
            absolutePath = artifactPath || `$ARTIFACTS/${defaultFilename}`;
        }
    }

    if (pathEl) pathEl.innerHTML = `<i data-lucide="file-text"></i> ${escapeHTML(absolutePath)}`;

    if (copyBtn) {
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(absolutePath);
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
    const pathToFetch = absolutePath || artifactPath;
    if (pathToFetch) {
        try {
            const res = await fetch("/api/file/read", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    path: pathToFetch,
                    chatId: state?.currentChatId,
                    numbered: false,
                    end_line: 5000
                })
            });
            if (res.ok) {
                const data = await res.json();
                if (data && data.content) {
                    rawContent = data.content;
                }
                if (data && data.resolved_path) {
                    absolutePath = data.resolved_path;
                    if (pathEl) {
                        pathEl.innerHTML = `<i data-lucide="file-text"></i> ${escapeHTML(absolutePath)}`;
                        renderIcons(pathEl);
                    }
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
            `**Artifact File:** \`${absolutePath}\`\n\n` +
            `## Context & Discoveries Briefing\n\n${summaryText}`;
    }

    if (bodyEl) {
        bodyEl.innerHTML = parseMarkdown(rawContent || "No checkpoint artifact content found.");
        bindInteractiveCodeBlocks(bodyEl);
        renderMath(bodyEl);
        renderMermaidInElement(bodyEl);
    }
}

/**
 * Creates and appends a context compaction / checkpoint badge into the message container.
 */
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
    if (chat) chat.scrollTop = chat.scrollHeight;

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
                    ? `${isEmergencyTrim ? "Emergency Trimmed" : "Archived"} Turns ${sliceStartIdx}–${sliceEndIdx} (${savedStr})`
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
                        collapseDiv.querySelector(".badge-collapse-inner pre")?.appendChild(noteEl);
                    }
                    noteEl.innerHTML = `
                        <div>
                            <span class="checkpoint-note-label">Permanent Snapshot:</span>
                            <code class="checkpoint-artifact-link" data-path="${escapeHTML(artifactPath)}" data-checkpoint-num="${checkpointNum || 1}" data-slice-start="${sliceStartIdx}" data-slice-end="${sliceEndIdx}" data-tokens-saved="${tokensSaved}" title="Click to view">${escapeHTML(artifactPath)}</code>
                        </div>
                        <button type="button" class="checkpoint-open-doc-btn" data-path="${escapeHTML(artifactPath)}" data-checkpoint-num="${checkpointNum || 1}" data-slice-start="${sliceStartIdx}" data-slice-end="${sliceEndIdx}" data-tokens-saved="${tokensSaved}">Open Document</button>
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
            if (chat) chat.scrollTop = chat.scrollHeight;
        }
    };
}

/**
 * Appends reasoning / thought traces into the chat stream.
 */
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
    requestScrollToBottom(chat);
    return item;
}

/**
 * Automatically wraps long reasoning thought blocks into collapsible containers.
 */
export function wrapHugeThoughts(root) {
    if (!root) return;

    // Check .activity-thought-item
    root.querySelectorAll(".activity-thought-item").forEach(item => {
        if (item.classList.contains("thought-collapsible") || item.querySelector(".thought-collapsed-body")) return;
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

    // Also check pre-search-content thought boxes
    root.querySelectorAll(".thought-box .thought-content").forEach(contentEl => {
        if (contentEl.classList.contains("thought-collapsible") || contentEl.querySelector(".thought-collapsed-body")) return;
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
