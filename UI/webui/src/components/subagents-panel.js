/* =========================================================
   SUBAGENTS SIDEBAR PANEL & DIRECT CHAT COORDINATOR
   Subagents are bound to the active main conversation.
   Allows selecting running or finished subagents and directly
   chatting with them on the main panel (same UI as MultiAI).
   ========================================================= */
import { state } from "../state/index.js";
import { saveStoredChats } from "../services/storage.js";
import { switchToChat, deleteChatSession } from "./chat-history-list.js";
import { getActiveSubagents, SUBAGENT_PERSONAS } from "../agent/subagent.js";
import { renderIcons, escapeHTML } from "../utils/dom.js";
import { closePanel } from "./gestures.js";

/**
 * Returns the currently active main conversation ID.
 * If currently viewing a subagent chat, returns its parentChatId.
 */
export function getActiveMainChatId() {
    const curId = state.currentChatId;
    if (!curId) return null;
    const cur = state.chatSessions[curId];
    if (cur && cur.isSubagent && cur.parentChatId) {
        return cur.parentChatId;
    }
    return curId;
}

/**
 * Recovers any past subagents from the main conversation's messages
 * (e.g. from tool_calls to invoke_subagent or task) so past subagents are preserved.
 */
function recoverPastSubagentsFromMainChat(mainChatId) {
    if (!mainChatId || !state.chatSessions[mainChatId]) return;
    const mainSession = state.chatSessions[mainChatId];
    const msgs = mainSession.messages || [];

    for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
            for (const call of m.tool_calls) {
                if (call.function?.name === "invoke_subagent" || call.function?.name === "task") {
                    const subagentId = "subagent_" + call.id;
                    if (!state.chatSessions[subagentId]) {
                        let args = {};
                        try {
                            args = JSON.parse(call.function?.arguments || "{}");
                        } catch (_) {}
                        const taskText = args.task || args.instruction || args.prompt || "Subagent task";
                        const subType = args.subagent_type || args.type || "designer";

                        // Find corresponding tool result message
                        const toolMsg = msgs.slice(i + 1).find(tm => tm.role === "tool" && tm.tool_call_id === call.id);
                        let repText = "";
                        if (toolMsg && toolMsg.content) {
                            try {
                                const parsed = JSON.parse(toolMsg.content);
                                repText = parsed.report || parsed.message || toolMsg.content;
                            } catch (_) {
                                repText = toolMsg.content;
                            }
                        }

                        const cleanTitle = `Subagent [${subType}]: ${taskText.slice(0, 35)}${taskText.length > 35 ? '…' : ''}`;
                        const subSession = {
                            id: subagentId,
                            title: cleanTitle,
                            isSubagent: true,
                            subagentType: subType,
                            subagentStatus: "completed",
                            parentChatId: mainChatId,
                            task: taskText,
                            createdAt: mainSession.createdAt || Date.now(),
                            updatedAt: mainSession.updatedAt || Date.now(),
                            model: mainSession.model,
                            provider: mainSession.provider,
                            messages: [
                                { role: "system", content: `You are an expert ${subType} subagent.` },
                                { role: "user", content: taskText },
                                { role: "assistant", content: repText || "Subagent completed task." }
                            ]
                        };
                        state.chatSessions[subagentId] = subSession;
                    }
                }
            }
        }
    }
}

/**
 * Renders the running and finished subagents bound to the active main conversation.
 */
