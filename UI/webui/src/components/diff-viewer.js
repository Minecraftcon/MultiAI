/* =========================================================
   MODERN DIFF & FILE VIEWER COMPONENT
   Clean, minimalist viewer based on modern web guidance.
   ========================================================= */
import { escapeHTML } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { getFileComments, addFileComment, removeFileComment } from "../services/file-comments.js";

/**
 * Returns language label, short badge, and icon metadata based on file extension.
 */
export function getLanguageMeta(filePath = "") {
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    switch (ext) {
        case "js": case "mjs": case "cjs": return { label: "JavaScript", shortBadge: "JS", icon: "file-code", color: "#f7df1e" };
        case "ts": return { label: "TypeScript", shortBadge: "TS", icon: "file-code", color: "#3178c6" };
        case "tsx": return { label: "React TSX", shortBadge: "TSX", icon: "file-code", color: "#00d8ff" };
        case "jsx": return { label: "React JSX", shortBadge: "JSX", icon: "file-code", color: "#00d8ff" };
        case "json": return { label: "JSON", shortBadge: "JSON", icon: "file-code", color: "#cbcb41" };
        case "css": case "scss": case "less": return { label: "CSS", shortBadge: "CSS", icon: "file-code", color: "#42a5f5" };
        case "html": case "htm": return { label: "HTML", shortBadge: "HTML", icon: "file-code", color: "#e34f26" };
        case "py": return { label: "Python", shortBadge: "PY", icon: "file-code", color: "#3572A5" };
        case "sh": case "bash": case "zsh": return { label: "Shell", shortBadge: "SH", icon: "terminal", color: "#89e051" };
        case "md": case "markdown": return { label: "Markdown", shortBadge: "MD", icon: "file-text", color: "#ffffff" };
        case "yml": case "yaml": return { label: "YAML", shortBadge: "YML", icon: "file-text", color: "#cb171e" };
        case "diff": case "patch": return { label: "Diff", shortBadge: "DIFF", icon: "git-commit", color: "#4ec9b0" };
        default: return { label: "Text", shortBadge: (ext.slice(0, 4).toUpperCase() || "TXT"), icon: "file", color: "#9ca3af" };
    }
}

/**
 * Parses unified diff string into hunks and line entries.
 */
export function parseUnifiedDiff(diffStr, defaultStartLine = 1) {
    if (!diffStr || typeof diffStr !== "string") {
        return { fileName: "", additions: 0, deletions: 0, hunks: [] };
    }

    const rawLines = diffStr.split(/\r?\n/);
    let fileName = "";
    let additions = 0;
    let deletions = 0;
    const hunks = [];
    let currentHunk = null;

    let curOldLine = defaultStartLine;
    let curNewLine = defaultStartLine;

    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];

        if (line.startsWith("--- ")) {
            const m = line.match(/^---\s+(?:[ab]\/)?(.+)$/);
            if (m && !fileName) fileName = m[1].trim();
            continue;
        }
        if (line.startsWith("+++ ")) {
            const m = line.match(/^\+\+\+\s+(?:[ab]\/)?(.+)$/);
            if (m) fileName = m[1].trim();
            continue;
        }

        const hunkMatch = line.match(/^(@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@)(.*)$/);
        if (hunkMatch) {
            const lineNums = hunkMatch[1].match(/-(\d+)(?:,\d+)?\s+\+(\d+)/);
            if (lineNums) {
                curOldLine = parseInt(lineNums[1], 10);
                curNewLine = parseInt(lineNums[2], 10);
            }
            const heading = (hunkMatch[2] || "").trim();
            currentHunk = {
                header: hunkMatch[1].trim(),
                heading,
                oldStart: curOldLine,
                newStart: curNewLine,
                lines: []
            };
            hunks.push(currentHunk);
            continue;
        }

        if (!currentHunk) {
            currentHunk = {
                header: `@@ -${defaultStartLine} +${defaultStartLine} @@`,
                heading: "",
                oldStart: defaultStartLine,
                newStart: defaultStartLine,
                lines: []
            };
            hunks.push(currentHunk);
        }

        if (line.startsWith("+")) {
            additions++;
            currentHunk.lines.push({
                type: "add",
                sign: "+",
                oldLine: null,
                newLine: curNewLine,
                displayLine: curNewLine,
                text: line.slice(1)
            });
            curNewLine++;
        } else if (line.startsWith("-")) {
            deletions++;
            currentHunk.lines.push({
                type: "del",
                sign: "-",
                oldLine: curOldLine,
                newLine: null,
                displayLine: curOldLine,
                text: line.slice(1)
            });
            curOldLine++;
        } else {
            currentHunk.lines.push({
                type: "ctx",
                sign: " ",
                oldLine: curOldLine,
                newLine: curNewLine,
                displayLine: curNewLine,
                text: line.startsWith(" ") ? line.slice(1) : line
            });
            curOldLine++;
            curNewLine++;
        }
    }

    return { fileName, additions, deletions, hunks };
}

