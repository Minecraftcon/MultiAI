/* =========================================================
   SUBAGENTS SIDEBAR PANEL & DIRECT CHAT COORDINATOR
   Allows selecting and directly chatting with subagent personas
   (Designer, Researcher, Auditor, Tester, General Purpose).
   ========================================================= */
import { state } from "../state/index.js";
import { saveStoredChats } from "../services/storage.js";
import { switchToChat, deleteChatSession } from "./chat-history-list.js";
import { SUBAGENT_PERSONAS } from "../agent/subagent.js";
import { renderIcons, escapeHTML } from "../utils/dom.js";
import { closePanel } from "./gestures.js";

export const SUBAGENT_CATALOG = [
    {
        id: "designer",
        name: "Designer",
        role: "UI/UX & Web Design",
        desc: "Interfaces, modern HTML/CSS & live preview pane",
        icon: "palette",
        badge: "Live Preview",
        welcome: "I am your Designer subagent. I specialize in designing and prototyping modern interfaces, HTML/CSS styling, responsive layouts, and rendering live previews right in your preview pane.\n\nTell me what interface or component you would like to create or style!"
    },
    {
        id: "researcher",
        name: "Researcher",
        role: "Deep Investigation",
        desc: "Web search, citations, synthesis & topic investigation",
        icon: "compass",
        badge: "Search & Citations",
        welcome: "I am your Researcher subagent. I conduct multi-angle web research, fetch and read web sources, and synthesize comprehensive, well-cited reports.\n\nWhat topic, question, or technology should I research for you?"
    },
    {
        id: "auditor",
        name: "Auditor",
        role: "Code Inspection",
        desc: "Codebase exploration, security, flow analysis & debugging",
        icon: "shield-check",
        badge: "Inspection",
        welcome: "I am your Auditor subagent. I inspect codebases, trace control flow, and identify vulnerabilities, bugs, and edge cases without making unauthorized changes.\n\nWhich file, module, or issue should I inspect?"
    },
    {
        id: "tester",
        name: "Tester",
        role: "Validation & Tests",
        desc: "Terminal task execution, test suite verification & reporting",
        icon: "terminal",
        badge: "Runner",
        welcome: "I am your Tester subagent. I run terminal test commands, verify test suites and runtime behaviors, and report back diagnostic output.\n\nWhat tests or command verification would you like me to run?"
    },
    {
        id: "general-purpose",
        name: "General Purpose",
        role: "Autonomous Execution",
        desc: "Multi-step autonomous task execution & structured reporting",
        icon: "bot",
        badge: "Full Access",
        welcome: "I am your General Purpose autonomous subagent. I can execute multi-step file operations, commands, and tasks, then summarize findings in a structured report.\n\nHow can I help you today?"
    }
];

/**
 * Starts or switches to a direct chat with a selected subagent persona.
 *
 * @param {string} [subagentType="designer"]
 */
export async function startFreshSubagentChat(subagentType = "designer") {
    const persona = SUBAGENT_CATALOG.find(p => p.id === subagentType) || SUBAGENT_CATALOG[0];
    const personaPrompt = SUBAGENT_PERSONAS[subagentType] || SUBAGENT_PERSONAS["general-purpose"];

    // If current chat is already an empty subagent chat of this exact persona, reuse it
    const curId = state.currentChatId;
    const curSession = curId ? state.chatSessions[curId] : null;
    if (curSession && curSession.isSubagent && curSession.subagentType === subagentType) {
        const hasUser = curSession.messages?.some(m => m.role === "user");
        if (!hasUser) {
            closePanel();
            renderSubagentsList();
            return curSession;
        }
    }

    const newId = `subagent_chat_${Date.now()}`;
    const modelSelect = typeof document !== "undefined" ? document.getElementById("modelSelect") : null;
    const currentModel = modelSelect?.value || null;
    const currentProvider = modelSelect?.selectedOptions?.[0]?.dataset?.provider || null;

    const systemPrompt = `${personaPrompt}\n\n[SUBAGENT GUIDELINES]:
1. You are communicating directly with the user as their dedicated ${persona.name} subagent.
2. Execute tool calls (e.g. read_file, write_file, show_html_preview, run_task) directly to complete their requests.
3. If designing or creating an interface, write the code using write_file and call show_html_preview to render it live for the user.
4. Conclude your responses clearly and concisely.`;

    const newSession = {
        id: newId,
        title: `${persona.name} Subagent`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: currentModel,
        provider: currentProvider,
        isSubagent: true,
        subagentType: subagentType,
        messages: [
            { role: "system", content: systemPrompt }
        ]
    };

    state.chatSessions[newId] = newSession;
    saveStoredChats();
    await switchToChat(newId);
    closePanel();
    renderSubagentsList();
    return newSession;
}

