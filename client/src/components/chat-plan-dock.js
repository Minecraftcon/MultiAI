/* =========================================================
   DUAL DOCK COMPONENT (CHATBOX DOCK)
   Mounts over composer in #chatboxDock.
   - Bottom Toolbar:
       - File icon (unaccepted changes count)
       - Task-list icon (pending tasks count; hidden if none)
       - Accept Changes button (only when active changes exist)
   - Expandable Windows:
       - Changes Window (workspace relative paths, +lines -lines, view diff, revert)
       - Task Window (checklist)
       - Mobile-style Back button (←) to return/collapse
   - Backed by Shadow Git Engine
   ========================================================= */

import { state } from "../state/index.js";
import { escapeHTML } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { renderDiffCardHtml, bindDiffViewerCards } from "./diff-viewer.js";

let activeTodos = null;
let unacceptedChanges = [];
let activeTab = null; // null (collapsed toolbar), "changes", or "tasks"
let autoDismissTimer = null;
let userManuallyToggled = false;

/**
 * Initializes the dock listeners and fetches initial state.
 */
export function initPlanDock() {
    document.addEventListener("todosUpdated", (e) => {
        const { chatId, todos } = e.detail || {};
        if (!chatId || chatId === state.currentChatId) {
            activeTodos = Array.isArray(todos) ? todos : null;
            syncDockState();
        }
    });

    document.addEventListener("changesUpdated", () => {
        fetchUnacceptedChanges().then(() => syncDockState());
    });

    // Check changes on initial load and chat switch
    fetchUnacceptedChanges().then(() => {
        if (state.currentChatId && state.chatSessions?.[state.currentChatId]?.todos) {
            activeTodos = state.chatSessions[state.currentChatId].todos;
        }
        syncDockState();
    });
}/**
 * Synchronizes dock state with the active chat session.
 */
export function syncPlanDock(chatId = state.currentChatId) {
    if (!chatId || !state.chatSessions?.[chatId]) {
        activeTodos = null;
    } else {
        activeTodos = state.chatSessions[chatId].todos || null;
    }

    fetchUnacceptedChanges().then(() => {
        syncDockState();
    });
}

/**
 * Fetches unaccepted changes from the Shadow Git endpoint.
 */
async function fetchUnacceptedChanges() {
    try {
        const chatId = state.currentChatId || "";
        const res = await fetch(`/api/history/changes?chatId=${encodeURIComponent(chatId)}`);
        if (res.ok) {
            const data = await res.json();
            unacceptedChanges = Array.isArray(data.files) ? data.files : [];
        }
    } catch (_) {
        unacceptedChanges = [];
    }
}

/**
 * Evaluates active tasks and unaccepted changes, rendering or dismissing dock.
 */
function syncDockState() {
    renderDock();
}

let isTransitioning = false;

/**
 * Dismisses and removes the plan dock card from the DOM.
 */
export function dismissPlanDock() {
    if (autoDismissTimer) {
        clearTimeout(autoDismissTimer);
        autoDismissTimer = null;
    }
    isTransitioning = false;
    activeTab = null;
    userManuallyToggled = false;
    const card = document.getElementById("planDockCard");
    if (card) {
        card.classList.add("closing");
        setTimeout(() => {
            if (card && card.parentNode) card.remove();
        }, 180);
    }
}

/**
 * Transitions smoothly between tabs, back to toolbar, or between windows.
 */
function transitionToTab(newTab) {
    if (isTransitioning) return;
    const card = document.getElementById("planDockCard");
    if (!card) {
        activeTab = newTab;
        renderDock();
        return;
    }

    const currentWindowView = card.querySelector(".dock-window-view");
    const currentToolbar = card.querySelector(".dock-bottom-toolbar");

    // Case 1: Back from expanded window to floating toolbar
    if (activeTab !== null && newTab === null && currentWindowView) {
        isTransitioning = true;
        currentWindowView.classList.add("is-closing");
        setTimeout(() => {
            activeTab = null;
            renderDock({ entering: "toolbar" });
            isTransitioning = false;
        }, 150);
        return;
    }

    // Case 2: Opening from floating toolbar to window
    if (activeTab === null && newTab !== null && currentToolbar) {
        isTransitioning = true;
        currentToolbar.classList.add("is-closing");
        setTimeout(() => {
            activeTab = newTab;
            renderDock({ entering: "window" });
            isTransitioning = false;
        }, 100);
        return;
    }

    // Case 3: Switching between open windows (e.g. changes <-> tasks)
    if (activeTab !== null && newTab !== null && activeTab !== newTab && currentWindowView) {
        isTransitioning = true;
        currentWindowView.classList.add("is-switching-out");
        setTimeout(() => {
            activeTab = newTab;
            renderDock({ entering: "window-switch" });
            isTransitioning = false;
        }, 110);
        return;
    }

    // Case 4: Toggle off currently active tab
    if (activeTab !== null && newTab === activeTab && currentWindowView) {
        transitionToTab(null);
        return;
    }

    // Fallback
    activeTab = newTab;
    renderDock();
}