/**
 * In-memory raw text cache for fast hunk line expansions without re-fetching.
 */
export const diffFileRawCache = new Map();

/**
 * Fetches raw file text split into lines for line expansion.
 */
export async function getFileRawLines(filePath) {
    if (!filePath) return [];
    const cleanPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
    if (diffFileRawCache.has(cleanPath)) {
        return diffFileRawCache.get(cleanPath);
    }
    try {
        const res = await fetch(`/api/file/raw?path=${encodeURIComponent(cleanPath)}`);
        if (res.ok) {
            const text = await res.text();
            const lines = text.split(/\r?\n/);
            diffFileRawCache.set(cleanPath, lines);
            return lines;
        }
    } catch (_) {}
    return [];
}

/**
 * Builds HTML for a modern unified diff viewer window with dual line numbers,
 * syntax highlighting, collapsible headers, and hunk expansion dividers.
 */
export function renderDiffCardHtml({
    diffStr = "",
    filePath = "",
    title = "",
    stats = null,
    startLine = 1,
    maxHeight = 600,
    hideWhitespace = false,
    isCollapsible = true,
    isCollapsed = false
} = {}) {
    const parsed = parseUnifiedDiff(diffStr, startLine);
    const displayPath = filePath || parsed.fileName || title || "diff";
    const normalized = displayPath.replace(/\\/g, "/");
    const baseName = normalized.split("/").pop() || normalized;
    const dirPath = normalized.substring(0, normalized.length - baseName.length).replace(/\/$/, "");
    const adds = stats?.additions ?? parsed.additions;
    const dels = stats?.deletions ?? parsed.deletions;
    const langMeta = getLanguageMeta(displayPath);

    let hlLang = "";
    if (typeof window !== "undefined" && typeof window.hljs !== "undefined") {
        const ext = displayPath.split(".").pop()?.toLowerCase() || "";
        const langCandidate = (langMeta?.label || ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        hlLang = (langCandidate && window.hljs.getLanguage(langCandidate)) ? langCandidate : (window.hljs.getLanguage(ext) ? ext : "");
    }

    let rowsHtml = "";
    let totalLinesCount = 0;
    const minimapTicks = [];
    let prevNewEnd = 1;
    let prevOldEnd = 1;

    parsed.hunks.forEach((hunk, hIdx) => {
        // Calculate skipped unchanged lines between hunks
        const skippedCount = hIdx === 0
            ? Math.max(0, hunk.newStart - 1)
            : Math.max(0, hunk.newStart - prevNewEnd);

        const gapStart = hIdx === 0 ? 1 : prevNewEnd;

        if (skippedCount > 0) {
            rowsHtml += `
                <div class="mv-hunk-divider" data-gap-start="${gapStart}" data-gap-count="${skippedCount}" data-file-path="${escapeHTML(displayPath)}">
                    <div class="mv-divider-line"></div>
                    <div class="mv-hunk-controls">
                        <button type="button" class="mv-hunk-pill" data-action="expand-all" title="Click to expand all ${skippedCount} lines">
                            +${skippedCount} more lines
                        </button>
                        <div class="mv-hunk-micro-btns">
                            <button type="button" class="mv-hunk-micro-btn" data-action="expand-up" title="Expand previous 10 lines">+10</button>
                            <button type="button" class="mv-hunk-micro-btn" data-action="expand-down" title="Expand next 10 lines">+10</button>
                        </div>
                    </div>
                </div>
            `;
        }

        hunk.lines.forEach((l) => {
            if (hideWhitespace && l.type !== "ctx") {
                const trimmed = (l.text || "").trim();
                if (!trimmed) return;
            }

            totalLinesCount++;
            const rowClass = l.type === "add" ? "mv-row-add" : (l.type === "del" ? "mv-row-del" : "mv-row-ctx");
            const oldStr = l.oldLine !== null && l.oldLine !== undefined ? String(l.oldLine) : "";
            const newStr = l.newLine !== null && l.newLine !== undefined ? String(l.newLine) : "";

            if (l.type === "add" || l.type === "del") {
                minimapTicks.push({ type: l.type, lineIdx: totalLinesCount });
            }

            let codeContent = l.text ? escapeHTML(l.text) : "&nbsp;";
            if (hlLang && l.text) {
                try {
                    codeContent = window.hljs.highlight(l.text, { language: hlLang, ignoreIllegals: true }).value;
                } catch (_) {
                    codeContent = escapeHTML(l.text);
                }
            }

            rowsHtml += `
                <div class="mv-row ${rowClass}">
                    <div class="mv-gutter dual" aria-hidden="true">
                        <span class="mv-old-num">${oldStr ? escapeHTML(oldStr) : "&nbsp;"}</span>
                        <span class="mv-new-num">${newStr ? escapeHTML(newStr) : "&nbsp;"}</span>
                    </div>
                    <div class="mv-code-line">${codeContent}</div>
                </div>
            `;
        });

        // Inline hunk action text (Accept / Reject) directly under modified changes
        const hasModifications = hunk.lines.some(l => l.type === "add" || l.type === "del");
        if (hasModifications) {
            rowsHtml += `
                <div class="mv-hunk-actions" data-hunk-index="${hIdx}" data-file-path="${escapeHTML(displayPath)}">
                    <span class="mv-hunk-actions-hint">Change ${hIdx + 1}:</span>
                    <button type="button" class="mv-hunk-action-btn accept" data-action="accept-file" data-file-path="${escapeHTML(displayPath)}" title="Accept modifications for this file">Accept</button>
                    <span class="mv-hunk-action-sep">•</span>
                    <button type="button" class="mv-hunk-action-btn reject" data-action="reject-file" data-file-path="${escapeHTML(displayPath)}" title="Revert modifications for this file">Reject</button>
                </div>
            `;
        }

        // Record end line of this hunk
        const lastLine = hunk.lines[hunk.lines.length - 1];
        if (lastLine) {
            if (lastLine.newLine) prevNewEnd = lastLine.newLine + 1;
            if (lastLine.oldLine) prevOldEnd = lastLine.oldLine + 1;
        }
    });

    // Minimap ticks
    let minimapHtml = "";
    if (totalLinesCount > 0) {
        minimapTicks.forEach((tick) => {
            const pct = Math.min(100, Math.max(0, (tick.lineIdx / totalLinesCount) * 100));
            minimapHtml += `<div class="mv-minimap-tick ${tick.type}" style="top: ${pct.toFixed(1)}%;"></div>`;
        });
    }

    const encodedRaw = encodeURIComponent(diffStr);
    const bodyStyle = maxHeight === "none" ? "" : `style="max-height: ${maxHeight}px;"`;
    const collapsedClass = isCollapsed ? "is-collapsed" : "";

    return `
        <div class="modern-viewer-window diff-mode ${collapsedClass}" data-raw-diff="${encodedRaw}" data-file-path="${escapeHTML(displayPath)}">
            <div class="mv-header" role="button" tabindex="0" title="Click to collapse or expand file diff">
                <div class="mv-header-left">
                    <span class="mv-lang-badge ${langMeta.shortBadge.toLowerCase()}" style="--badge-color: ${langMeta.color};">${langMeta.shortBadge}</span>
                    <span class="mv-filename" title="${escapeHTML(displayPath)}">${escapeHTML(baseName)}</span>
                    ${dirPath ? `<span class="mv-dirpath" title="${escapeHTML(dirPath)}">${escapeHTML(dirPath)}</span>` : ""}
                </div>
                <div class="mv-header-right">
                    <div class="mv-stats">
                        ${adds > 0 ? `<span class="mv-stat add">+${adds}</span>` : ""}
                        ${dels > 0 ? `<span class="mv-stat del">-${dels}</span>` : ""}
                        ${adds === 0 && dels === 0 ? `<span class="mv-stat neutral">0</span>` : ""}
                    </div>
                    <button type="button" class="mv-btn mv-copy-btn" title="Copy diff" aria-label="Copy diff">
                        <i data-lucide="copy"></i>
                    </button>
                    ${isCollapsible ? `
                    <button type="button" class="mv-collapse-btn" title="Toggle diff view" aria-label="Toggle diff view">
                        <svg class="mv-chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                    ` : ""}
                </div>
            </div>
            <div class="mv-body" ${bodyStyle}>
                <div class="mv-table">
                    ${rowsHtml || '<div class="mv-empty">No diff changes detected.</div>'}
                </div>
                <div class="mv-minimap-bar" aria-hidden="true">
                    ${minimapHtml}
                </div>
            </div>
        </div>
    `;
}

/**
 * Builds HTML for viewing all modified files stacked together in a unified Review stream.
 */
export function renderStackedReviewHtml({
    files = [],
    hideWhitespace = false
} = {}) {
    if (!Array.isArray(files) || files.length === 0) {
        return `
            <div class="diff-empty-state">
                <div class="diff-empty-icon"><i data-lucide="check-circle"></i></div>
                <div class="diff-empty-title">Working tree clean</div>
                <div class="diff-empty-sub">No unaccepted file modifications detected.</div>
            </div>
        `;
    }

    let totalAdds = 0;
    let totalDels = 0;
    files.forEach(f => {
        totalAdds += (Number(f.stats?.additions ?? f.additions) || 0);
        totalDels += (Number(f.stats?.deletions ?? f.deletions) || 0);
    });

    const summaryHtml = `
        <div class="mv-review-summary-bar">
            <div class="mv-review-summary-info">
                <span class="mv-review-file-count">${files.length} ${files.length === 1 ? "file" : "files"} changed</span>
                <div class="mv-stats">
                    ${totalAdds > 0 ? `<span class="mv-stat add">+${totalAdds}</span>` : ""}
                    ${totalDels > 0 ? `<span class="mv-stat del">-${totalDels}</span>` : ""}
                </div>
            </div>
            <div class="mv-review-summary-actions">
                <button type="button" class="diff-action-btn secondary" id="reviewExpandAllBtn" title="Expand all file cards">Expand All</button>
                <button type="button" class="diff-action-btn secondary" id="reviewCollapseAllBtn" title="Collapse all file cards">Collapse All</button>
                <button type="button" class="diff-action-btn" id="reviewAcceptAllBtn" title="Accept all workspace modifications">Accept All</button>
                <button type="button" class="diff-action-btn secondary" id="reviewRevertAllBtn" title="Revert all workspace modifications">Revert All</button>
            </div>
        </div>
    `;

    const cardsHtml = files.map(f => {
        const filePath = f.displayPath || f.path || "";
        const diffStr = f.diff || "";
        return renderDiffCardHtml({
            diffStr,
            filePath,
            stats: f.stats || { additions: f.additions, deletions: f.deletions },
            maxHeight: "none",
            hideWhitespace,
            isCollapsible: true
        });
    }).join("");

    return `
        <div class="mv-stacked-review-container">
            ${summaryHtml}
            <div class="mv-stacked-cards-list">
                ${cardsHtml}
            </div>
        </div>
    `;
}

/**
 * Renders the rows HTML and line count for a code viewer table.
 */
export function renderCodeViewerRowsHtml({
    code = "",
    filePath = "",
    startLine = 1,
    isStreaming = false
} = {}) {
    const rawLines = String(code).split(/\r?\n/);
    const displayPath = filePath || "file";
    const langMeta = getLanguageMeta(displayPath);
    const activeComments = getFileComments(displayPath);

    // Group comments by their endLine for inline rendering
    const commentsByEndLine = new Map();
    const commentedLinesSet = new Set();
    if (Array.isArray(activeComments)) {
        activeComments.forEach(c => {
            const list = commentsByEndLine.get(c.endLine) || [];
            list.push(c);
            commentsByEndLine.set(c.endLine, list);
            for (let l = c.startLine; l <= c.endLine; l++) {
                commentedLinesSet.add(l);
            }
        });
    }

    let highlightedLines = rawLines.map(l => (l ? escapeHTML(l) : "&nbsp;"));
    if (typeof window !== "undefined" && typeof window.hljs !== "undefined" && code) {
        try {
            const ext = displayPath.split(".").pop()?.toLowerCase() || "";
            const isPlainText = ["txt", "text", "log", "out", "plain", "csv", "tsv", "env", "diff", "patch"].includes(ext);
            if (!isPlainText) {
                const langCandidate = (langMeta?.label || ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                const lang = (langCandidate && window.hljs.getLanguage(langCandidate)) ? langCandidate : (window.hljs.getLanguage(ext) ? ext : "");
                if (lang) {
                    const res = window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
                    const splitHl = res.split(/\r?\n/);
                    if (splitHl.length === rawLines.length) {
                        highlightedLines = splitHl.map(l => (l ? l : "&nbsp;"));
                    }
                } else if (!isStreaming) {
                    const res = window.hljs.highlightAuto(code).value;
                    const splitHl = res.split(/\r?\n/);
                    if (splitHl.length === rawLines.length) {
                        highlightedLines = splitHl.map(l => (l ? l : "&nbsp;"));
                    }
                }
            }
        } catch (_) {}
    }

    let rowsHtml = "";
    rawLines.forEach((_, idx) => {
        const lineNum = startLine + idx;
        const lineContent = highlightedLines[idx];
        const hasComment = commentedLinesSet.has(lineNum);
        const rowClass = hasComment ? "mv-row mv-row-ctx has-user-comment" : "mv-row mv-row-ctx";

        rowsHtml += `
            <div class="${rowClass}" data-line="${lineNum}">
                <div class="mv-gutter" aria-hidden="true">
                    <span class="mv-num">${lineNum}</span>
                </div>
                <div class="mv-code-line">${lineContent}</div>
            </div>
        `;

        const endComments = commentsByEndLine.get(lineNum);
        if (endComments && endComments.length > 0) {
            endComments.forEach(c => {
                const lineRangeStr = c.startLine === c.endLine ? `Line ${c.startLine}` : `Lines ${c.startLine}–${c.endLine}`;
                rowsHtml += `
                    <div class="mv-inline-comment-card" data-comment-id="${c.id}">
                        <div class="mv-inline-comment-header">
                            <span class="mv-inline-comment-badge">${escapeHTML(lineRangeStr)}</span>
                            <span class="mv-inline-comment-hint">Sent to model on next turn</span>
                            <button type="button" class="mv-inline-comment-del" data-comment-id="${c.id}" title="Remove comment">
                                <i data-lucide="x"></i>
                            </button>
                        </div>
                        <div class="mv-inline-comment-body">${escapeHTML(c.comment)}</div>
                    </div>
                `;
            });
        }
    });

    return { rowsHtml, lineCount: rawLines.length, langMeta };
}

/**
 * Builds HTML for viewing file content with a modern UI.
 */
export function renderCodeViewerCardHtml({
    code = "",
    filePath = "",
    startLine = 1,
    maxHeight = 600,
    isStreaming = false
} = {}) {
    const displayPath = filePath || "file";
    const baseName = displayPath.split("/").pop() || displayPath;
    const { rowsHtml, lineCount, langMeta } = renderCodeViewerRowsHtml({
        code,
        filePath,
        startLine,
        isStreaming
    });

    const encodedRaw = encodeURIComponent(code);

    return `
        <div class="modern-viewer-window code-mode" data-raw-diff="${encodedRaw}" data-file-path="${escapeHTML(displayPath)}">
            <div class="mv-header">
                <div class="mv-header-left">
                    <span class="mv-file-icon" style="color: ${langMeta.color};">
                        <i data-lucide="${langMeta.icon}"></i>
                    </span>
                    <span class="mv-filename" title="${escapeHTML(displayPath)}">${escapeHTML(baseName)}</span>
                    <span class="mv-stat neutral">${lineCount} lines</span>
                </div>
                <div class="mv-header-actions">
                    <button type="button" class="mv-btn mv-wrap-btn" title="Toggle Word Wrap" aria-label="Toggle word wrap">
                        <i data-lucide="wrap-text"></i>
                    </button>
                    <button type="button" class="mv-btn mv-copy-btn" title="Copy code" aria-label="Copy code">
                        <i data-lucide="copy"></i>
                        <span>Copy</span>
                    </button>
                </div>
            </div>
            <div class="mv-body" style="max-height: ${maxHeight}px;">
                <div class="mv-table">
                    ${rowsHtml}
                </div>
            </div>
        </div>
    `;
}

// Global dismiss for context menus
if (typeof document !== "undefined" && !document._mvContextMenuBound) {
    document._mvContextMenuBound = true;
    document.addEventListener("click", () => {
        document.querySelectorAll(".mv-context-menu").forEach(m => m.remove());
    });
}

/**
 * Displays an inline comment composer beneath the selected line or target row.
 */
function showInlineCommentComposer({ win, filePath, startLine, endLine, selectedText }) {
    win.querySelectorAll(".mv-inline-composer").forEach(c => c.remove());

    const lineRangeStr = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
    const targetRow = win.querySelector(`.mv-row[data-line="${endLine}"]`) || win.querySelector(".mv-table")?.lastElementChild;

    const composer = document.createElement("div");
    composer.className = "mv-inline-composer";
    composer.innerHTML = `
        <div class="mv-inline-composer-header">
            <span class="mv-inline-composer-badge">${escapeHTML(lineRangeStr)}</span>
            <span class="mv-inline-composer-title">Add instruction for AI model</span>
        </div>
        <textarea class="mv-inline-composer-input" placeholder="Type instructions or comments for these lines... (sent to AI on next turn)" rows="3"></textarea>
        <div class="mv-inline-composer-actions">
            <button type="button" class="mv-btn-comment-cancel">Cancel</button>
            <button type="button" class="mv-btn-comment-save">Save Comment</button>
        </div>
    `;

    if (targetRow && targetRow.nextSibling) {
        targetRow.parentNode.insertBefore(composer, targetRow.nextSibling);
    } else if (targetRow) {
        targetRow.parentNode.appendChild(composer);
    } else {
        win.querySelector(".mv-body")?.appendChild(composer);
    }

    const textarea = composer.querySelector(".mv-inline-composer-input");
    const saveBtn = composer.querySelector(".mv-btn-comment-save");
    const cancelBtn = composer.querySelector(".mv-btn-comment-cancel");

    textarea?.focus();

    const doSave = () => {
        const text = textarea?.value?.trim();
        if (!text) {
            composer.remove();
            return;
        }
        addFileComment({
            filePath,
            startLine,
            endLine,
            selectedText,
            comment: text
        });
        composer.remove();
        if (typeof window !== "undefined" && window.rightPanel) {
            window.rightPanel.renderActiveTab();
        }
    };

    saveBtn.addEventListener("click", doSave);
    cancelBtn.addEventListener("click", () => composer.remove());

    textarea.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            doSave();
        } else if (e.key === "Escape") {
            composer.remove();
        }
    });
}

/**
 * Binds copy buttons, word wrap toggles, hunk actions, inline comments, and context menus.
 */
export function bindDiffViewerCards(root = document) {
    if (!root) return;
    const windows = root.querySelectorAll(".modern-viewer-window");
    windows.forEach((win) => {
        if (win._mvBound) return;
        win._mvBound = true;

        // Header Collapse/Expand toggle
        const headerEl = win.querySelector(".mv-header");
        if (headerEl) {
            headerEl.addEventListener("click", (e) => {
                if (e.target.closest(".mv-btn") || e.target.closest(".mv-copy-btn")) return;
                win.classList.toggle("is-collapsed");
                win.dataset.collapsed = win.classList.contains("is-collapsed") ? "true" : "false";
            });
        }

        const collapseBtn = win.querySelector(".mv-collapse-btn");
        if (collapseBtn) {
            collapseBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                win.classList.toggle("is-collapsed");
                win.dataset.collapsed = win.classList.contains("is-collapsed") ? "true" : "false";
            });
        }

        // Hunk Expander Dividers (+N more lines, +10 up, +10 down)
        win.querySelectorAll(".mv-hunk-divider").forEach((divider) => {
            const controls = divider.querySelector(".mv-hunk-controls");
            if (!controls) return;

            controls.addEventListener("click", async (e) => {
                const btn = e.target.closest("button");
                if (!btn) return;
                e.stopPropagation();

                const action = btn.getAttribute("data-action");
                const gapStart = parseInt(divider.dataset.gapStart, 10);
                const gapCount = parseInt(divider.dataset.gapCount, 10);
                const filePath = divider.dataset.filePath || win.getAttribute("data-file-path") || "";
                if (isNaN(gapStart) || isNaN(gapCount) || gapCount <= 0 || !filePath) return;

                btn.disabled = true;
                btn.style.opacity = "0.6";

                try {
                    const rawLines = await getFileRawLines(filePath);
                    if (!rawLines || rawLines.length === 0) {
                        btn.disabled = false;
                        btn.style.opacity = "1";
                        return;
                    }

                    const langMeta = getLanguageMeta(filePath);
                    let hlLang = "";
                    if (typeof window !== "undefined" && typeof window.hljs !== "undefined") {
                        const ext = filePath.split(".").pop()?.toLowerCase() || "";
                        const langCandidate = (langMeta?.label || ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                        hlLang = (langCandidate && window.hljs.getLanguage(langCandidate)) ? langCandidate : (window.hljs.getLanguage(ext) ? ext : "");
                    }

                    const buildRow = (lineIdx) => {
                        const lineNum = lineIdx + 1; // 1-based
                        const rawText = rawLines[lineIdx] ?? "";
                        let content = rawText ? escapeHTML(rawText) : "&nbsp;";
                        if (hlLang && rawText) {
                            try {
                                content = window.hljs.highlight(rawText, { language: hlLang, ignoreIllegals: true }).value;
                            } catch (_) {}
                        }
                        const rowEl = document.createElement("div");
                        rowEl.className = "mv-row mv-row-ctx mv-row-expanded";
                        rowEl.innerHTML = `
                            <div class="mv-gutter dual" aria-hidden="true">
                                <span class="mv-old-num">${lineNum}</span>
                                <span class="mv-new-num">${lineNum}</span>
                            </div>
                            <div class="mv-code-line">${content}</div>
                        `;
                        return rowEl;
                    };

                    if (action === "expand-all") {
                        // Expand all lines in gap
                        const frag = document.createDocumentFragment();
                        for (let i = 0; i < gapCount; i++) {
                            const lIdx = (gapStart - 1) + i;
                            if (lIdx < rawLines.length) {
                                frag.appendChild(buildRow(lIdx));
                            }
                        }
                        divider.parentNode.insertBefore(frag, divider);
                        divider.remove();
                    } else if (action === "expand-down") {
                        // Expand top 10 lines from gapStart
                        const count = Math.min(10, gapCount);
                        const frag = document.createDocumentFragment();
                        for (let i = 0; i < count; i++) {
                            const lIdx = (gapStart - 1) + i;
                            if (lIdx < rawLines.length) {
                                frag.appendChild(buildRow(lIdx));
                            }
                        }
                        divider.parentNode.insertBefore(frag, divider);

                        const remaining = gapCount - count;
                        if (remaining <= 0) {
                            divider.remove();
                        } else {
                            divider.dataset.gapStart = String(gapStart + count);
                            divider.dataset.gapCount = String(remaining);
                            const pill = divider.querySelector(".mv-hunk-pill");
                            if (pill) pill.textContent = `+${remaining} more lines`;
                            btn.disabled = false;
                            btn.style.opacity = "1";
                        }
                    } else if (action === "expand-up") {
                        // Expand bottom 10 lines ending at gapStart + gapCount - 1
                        const count = Math.min(10, gapCount);
                        const startIdx = (gapStart - 1) + (gapCount - count);
                        const frag = document.createDocumentFragment();
                        for (let i = 0; i < count; i++) {
                            const lIdx = startIdx + i;
                            if (lIdx >= 0 && lIdx < rawLines.length) {
                                frag.appendChild(buildRow(lIdx));
                            }
                        }
                        if (divider.nextSibling) {
                            divider.parentNode.insertBefore(frag, divider.nextSibling);
                        } else {
                            divider.parentNode.appendChild(frag);
                        }

                        const remaining = gapCount - count;
                        if (remaining <= 0) {
                            divider.remove();
                        } else {
                            divider.dataset.gapCount = String(remaining);
                            const pill = divider.querySelector(".mv-hunk-pill");
                            if (pill) pill.textContent = `+${remaining} more lines`;
                            btn.disabled = false;
                            btn.style.opacity = "1";
                        }
                    }
                } catch (err) {
                    console.error("[DiffViewer] Hunk expansion error:", err);
                    btn.disabled = false;
                    btn.style.opacity = "1";
                }
            });
        });

        const copyBtn = win.querySelector(".mv-copy-btn");
        if (copyBtn) {
            copyBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const raw = decodeURIComponent(win.dataset.rawDiff || "");
                if (!raw) return;

                try {
                    await navigator.clipboard.writeText(raw);
                    const origHtml = copyBtn.innerHTML;
                    copyBtn.innerHTML = '<i data-lucide="check"></i><span>Copied</span>';
                    copyBtn.classList.add("copied");
                    renderIcons(copyBtn);
                    setTimeout(() => {
                        copyBtn.innerHTML = origHtml;
                        copyBtn.classList.remove("copied");
                        renderIcons(copyBtn);
                    }, 2000);
                } catch (err) {
                    console.error("Failed to copy content:", err);
                }
            });
        }

        const wrapBtn = win.querySelector(".mv-wrap-btn");
        if (wrapBtn) {
            wrapBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const isWrapped = win.classList.toggle("word-wrap");
                wrapBtn.classList.toggle("active", isWrapped);
            });
        }

        // Inline comment delete buttons
        win.querySelectorAll(".mv-inline-comment-del").forEach((delBtn) => {
            delBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const cid = delBtn.getAttribute("data-comment-id");
                if (cid) {
                    removeFileComment(cid);
                    const card = delBtn.closest(".mv-inline-comment-card");
                    if (card) card.remove();
                    if (typeof window !== "undefined" && window.rightPanel) {
                        window.rightPanel.renderActiveTab();
                    }
                }
            });
        });

        // Right-click context menu for commenting
        win.addEventListener("contextmenu", (e) => {
            const filePath = win.getAttribute("data-file-path") || "";
            if (!filePath) return;

            const selection = window.getSelection();
            let startLine = null;
            let endLine = null;
            let selectedText = "";

            if (selection && !selection.isCollapsed) {
                selectedText = selection.toString().trim();
                const anchorNode = selection.anchorNode;
                const focusNode = selection.focusNode;
                if (win.contains(anchorNode) || win.contains(focusNode)) {
                    const anchorRow = (anchorNode?.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode?.parentElement)?.closest(".mv-row");
                    const focusRow = (focusNode?.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode?.parentElement)?.closest(".mv-row");
                    const aLine = anchorRow?.dataset?.line ? parseInt(anchorRow.dataset.line, 10) : null;
                    const fLine = focusRow?.dataset?.line ? parseInt(focusRow.dataset.line, 10) : null;
                    if (aLine && fLine) {
                        startLine = Math.min(aLine, fLine);
                        endLine = Math.max(aLine, fLine);
                    } else if (aLine) {
                        startLine = aLine;
                        endLine = aLine;
                    } else if (fLine) {
                        startLine = fLine;
                        endLine = fLine;
                    }
                }
            }

            if (!startLine) {
                const clickedRow = e.target.closest(".mv-row");
                if (clickedRow && clickedRow.dataset.line) {
                    const l = parseInt(clickedRow.dataset.line, 10);
                    if (!isNaN(l)) {
                        startLine = l;
                        endLine = l;
                    }
                }
            }

            if (!startLine) return;

            e.preventDefault();
            document.querySelectorAll(".mv-context-menu").forEach(m => m.remove());

            const lineRangeStr = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
            const menu = document.createElement("div");
            menu.className = "mv-context-menu";
            menu.style.left = `${e.clientX}px`;
            menu.style.top = `${e.clientY}px`;
            menu.innerHTML = `
                <button type="button" class="mv-context-menu-item" id="mvAddCommentAction">
                    <i data-lucide="message-square-plus"></i>
                    <span>Add Comment (${escapeHTML(lineRangeStr)})</span>
                </button>
            `;
            document.body.appendChild(menu);
            renderIcons(menu);

            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
            if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;

            const addActionBtn = menu.querySelector("#mvAddCommentAction");
            if (addActionBtn) {
                addActionBtn.addEventListener("click", (evt) => {
                    evt.stopPropagation();
                    menu.remove();
                    showInlineCommentComposer({
                        win,
                        filePath,
                        startLine,
                        endLine,
                        selectedText
                    });
                });
            }
        });

        // Inline hunk Accept / Reject action buttons
        win.querySelectorAll(".mv-hunk-action-btn").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const action = btn.getAttribute("data-action");
                const filePath = btn.getAttribute("data-file-path") || win.getAttribute("data-file-path") || "";
                if (!filePath) return;

                btn.disabled = true;
                btn.style.opacity = "0.5";

                if (action === "accept-file") {
                    try {
                        const chatId = (typeof window !== "undefined" && window.state?.currentChatId) ? window.state.currentChatId : "";
                        const res = await fetch("/api/history/accept", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ file: filePath, chatId })
                        });
                        if (res.ok && typeof window !== "undefined" && window.rightPanel) {
                            const tabs = window.rightPanel.tabs || [];
                            const cleanPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
                            tabs.forEach(t => {
                                const tPath = (t.path || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
                                if (t.type === "diff" && (tPath === cleanPath || !filePath)) {
                                    t.type = "file";
                                    t.title = t.path.split("/").pop() || t.path;
                                    t.id = `file_${t.path}`;
                                    if (window.rightPanel.activeTabId === t.id || window.rightPanel.activeTabId === `diff_${t.path}`) {
                                        window.rightPanel.activeTabId = t.id;
                                    }
                                }
                            });
                            window.rightPanel.renderTabStrip();
                            await window.rightPanel.checkWorkspaceChanges();
                            window.rightPanel.renderActiveTab();
                            document.dispatchEvent(new CustomEvent("unacceptedChangesUpdated"));
                        }
                    } catch (err) {
                        console.error("[DiffViewer] Accept error:", err);
                    }
                } else if (action === "reject-file") {
                    try {
                        const chatId = (typeof window !== "undefined" && window.state?.currentChatId) ? window.state.currentChatId : "";
                        const res = await fetch("/api/history/revert", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ file: filePath, chatId })
                        });
                        if (res.ok && typeof window !== "undefined" && window.rightPanel) {
                            const tabs = window.rightPanel.tabs || [];
                            const cleanPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
                            tabs.forEach(t => {
                                const tPath = (t.path || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
                                if (t.type === "diff" && (tPath === cleanPath || !filePath)) {
                                    t.type = "file";
                                    t.title = t.path.split("/").pop() || t.path;
                                    t.id = `file_${t.path}`;
                                    if (window.rightPanel.activeTabId === t.id || window.rightPanel.activeTabId === `diff_${t.path}`) {
                                        window.rightPanel.activeTabId = t.id;
                                    }
                                }
                            });
                            window.rightPanel.renderTabStrip();
                            await window.rightPanel.checkWorkspaceChanges();
                            window.rightPanel.renderActiveTab();
                            document.dispatchEvent(new CustomEvent("unacceptedChangesUpdated"));
                        }
                    } catch (err) {
                        console.error("[DiffViewer] Revert error:", err);
                    }
                }
            });
        });
    });

    // Bind Stacked Review Summary Actions
    const expandAllBtn = root.querySelector("#reviewExpandAllBtn");
    if (expandAllBtn && !expandAllBtn._mvBound) {
        expandAllBtn._mvBound = true;
        expandAllBtn.addEventListener("click", () => {
            const container = expandAllBtn.closest(".mv-stacked-review-container") || root;
            container.querySelectorAll(".modern-viewer-window.diff-mode").forEach(w => {
                w.classList.remove("is-collapsed");
                w.dataset.collapsed = "false";
            });
        });
    }

    const collapseAllBtn = root.querySelector("#reviewCollapseAllBtn");
    if (collapseAllBtn && !collapseAllBtn._mvBound) {
        collapseAllBtn._mvBound = true;
        collapseAllBtn.addEventListener("click", () => {
            const container = collapseAllBtn.closest(".mv-stacked-review-container") || root;
            container.querySelectorAll(".modern-viewer-window.diff-mode").forEach(w => {
                w.classList.add("is-collapsed");
                w.dataset.collapsed = "true";
            });
        });
    }

    const acceptAllBtn = root.querySelector("#reviewAcceptAllBtn");
    if (acceptAllBtn && !acceptAllBtn._mvBound) {
        acceptAllBtn._mvBound = true;
        acceptAllBtn.addEventListener("click", async () => {
            acceptAllBtn.disabled = true;
            acceptAllBtn.style.opacity = "0.5";
            try {
                const chatId = (typeof window !== "undefined" && window.state?.currentChatId) ? window.state.currentChatId : "";
                const res = await fetch("/api/history/accept", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chatId })
                });
                if (res.ok && typeof window !== "undefined" && window.rightPanel) {
                    await window.rightPanel.checkWorkspaceChanges();
                    window.rightPanel.renderActiveTab();
                    document.dispatchEvent(new CustomEvent("unacceptedChangesUpdated"));
                }
            } catch (err) {
                console.error("[DiffViewer] Accept all error:", err);
            } finally {
                acceptAllBtn.disabled = false;
                acceptAllBtn.style.opacity = "1";
            }
        });
    }

    const revertAllBtn = root.querySelector("#reviewRevertAllBtn");
    if (revertAllBtn && !revertAllBtn._mvBound) {
        revertAllBtn._mvBound = true;
        revertAllBtn.addEventListener("click", async () => {
            revertAllBtn.disabled = true;
            revertAllBtn.style.opacity = "0.5";
            try {
                const chatId = (typeof window !== "undefined" && window.state?.currentChatId) ? window.state.currentChatId : "";
                const res = await fetch("/api/history/revert", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chatId })
                });
                if (res.ok && typeof window !== "undefined" && window.rightPanel) {
                    await window.rightPanel.checkWorkspaceChanges();
                    window.rightPanel.renderActiveTab();
                    document.dispatchEvent(new CustomEvent("unacceptedChangesUpdated"));
                }
            } catch (err) {
                console.error("[DiffViewer] Revert all error:", err);
            } finally {
                revertAllBtn.disabled = false;
                revertAllBtn.style.opacity = "1";
            }
        });
    }
}