/**
 * Renders the available subagents and ongoing subagent chats in the side panel.
 */
export function renderSubagentsList() {
    const container = document.getElementById("subagentList");
    if (!container) return;

    const curSession = state.currentChatId ? state.chatSessions[state.currentChatId] : null;
    const activePersona = curSession?.isSubagent ? curSession.subagentType : null;

    // 1. Available Subagent Personas Grid
    let html = `
        <div class="subagent-section-label">Available Subagents</div>
        <div class="subagent-cards-container">
    `;

    SUBAGENT_CATALOG.forEach(p => {
        const isActive = activePersona === p.id;
        html += `
            <div class="subagent-persona-card ${isActive ? 'active' : ''}" data-subagent-id="${escapeHTML(p.id)}" role="button" tabindex="0" title="Chat directly with ${escapeHTML(p.name)}">
                <div class="subagent-card-row">
                    <div class="subagent-card-left">
                        <div class="subagent-icon-badge">
                            <i data-lucide="${p.icon}"></i>
                        </div>
                        <span class="subagent-name-text">${escapeHTML(p.name)}</span>
                    </div>
                    <span class="subagent-pill-tag">${escapeHTML(p.badge)}</span>
                </div>
                <div class="subagent-card-summary">${escapeHTML(p.desc)}</div>
            </div>
        `;
    });

    html += `</div>`;

    // 2. Subagent Conversations List
    const allSessions = Object.values(state.chatSessions || {});
    const subagentChats = allSessions.filter(s => s && s.isSubagent);
    subagentChats.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

    html += `
        <div class="subagent-chats-section">
            <div class="subagent-section-label">Subagent Chats (${subagentChats.length})</div>
            <div class="subagent-chats-container">
    `;

    if (subagentChats.length === 0) {
        html += `<div class="subagent-empty-hint">Click a subagent above to start chatting</div>`;
    } else {
        subagentChats.forEach(s => {
            const isCur = s.id === state.currentChatId;
            const pInfo = SUBAGENT_CATALOG.find(p => p.id === s.subagentType) || { icon: "bot", name: "Agent" };
            const cleanTitle = s.title || `${pInfo.name} Subagent`;
            html += `
                <div class="subagent-chat-row ${isCur ? 'active' : ''}" data-chat-id="${escapeHTML(s.id)}" role="button" tabindex="0">
                    <div class="subagent-chat-info">
                        <i data-lucide="${pInfo.icon}"></i>
                        <span class="subagent-chat-title-text" title="${escapeHTML(cleanTitle)}">${escapeHTML(cleanTitle)}</span>
                    </div>
                    <button type="button" class="subagent-chat-del-btn" data-del-id="${escapeHTML(s.id)}" title="Delete chat" aria-label="Delete chat">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            `;
        });
    }

    html += `
            </div>
        </div>
    `;

    container.innerHTML = html;
    renderIcons(container);

    // Event Bindings: Click persona card to start/switch direct subagent chat
    container.querySelectorAll(".subagent-persona-card").forEach(card => {
        const id = card.getAttribute("data-subagent-id");
        card.addEventListener("click", () => {
            if (id) startFreshSubagentChat(id);
        });
        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (id) startFreshSubagentChat(id);
            }
        });
    });

    // Event Bindings: Click subagent chat row to resume
    container.querySelectorAll(".subagent-chat-row").forEach(row => {
        const chatId = row.getAttribute("data-chat-id");
        row.addEventListener("click", (e) => {
            if (e.target.closest(".subagent-chat-del-btn")) return;
            if (chatId) {
                switchToChat(chatId);
                closePanel();
                renderSubagentsList();
            }
        });
    });

    // Event Bindings: Delete subagent chat
    container.querySelectorAll(".subagent-chat-del-btn").forEach(btn => {
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
 * Initializes listeners for the subagents panel.
 */
export function initSubagentsPanelListeners() {
    const newBtn = document.getElementById("newSubagentChatBtn");
    if (newBtn) {
        newBtn.addEventListener("click", () => {
            startFreshSubagentChat("designer");
        });
    }

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