/**
 * Renders the integrated dock.
 */
function renderDock(transitionMeta = {}) {
    const dock = document.getElementById("chatboxDock");
    if (!dock || !dock.parentNode) return;

    let card = document.getElementById("planDockCard");
    if (!card) {
        card = document.createElement("div");
        card.id = "planDockCard";
        card.className = "plan-dock-card";
        dock.parentNode.insertBefore(card, dock);
    } else {
        card.classList.remove("closing");
        if (card.nextSibling !== dock) {
            dock.parentNode.insertBefore(card, dock);
        }
    }

    const totalTasks = Array.isArray(activeTodos) ? activeTodos.length : 0;
    const completedTasks = totalTasks > 0 ? activeTodos.filter(t => t.status === "completed").length : 0;
    const hasTodos = totalTasks > 0;
    const hasActiveTasks = totalTasks > 0 && completedTasks < totalTasks;
    const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const isWindowOpen = activeTab !== null;
    card.classList.toggle("is-collapsed", !isWindowOpen);
    card.classList.toggle("is-expanded", isWindowOpen);

    const windowAnimClass = transitionMeta.entering === 'window' ? 'is-entering' : (transitionMeta.entering === 'window-switch' ? 'is-switching-in' : '');

    // ── 1. Window HTML (when activeTab is open) ─────────────────
    let windowHtml = "";
    if (activeTab === "changes") {
        const hasUnaccepted = unacceptedChanges.length > 0;
        windowHtml = `
            <div class="dock-window-view ${windowAnimClass}">
                <!-- Top: The Changes Box (HAS BG) -->
                <div class="dock-changes-box">
                    <div class="dock-changes-list" role="list">
                        ${hasUnaccepted ? unacceptedChanges.map(f => {
                            const cleanPath = f.displayPath || f.path;
                            const slashIdx = cleanPath.lastIndexOf("/");
                            const fileName = slashIdx !== -1 ? cleanPath.slice(slashIdx + 1) : cleanPath;
                            const dirPath = cleanPath;
                            return `
                                <div class="dock-change-row" role="listitem" data-path="${escapeHTML(f.path)}" data-workspace="${escapeHTML(f.workspace || '')}">
                                    <div class="dock-change-left" title="${escapeHTML(f.workspace ? `${f.workspace}/${f.path}` : f.path)}">
                                        <span class="dock-change-status-dot ${f.isNew ? 'is-new' : 'is-modified'}">
                                            <i data-lucide="${f.isNew ? 'plus-circle' : 'circle-dot'}"></i>
                                        </span>
                                        <span class="dock-diff-pill add">+${f.additions}</span>
                                        <span class="dock-diff-pill del">-${f.deletions}</span>
                                        <span class="dock-file-name">${escapeHTML(fileName)}</span>
                                        <span class="dock-file-dir">${escapeHTML(dirPath)}</span>
                                    </div>
                                    <div class="dock-change-actions">
                                        <button type="button" class="dock-row-action-btn dock-view-diff-btn" title="View Diff" data-path="${escapeHTML(f.path)}" data-workspace="${escapeHTML(f.workspace || '')}">
                                            <i data-lucide="eye"></i>
                                        </button>
                                        <button type="button" class="dock-row-action-btn dock-revert-file-btn" title="Reject File" data-path="${escapeHTML(f.path)}" data-workspace="${escapeHTML(f.workspace || '')}">
                                            <i data-lucide="rotate-ccw"></i>
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join("") : `
                            <div class="dock-empty-changes">
                                <span>No files with changes</span>
                            </div>
                        `}
                    </div>
                </div>

                <!-- Bottom: The Bar (NO BG) -->
                <div class="dock-window-header dock-changes-bar">
                    <div class="dock-window-header-left">
                        <button type="button" class="dock-back-btn" title="Back" aria-label="Back">
                            <i data-lucide="arrow-left"></i>
                        </button>
                        <i data-lucide="file-text" class="dock-bar-file-icon"></i>
                        <span class="dock-window-title"><span class="dock-title-count">${unacceptedChanges.length}</span> <span class="dock-title-full">${unacceptedChanges.length === 1 ? 'File' : 'Files'} With Changes</span><span class="dock-title-short">${unacceptedChanges.length === 1 ? 'Change' : 'Changes'}</span></span>
                    </div>
                    <div class="dock-window-header-right">
                        <button type="button" class="dock-reject-all-btn" title="Reject all unaccepted changes" ${!hasUnaccepted ? "disabled" : ""}>
                            <span>Reject all</span>
                        </button>
                        <button type="button" class="dock-accept-all-btn" title="Accept all changes" ${!hasUnaccepted ? "disabled" : ""}>
                            <span>Accept all</span>
                            <i data-lucide="chevron-down"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    } else if (activeTab === "tasks") {
        windowHtml = `
            <div class="dock-window-view ${windowAnimClass}">
                <!-- Top: The Tasks Box (HAS BG) -->
                <div class="dock-tasks-box">
                    <div class="plan-dock-list" role="list">
                        ${hasTodos ? activeTodos.map(t => {
                            const isDone = t.status === "completed";
                            const isProg = t.status === "in_progress";
                            const iconHtml = isDone
                                ? `<i data-lucide="check" class="plan-lucide-check" aria-hidden="true"></i>`
                                : (isProg
                                    ? `<i data-lucide="loader-2" class="plan-lucide-spin" aria-hidden="true"></i>`
                                    : `<i data-lucide="circle" class="plan-lucide-circle" aria-hidden="true"></i>`);
                            const itemClass = isDone ? "is-completed" : (isProg ? "is-in-progress" : "is-pending");
                            return `
                                <div class="plan-dock-item ${itemClass}" role="listitem">
                                    <span class="plan-dock-item-status">${iconHtml}</span>
                                    <span class="plan-dock-item-content">${escapeHTML(t.content)}</span>
                                </div>
                            `;
                        }).join("") : `
                            <div class="dock-empty-changes">
                                <span>No active tasks</span>
                            </div>
                        `}
                    </div>
                </div>

                <!-- Bottom: The Bar (NO BG) -->
                <div class="dock-window-header dock-tasks-bar">
                    <div class="dock-window-header-left">
                        <button type="button" class="dock-back-btn" title="Back" aria-label="Back">
                            <i data-lucide="arrow-left"></i>
                        </button>
                        <i data-lucide="list-todo" class="dock-bar-task-icon"></i>
                        <span class="dock-window-title"><span class="dock-title-full">Planning (${completedTasks}/${totalTasks})</span><span class="dock-title-short">Plan (${completedTasks}/${totalTasks})</span></span>
                    </div>
                    <div class="dock-window-header-right">
                        <span class="plan-dock-pct-pill">${pct}%</span>
                    </div>
                </div>
            </div>
        `;
    }

    // ── 2. Bottom Toolbar HTML (When closed, compact floating icons) ─────
    const hasChanges = unacceptedChanges.length > 0;
    const toolbarAnimClass = transitionMeta.entering === 'toolbar' ? 'is-entering' : '';

    const toolbarHtml = `
        <div class="dock-bottom-toolbar ${toolbarAnimClass}">
            <div class="dock-toolbar-left">
                <!-- File Icon for changes -->
                <button type="button" class="dock-tab-btn ${activeTab === 'changes' ? 'is-active' : ''} ${hasChanges ? 'has-changes' : ''}" data-tab="changes" title="Unaccepted Changes">
                    <i data-lucide="file-text"></i>
                    ${hasChanges ? `<span class="dock-tab-badge">${unacceptedChanges.length}</span>` : ""}
                </button>

                <!-- Task-list icon (show if tasks exist, keep it simple without 5/7 badge) -->
                ${hasTodos ? `
                    <button type="button" class="dock-tab-btn ${activeTab === 'tasks' ? 'is-active' : ''}" data-tab="tasks" title="Active Plan">
                        <i data-lucide="list-todo"></i>
                    </button>
                ` : ""}
            </div>

            <div class="dock-toolbar-right">
                <!-- Accept Changes Button (ONLY appears when active changes exist AND window is closed) -->
                ${hasChanges ? `
                    <button type="button" class="dock-accept-btn" title="Accept all changes and update ledger">
                        <i data-lucide="check"></i>
                        <span>Accept Changes</span>
                    </button>
                ` : ""}
            </div>
        </div>
    `;

    // When an option is opened, show the window view (which has the bar at the bottom); otherwise show floating icons
    card.innerHTML = isWindowOpen ? windowHtml : toolbarHtml;

    // ── 3. Wire Event Listeners ────────────────────────────────
    // Back button
    const backBtn = card.querySelector(".dock-back-btn");
    if (backBtn) {
        backBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            userManuallyToggled = true;
            transitionToTab(null);
        });
    }

    // Tab buttons
    card.querySelectorAll(".dock-tab-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            userManuallyToggled = true;
            const tab = btn.getAttribute("data-tab");
            if (activeTab === tab) {
                transitionToTab(null);
            } else {
                transitionToTab(tab);
            }
        });
    });

    // Accept All / Accept Button
    card.querySelectorAll(".dock-accept-btn, .dock-accept-all-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            btn.disabled = true;
            try {
                const res = await fetch("/api/history/accept", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chatId: state.currentChatId || "" })
                });
                if (res.ok) {
                    await fetchUnacceptedChanges();
                    if (activeTab === "changes") {
                        transitionToTab(null);
                    } else {
                        syncDockState();
                    }
                }
            } catch (err) {
                console.error("[Dock] Accept failed:", err);
            } finally {
                btn.disabled = false;
            }
        });
    });

    // Reject All Button
    card.querySelectorAll(".dock-revert-all-btn, .dock-reject-all-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!confirm("Are you sure you want to reject all unaccepted file changes?")) return;
            try {
                const res = await fetch("/api/history/revert", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chatId: state.currentChatId || "" })
                });
                if (res.ok) {
                    await fetchUnacceptedChanges();
                    syncDockState();
                }
            } catch (err) {
                console.error("[Dock] Reject all failed:", err);
            }
        });
    });

    // Row Revert File Button
    card.querySelectorAll(".dock-revert-file-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const filePath = btn.getAttribute("data-path");
            const workspace = btn.getAttribute("data-workspace") || "";
            if (!filePath) return;
            if (!confirm(`Revert unaccepted changes in ${filePath}?`)) return;
            try {
                const res = await fetch("/api/history/revert", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chatId: state.currentChatId || "", path: filePath, workspace })
                });
                if (res.ok) {
                    await fetchUnacceptedChanges();
                    syncDockState();
                }
            } catch (err) {
                console.error("[Dock] Revert file failed:", err);
            }
        });
    });

    // Row View Diff Button
    card.querySelectorAll(".dock-view-diff-btn, .dock-change-left").forEach(el => {
        el.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const filePath = el.getAttribute("data-path") || el.closest(".dock-change-row")?.getAttribute("data-path");
            const workspace = el.getAttribute("data-workspace") || el.closest(".dock-change-row")?.getAttribute("data-workspace") || "";
            if (!filePath) return;
            openDiffModal(filePath, workspace);
        });
    });

    renderIcons(card);
}