export function renderSubagentsList() {
    const container = document.getElementById("subagentList");
    if (!container) return;

    const mainChatId = getActiveMainChatId();
    if (!mainChatId || !state.chatSessions[mainChatId]) {
        container.innerHTML = `
            <div class="subagent-empty-hint">
                <i data-lucide="bot" style="width:28px; height:28px; opacity:0.4; margin-bottom:8px;"></i>
                <p style="font-weight:600; color:var(--text-primary); margin-bottom:4px;">No conversation selected</p>
                <span>Select a conversation in the Chat tab first to view its bound subagents.</span>
            </div>
        `;
        renderIcons(container);
        return;
    }

    // Recover past subagent calls made in this main conversation
    recoverPastSubagentsFromMainChat(mainChatId);

    const mainSession = state.chatSessions[mainChatId];
    const mainTitle = mainSession.title || "Untitled Conversation";

    // Get all subagents bound to this main conversation
    const allSessions = Object.values(state.chatSessions || {});
    const boundSubagents = allSessions.filter(s => s && s.isSubagent && s.parentChatId === mainChatId);

    // Merge in any actively running subagents for this conversation
    const liveActive = getActiveSubagents().filter(a => a.parentChatId === mainChatId);
    const runningIds = new Set(liveActive.map(a => a.id));

    // Sort into running vs finished
    const runningSubagents = [];
    const finishedSubagents = [];

    boundSubagents.forEach(s => {
        if (s.subagentStatus === "running" || runningIds.has(s.id)) {
            runningSubagents.push(s);
        } else {
            finishedSubagents.push(s);
        }
    });

    finishedSubagents.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

    let html = `
        <div class="subagent-context-bar">
            <div class="subagent-context-info">
                <span class="subagent-context-label">Main conversation</span>
                <span class="subagent-context-title" title="${escapeHTML(mainTitle)}">${escapeHTML(mainTitle)}</span>
            </div>
            <button type="button" class="subagent-context-back-btn" id="subagentBackToMainBtn" title="Return to main chat">
                <i data-lucide="arrow-left"></i>
                <span>Main Chat</span>
            </button>
        </div>
    `;

    // 1. Running Subagents Section
    if (runningSubagents.length > 0) {
        html += `
            <div class="subagent-section-block">
                <div class="subagent-section-label">
                    <span>Running Subagents</span>
                    <span class="subagent-count-badge">${runningSubagents.length}</span>
                </div>
                <div class="subagent-items-list">
        `;
        runningSubagents.forEach(s => {
            const isCur = s.id === state.currentChatId;
            const subType = s.subagentType || "designer";
            const taskText = s.task || s.title || "Subagent task in progress...";
            html += `
                <div class="subagent-bound-card running ${isCur ? 'active' : ''}" data-subagent-id="${escapeHTML(s.id)}" role="button" tabindex="0">
                    <div class="subagent-card-header-row">
                        <div class="subagent-card-title-group">
                            <span class="subagent-persona-chip ${escapeHTML(subType)}">${escapeHTML(subType)}</span>
                            <span class="subagent-live-pulse-badge">
                                <span class="subagent-spinner-dots">
                                    <span class="subagent-spinner-dot"></span>
                                    <span class="subagent-spinner-dot"></span>
                                    <span class="subagent-spinner-dot"></span>
                                    <span class="subagent-spinner-dot"></span>
                                </span>
                                <span>Running</span>
                            </span>
                        </div>
                    </div>
                    <div class="subagent-task-excerpt" title="${escapeHTML(taskText)}">${escapeHTML(taskText)}</div>
                    <div class="subagent-card-footer-row">
                        <span class="subagent-action-hint">Click to chat live →</span>
                    </div>
                </div>
            `;
        });
        html += `</div></div>`;
    }

    // 2. Finished Subagents Section
    if (finishedSubagents.length > 0) {
        html += `
            <div class="subagent-section-block">
                <div class="subagent-section-label">
                    <span>Finished Subagents</span>
                    <span class="subagent-count-badge">${finishedSubagents.length}</span>
                </div>
                <div class="subagent-items-list">
        `;
        finishedSubagents.forEach(s => {
            const isCur = s.id === state.currentChatId;
            const subType = s.subagentType || "designer";
            const taskText = s.task || s.title || "Completed subagent task";
            const dateStr = s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
            html += `
                <div class="subagent-bound-card ${isCur ? 'active' : ''}" data-subagent-id="${escapeHTML(s.id)}" role="button" tabindex="0">
                    <div class="subagent-card-header-row">
                        <div class="subagent-card-title-group">
                            <span class="subagent-persona-chip ${escapeHTML(subType)}">${escapeHTML(subType)}</span>
                            <span class="subagent-status-tag">Completed</span>
                        </div>
                        <button type="button" class="subagent-item-del-btn" data-del-id="${escapeHTML(s.id)}" title="Delete subagent history" aria-label="Delete subagent history">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                    <div class="subagent-task-excerpt" title="${escapeHTML(taskText)}">${escapeHTML(taskText)}</div>
                    <div class="subagent-card-footer-row">
                        <span class="subagent-time-text">${dateStr}</span>
                        <span class="subagent-action-hint">Chat directly →</span>
                    </div>
                </div>
            `;
        });
        html += `</div></div>`;
    }

    if (runningSubagents.length === 0 && finishedSubagents.length === 0) {
        html += `
            <div class="subagent-empty-hint">
                <i data-lucide="bot" style="width:26px; height:26px; opacity:0.4; margin-bottom:8px;"></i>
                <p style="font-weight:600; color:var(--text-primary); margin-bottom:4px;">No subagents in this conversation</p>
                <span>When a subagent runs (e.g. via /render or asking the model to design), it will appear here so you can chat with it directly.</span>
            </div>
        `;
    }

    container.innerHTML = html;
    renderIcons(container);

    // Event Bindings: Return to main chat
    const backBtn = container.querySelector("#subagentBackToMainBtn");
    if (backBtn) {
        backBtn.addEventListener("click", async () => {
            await switchToChat(mainChatId);
            closePanel();
        });
    }

    // Event Bindings: Click subagent card to chat with it directly
    container.querySelectorAll(".subagent-bound-card").forEach(card => {
        const subId = card.getAttribute("data-subagent-id");
        card.addEventListener("click", async (e) => {
            if (e.target.closest(".subagent-item-del-btn")) return;
            if (subId) {
                await switchToChat(subId);
                closePanel();
                renderSubagentsList();
            }
        });
    });

    // Event Bindings: Delete subagent
    container.querySelectorAll(".subagent-item-del-btn").forEach(btn => {
        const delId = btn.getAttribute("data-del-id");
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (delId) {
                deleteChatSession(delId);
                renderSubagentsList();
            }
        });
    });
}

