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

export function showChatItemContextMenu(chatId, posX, posY) {
    if (!chatId || !state.chatSessions[chatId]) return;
    const chatItemContextMenu = document.getElementById("chatItemContextMenu");
    if (!chatItemContextMenu) return;

    hideContextMenu();
    hideMobileActions();

    chatMenuTargetId = chatId;
    chatItemContextMenu.style.display = "flex";
    renderIcons(chatItemContextMenu);

    const menuRect = chatItemContextMenu.getBoundingClientRect();
    const menuWidth = menuRect.width || 150;
    const menuHeight = menuRect.height || 120;

    let x = (typeof posX === "number" && posX > 0) ? posX : (window.innerWidth / 2 - menuWidth / 2);
    let y = (typeof posY === "number" && posY > 0) ? posY : (window.innerHeight / 2 - menuHeight / 2);

    if (x + menuWidth > window.innerWidth - 8) {
        x = window.innerWidth - menuWidth - 8;
    }
    if (y + menuHeight > window.innerHeight - 8) {
        y = Math.max(8, (typeof posY === "number" ? posY : window.innerHeight) - menuHeight);
    }

    chatItemContextMenu.style.left = `${Math.max(8, Math.round(x))}px`;
    chatItemContextMenu.style.top = `${Math.max(8, Math.round(y))}px`;
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
    const mobileEditBtn = document.getElementById("mobileEditBtn");
    const mobileCopyBtn = document.getElementById("mobileCopyBtn");
    const mobileRetryBtn = document.getElementById("mobileRetryBtn");
    if (!msgEl || !mobileMsgActions) return;

    mobileActionsTargetEl = msgEl;
    const isBusy = Boolean(state.currentChatId && state.activeGenerations[state.currentChatId]?.isGenerating);
    const isUser = msgEl.classList.contains("user");

    if (mobileEditBtn) {
        mobileEditBtn.innerHTML = '<i data-lucide="pencil"></i>';
        mobileEditBtn.style.display = isUser ? "inline-flex" : "none";
        mobileEditBtn.disabled = isBusy;
    }
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
    const actionsWidth = actionsRect.width || (isUser ? 112 : 76);
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

    ensureSessionMessages(session, chat);

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

/**
 * Ensures session.messages is fully populated, reconstructing from DOM if missing
 */
export function ensureSessionMessages(session, chat = document.getElementById("chat")) {
    if (!session) return;
    if (!session.messages || !Array.isArray(session.messages)) {
        session.messages = [{ role: "system", content: state.activeSystemPrompt }];
    }
    const userCount = session.messages.filter(m => m.role === "user").length;
    const domUserEls = chat ? Array.from(chat.querySelectorAll(".message.user")) : [];
    if (userCount < domUserEls.length && chat) {
        const msgs = [{ role: "system", content: state.activeSystemPrompt }];
        chat.querySelectorAll(".message").forEach(el => {
            if (el.classList.contains("user")) {
                const text = el.querySelector(".msg-bubble-text")?.textContent || el.dataset.rawText || el.textContent.trim();
                msgs.push({ role: "user", content: text });
            } else if (el.classList.contains("ai")) {
                const text = el.querySelector(".final-content")?.textContent || el.dataset.rawText || el.textContent.trim();
                msgs.push({ role: "assistant", content: text });
            }
        });
        session.messages = msgs;
        state.messages = session.messages;
    }
}

/**
 * Starts inline editing mode for a user message
 */
export function startEditUserMessage(userEl) {
    if (!userEl || !userEl.classList.contains("user")) return;

    const isBusy = Boolean(state.currentChatId && state.activeGenerations[state.currentChatId]?.isGenerating);
    if (isBusy) return;

    // Close any other open edit containers in the chat first
    document.querySelectorAll(".message.user.is-editing").forEach(el => {
        if (el !== userEl) cancelEditUserMessage(el);
    });

    hideContextMenu();
    hideMobileActions();

    userEl.classList.add("is-editing");

    const textEl = userEl.querySelector(".msg-bubble-text");
    const currentText = (textEl ? textEl.textContent : userEl.dataset.rawText || "").trim();

    if (textEl) {
        textEl.style.display = "none";
    }

    let editContainer = userEl.querySelector(".user-edit-container");
    if (!editContainer) {
        editContainer = document.createElement("div");
        editContainer.className = "user-edit-container";
        editContainer.innerHTML = `
            <textarea class="user-edit-textarea" placeholder="Edit your message..." rows="1"></textarea>
            <div class="user-edit-actions">
                <button type="button" class="user-edit-btn user-edit-cancel-btn">Cancel</button>
                <button type="button" class="user-edit-btn user-edit-submit-btn">Send</button>
            </div>
        `;
        const bubbleContent = userEl.querySelector(".user-bubble-content") || userEl;
        bubbleContent.appendChild(editContainer);
    }

    const textarea = editContainer.querySelector(".user-edit-textarea");
    textarea.value = currentText;

    const adjustHeight = () => {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 360)}px`;
    };
    textarea.addEventListener("input", adjustHeight);

    setTimeout(() => {
        adjustHeight();
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 30);

    textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submitEditUserMessage(userEl);
        } else if (e.key === "Escape") {
            e.preventDefault();
            cancelEditUserMessage(userEl);
        }
    });

    const cancelBtn = editContainer.querySelector(".user-edit-cancel-btn");
    cancelBtn.onclick = (e) => {
        e.stopPropagation();
        cancelEditUserMessage(userEl);
    };

    const submitBtn = editContainer.querySelector(".user-edit-submit-btn");
    submitBtn.onclick = (e) => {
        e.stopPropagation();
        submitEditUserMessage(userEl);
    };
}

/**
 * Cancels editing mode and restores original message bubble display
 */
export function cancelEditUserMessage(userEl) {
    if (!userEl) return;
    const editContainer = userEl.querySelector(".user-edit-container");
    if (editContainer) {
        editContainer.remove();
    }
    const textEl = userEl.querySelector(".msg-bubble-text");
    if (textEl) {
        textEl.style.display = "";
    }
    userEl.classList.remove("is-editing");
}

/**
 * Submits edited message and triggers model regeneration from that turn onward
 */
export async function submitEditUserMessage(userEl) {
    const isBusy = Boolean(state.currentChatId && state.activeGenerations[state.currentChatId]?.isGenerating);
    if (!userEl || isBusy || !state.currentChatId) return;

    const editContainer = userEl.querySelector(".user-edit-container");
    const textarea = editContainer?.querySelector(".user-edit-textarea");
    if (!textarea) return;

    const newText = textarea.value.trim();
    const textEl = userEl.querySelector(".msg-bubble-text");
    const originalText = (textEl ? textEl.textContent : userEl.dataset.rawText || "").trim();

    const hasImages = userEl.querySelectorAll(".msg-img-card").length > 0;
    const hasDocs = userEl.querySelectorAll(".msg-doc-pill").length > 0;

    if (!newText && !hasImages && !hasDocs) {
        textarea.focus();
        return;
    }

    if (newText === originalText && (newText || hasImages || hasDocs)) {
        cancelEditUserMessage(userEl);
        return;
    }

    const chat = document.getElementById("chat");
    const session = state.chatSessions[state.currentChatId];
    if (!chat || !session) return;

    ensureSessionMessages(session, chat);

    const allUserEls = Array.from(chat.querySelectorAll(".message.user"));
    const userIndex = allUserEls.indexOf(userEl);
    if (userIndex === -1) return;

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

    let images = [];
    if (msgIndex !== -1 && session.messages[msgIndex]) {
        const userMsgObj = session.messages[msgIndex];
        if (Array.isArray(userMsgObj.content)) {
            for (const part of userMsgObj.content) {
                if (part.type === "image_url" && part.image_url?.url) {
                    images.push({ dataUrl: part.image_url.url, name: "image.png" });
                }
            }
        }
    }
    if (images.length === 0) {
        userEl.querySelectorAll(".msg-img-card").forEach(card => {
            const dataUrl = card.dataset.fullImg || card.querySelector("img")?.src;
            if (dataUrl) images.push({ dataUrl, name: "image.png" });
        });
    }

    // Update DOM user bubble
    let bubbleTextEl = userEl.querySelector(".msg-bubble-text");
    if (!bubbleTextEl) {
        bubbleTextEl = document.createElement("div");
        bubbleTextEl.className = "msg-bubble-text";
        const bubbleContent = userEl.querySelector(".user-bubble-content") || userEl;
        bubbleContent.appendChild(bubbleTextEl);
    }
    bubbleTextEl.textContent = newText;
    bubbleTextEl.style.display = "";

    userEl.dataset.rawText = newText;
    editContainer.remove();
    userEl.classList.remove("is-editing");

    // Remove following messages (the previous AI answer and any subsequent turns)
    while (userEl.nextElementSibling) {
        userEl.nextElementSibling.remove();
    }

    // Slice session messages up to the user message turn (runAgent will re-push the new user message)
    if (msgIndex !== -1) {
        session.messages = session.messages.slice(0, msgIndex);
    }

    // Create new AI message shell directly under the updated user bubble
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
        await runAgent(newText, currentAIMessage, targetChatId, images);
    } catch (error) {
        const genState = state.activeGenerations[targetChatId];
        if (!genState?.abortRequested && error.message !== "Generation stopped by user") {
            console.error("Edit message regeneration error:", error);
            logEvent("SEND_FATAL_ERROR", { userText: newText, error: String(error?.message || error) });

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
                promptText: newText,
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
    const ctxEditBtn = document.getElementById("ctxEditBtn");
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
    const mobileEditBtn = document.getElementById("mobileEditBtn");
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
            const isUser = msgEl.classList.contains("user");

            if (ctxEditBtn) {
                ctxEditBtn.style.display = isUser ? "flex" : "none";
                ctxEditBtn.disabled = isBusy;
            }
            if (ctxRegenerateBtn) {
                ctxRegenerateBtn.disabled = isBusy;
            }

            const menuRect = msgContextMenu.getBoundingClientRect();
            const menuWidth = menuRect.width || 170;
            const menuHeight = menuRect.height || 180;
            const msgRect = msgEl.getBoundingClientRect();
            const chatRect = chat.getBoundingClientRect();

            let posX = e.clientX;
            let posY = e.clientY;

            // Constrain right boundary: for user messages (which are right-aligned),
            // or if opening rightwards would spill past the chat column / viewport,
            // open to the left of the click cursor so it hugs the message neatly.
            const maxRight = isUser ? msgRect.right : Math.min(chatRect.right - 12, window.innerWidth - 12);

            if (isUser || (posX + menuWidth > maxRight)) {
                posX = e.clientX - menuWidth;
            }

            // Clamp horizontal position within viewport
            if (posX < 8) {
                posX = Math.max(8, Math.min(e.clientX, window.innerWidth - menuWidth - 8));
            } else if (posX + menuWidth > window.innerWidth - 8) {
                posX = window.innerWidth - menuWidth - 8;
            }

            // Vertical flipping if near the bottom of viewport
            if (posY + menuHeight > window.innerHeight - 8) {
                posY = Math.max(8, e.clientY - menuHeight);
            }

            const flippedX = (posX < e.clientX);
            const flippedY = (posY < e.clientY);
            msgContextMenu.style.transformOrigin = `${flippedY ? "bottom" : "top"} ${flippedX ? "right" : "left"}`;

            msgContextMenu.style.left = `${Math.round(posX)}px`;
            msgContextMenu.style.top = `${Math.round(posY)}px`;
        });
    }

    // 2. Right Click on Sidebar Chat Items (.chat-item)
    document.addEventListener("contextmenu", (e) => {
        const chatItem = e.target.closest(".chat-item");
        if (!chatItem) return;

        e.preventDefault();
        const chatId = chatItem.dataset.chatId;
        const rect = chatItem.getBoundingClientRect();
        const posX = (typeof e.clientX === "number" && e.clientX > 0) ? e.clientX : rect.left + 20;
        const posY = (typeof e.clientY === "number" && e.clientY > 0) ? e.clientY : rect.bottom + 4;
        showChatItemContextMenu(chatId, posX, posY);
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
        }, { passive: true });

        chat.addEventListener("click", (e) => {
            if (!isMobileDevice()) return;

            if (e.target.closest("button, a, input, textarea, select, .activity-toggle, .code-copy-btn, .code-mode-pill, .table-wrapper, .clickable-badge, .command-output-box, .msg-img-card, .user-edit-container")) {
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
    if (ctxEditBtn) {
        ctxEditBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const target = contextMenuTargetEl;
            hideContextMenu();
            if (target && target.classList.contains("user")) {
                startEditUserMessage(target);
            }
        });
    }

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
    if (mobileEditBtn) {
        mobileEditBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const target = mobileActionsTargetEl;
            hideMobileActions();
            if (target && target.classList.contains("user")) {
                startEditUserMessage(target);
            }
        });
    }

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