/**
 * Opens a modal viewing the unified diff for a given file.
 */
async function openDiffModal(filePath, workspace = "") {
    try {
        let diffUrl = `/api/history/diff?chatId=${encodeURIComponent(state.currentChatId || "")}&path=${encodeURIComponent(filePath)}`;
        if (workspace) {
            diffUrl += `&workspace=${encodeURIComponent(workspace)}`;
        }
        const res = await fetch(diffUrl);
        if (!res.ok) return;
        const data = await res.json();
        const diffText = data.diff || "";

        let overlay = document.getElementById("dockDiffOverlay");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "dockDiffOverlay";
            overlay.className = "dock-diff-overlay modal-backdrop";
            document.body.appendChild(overlay);
        }

        overlay.innerHTML = `
            <div class="dock-diff-modal modal-card">
                <div class="dock-diff-modal-header">
                    <span class="dock-diff-modal-title">Diff: ${escapeHTML(filePath)}</span>
                    <button type="button" class="dock-diff-close-btn" aria-label="Close">
                        <i data-lucide="x"></i>
                    </button>
                </div>
                <div class="dock-diff-modal-body">
                    ${renderDiffCardHtml({ diffStr: diffText, filePath })}
                </div>
            </div>
        `;

        const closeBtn = overlay.querySelector(".dock-diff-close-btn");
        const closeModal = () => { overlay.remove(); };
        if (closeBtn) closeBtn.addEventListener("click", closeModal);
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeModal();
        });

        bindDiffViewerCards(overlay);
        renderIcons(overlay);
    } catch (err) {
        console.error("[Dock] Open diff modal error:", err);
    }
}
