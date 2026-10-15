/* =========================================================
   PLAN DOCK COMPONENT (CHATBOX DOCK)
   Mounts over composer in #chatboxDock.
   Shows full plan progress list, smoothly collapses to
   the active/first task with the spinning loader.
   ========================================================= */

import { state } from "../state/index.js";
import { escapeHTML } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";

let activeTodos = null;
let autoCollapseTimer = null;
let autoDismissTimer = null;
let isExpanded = false;
let userManuallyToggled = false;

/**
 * Initializes the plan dock listeners and checks initial state.
 */
export function initPlanDock() {
    document.addEventListener("todosUpdated", (e) => {
        const { chatId, todos } = e.detail || {};
        if (!chatId || chatId === state.currentChatId) {
            renderPlanDock(todos, { autoCollapse: true });
        }
    });

    if (state.currentChatId && state.chatSessions?.[state.currentChatId]?.todos) {
        syncPlanDock(state.currentChatId);
    }
}

/**
 * Synchronizes the plan dock with the given chat session.
 *
 * @param {string} [chatId]
 */
export function syncPlanDock(chatId = state.currentChatId) {
    if (!chatId || !state.chatSessions?.[chatId]) {
        dismissPlanDock();
        return;
    }
    const todos = state.chatSessions[chatId].todos;
    if (Array.isArray(todos) && todos.length > 0) {
        const allDone = todos.every(t => t.status === "completed");
        if (allDone) {
            dismissPlanDock();
        } else {
            renderPlanDock(todos, { autoCollapse: false, startCollapsed: true });
        }
    } else {
        dismissPlanDock();
    }
}

/**
 * Dismisses and removes the plan dock card from the DOM.
 */
export function dismissPlanDock() {
    clearTimers();
    activeTodos = null;
    isExpanded = false;
    userManuallyToggled = false;
    const card = document.getElementById("planDockCard");
    if (card) {
        card.classList.add("closing");
        setTimeout(() => {
            if (card && card.parentNode) card.remove();
        }, 180);
    }
}

function clearTimers() {
    if (autoCollapseTimer) {
        clearTimeout(autoCollapseTimer);
        autoCollapseTimer = null;
    }
    if (autoDismissTimer) {
        clearTimeout(autoDismissTimer);
        autoDismissTimer = null;
    }
}

/**
 * Renders or updates the plan dock card.
 *
 * @param {Array<Object>} todos
 * @param {Object} [options]
 * @param {boolean} [options.autoCollapse=false]
 * @param {boolean} [options.startCollapsed=false]
 */
export function renderPlanDock(todos, options = {}) {
    clearTimers();

    if (!Array.isArray(todos) || todos.length === 0) {
        dismissPlanDock();
        return;
    }

    activeTodos = todos;
    const dock = document.getElementById("chatboxDock");
    if (!dock || !dock.parentNode) return;

    let card = document.getElementById("planDockCard");
    const isNewCard = !card;

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

    const total = todos.length;
    const completed = todos.filter(t => t.status === "completed").length;
    const pct = Math.round((completed / total) * 100);
    const allDone = total > 0 && completed === total;

    // Active task to highlight in collapsed header
    const activeTask = todos.find(t => t.status === "in_progress") || 
                       todos.find(t => t.status === "pending") || 
                       todos[0];

    if (options.startCollapsed) {
        isExpanded = false;
    } else if (isNewCard || (!userManuallyToggled && options.autoCollapse)) {
        isExpanded = true;
    }

    updateCardDOM(card, { todos, total, completed, pct, allDone, activeTask });

    if (allDone) {
        autoDismissTimer = setTimeout(() => {
            dismissPlanDock();
        }, 3800);
    } else if (isExpanded && options.autoCollapse && !userManuallyToggled) {
        autoCollapseTimer = setTimeout(() => {
            if (!userManuallyToggled && isExpanded) {
                isExpanded = false;
                const c = document.getElementById("planDockCard");
                if (c && activeTodos) {
                    updateCardDOM(c, { todos: activeTodos, total, completed, pct, allDone, activeTask });
                }
            }
        }, 3200);
    }
}

/**
 * Updates DOM structure for either expanded or collapsed state.
 */
