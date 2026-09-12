/* =========================================================
   CONTEXT MENU (DESKTOP) & MOBILE MESSAGE ACTIONS
   Supports Delete, Branch, and Export on chats & messages
   ========================================================= */
import { state } from "../state.js";
import { isMobileDevice, escapeHTML } from "../utils/dom.js";
import { renderIcons } from "../utils/icons.js";
import { copyTextToClipboard, getMessageTextToCopy } from "../utils/clipboard.js";
import { send, updateSendButtonState } from "./composer.js";
import { generateChatId, saveStoredChats, saveCurrentChatState } from "../services/storage.js";
import { switchToChat, deleteChatSession, renderChatList } from "./side-panel.js";
import { createAIMessageShell } from "./chat-ui.js";
import { runAgent } from "../services/agent.js";
import { logEvent } from "../utils/logger.js";
import { showErrorRecoveryPopup } from "./error-recovery.js";

let contextMenuTargetEl = null;
let contextMenuTargetText = "";
let mobileActionsTargetEl = null;
let chatMenuTargetId = null;

export function hideContextMenu() {
    const msgContextMenu = document.getElementById("msgContextMenu");
    if (msgContextMenu && msgContextMenu.style.display !== "none") {
        msgContextMenu.style.display = "none";
        contextMenuTargetEl = null;
        contextMenuTargetText = "";
    }
}

export function hideChatItemContextMenu() {
    const menu = document.getElementById("chatItemContextMenu");
    if (menu && menu.style.display !== "none") {
        menu.style.display = "none";
        chatMenuTargetId = null;
    }
}

export function hideMobileActions() {
    const mobileMsgActions = document.getElementById("mobileMsgActions");
    if (mobileMsgActions && mobileMsgActions.style.display !== "none") {
        mobileMsgActions.style.display = "none";
        mobileActionsTargetEl = null;
    }
}

export function showMobileActions(msgEl) {
    const mobileMsgActions = document.getElementById("mobileMsgActions");
    const mobileCopyBtn = document.getElementById("mobileCopyBtn");
    const mobileRetryBtn = document.getElementById("mobileRetryBtn");
    if (!msgEl || !mobileMsgActions) return;

    mobileActionsTargetEl = msgEl;
    const isBusy = Boolean(state.currentChatId && state.activeGenerations[state.currentChatId]?.isGenerating);

    if (mobileCopyBtn) {
        mobileCopyBtn.innerHTML = '<i data-lucide="copy"></i>';
    }
    if (mobileRetryBtn) {
        mobileRetryBtn.innerHTML = '<i data-lucide="rotate-cw"></i>';
        mobileRetryBtn.disabled = isBusy;
    }

    mobileMsgActions.style.display = "inline-flex";
    renderIcons(mobileMsgActions);

    const rect = msgEl.getBoundingClientRect();
    const actionsRect = mobileMsgActions.getBoundingClientRect();
    const actionsWidth = actionsRect.width || 76;
    const actionsHeight = actionsRect.height || 36;

    let top = rect.bottom + 6;
    let left = rect.left;

    if (msgEl.classList.contains("user")) {
        left = rect.right - actionsWidth;
    } else {
        left = rect.left + 4;
    }

    const minLeft = 12;
    const maxLeft = window.innerWidth - actionsWidth - 12;
    left = Math.max(minLeft, Math.min(maxLeft, left));

    const composerEl = document.getElementById("inputArea");
    const bottomLimit = composerEl ? composerEl.getBoundingClientRect().top - 8 : window.innerHeight - 70;

    if (top + actionsHeight > bottomLimit) {
        top = Math.max(60, rect.top - actionsHeight - 6);
    }

    mobileMsgActions.style.left = `${left}px`;
    mobileMsgActions.style.top = `${top}px`;
}

/**
 * Exports a conversation session to a clean, formatted Markdown file download
 */
