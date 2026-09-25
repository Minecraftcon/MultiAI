/* =========================================================
   COMPOSER ATTACHMENTS & IMAGE PROCESSING
   Attachment staging, image downscaling, and preview handlers
   ========================================================= */
import { state } from "../state.js";
import { renderIcons } from "../utils/icons.js";
import { escapeHTML } from "../utils/dom.js";
import { isModelVisionCapable } from "../services/models.js";
import { showToast } from "./bottom-sheet.js";
import { chatbox } from "./chatbox.js";

export const stagedAttachments = [];

export function isImageFile(file) {
    if (!file) return false;
    const type = (file.type || "").toLowerCase();
    if (type.startsWith("image/")) return true;
    const name = (file.name || "").toLowerCase();
    return /\.(png|jpe?g|webp|gif|svg|bmp|ico|heic|heif|avif|tiff?)$/i.test(name);
}

export function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function downscaleImage(file, maxDim = 1600, minDim = 64, quality = 0.85) {
    return new Promise((resolve) => {
        // If SVG or GIF, preserve vector / animation data directly
        if (file.type === "image/svg+xml" || file.type === "image/gif" || file.name.match(/\.(svg|gif)$/i)) {
            const reader = new FileReader();
            reader.onload = (e) => resolve({ dataUrl: e.target.result, width: 0, height: 0 });
            reader.onerror = () => resolve({ dataUrl: "", width: 0, height: 0 });
            reader.readAsDataURL(file);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (!width || !height) {
                    resolve({ dataUrl: e.target.result, width: 0, height: 0 });
                    return;
                }

                // AI vision models reject tiny images under ~32x32px.
                if (width < minDim || height < minDim) {
                    const scale = Math.max(minDim / width, minDim / height);
                    const targetW = Math.round(width * scale);
                    const targetH = Math.round(height * scale);
                    const canvas = document.createElement("canvas");
                    canvas.width = targetW;
                    canvas.height = targetH;
                    const ctx = canvas.getContext("2d");
                    ctx.imageSmoothingEnabled = false;
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
                const isPng = file.type === "image/png" || file.name.match(/\.png$/i);
                const dataUrl = isPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality);
                resolve({ dataUrl, width, height });
            };
            img.onerror = () => resolve({ dataUrl: e.target.result, width: 0, height: 0 });
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

export function clearStagedAttachments() {
    const list = stagedAttachments.slice();
    stagedAttachments.length = 0;
    return list;
}

export function getStagedAttachments() {
    return stagedAttachments;
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

export function renderStagedAttachments() {
    const strip = document.getElementById("stagedAttachments");
    if (!strip) return;

    if (stagedAttachments.length === 0) {
        strip.innerHTML = "";
        strip.style.display = "none";
        chatbox.setHasAttachments(false);
        return;
    }

    strip.style.display = "flex";
    strip.innerHTML = "";
    chatbox.setHasAttachments(true);

    const images = stagedAttachments.filter(a => a.type === "image");
    const docs = stagedAttachments.filter(a => a.type === "document");

    const row = document.createElement("div");
    row.className = "staged-items-row";

    // 1. Render images starting right from the left corner over the plus button
    images.forEach(att => {
        const item = document.createElement("div");
        item.className = "staged-att-item staged-image-item";
        item.innerHTML = `
            <div class="staged-img-preview" title="Click to preview ${escapeHTML(att.name)}">
                <div class="staged-img-thumb">
                    <img src="${att.dataUrl}" alt="${escapeHTML(att.name)}">
                    <div class="staged-img-badge">${formatFileSize(att.size)}</div>
                </div>
            </div>
            <button type="button" class="staged-att-del" title="Remove image" aria-label="Remove image">
                <i data-lucide="x"></i>
            </button>
        `;
        const previewEl = item.querySelector(".staged-img-preview");
        if (previewEl) {
            previewEl.addEventListener("click", (e) => {
                if (e.target.closest(".staged-att-del")) return;
                openImageLightbox(att.dataUrl);
            });
        }
        item.querySelector(".staged-att-del")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const idx = stagedAttachments.indexOf(att);
            if (idx !== -1) stagedAttachments.splice(idx, 1);
            renderStagedAttachments();
        });
        row.appendChild(item);
    });

    // 2. Render documents cleanly in the same horizontal row (no tag clutter)
    docs.forEach(att => {
        const item = document.createElement("div");
        item.className = "staged-att-item staged-doc-item";
        item.innerHTML = `
            <div class="staged-doc-preview" title="${escapeHTML(att.name)}">
                <i data-lucide="file-text"></i>
                <span class="staged-doc-name">${escapeHTML(att.name)}</span>
                <span class="staged-doc-size">${formatFileSize(att.size)}</span>
            </div>
            <button type="button" class="staged-att-del" title="Remove file" aria-label="Remove file">
                <i data-lucide="x"></i>
            </button>
        `;
        item.querySelector(".staged-att-del")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const idx = stagedAttachments.indexOf(att);
            if (idx !== -1) stagedAttachments.splice(idx, 1);
            renderStagedAttachments();
        });
        row.appendChild(item);
    });

    strip.appendChild(row);
    renderIcons(strip);
}

export async function addImageFiles(files) {
    if (!files || files.length === 0) return;

    const actualImages = [];
    const actualDocs = [];

    for (const file of files) {
        if (isImageFile(file)) {
            actualImages.push(file);
        } else {
            actualDocs.push(file);
        }
    }

    if (actualDocs.length > 0) {
        await addDocumentFiles(actualDocs);
    }
    if (actualImages.length === 0) return;

    const modelSelect = document.getElementById("modelSelect");
    const curModel = modelSelect ? modelSelect.value : "";

    if (!isModelVisionCapable(curModel)) {
        const visionOpt = Array.from(modelSelect?.options || []).find(opt => isModelVisionCapable(opt.value));
        if (visionOpt && modelSelect) {
            modelSelect.value = visionOpt.value;
            if (state.currentChatId && state.chatSessions[state.currentChatId]) {
                state.chatSessions[state.currentChatId].model = visionOpt.value;
            }
            showToast(`Switched to ${visionOpt.textContent.replace(/\s*\[Vision\]\s*/i, "").trim()} for image vision support.`);
        } else {
            showToast("Selected model is text-only. Please select a vision model (e.g. Gemini 2.5 Flash) to attach images.");
        }
    }

    for (const file of actualImages) {
        try {
            const { dataUrl } = await downscaleImage(file);
            if (!dataUrl) continue;
            stagedAttachments.push({
                type: "image",
                name: file.name,
                size: file.size,
                mimeType: file.type || (file.name.match(/\.png$/i) ? "image/png" : "image/jpeg"),
                dataUrl
            });
        } catch (e) {
            console.error("[IMAGE] Error processing image file:", file.name, e);
        }
    }

    renderStagedAttachments();
}

export async function addDocumentFiles(files) {
    if (!files || files.length === 0) return;

    const actualImages = [];
    const actualDocs = [];

    for (const file of files) {
        if (isImageFile(file)) {
            actualImages.push(file);
        } else {
            actualDocs.push(file);
        }
    }

    // Automatically route images to the image handler so they never get sent as text documents
    if (actualImages.length > 0) {
        await addImageFiles(actualImages);
    }
    if (actualDocs.length === 0) return;

    for (const file of actualDocs) {
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