function updateCardDOM(card, { todos, total, completed, pct, allDone, activeTask }) {
    card.classList.toggle("is-collapsed", !isExpanded);
    card.classList.toggle("is-expanded", isExpanded);

    if (!isExpanded) {
        // Floating Collapsed View: Minimal typography & Lucide spinner over dark gradient
        const statusIcon = allDone
            ? `<i data-lucide="check" class="plan-lucide-check" aria-label="Completed"></i>`
            : `<i data-lucide="loader-2" class="plan-lucide-spin" aria-label="In progress"></i>`;

        const taskText = allDone
            ? `All tasks completed (${completed}/${total})`
            : (activeTask ? activeTask.content : "Task");

        card.innerHTML = `
            <div class="plan-dock-collapsed-bar" role="button" tabindex="0" aria-expanded="false" title="Click to view full plan">
                <div class="plan-dock-collapsed-left">
                    <span class="plan-dock-item-status">${statusIcon}</span>
                    <span class="plan-dock-collapsed-label">${escapeHTML(taskText)}</span>
                </div>
                <div class="plan-dock-collapsed-right">
                    <span class="plan-dock-progress-pill">${completed}/${total}</span>
                    <span class="plan-dock-expand-icon" aria-hidden="true">
                        <i data-lucide="chevron-up"></i>
                    </span>
                </div>
            </div>
        `;

        const bar = card.querySelector(".plan-dock-collapsed-bar");
        if (bar) {
            const toggleOpen = (e) => {
                e.preventDefault();
                userManuallyToggled = true;
                clearTimers();
                isExpanded = true;
                updateCardDOM(card, { todos, total, completed, pct, allDone, activeTask });
            };
            bar.addEventListener("click", toggleOpen);
            bar.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") toggleOpen(e);
            });
        }
    } else {
        // Floating Expanded View: Minimal header 'Task {percentage} 2/7' and clean Lucide list
        card.innerHTML = `
            <div class="plan-dock-expanded-view">
                <div class="plan-dock-header" role="button" tabindex="0" aria-expanded="true" title="Click to collapse plan">
                    <div class="plan-dock-title-wrap">
                        <span class="plan-dock-title">Task</span>
                        <span class="plan-dock-pct-pill">${pct}%</span>
                    </div>
                    <div class="plan-dock-header-actions">
                        <span class="plan-dock-progress-pill">${completed}/${total}</span>
                        <button type="button" class="plan-dock-toggle-btn" aria-label="Collapse plan" title="Collapse plan">
                            <i data-lucide="chevron-down"></i>
                        </button>
                    </div>
                </div>

                <div class="plan-dock-list" role="list">
                    ${todos.map(t => {
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
                    }).join("")}
                </div>
            </div>
        `;

        const toggleClose = (e) => {
            e.preventDefault();
            e.stopPropagation();
            userManuallyToggled = true;
            clearTimers();
            isExpanded = false;
            updateCardDOM(card, { todos, total, completed, pct, allDone, activeTask });
        };

        const header = card.querySelector(".plan-dock-header");
        const btn = card.querySelector(".plan-dock-toggle-btn");
        if (header) {
            header.addEventListener("click", toggleClose);
            header.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") toggleClose(e);
            });
        }
        if (btn) {
            btn.addEventListener("click", toggleClose);
        }
    }

    renderIcons(card);
}

/* =========================================================
   PREVIOUS BOXED CARD DOM BUILDER (PRESERVED / COMMENTED OUT)
   =========================================================
function updateCardDOMBoxed(card, { todos, total, completed, pct, allDone, activeTask }) {
    card.classList.toggle("is-collapsed", !isExpanded);
    card.classList.toggle("is-expanded", isExpanded);

    if (!isExpanded) {
        const statusIcon = allDone
            ? `<span class="plan-dock-check-icon" aria-label="Completed">✓</span>`
            : `<span class="plan-dock-spinner" aria-label="In progress"></span>`;
        const taskText = allDone
            ? `All tasks completed (${completed}/${total})`
            : (activeTask ? activeTask.content : "Task plan");

        card.innerHTML = `
            <div class="plan-dock-collapsed-bar" role="button" tabindex="0" aria-expanded="false" title="Click to view full plan">
                <div class="plan-dock-collapsed-left">
                    <span class="plan-dock-item-status">${statusIcon}</span>
                    <span class="plan-dock-collapsed-label">${escapeHTML(taskText)}</span>
                </div>
                <div class="plan-dock-collapsed-right">
                    <span class="plan-dock-progress-pill">${completed}/${total}</span>
                    <span class="plan-dock-expand-icon" aria-hidden="true">
                        <i data-lucide="chevron-up"></i>
                    </span>
                </div>
            </div>
        `;
    } else {
        card.innerHTML = `
            <div class="plan-dock-expanded-view">
                <div class="plan-dock-header" role="button" tabindex="0" aria-expanded="true" title="Click to collapse plan">
                    <div class="plan-dock-title-wrap">
                        <div class="plan-dock-icon-badge"><i data-lucide="list-todo"></i></div>
                        <span class="plan-dock-title">Implementation Plan</span>
                    </div>
                    <div class="plan-dock-header-actions">
                        <span class="plan-dock-pct-pill">${completed}/${total} (${pct}%)</span>
                        <button type="button" class="plan-dock-toggle-btn"><i data-lucide="chevron-down"></i></button>
                    </div>
                </div>
                <div class="plan-dock-progress-track">
                    <div class="plan-dock-progress-fill" style="width: ${pct}%;"></div>
                </div>
                <div class="plan-dock-list">...</div>
            </div>
        `;
    }
}
========================================================= */
