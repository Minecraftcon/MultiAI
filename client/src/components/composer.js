/* =========================================================
   COMPOSER, SEND BUTTON & GENERATION CONTROLLER
   Manages message dispatch, streaming lifecycle, and user input
   ========================================================= */
import { state } from "../state.js";
import { logEvent } from "../utils/logger.js";
import { renderIcons } from "../utils/icons.js";
import { createNewChatSession, saveStoredChats, saveCurrentChatState } from "../services/storage.js";
import { runAgent } from "../services/agent.js";
import { createAIMessageShell } from "./chat-ui.js";
import { hideMobileActions } from "./context-menu.js";
import { renderChatList } from "./side-panel.js";
import { showErrorRecoveryPopup } from "./error-recovery.js";
import { escapeHTML } from "../utils/dom.js";
import { chatbox, setStartPageMode } from "./chatbox.js";
import { updateModelPickerDisplay } from "./model-picker.js";
import {
    stagedAttachments,
    isImageFile,
    formatFileSize,
    downscaleImage,
    clearStagedAttachments,
    getStagedAttachments,
    openImageLightbox,
    renderStagedAttachments,
    addImageFiles,
    addDocumentFiles
} from "./composer-attachments.js";

export {
    chatbox,
    stagedAttachments,
    isImageFile,
    formatFileSize,
    downscaleImage,
    clearStagedAttachments,
    getStagedAttachments,
    openImageLightbox,
    renderStagedAttachments,
    addImageFiles,
    addDocumentFiles
};

export function updateSendButtonState(active) {
    chatbox.setGenerating(active);
}

export function stopChatGeneration(chatId) {
    const genState = state.activeGenerations[chatId];
    if (!genState || !genState.isGenerating) return;

    genState.abortRequested = true;
    logEvent("STOP_REQUESTED_BY_USER", { chatId });

    if (genState.abortController) {
        try {
            genState.abortController.abort();
        } catch (e) {}
    }

    if (typeof genState.sleepResolve === "function") {
        genState.sleepResolve();
        genState.sleepResolve = null;
    }
}

export async function send() {
    hideMobileActions();

    if (state.currentChatId && state.activeGenerations[state.currentChatId]?.isGenerating) {
        stopChatGeneration(state.currentChatId);
        return;
    }

    const input = document.getElementById("input");
    const chat = document.getElementById("chat");
    if (!input || !chat) return;

    const text = input.value.trim();
    const hasAttachments = stagedAttachments.length > 0;
    if (!text && !hasAttachments) return;

    setStartPageMode(false);

    const currentAttachments = clearStagedAttachments();
    renderStagedAttachments();

    chatbox.clearInput();

    // -------------------------------------------------------------
    // RENDER USER MESSAGE BUBBLE:
    // Layout: On top of prompt bubble: (icon) doc name
    // Directly under: (image preview)
    // Below that: prompt bubble text
    // -------------------------------------------------------------
    const userDiv = document.createElement("div");
    userDiv.className = "message user";

    const docs = currentAttachments.filter(a => a.type === "document");
    const images = currentAttachments.filter(a => a.type === "image");

    let docsHtml = "";
    if (docs.length > 0) {
        docsHtml = `<div class="msg-bubble-docs">` + docs.map(d => `
            <div class="msg-doc-pill">
                <i data-lucide="file-text"></i>
                <span class="msg-doc-name" title="${d.name}">${d.name}</span>
                <span class="msg-doc-size">${formatFileSize(d.size)}</span>
            </div>
        `).join("") + `</div>`;
    }

    let imgsHtml = "";
    if (images.length > 0) {
        imgsHtml = `<div class="msg-bubble-images">` + images.map(img => `
            <div class="msg-img-card" data-full-img="${img.dataUrl}">
                <img src="${img.dataUrl}" alt="${img.name}">
            </div>
        `).join("") + `</div>`;
    }

    const textHtml = text ? `<div class="msg-bubble-text">${text}</div>` : "";

    userDiv.innerHTML = `
        <div class="user-bubble-content">
            ${docsHtml}
            ${imgsHtml}
            ${textHtml}
        </div>
    `;

    userDiv.dataset.rawText = text || (images.length > 0 ? "Attached image" : "Attached document");
    chat.appendChild(userDiv);
    renderIcons(userDiv);
    chat.scrollTop = chat.scrollHeight;

    // Attach click listener for image lightbox
    userDiv.querySelectorAll(".msg-img-card").forEach(card => {
        card.addEventListener("click", () => {
            const fullImg = card.dataset.fullImg;
            if (fullImg) openImageLightbox(fullImg);
        });
    });

    let targetChatId = state.currentChatId;
    if (!targetChatId || !state.chatSessions[targetChatId]) {
        targetChatId = createNewChatSession(text || "New chat with attachments");
    } else {
        saveCurrentChatState();
    }

    state.activeGenerations[targetChatId] = {
        isGenerating: true,
        abortRequested: false,
        abortController: new AbortController(),
        sleepResolve: null
    };

    updateSendButtonState(true);
    renderChatList();

    const currentAIMessage = createAIMessageShell();

    try {
        // Build multimodal payload or doc-augmented text
        let promptText = text;
        if (docs.length > 0) {
            const docContexts = docs.map(d => {
                if (d.textContent) {
                    return `--- Attachment: ${d.name} ---\n${d.textContent}\n--- End Attachment ---`;
                }
                return `[Attached document: ${d.name} (${formatFileSize(d.size)})]`;
            }).join("\n\n");
            promptText = promptText ? `${promptText}\n\n${docContexts}` : docContexts;
        }

        await runAgent(promptText, currentAIMessage, targetChatId, images);
    } catch (error) {
        const genState = state.activeGenerations[targetChatId];
        if (!genState?.abortRequested && error.message !== "Generation stopped by user") {
            console.error(error);
            logEvent("SEND_FATAL_ERROR", { userText: text, error: String(error && error.message || error) });
            
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
                promptText: promptText || text,
                images,
                failedAIMessage: currentAIMessage,
                error
            });
        }
    } finally {
        delete state.activeGenerations[targetChatId];

        if (state.currentChatId === targetChatId) {
            updateSendButtonState(false);
            chat.scrollTop = chat.scrollHeight;
        }

        saveStoredChats();
        renderChatList();
    }
}

