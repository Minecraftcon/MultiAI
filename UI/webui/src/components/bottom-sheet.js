/* =========================================================
   BOTTOM SHEET ATTACHMENT DRAWER & GESTURE CONTROLLER
   ========================================================= */
import { renderIcons } from "../utils/icons.js";
import { isModelVisionCapable } from "./side-panel.js";
import { state, setDeepSearchActive } from "../state/index.js";

let isSheetOpen = false;
let startY = 0;
let currentY = 0;
let isDragging = false;
let startTime = 0;
let velocityY = 0;

function getSheetElements() {
    return {
        sheet: document.getElementById("attachSheet"),
        backdrop: document.getElementById("attachBackdrop"),
        sheetBtn: document.getElementById("attachSheetBtn"),
        closeBtn: document.getElementById("attachSheetClose"),
        handleBar: document.querySelector(".sheet-handle-bar"),
        pickImageBtn: document.getElementById("pickImageBtn"),
        pickDocBtn: document.getElementById("pickDocBtn"),
        pickDeepSearchBtn: document.getElementById("pickDeepSearchBtn"),
        deepSearchSheetBadge: document.getElementById("deepSearchSheetBadge"),
        deepSearchSheetDesc: document.getElementById("deepSearchSheetDesc"),
        imageInput: document.getElementById("imageInput"),
        docInput: document.getElementById("docInput"),
        modelSelect: document.getElementById("modelSelect")
    };
}

export function showToast(message, duration = 4000) {
    let toast = document.getElementById("appToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "appToast";
        toast.className = "app-toast";
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.classList.remove("show");
    }, duration);
}

export function updateDeepSearchAvailability() {
    const { pickDeepSearchBtn, deepSearchSheetBadge, deepSearchSheetDesc } = getSheetElements();
    if (!pickDeepSearchBtn) return;

    // Check if current chat has any user messages
    const curId = state.currentChatId;
    const session = curId ? state.chatSessions[curId] : null;
    const hasUserMsg = session && Array.isArray(session.messages) && session.messages.some(m => m.role === "user");
    const isNewChat = !hasUserMsg;

    if (!isNewChat) {
        // Older chat: not available
        pickDeepSearchBtn.classList.add("disabled");
        pickDeepSearchBtn.setAttribute("aria-disabled", "true");
        pickDeepSearchBtn.classList.remove("active");
        if (deepSearchSheetBadge) {
            deepSearchSheetBadge.textContent = "NEW CHATS ONLY";
            deepSearchSheetBadge.classList.remove("active");
        }
        if (deepSearchSheetDesc) {
            deepSearchSheetDesc.textContent = "Available on new chats only";
        }
    } else {
        // New chat: fully available to toggle
        pickDeepSearchBtn.classList.remove("disabled");
        pickDeepSearchBtn.removeAttribute("aria-disabled");
        const isActive = Boolean(state.isDeepSearchActive);
        pickDeepSearchBtn.classList.toggle("active", isActive);
        if (deepSearchSheetBadge) {
            deepSearchSheetBadge.textContent = isActive ? "ON" : "OFF";
            deepSearchSheetBadge.classList.toggle("active", isActive);
        }
        if (deepSearchSheetDesc) {
            deepSearchSheetDesc.textContent = "Multi-agent research & synthesis";
        }
    }
}

export function openAttachmentSheet() {
    const { sheet, backdrop } = getSheetElements();
    if (!sheet || !backdrop) return;

    updateDeepSearchAvailability();
    isSheetOpen = true;
    backdrop.style.display = "block";
    // Trigger reflow for CSS transition
    void backdrop.offsetHeight;
    backdrop.classList.add("active");

    sheet.classList.add("active");
    sheet.style.transform = "translate3d(0, 0, 0)";
    sheet.setAttribute("aria-hidden", "false");
    renderIcons(sheet);
}

export function closeAttachmentSheet() {
    const { sheet, backdrop } = getSheetElements();
    if (!sheet || !backdrop) return;

    isSheetOpen = false;
    sheet.classList.remove("active");
    sheet.style.transform = "translate3d(0, 100%, 0)";
    sheet.setAttribute("aria-hidden", "true");

    backdrop.classList.remove("active");
    setTimeout(() => {
        if (!isSheetOpen) {
            backdrop.style.display = "none";
        }
    }, 280);
}

