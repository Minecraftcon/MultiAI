/* =========================================================
   COMPOSER, SEND BUTTON, GENERATION & ATTACHMENTS CONTROLLER
   ========================================================= */
import { state } from "../state.js";
import { logEvent } from "../utils/logger.js";
import { renderIcons } from "../utils/icons.js";
import { createNewChatSession, saveStoredChats, saveCurrentChatState } from "../services/storage.js";
import { runAgent } from "../services/agent.js";
import { createAIMessageShell } from "./chat-ui.js";
import { hideMobileActions } from "./context-menu.js";
import { renderChatList, isModelVisionCapable } from "./side-panel.js";
import { showToast } from "./bottom-sheet.js";
import { showErrorRecoveryPopup } from "./error-recovery.js";
import { escapeHTML } from "../utils/dom.js";

export let stagedAttachments = [];

function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function downscaleImage(file, maxDim = 1600, minDim = 64, quality = 0.85) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (!width || !height) {
                    resolve({ dataUrl: e.target.result, width: 0, height: 0 });
                    return;
                }

                // AI vision models (like Gemini) reject images smaller than ~32x32px.
                // If the image is tiny, upscale it on a canvas to at least minDim.
                if (width < minDim || height < minDim) {
                    const scale = Math.max(minDim / width, minDim / height);
                    const targetW = Math.round(width * scale);
                    const targetH = Math.round(height * scale);
                    const canvas = document.createElement("canvas");
                    canvas.width = targetW;
                    canvas.height = targetH;
                    const ctx = canvas.getContext("2d");
                    ctx.imageSmoothingEnabled = false; // keep pixel/icon art sharp
                    ctx.drawImage(img, 0, 0, targetW, targetH);
                    const dataUrl = canvas.toDataURL("image/png");
                    resolve({ dataUrl, width: targetW, height: targetH });
                    return;
                }

                if (width <= maxDim && height <= maxDim) {
                    resolve({ dataUrl: e.target.result, width, height });
                    return;
                }

                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL("image/jpeg", quality);
                resolve({ dataUrl, width, height });
            };
            img.onerror = () => resolve({ dataUrl: e.target.result, width: 0, height: 0 });
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

export function renderStagedAttachments() {
    const strip = document.getElementById("stagedAttachments");
    if (!strip) return;

    if (stagedAttachments.length === 0) {
        strip.innerHTML = "";
        strip.style.display = "none";
        return;
    }

    strip.style.display = "flex";
    strip.innerHTML = "";

    stagedAttachments.forEach((att, index) => {
        const item = document.createElement("div");
        item.className = "staged-att-item";

        if (att.type === "image") {
            item.innerHTML = `
                <div class="staged-img-preview">
                    <img src="${att.dataUrl}" alt="${att.name}">
                    <button type="button" class="staged-att-del" data-idx="${index}" title="Remove image">
                        <i data-lucide="x"></i>
                    </button>
                </div>
            `;
        } else {
            item.innerHTML = `
                <div class="staged-doc-preview">
                    <i data-lucide="file-text"></i>
                    <span class="staged-doc-name" title="${att.name}">${att.name}</span>
                    <span class="staged-doc-size">${formatFileSize(att.size)}</span>
                    <button type="button" class="staged-att-del" data-idx="${index}" title="Remove file">
                        <i data-lucide="x"></i>
                    </button>
                </div>
            `;
        }

        const delBtn = item.querySelector(".staged-att-del");
        if (delBtn) {
            delBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                stagedAttachments.splice(index, 1);
                renderStagedAttachments();
            });
        }

        strip.appendChild(item);
    });

    renderIcons(strip);
}

export async function addImageFiles(files) {
    if (!files || files.length === 0) return;
    const modelSelect = document.getElementById("modelSelect");
    const curModel = modelSelect ? modelSelect.value : "";

    if (!isModelVisionCapable(curModel)) {
        showToast("The selected model is text-only. Please choose a vision model (e.g. Gemini 2.5 Flash, GPT-4o, Claude 3.5, or Llama 3.2 Vision) to attach images.");
        if (modelSelect) {
            modelSelect.classList.add("highlight-pulse");
            setTimeout(() => modelSelect.classList.remove("highlight-pulse"), 2000);
        }
        return;
    }

    for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const { dataUrl } = await downscaleImage(file);
        stagedAttachments.push({
            type: "image",
            name: file.name,
            size: file.size,
            mimeType: file.type || "image/jpeg",
            dataUrl
        });
    }

    renderStagedAttachments();
}