export function initComposer() {
    const inputArea = document.getElementById("inputArea");
    if (inputArea) {
        chatbox.mount(inputArea);
        updateModelPickerDisplay();
    }

    chatbox.onSend(() => {
        send();
    });

    const imageInput = document.getElementById("imageInput");
    const docInput = document.getElementById("docInput");

    if (imageInput) {
        imageInput.addEventListener("change", (e) => {
            addImageFiles(Array.from(e.target.files || []));
            imageInput.value = "";
        });
    }

    if (docInput) {
        docInput.addEventListener("change", (e) => {
            addDocumentFiles(Array.from(e.target.files || []));
            docInput.value = "";
        });
    }

    // Clipboard paste handling (e.g. screenshots & images)
    window.addEventListener("paste", (e) => {
        const target = e.target;
        if (target && target.tagName === "INPUT" && target.id !== "input") return;

        const items = Array.from(e.clipboardData?.items || []);
        const files = [];
        for (const item of items) {
            if (item.kind === "file") {
                const f = item.getAsFile();
                if (f) files.push(f);
            }
        }
        if (files.length > 0) {
            const imgFiles = files.filter(isImageFile);
            const docFiles = files.filter(f => !isImageFile(f));
            if (imgFiles.length > 0) addImageFiles(imgFiles);
            if (docFiles.length > 0) addDocumentFiles(docFiles);
        }
    });

    // Drag and Drop support
    let dragCounter = 0;

    window.addEventListener("dragenter", (e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
            dragCounter++;
            document.body.classList.add("drag-over");
        }
    });

    window.addEventListener("dragleave", (e) => {
        dragCounter = Math.max(0, dragCounter - 1);
        if (dragCounter === 0) {
            document.body.classList.remove("drag-over");
        }
    });

    window.addEventListener("dragover", (e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
            e.preventDefault();
        }
    });

    window.addEventListener("drop", (e) => {
        e.preventDefault();
        dragCounter = 0;
        document.body.classList.remove("drag-over");

        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length > 0) {
            const imgFiles = files.filter(isImageFile);
            const docFiles = files.filter(f => !isImageFile(f));
            if (imgFiles.length > 0) addImageFiles(imgFiles);
            if (docFiles.length > 0) addDocumentFiles(docFiles);
        }
    });
}