export function exportChatToMarkdown(session) {
    if (!session) return;
    const title = session.title || "Conversation";
    const dateStr = new Date(session.updatedAt || session.createdAt || Date.now()).toLocaleString();
    const model = session.model || "Unknown";

    let md = `# ${title}\n\n`;
    md += `- **Date:** ${dateStr}\n`;
    md += `- **Model:** ${model}\n\n`;
    md += `---\n\n`;

    const messages = session.messages || [];
    for (const msg of messages) {
        if (msg.role === "system") continue;

        const roleName = msg.role === "user" ? "User" : "Assistant";
        md += `### ${roleName}\n\n`;

        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === "text") {
                    md += `${part.text}\n\n`;
                } else if (part.type === "image_url") {
                    md += `*[Attached Image]*\n\n`;
                }
            }
        } else if (typeof msg.content === "string") {
            md += `${msg.content}\n\n`;
        }

        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
            for (const tc of msg.tool_calls) {
                md += `> **Action:** \`${tc.function?.name}\`\n\n`;
            }
        }
    }

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = title.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 30) || "chat";
    a.download = `${safeName}.md`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 150);
}

/**
 * Clones the full chat conversation into a new branched session
 */
export function branchChatSession(chatId) {
    const original = state.chatSessions[chatId];
    if (!original) return;

    if (state.currentChatId && state.chatSessions[state.currentChatId]) {
        saveCurrentChatState();
    }

    const newId = generateChatId();
    const originalTitle = original.title || "Conversation";
    const newTitle = originalTitle.endsWith(" (Branch)") ? originalTitle : `${originalTitle} (Branch)`;

    state.chatSessions[newId] = {
        id: newId,
        title: newTitle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: original.model,
        messages: JSON.parse(JSON.stringify(original.messages || [])),
        chatHtml: original.chatHtml || ""
    };

    saveStoredChats();
    renderChatList();
    switchToChat(newId);
}

/**
 * Branches the conversation from a specific message element up to that point
 */
export function branchFromMessage(targetMsgEl) {
    if (!targetMsgEl || !state.currentChatId) return;
    const session = state.chatSessions[state.currentChatId];
    if (!session) return;
    const chat = document.getElementById("chat");
    if (!chat) return;

    saveCurrentChatState();

    const allMessages = Array.from(chat.querySelectorAll(".message"));
    const targetIdx = allMessages.indexOf(targetMsgEl);
    if (targetIdx === -1) return;

    // Messages DOM to keep in new branch
    const messagesToKeep = allMessages.slice(0, targetIdx + 1);
    const tempContainer = document.createElement("div");
    messagesToKeep.forEach(m => tempContainer.appendChild(m.cloneNode(true)));
    const branchHtml = tempContainer.innerHTML;

    // Slicing session.messages
    const userMsgCount = messagesToKeep.filter(m => m.classList.contains("user")).length;
    let uCount = 0;
    let cutOffIdx = -1;

    for (let i = 0; i < session.messages.length; i++) {
        const m = session.messages[i];
        if (m.role === "user") {
            uCount++;
            if (uCount === userMsgCount) {
                cutOffIdx = i;
                if (targetMsgEl.classList.contains("ai")) {
                    while (i + 1 < session.messages.length && session.messages[i + 1].role !== "user") {
                        i++;
                        cutOffIdx = i;
                    }
                }
                break;
            }
        }
    }

    const slicedMessages = cutOffIdx !== -1
        ? session.messages.slice(0, cutOffIdx + 1)
        : [...session.messages];

    const newId = generateChatId();
    const originalTitle = session.title || "Conversation";
    const newTitle = originalTitle.endsWith(" (Branch)") ? originalTitle : `${originalTitle} (Branch)`;

    state.chatSessions[newId] = {
        id: newId,
        title: newTitle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: session.model,
        messages: JSON.parse(JSON.stringify(slicedMessages)),
        chatHtml: branchHtml
    };

    saveStoredChats();
    renderChatList();
    switchToChat(newId);
}