export function initBottomSheet() {
    const { sheet, backdrop, sheetBtn, closeBtn, handleBar, pickImageBtn, pickDocBtn, pickDeepSearchBtn, imageInput, docInput, modelSelect } = getSheetElements();

    if (sheetBtn) {
        sheetBtn.addEventListener("click", () => {
            isSheetOpen ? closeAttachmentSheet() : openAttachmentSheet();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener("click", closeAttachmentSheet);
    }

    if (backdrop) {
        backdrop.addEventListener("click", closeAttachmentSheet);
    }

    // Image Picker
    if (pickImageBtn && imageInput) {
        pickImageBtn.addEventListener("click", () => {
            const curModel = modelSelect ? modelSelect.value : "";
            if (!isModelVisionCapable(curModel)) {
                showToast(`The selected model is text-only. Please choose a vision model (e.g. Gemini 2.5 Flash, GPT-4o, Claude 3.5, or Llama 3.2 Vision) to analyze images.`);
                closeAttachmentSheet();
                if (modelSelect) {
                    modelSelect.classList.add("highlight-pulse");
                    setTimeout(() => modelSelect.classList.remove("highlight-pulse"), 2000);
                }
                return;
            }
            imageInput.click();
            closeAttachmentSheet();
        });
    }

    // Document Picker
    if (pickDocBtn && docInput) {
        pickDocBtn.addEventListener("click", () => {
            docInput.click();
            closeAttachmentSheet();
        });
    }

    // Deep Search Mode Toggle (+ / -)
    if (pickDeepSearchBtn) {
        pickDeepSearchBtn.addEventListener("click", () => {
            const curId = state.currentChatId;
            const session = curId ? state.chatSessions[curId] : null;
            const hasUserMsg = session && Array.isArray(session.messages) && session.messages.some(m => m.role === "user");

            if (hasUserMsg) {
                showToast("Deep Search must be started on a new chat.");
                closeAttachmentSheet();
                return;
            }

            const nextActive = !state.isDeepSearchActive;
            setDeepSearchActive(nextActive);
            updateDeepSearchAvailability();
            showToast(nextActive ? "Deep Search enabled (+)" : "Deep Search disabled (-)");
            closeAttachmentSheet();
        });
    }

    // Drag-down to dismiss gesture
    const dragTarget = handleBar || sheet;
    if (dragTarget && sheet) {
        const onStart = (clientY) => {
            if (!isSheetOpen) return;
            startY = clientY;
            currentY = clientY;
            startTime = performance.now();
            velocityY = 0;
            isDragging = true;
            sheet.classList.remove("animate-transition");
        };

        const onMove = (clientY, e) => {
            if (!isDragging) return;
            const dy = clientY - startY;
            if (dy > 0) {
                // Dragging downwards
                if (e && e.cancelable) e.preventDefault();
                sheet.style.transform = `translate3d(0, ${dy}px, 0)`;
                const now = performance.now();
                const dt = now - startTime;
                if (dt > 0) {
                    velocityY = (clientY - currentY) / dt;
                }
                currentY = clientY;
                startTime = now;
            } else {
                // Resistance when trying to pull upwards past top
                sheet.style.transform = `translate3d(0, ${dy * 0.2}px, 0)`;
            }
        };

        const onEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            sheet.classList.add("animate-transition");

            const dy = currentY - startY;
            const threshold = sheet.offsetHeight * 0.25 || 75;

            if (dy > threshold || velocityY > 0.4) {
                closeAttachmentSheet();
            } else {
                sheet.style.transform = "translate3d(0, 0, 0)";
            }
        };

        // Touch events
        dragTarget.addEventListener("touchstart", (e) => {
            if (e.touches.length === 1) onStart(e.touches[0].clientY);
        }, { passive: true });

        window.addEventListener("touchmove", (e) => {
            if (isDragging && e.touches.length === 1) onMove(e.touches[0].clientY, e);
        }, { passive: false });

        window.addEventListener("touchend", () => {
            if (isDragging) onEnd();
        });

        // Pointer/mouse drag
        dragTarget.addEventListener("pointerdown", (e) => {
            if (e.button === 0) onStart(e.clientY);
        });

        window.addEventListener("pointermove", (e) => {
            if (isDragging) onMove(e.clientY, e);
        });

        window.addEventListener("pointerup", () => {
            if (isDragging) onEnd();
        });
    }

    // Keyboard ESC to close
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && isSheetOpen) {
            closeAttachmentSheet();
        }
    });
}
