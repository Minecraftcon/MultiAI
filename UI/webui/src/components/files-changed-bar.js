/* =========================================================
   FILES CHANGED REVIEW BAR COMPONENT
   Renders a persistent, expandable review bar at the end of
   an AI turn whenever file modifications occurred.

   Layout:
   _____________________________________________________
   | { } Files changed                      | Review   |
   _____________________________________________________
   - Clicking the bar expands/collapses the changed files list.
   - Clicking an individual file row opens it in diff viewer.
   - Clicking the "Review" button opens the diff/review tab.
   - Fully persistent across page reloads and session restarts.
   ========================================================= */

import { state } from "../state/index.js";
import { escapeHTML } from "../utils/dom.js";
import { saveStoredChats } from "../services/storage.js";

/**
 * Extracts the list of files changed in a given turn.
 * Prioritizes explicitly stored message.filesChanged, with fallback
 * to inspecting tool call arguments in the turn.
 *
 * @param {object} turn - The chat turn object
 * @param {object} [finalAssistantMsg] - The final assistant message object
 * @returns {Array<{path: string, displayPath?: string, additions?: number, deletions?: number, workspace?: string}>}
 */
export function extractTurnFilesChanged(turn, finalAssistantMsg = null) {
    if (finalAssistantMsg?.filesChanged && Array.isArray(finalAssistantMsg.filesChanged) && finalAssistantMsg.filesChanged.length > 0) {
        return finalAssistantMsg.filesChanged;
    }

    if (turn?.aiMessages && Array.isArray(turn.aiMessages)) {
        for (const msg of turn.aiMessages) {
            if (msg.role === "assistant" && Array.isArray(msg.filesChanged) && msg.filesChanged.length > 0) {
                return msg.filesChanged;
            }
        }

        // Fallback: Infer from successful file editing tool calls within the turn
        const fileMap = new Map();
        const editingToolNames = new Set([
            "write_file",
            "replace_file_content",
            "multi_replace_file_content",
            "edit_file",
            "search_and_replace"
        ]);

        for (const msg of turn.aiMessages) {
            if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
                for (const tc of msg.tool_calls) {
                    const name = tc.function?.name;
                    if (editingToolNames.has(name)) {
                        let args = {};
                        try {
                            args = typeof tc.function?.arguments === "string"
                                ? JSON.parse(tc.function.arguments)
                                : (tc.function?.arguments || {});
                        } catch (_) {
                            args = {};
                        }
                        const p = args.path || args.TargetFile || args.target_file || args.file_path || args.AbsolutePath;
                        if (p && typeof p === "string" && !fileMap.has(p)) {
                            fileMap.set(p, {
                                path: p,
                                displayPath: p,
                                additions: 0,
                                deletions: 0
                            });
                        }
                    }
                }
            }
        }

        if (fileMap.size > 0) {
            return Array.from(fileMap.values());
        }
    }

    return [];
}

/**
 * Renders or updates the persistent Files Changed review bar inside an AI message element.
 *
 * @param {HTMLElement} aiDiv - The .message.ai container element
 * @param {Array<object>} files - Array of changed file objects
 * @param {object} [messageRef] - Reference to the assistant message for persisting expanded state
 * @returns {HTMLElement|null} The mounted bar container element
 */