/**
 * Deletes a specific message from chat & session history
 */
export function deleteMessage(targetMsgEl) {
    if (!targetMsgEl || !state.currentChatId) return;
    const session = state.chatSessions[state.currentChatId];
    if (!session) return;
    const chat = document.getElementById("chat");
    if (!chat) return;

    if (targetMsgEl.classList.contains("user")) {
        const next = targetMsgEl.nextElementSibling;
        if (next && next.classList.contains("ai")) {
            next.remove();
        }

        const allUserEls = Array.from(chat.querySelectorAll(".message.user"));
        const userIndex = allUserEls.indexOf(targetMsgEl);
        if (userIndex !== -1) {
            let count = -1;
            for (let i = 0; i < session.messages.length; i++) {
                if (session.messages[i].role === "user") {
                    count++;
                    if (count === userIndex) {
                        let removeCount = 1;
                        while (i + removeCount < session.messages.length && session.messages[i + removeCount].role !== "user") {
                            removeCount++;
                        }
                        session.messages.splice(i, removeCount);
                        break;
                    }
                }
            }
        }
    } else if (targetMsgEl.classList.contains("ai")) {
        let prevUser = targetMsgEl.previousElementSibling;
        while (prevUser && !prevUser.classList.contains("user")) {
            prevUser = prevUser.previousElementSibling;
        }
        if (prevUser) {
            const uIdx = Array.from(chat.querySelectorAll(".message.user")).indexOf(prevUser);
            if (uIdx !== -1) {
                let count = -1;
                for (let i = 0; i < session.messages.length; i++) {
                    if (session.messages[i].role === "user") {
                        count++;
                        if (count === uIdx) {
                            let removeCount = 0;
                            while (i + 1 + removeCount < session.messages.length && session.messages[i + 1 + removeCount].role !== "user") {
                                removeCount++;
                            }
                            if (removeCount > 0) {
                                session.messages.splice(i + 1, removeCount);
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    targetMsgEl.remove();
    session.chatHtml = chat.innerHTML;
    saveStoredChats();
    renderChatList();
}

export async function regenerateFromMessage(target) {
    const isBusy = Boolean(state.currentChatId && state.activeGenerations[state.currentChatId]?.isGenerating);
    if (!target || isBusy || !state.currentChatId) return;

    const chat = document.getElementById("chat");
    const input = document.getElementById("input");
    if (!chat || !input) return;

    let userPrompt = "";
    let userEl = null;

    if (target.classList.contains("user")) {
        userEl = target;
        userPrompt = userEl.textContent.trim();
    } else {
        let prev = target.previousElementSibling;
        while (prev && !prev.classList.contains("user")) {
            prev = prev.previousElementSibling;
        }
        if (prev) {
            userEl = prev;
            userPrompt = userEl.textContent.trim();
        }
    }

    if (!userEl || !userPrompt) return;

    const allUserEls = Array.from(chat.querySelectorAll(".message.user"));
    const userIndex = allUserEls.indexOf(userEl);
    if (userIndex === -1) return;

    const session = state.chatSessions[state.currentChatId];
    if (!session) return;

    let count = -1;
    let msgIndex = -1;
    for (let i = 0; i < session.messages.length; i++) {
        if (session.messages[i].role === "user") {
            count++;
            if (count === userIndex) {
                msgIndex = i;
                break;
            }
        }
    }

    let promptText = "";
    let images = [];

    if (msgIndex !== -1 && session.messages[msgIndex]) {
        const userMsgObj = session.messages[msgIndex];
        if (Array.isArray(userMsgObj.content)) {
            for (const part of userMsgObj.content) {
                if (part.type === "text") {
                    promptText += (part.text || "");
                } else if (part.type === "image_url" && part.image_url?.url) {
                    images.push({ dataUrl: part.image_url.url, name: "image.png" });
                }
            }
        } else if (typeof userMsgObj.content === "string") {
            promptText = userMsgObj.content;
        }
    }

    // Fallback image/text extraction from DOM if not in session messages
    if (!promptText) {
        const textEl = userEl.querySelector(".msg-bubble-text");
        promptText = textEl ? textEl.textContent.trim() : (userEl.dataset.rawText || userEl.textContent.trim());
    }
    if (images.length === 0) {
        userEl.querySelectorAll(".msg-img-card").forEach(card => {
            const dataUrl = card.dataset.fullImg || card.querySelector("img")?.src;
            if (dataUrl) images.push({ dataUrl, name: "image.png" });
        });
    }

    // Remove following messages (the previous AI answer and any subsequent turns)
    while (userEl.nextElementSibling) {
        userEl.nextElementSibling.remove();
    }

    // Slice session messages up to the user message (runAgent will re-push it)
    if (msgIndex !== -1) {
        session.messages = session.messages.slice(0, msgIndex);
    }

    // Create new AI message shell directly under the intact user bubble
    const currentAIMessage = createAIMessageShell();
    const targetChatId = state.currentChatId;

    state.activeGenerations[targetChatId] = {
        isGenerating: true,
        abortRequested: false,
        abortController: new AbortController(),
        sleepResolve: null
    };

    updateSendButtonState(true);
    renderChatList();

    try {
        await runAgent(promptText, currentAIMessage, targetChatId, images);
    } catch (error) {
        const genState = state.activeGenerations[targetChatId];
        if (!genState?.abortRequested && error.message !== "Generation stopped by user") {
            console.error("Regeneration error:", error);
            logEvent("SEND_FATAL_ERROR", { userText: promptText, error: String(error?.message || error) });

            const cleanErr = error.message || "Request could not be succeeded";
            const codeLabel = error.statusCode ? ` [HTTP ${error.statusCode}]` : "";

            const finalContent = currentAIMessage.querySelector(".final-content");
            if (finalContent) {
                finalContent.innerHTML = `
                    <div class="ai-error-notice">
                        <span class="ai-error-badge"><i data-lucide="alert-circle"></i> Request could not be succeeded${codeLabel}</span>
                        <span class="ai-error-text">${escapeHTML(cleanErr)}</span>
                    </div>
                `;
                renderIcons(finalContent);
            }
            const cursor = currentAIMessage.querySelector(".blinking-cursor");
            if (cursor) cursor.remove();
            showErrorRecoveryPopup({
                targetChatId,
                promptText,
                images,
                failedAIMessage: currentAIMessage,
                error
            });
        }
    } finally {
        const targetSession = state.chatSessions[targetChatId];
        if (targetSession) {
            targetSession.chatHtml = (state.currentChatId === targetChatId) ? chat.innerHTML : targetSession.chatHtml;
        }
        delete state.activeGenerations[targetChatId];

        if (state.currentChatId === targetChatId) {
            updateSendButtonState(false);
            chat.scrollTop = chat.scrollHeight;
        }

        saveStoredChats();
        renderChatList();
    }
}

export function initContextMenu() {
    const chat = document.getElementById("chat");
    const msgContextMenu = document.getElementById("msgContextMenu");
    const ctxCopyBtn = document.getElementById("ctxCopyBtn");
    const ctxRegenerateBtn = document.getElementById("ctxRegenerateBtn");
    const ctxBranchBtn = document.getElementById("ctxBranchBtn");
    const ctxExportBtn = document.getElementById("ctxExportBtn");
    const ctxDeleteBtn = document.getElementById("ctxDeleteBtn");

    const chatItemContextMenu = document.getElementById("chatItemContextMenu");
    const chatCtxBranchBtn = document.getElementById("chatCtxBranchBtn");
    const chatCtxExportBtn = document.getElementById("chatCtxExportBtn");
    const chatCtxDeleteBtn = document.getElementById("chatCtxDeleteBtn");

    const mobileMsgActions = document.getElementById("mobileMsgActions");
    const mobileCopyBtn = document.getElementById("mobileCopyBtn");
    const mobileRetryBtn = document.getElementById("mobileRetryBtn");

    // 1. Right Click on Messages / Active Chat Container
    if (chat && msgContextMenu) {
        chat.addEventListener("contextmenu", (e) => {
            const msgEl = e.target.closest(".message");
            if (!msgEl) return;

            e.preventDefault();
            hideChatItemContextMenu();

            contextMenuTargetEl = msgEl;
            contextMenuTargetText = getMessageTextToCopy(msgEl);

            msgContextMenu.style.display = "flex";
            renderIcons(msgContextMenu);

            const isBusy = Boolean(state.currentChatId && state.activeGenerations[state.currentChatId]?.isGenerating);
            if (ctxRegenerateBtn) {
                ctxRegenerateBtn.disabled = isBusy;
            }

            const menuRect = msgContextMenu.getBoundingClientRect();
            const menuWidth = menuRect.width || 165;
            const menuHeight = menuRect.height || 160;

            let posX = e.clientX;
            let posY = e.clientY;

            if (posX + menuWidth > window.innerWidth) {
                posX = window.innerWidth - menuWidth - 8;
            }
            if (posY + menuHeight > window.innerHeight) {
                posY = window.innerHeight - menuHeight - 8;
            }

            msgContextMenu.style.left = `${Math.max(8, posX)}px`;
            msgContextMenu.style.top = `${Math.max(8, posY)}px`;
        });
    }

    // 2. Right Click on Sidebar Chat Items (.chat-item)
    document.addEventListener("contextmenu", (e) => {
        const chatItem = e.target.closest(".chat-item");
        if (!chatItem) return;

        e.preventDefault();
        hideContextMenu();

        const chatId = chatItem.dataset.chatId;
        if (!chatId || !state.chatSessions[chatId]) return;

        chatMenuTargetId = chatId;
        if (!chatItemContextMenu) return;

        chatItemContextMenu.style.display = "flex";
        renderIcons(chatItemContextMenu);

        const menuRect = chatItemContextMenu.getBoundingClientRect();
        const menuWidth = menuRect.width || 150;
        const menuHeight = menuRect.height || 120;

        let posX = e.clientX;
        let posY = e.clientY;

        if (posX + menuWidth > window.innerWidth) {
            posX = window.innerWidth - menuWidth - 8;
        }
        if (posY + menuHeight > window.innerHeight) {
            posY = window.innerHeight - menuHeight - 8;
        }

        chatItemContextMenu.style.left = `${Math.max(8, posX)}px`;
        chatItemContextMenu.style.top = `${Math.max(8, posY)}px`;
    });

    // 3. Close menus on pointerdown outside
    document.addEventListener("pointerdown", (e) => {
        if (msgContextMenu && msgContextMenu.style.display !== "none") {
            if (!msgContextMenu.contains(e.target)) {
                hideContextMenu();
            }
        }
        if (chatItemContextMenu && chatItemContextMenu.style.display !== "none") {
            if (!chatItemContextMenu.contains(e.target)) {
                hideChatItemContextMenu();
            }
        }
        if (mobileMsgActions && mobileMsgActions.style.display !== "none") {
            if (!mobileMsgActions.contains(e.target) && !e.target.closest(".message")) {
                hideMobileActions();
            }
        }
    });

    if (chat) {
        chat.addEventListener("scroll", () => {
            hideContextMenu();
            hideChatItemContextMenu();
            hideMobileActions();
        });

        chat.addEventListener("click", (e) => {
            if (!isMobileDevice()) return;

            if (e.target.closest("button, a, input, textarea, select, .activity-toggle, .code-copy-btn, .code-mode-pill, .table-wrapper, .clickable-badge, .command-output-box, .msg-img-card")) {
                return;
            }

            const msgEl = e.target.closest(".message");
            if (!msgEl) {
                hideMobileActions();
                return;
            }

            if (mobileActionsTargetEl === msgEl && mobileMsgActions.style.display !== "none") {
                hideMobileActions();
            } else {
                showMobileActions(msgEl);
            }
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            hideContextMenu();
            hideChatItemContextMenu();
            hideMobileActions();
        }
    });

    // Message context menu buttons
    if (ctxCopyBtn) {
        ctxCopyBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const textToCopy = contextMenuTargetText || (contextMenuTargetEl ? getMessageTextToCopy(contextMenuTargetEl) : "");
            const success = await copyTextToClipboard(textToCopy);

            ctxCopyBtn.innerHTML = success 
                ? '<i data-lucide="check"></i><span>Copied</span>' 
                : '<i data-lucide="copy"></i><span>Failed</span>';
            renderIcons(ctxCopyBtn);

            setTimeout(() => {
                ctxCopyBtn.innerHTML = '<i data-lucide="copy"></i><span>Copy</span>';
                renderIcons(ctxCopyBtn);
                hideContextMenu();
            }, 500);
        });
    }

    if (ctxRegenerateBtn) {
        ctxRegenerateBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const isBusy = Boolean(state.currentChatId && state.activeGenerations[state.currentChatId]?.isGenerating);
            if (!contextMenuTargetEl || isBusy) {
                hideContextMenu();
                return;
            }

            const target = contextMenuTargetEl;
            hideContextMenu();
            await regenerateFromMessage(target);
        });
    }

    if (ctxBranchBtn) {
        ctxBranchBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const target = contextMenuTargetEl;
            hideContextMenu();
            if (target) {
                branchFromMessage(target);
            }
        });
    }

    if (ctxExportBtn) {
        ctxExportBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            hideContextMenu();
            if (state.currentChatId && state.chatSessions[state.currentChatId]) {
                exportChatToMarkdown(state.chatSessions[state.currentChatId]);
            }
        });
    }

    if (ctxDeleteBtn) {
        ctxDeleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const target = contextMenuTargetEl;
            hideContextMenu();
            if (target) {
                deleteMessage(target);
            }
        });
    }

    // Sidebar Chat Item context menu buttons
    if (chatCtxBranchBtn) {
        chatCtxBranchBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const targetId = chatMenuTargetId;
            hideChatItemContextMenu();
            if (targetId) {
                branchChatSession(targetId);
            }
        });
    }

    if (chatCtxExportBtn) {
        chatCtxExportBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const targetId = chatMenuTargetId;
            hideChatItemContextMenu();
            if (targetId && state.chatSessions[targetId]) {
                exportChatToMarkdown(state.chatSessions[targetId]);
            }
        });
    }

    if (chatCtxDeleteBtn) {
        chatCtxDeleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const targetId = chatMenuTargetId;
            hideChatItemContextMenu();
            if (targetId) {
                deleteChatSession(targetId);
            }
        });
    }

    // Mobile buttons
    if (mobileCopyBtn) {
        mobileCopyBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!mobileActionsTargetEl) return;

            const textToCopy = getMessageTextToCopy(mobileActionsTargetEl);
            const success = await copyTextToClipboard(textToCopy);

            mobileCopyBtn.innerHTML = success 
                ? '<i data-lucide="check"></i>' 
                : '<i data-lucide="x"></i>';
            renderIcons(mobileCopyBtn);

            setTimeout(() => {
                mobileCopyBtn.innerHTML = '<i data-lucide="copy"></i>';
                renderIcons(mobileCopyBtn);
                hideMobileActions();
            }, 500);
        });
    }

    if (mobileRetryBtn) {
        mobileRetryBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const isBusy = Boolean(state.currentChatId && state.activeGenerations[state.currentChatId]?.isGenerating);
            if (!mobileActionsTargetEl || isBusy) {
                hideMobileActions();
                return;
            }

            const target = mobileActionsTargetEl;
            hideMobileActions();
            await regenerateFromMessage(target);
        });
    }
}
