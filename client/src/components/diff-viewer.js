/* =========================================================
   MODERN DIFF & FILE VIEWER COMPONENT
   Clean, minimalist viewer based on modern web guidance.
   ========================================================= */
import { escapeHTML } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";

/**
 * Returns language label and icon metadata based on file extension.
 */
export function getLanguageMeta(filePath = "") {
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    switch (ext) {
        case "js": case "mjs": case "cjs": return { label: "JavaScript", icon: "file-code", color: "#f7df1e" };
        case "ts": return { label: "TypeScript", icon: "file-code", color: "#3178c6" };
        case "tsx": case "jsx": return { label: "React JSX", icon: "file-code", color: "#00d8ff" };
        case "json": return { label: "JSON", icon: "file-code", color: "#cbcb41" };
        case "css": case "scss": case "less": return { label: "CSS", icon: "file-code", color: "#42a5f5" };
        case "html": case "htm": return { label: "HTML", icon: "file-code", color: "#e34f26" };
        case "py": return { label: "Python", icon: "file-code", color: "#3572A5" };
        case "sh": case "bash": case "zsh": return { label: "Shell", icon: "terminal", color: "#89e051" };
        case "md": case "markdown": return { label: "Markdown", icon: "file-text", color: "#ffffff" };
        case "yml": case "yaml": return { label: "YAML", icon: "file-text", color: "#cb171e" };
        case "diff": case "patch": return { label: "Diff", icon: "git-commit", color: "#4ec9b0" };
        default: return { label: "Text", icon: "file", color: "#9ca3af" };
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
                displayLine: curNewLine,
                text: line.slice(1)
            });
            curNewLine++;
        } else if (line.startsWith("-")) {
            deletions++;
            currentHunk.lines.push({
                type: "del",
                sign: "-",
                displayLine: curOldLine,
                text: line.slice(1)
            });
            curOldLine++;
        } else {
            currentHunk.lines.push({
                type: "ctx",
                sign: " ",
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
 * Builds HTML for a modern unified diff viewer window.
 */
export function renderDiffCardHtml({
    diffStr = "",
    filePath = "",
    title = "",
    stats = null,
    startLine = 1,
    maxHeight = 600
} = {}) {
    const parsed = parseUnifiedDiff(diffStr, startLine);
    const displayPath = filePath || parsed.fileName || title || "diff";
    const baseName = displayPath.split("/").pop() || displayPath;
    const adds = stats?.additions ?? parsed.additions;
    const dels = stats?.deletions ?? parsed.deletions;
    const langMeta = getLanguageMeta(displayPath);

    let rowsHtml = "";

    parsed.hunks.forEach((hunk) => {
        if (hunk.header && (parsed.hunks.length > 1 || hunk.heading)) {
            rowsHtml += `
                <div class="mv-hunk-banner">
                    <span class="mv-hunk-tag">${escapeHTML(hunk.header)}</span>
                    ${hunk.heading ? `<span class="mv-hunk-context">${escapeHTML(hunk.heading)}</span>` : ""}
                </div>
            `;
        }

        hunk.lines.forEach((l) => {
            const lineNumStr = l.displayLine !== null && l.displayLine !== undefined ? String(l.displayLine) : "";
            const rowClass = l.type === "add" ? "mv-row-add" : (l.type === "del" ? "mv-row-del" : "mv-row-ctx");

            rowsHtml += `
                <div class="mv-row ${rowClass}">
                    <div class="mv-gutter" aria-hidden="true">
                        <span class="mv-num">${escapeHTML(lineNumStr)}</span>
                    </div>
                    <div class="mv-code-line">${l.text ? escapeHTML(l.text) : "&nbsp;"}</div>
                </div>
            `;
        });
    });

    const encodedRaw = encodeURIComponent(diffStr);

    return `
        <div class="modern-viewer-window diff-mode" data-raw-diff="${encodedRaw}">
            <div class="mv-header">
                <div class="mv-header-left">
                    <span class="mv-file-icon" style="color: ${langMeta.color};">
                        <i data-lucide="${langMeta.icon}"></i>
                    </span>
                    <span class="mv-filename" title="${escapeHTML(displayPath)}">${escapeHTML(baseName)}</span>
                    <div class="mv-stats">
                        ${adds > 0 ? `<span class="mv-stat add">+${adds}</span>` : ""}
                        ${dels > 0 ? `<span class="mv-stat del">-${dels}</span>` : ""}
                    </div>
                </div>
                <div class="mv-header-actions">
                    <button type="button" class="mv-btn mv-wrap-btn" title="Toggle Word Wrap" aria-label="Toggle word wrap">
                        <i data-lucide="wrap-text"></i>
                    </button>
                    <button type="button" class="mv-btn mv-copy-btn" title="Copy diff" aria-label="Copy diff">
                        <i data-lucide="copy"></i>
                        <span>Copy</span>
                    </button>
                </div>
            </div>
            <div class="mv-body" style="max-height: ${maxHeight}px;">
                <div class="mv-table">
                    ${rowsHtml || '<div class="mv-empty">No diff changes detected.</div>'}
                </div>
            </div>
        </div>
    `;
}

/**
 * Builds HTML for viewing file content with a modern UI.
 */
export function renderCodeViewerCardHtml({
    code = "",
    filePath = "",
    startLine = 1,
    maxHeight = 600
} = {}) {
    const rawLines = String(code).split(/\r?\n/);
    const displayPath = filePath || "file";
    const baseName = displayPath.split("/").pop() || displayPath;
    const langMeta = getLanguageMeta(displayPath);

    let rowsHtml = "";
    rawLines.forEach((lineText, idx) => {
        const lineNum = startLine + idx;
        rowsHtml += `
            <div class="mv-row mv-row-ctx">
                <div class="mv-gutter" aria-hidden="true">
                    <span class="mv-num">${lineNum}</span>
                </div>
                <div class="mv-code-line">${lineText ? escapeHTML(lineText) : "&nbsp;"}</div>
            </div>
        `;
    });

    const encodedRaw = encodeURIComponent(code);

    return `
        <div class="modern-viewer-window code-mode" data-raw-diff="${encodedRaw}">
            <div class="mv-header">
                <div class="mv-header-left">
                    <span class="mv-file-icon" style="color: ${langMeta.color};">
                        <i data-lucide="${langMeta.icon}"></i>
                    </span>
                    <span class="mv-filename" title="${escapeHTML(displayPath)}">${escapeHTML(baseName)}</span>
                    <span class="mv-stat neutral">${rawLines.length} lines</span>
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

/**
 * Binds copy buttons, word wrap toggles, and click handlers on rendered viewer windows.
 */
export function bindDiffViewerCards(root = document) {
    if (!root) return;
    const windows = root.querySelectorAll(".modern-viewer-window");
    windows.forEach((win) => {
        if (win._mvBound) return;
        win._mvBound = true;

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
    });
}