export function renderFilesChangedBar(aiDiv, files, messageRef = null) {
    if (!aiDiv) return null;

    if (!Array.isArray(files) || files.length === 0) {
        const existing = aiDiv.querySelector(".files-changed-bar-container");
        if (existing) existing.remove();
        return null;
    }

    let barContainer = aiDiv.querySelector(".files-changed-bar-container");
    if (!barContainer) {
        barContainer = document.createElement("div");
        barContainer.className = "files-changed-bar-container";
    }

    // Place directly under .followup-suggestions (next message suggestions)
    // If followup suggestions or plan approval are present, place after them; otherwise after .final-content
    const followupContainer = aiDiv.querySelector(".followup-suggestions");
    const planContainer = aiDiv.querySelector(".plan-approval-container");
    const finalContent = aiDiv.querySelector(".final-content");

    if (followupContainer && followupContainer.parentNode === aiDiv) {
        if (followupContainer.nextSibling !== barContainer) {
            if (followupContainer.nextSibling) {
                aiDiv.insertBefore(barContainer, followupContainer.nextSibling);
            } else {
                aiDiv.appendChild(barContainer);
            }
        }
    } else if (planContainer && planContainer.parentNode === aiDiv) {
        if (planContainer.nextSibling !== barContainer) {
            if (planContainer.nextSibling) {
                aiDiv.insertBefore(barContainer, planContainer.nextSibling);
            } else {
                aiDiv.appendChild(barContainer);
            }
        }
    } else if (finalContent && finalContent.parentNode === aiDiv) {
        if (finalContent.nextSibling !== barContainer) {
            if (finalContent.nextSibling) {
                aiDiv.insertBefore(barContainer, finalContent.nextSibling);
            } else {
                aiDiv.appendChild(barContainer);
            }
        }
    } else if (barContainer.parentNode !== aiDiv) {
        aiDiv.appendChild(barContainer);
    }

    const count = files.length;
    const fileWord = count === 1 ? "file" : "files";
    const isExpanded = messageRef?.filesChangedExpanded === true || barContainer.dataset.expanded === "true";

    barContainer.dataset.expanded = isExpanded ? "true" : "false";

    let totalAdditions = 0;
    let totalDeletions = 0;
    for (const f of files) {
        totalAdditions += (Number(f.additions) || 0);
        totalDeletions += (Number(f.deletions) || 0);
    }
    const totalAddStr = totalAdditions > 0 ? `<span class="diff-stat-add files-changed-total-add">+${totalAdditions}</span>` : "";
    const totalDelStr = totalDeletions > 0 ? `<span class="diff-stat-del files-changed-total-del">-${totalDeletions}</span>` : "";
    const totalStatsHtml = (totalAddStr || totalDelStr) ? `<span class="files-changed-total-stats">${totalAddStr}${totalDelStr}</span>` : "";

    barContainer.innerHTML = `
        <div class="files-changed-header" role="button" tabindex="0" aria-expanded="${isExpanded ? "true" : "false"}">
            <div class="files-changed-summary">
                <span class="files-changed-label">${count} ${fileWord} changed</span>
                ${totalStatsHtml}
                <span class="files-changed-chevron" aria-hidden="true">${isExpanded ? "▾" : "▸"}</span>
            </div>
            <div class="files-changed-actions">
                <button type="button" class="files-changed-review-btn">Review</button>
            </div>
        </div>
        <div class="files-changed-dropdown" style="${isExpanded ? "" : "display: none;"}">
            <div class="files-changed-file-list">
                ${files.map(f => {
                    const rawPath = f.displayPath || f.path || "";
                    const normalized = rawPath.replace(/\\/g, "/");
                    const fileName = normalized.split("/").pop() || normalized;
                    const dirPath = normalized.substring(0, normalized.length - fileName.length).replace(/\/$/, "");

                    const addStr = Number(f.additions) > 0 ? `<span class="diff-stat-add">+${f.additions}</span>` : "";
                    const delStr = Number(f.deletions) > 0 ? `<span class="diff-stat-del">-${f.deletions}</span>` : "";
                    const hasStats = addStr || delStr;

                    return `
                        <div class="files-changed-file-row" data-path="${escapeHTML(f.path)}" data-workspace="${escapeHTML(f.workspace || "")}" role="button" tabindex="0">
                            <div class="files-changed-file-info">
                                <svg class="files-changed-file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                                <span class="file-name">${escapeHTML(fileName)}</span>
                                ${dirPath ? `<span class="file-dir">${escapeHTML(dirPath)}</span>` : ""}
                            </div>
                            <div class="files-changed-file-stats">
                                ${hasStats ? `${addStr}${delStr}` : `<span class="diff-stat-modified">modified</span>`}
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>
        </div>
    `;

    // Bind Expand/Collapse on header
    const headerEl = barContainer.querySelector(".files-changed-header");
    const dropdownEl = barContainer.querySelector(".files-changed-dropdown");
    const chevronEl = barContainer.querySelector(".files-changed-chevron");

    const toggleExpand = (e) => {
        if (e && e.target && typeof e.target.closest === "function" && e.target.closest(".files-changed-review-btn")) return;
        const nowExpanded = barContainer.dataset.expanded !== "true";
        barContainer.dataset.expanded = nowExpanded ? "true" : "false";
        headerEl.setAttribute("aria-expanded", nowExpanded ? "true" : "false");
        dropdownEl.style.display = nowExpanded ? "" : "none";
        chevronEl.textContent = nowExpanded ? "▾" : "▸";

        if (messageRef) {
            messageRef.filesChangedExpanded = nowExpanded;
            try { saveStoredChats(); } catch (_) {}
        }
    };

    headerEl.addEventListener("click", toggleExpand);
    headerEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleExpand(e);
        }
    });

    // Bind Review Button
    const reviewBtn = barContainer.querySelector(".files-changed-review-btn");
    reviewBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (window.rightPanel) {
            window.rightPanel.open();
            if (files.length === 1 && files[0]?.path) {
                window.rightPanel.openDiffTab(files[0].path, files[0].workspace || "");
            } else if (window.rightPanel.openReviewTab) {
                window.rightPanel.openReviewTab();
            } else if (files[0]?.path) {
                window.rightPanel.openDiffTab(files[0].path, files[0].workspace || "");
            }
        }
    });

    // Bind File Row clicks to open individual diff viewer
    const fileRows = barContainer.querySelectorAll(".files-changed-file-row");
    fileRows.forEach(row => {
        const filePath = row.dataset.path;
        const workspace = row.dataset.workspace || "";

        const openRowDiff = (e) => {
            e.stopPropagation();
            if (window.rightPanel && filePath) {
                window.rightPanel.open();
                window.rightPanel.openDiffTab(filePath, workspace);
            }
        };

        row.addEventListener("click", openRowDiff);
        row.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openRowDiff(e);
            }
        });
    });

    return barContainer;
}

/**
 * Concludes file change tracking for a turn, fetching unaccepted diff stats
 * and persisting the results on the assistant message.
 *
 * @param {object} session - The active chat session
 * @param {HTMLElement} currentAIMessage - The .message.ai element for this turn
 * @param {Set<string>} turnModifiedFiles - Paths modified directly via tools in this turn
 * @param {Map<string, object>} initialChangesMap - Pre-turn baseline of unaccepted changes
 */
export async function finalizeTurnFilesChanged(session, currentAIMessage, turnModifiedFiles, initialChangesMap) {
    if (!session || !currentAIMessage) return;

    const filesMap = new Map();

    // 1. Fetch current unaccepted changes from the Shadow Git endpoint
    try {
        const chatId = session.id || state.currentChatId || "";
        const res = await fetch(`/api/history/changes?chatId=${encodeURIComponent(chatId)}`);
        if (res.ok) {
            const data = await res.json();
            const currentFiles = Array.isArray(data.files) ? data.files : [];

            for (const f of currentFiles) {
                const init = initialChangesMap?.get(f.path);
                const wasInTurn = turnModifiedFiles?.has(f.path);
                const statsChanged = !init || init.additions !== f.additions || init.deletions !== f.deletions || init.status !== f.status;

                if (wasInTurn || statsChanged) {
                    filesMap.set(f.path, {
                        path: f.path,
                        displayPath: f.displayPath || f.path,
                        additions: f.additions || 0,
                        deletions: f.deletions || 0,
                        status: f.status || "modified",
                        workspace: f.workspace || ""
                    });
                }
            }
        }
    } catch (_) {}

    // 2. Include any directly modified files from tools that may not be tracked by Shadow Git
    if (turnModifiedFiles && turnModifiedFiles.size > 0) {
        for (const p of turnModifiedFiles) {
            if (!filesMap.has(p)) {
                filesMap.set(p, {
                    path: p,
                    displayPath: p,
                    additions: 0,
                    deletions: 0,
                    status: "modified"
                });
            }
        }
    }

    if (filesMap.size === 0) return;

    const turnFiles = Array.from(filesMap.values());

    // 3. Find the last assistant message in session to attach filesChanged
    const msgs = Array.isArray(session.messages) ? session.messages : [];
    let lastAssistantMsg = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
            lastAssistantMsg = msgs[i];
            break;
        }
    }

    if (lastAssistantMsg) {
        lastAssistantMsg.filesChanged = turnFiles;
    }

    // 4. Render the UI bar
    renderFilesChangedBar(currentAIMessage, turnFiles, lastAssistantMsg);

    // 5. Persist immediately so it survives restarts
    try {
        saveStoredChats();
    } catch (_) {}
}