export async function addDocumentFiles(files) {
    if (!files || files.length === 0) return;

    for (const file of files) {
        const isTextBased = file.type.startsWith("text/") || 
            file.name.match(/\.(txt|md|json|csv|py|js|html|css|yaml|yml|xml|sh|ts|jsx|tsx|sql|c|cpp|h)$/i);

        if (isTextBased) {
            const textContent = await new Promise((res) => {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.onerror = () => res("");
                r.readAsText(file);
            });

            stagedAttachments.push({
                type: "document",
                name: file.name,
                size: file.size,
                mimeType: file.type || "text/plain",
                textContent,
                dataUrl: null
            });
        } else {
            const dataUrl = await new Promise((res) => {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.onerror = () => res("");
                r.readAsDataURL(file);
            });

            stagedAttachments.push({
                type: "document",
                name: file.name,
                size: file.size,
                mimeType: file.type || "application/octet-stream",
                textContent: null,
                dataUrl
            });
        }
    }

    renderStagedAttachments();
}

export function updateSendButtonState(active) {
    const sendButton = document.getElementById("send");
    const input = document.getElementById("input");
    const modelSelect = document.getElementById("modelSelect");
    const attachBtn = document.getElementById("attachSheetBtn");
    if (!sendButton || !input) return;

    if (active) {
        sendButton.classList.add("generating");
        sendButton.title = "Stop generation";
        sendButton.setAttribute("aria-label", "Stop generation");
        sendButton.innerHTML = '<i data-lucide="square"></i>';
        renderIcons(sendButton);
        sendButton.disabled = false;
        input.disabled = true;
        if (modelSelect) modelSelect.disabled = true;
        if (attachBtn) attachBtn.disabled = true;
    } else {
        sendButton.classList.remove("generating");
        sendButton.title = "Send message";
        sendButton.setAttribute("aria-label", "Send message");
        sendButton.innerHTML = '<i data-lucide="arrow-up"></i>';
        renderIcons(sendButton);
        sendButton.disabled = false;
        input.disabled = false;
        if (modelSelect) modelSelect.disabled = false;
        if (attachBtn) attachBtn.disabled = false;
        input.focus();
    }
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

    const currentAttachments = stagedAttachments.slice();
    stagedAttachments = [];
    renderStagedAttachments();

    input.value = "";
    input.style.height = "auto";

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

    const targetSession = state.chatSessions[targetChatId];
    targetSession.chatHtml = chat.innerHTML;

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

export function openImageLightbox(src) {
    let lb = document.getElementById("imageLightbox");
    if (!lb) {
        lb = document.createElement("div");
        lb.id = "imageLightbox";
        lb.className = "image-lightbox";
        lb.innerHTML = `
            <div class="lightbox-backdrop"></div>
            <div class="lightbox-container">
                <button type="button" class="lightbox-close" aria-label="Close image"><i data-lucide="x"></i></button>
                <img id="lightboxImg" src="" alt="Full preview">
            </div>
        `;
        document.body.appendChild(lb);
        renderIcons(lb);
        lb.querySelector(".lightbox-backdrop").addEventListener("click", () => lb.classList.remove("active"));
        lb.querySelector(".lightbox-close").addEventListener("click", () => lb.classList.remove("active"));
    }
    const img = lb.querySelector("#lightboxImg");
    if (img) img.src = src;
    lb.classList.add("active");
}

export function initComposer() {
    const input = document.getElementById("input");
    const sendButton = document.getElementById("send");
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

    if (input) {
        input.addEventListener("input", () => {
            input.style.height = "auto";
            input.style.height = Math.min(input.scrollHeight, 150) + "px";
        });

        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
            }
        });

        // Clipboard paste handling (e.g. screenshots)
        input.addEventListener("paste", (e) => {
            const items = Array.from(e.clipboardData?.items || []);
            const imageItems = items.filter(item => item.type && item.type.startsWith("image/"));
            if (imageItems.length > 0) {
                const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
                if (files.length > 0) {
                    addImageFiles(files);
                }
            }
        });
    }

    if (sendButton) {
        sendButton.addEventListener("click", () => {
            send();
        });
    }

    // Drag and Drop support
    const dropZone = document.body;
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
            const imgFiles = files.filter(f => f.type.startsWith("image/"));
            const docFiles = files.filter(f => !f.type.startsWith("image/"));
            if (imgFiles.length > 0) addImageFiles(imgFiles);
            if (docFiles.length > 0) addDocumentFiles(docFiles);
        }
    });
}