/**
 * Starts a fresh subagent chat session bound to the active main conversation.
 */
export async function startFreshSubagentChat(subagentType = "designer") {
    const mainChatId = getActiveMainChatId();
    const parentSession = mainChatId ? state.chatSessions[mainChatId] : null;
    const subId = "subagent_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
    const pretty = subagentType.charAt(0).toUpperCase() + subagentType.slice(1);
    const modelSelect = typeof document !== "undefined" ? document.getElementById("modelSelect") : null;
    const model = parentSession?.model || modelSelect?.value || "gemini-2.5-flash";
    const provider = parentSession?.provider || modelSelect?.selectedOptions?.[0]?.dataset?.provider || null;

    const newSession = {
        id: subId,
        title: `${pretty} Subagent`,
        isSubagent: true,
        subagentType: subagentType,
        subagentStatus: "idle",
        parentChatId: mainChatId,
        task: `Direct conversation with ${pretty} subagent`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model,
        provider,
        messages: [{ role: "system", content: SUBAGENT_PERSONAS[subagentType] || SUBAGENT_PERSONAS["general-purpose"] }]
    };

    state.chatSessions[subId] = newSession;
    saveStoredChats();
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
        document.dispatchEvent(new CustomEvent("chatsUpdated"));
    }
    await switchToChat(subId);
    return subId;
}

/**
 * Initializes listeners for the subagents panel.
 */
export function initSubagentsPanelListeners() {
    document.addEventListener("chatsUpdated", () => {
        if (state.appMode === "subagents") {
            renderSubagentsList();
        }
    });

    window.addEventListener("app-mode-changed", (e) => {
        if (e.detail?.mode === "subagents" || state.appMode === "subagents") {
            renderSubagentsList();
        }
    });
}
