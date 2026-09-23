/* =========================================================
   ERROR RECOVERY POPUP COMPONENT
   Slides in from bottom-right on failed generation requests
   Allows continuing from the current point with a new or same model
   Self-mounting & resilient against stale DOM / cache states
   ========================================================= */
import { state } from "../state.js";
import { renderIcons } from "../utils/icons.js";
import { logEvent } from "../utils/logger.js";
import { createAIMessageShell } from "./chat-ui.js";
import { updateSendButtonState } from "./composer.js";
import { runAgent } from "../services/agent.js";
import { saveStoredChats } from "../services/storage.js";
import { renderChatList } from "./side-panel.js";
import { escapeHTML } from "../utils/dom.js";

let recoveryContext = null;

function ensureInjectedStyles() {
    if (document.getElementById("errorRecoveryInjectedStyles")) return;
    const style = document.createElement("style");
    style.id = "errorRecoveryInjectedStyles";
    style.textContent = `
        .error-recovery-popup {
            position: fixed !important;
            bottom: 86px !important;
            right: 24px !important;
            z-index: 9999 !important;
            width: min(390px, calc(100vw - 32px)) !important;
            background: #1e1e1e !important;
            border: 1px solid #333333 !important;
            border-radius: 16px !important;
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.8), 0 4px 16px rgba(0, 0, 0, 0.5) !important;
            padding: 16px 18px !important;
            display: flex !important;
            flex-direction: column !important;
            transform: translate3d(140%, 0, 0) !important;
            opacity: 0 !important;
            pointer-events: none !important;
            transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease !important;
            user-select: none !important;
            font-family: inherit !important;
        }
        .error-recovery-popup.active {
            transform: translate3d(0, 0, 0) !important;
            opacity: 1 !important;
            pointer-events: auto !important;
        }
        .recovery-popup-header {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 8px !important;
        }
        .recovery-popup-title-group {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
        }
        .recovery-alert-icon {
            width: 18px !important;
            height: 18px !important;
            color: #888888 !important;
            flex-shrink: 0 !important;
        }
        .recovery-popup-title {
            font-size: 13.5px !important;
            font-weight: 600 !important;
            color: #f5f5f5 !important;
            letter-spacing: -0.01em !important;
        }
        .recovery-close-btn {
            width: 26px !important;
            height: 26px !important;
            border-radius: 50% !important;
            background: transparent !important;
            border: none !important;
            color: #777 !important;
            cursor: pointer !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 0 !important;
            transition: background 0.15s, color 0.15s !important;
        }
        .recovery-close-btn:hover {
            background: #2a2a2a !important;
            color: #eee !important;
        }
        .recovery-close-btn svg {
            width: 15px !important;
            height: 15px !important;
        }
        .recovery-popup-body {
            font-size: 13px !important;
            color: #999999 !important;
            line-height: 1.45 !important;
            margin: 8px 0 16px !important;
        }
        .recovery-popup-actions {
            display: flex !important;
            align-items: center !important;
            justify-content: flex-end !important;
            gap: 10px !important;
        }
        .recovery-btn {
            font-family: inherit !important;
            border-radius: 10px !important;
            padding: 8px 18px !important;
            font-size: 13px !important;
            cursor: pointer !important;
            transition: background 0.15s ease, transform 0.12s ease, color 0.15s ease !important;
        }
        .recovery-btn-cancel {
            background: #2a2a2a !important;
            color: #bbb !important;
            border: 1px solid #3d3d3d !important;
            font-weight: 500 !important;
        }
        .recovery-btn-cancel:hover {
            background: #353535 !important;
            color: #fff !important;
        }
        .recovery-btn-continue {
            background: #ffffff !important;
            color: #000000 !important;
            border: none !important;
            font-weight: 600 !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25) !important;
        }
        .recovery-btn-continue:hover {
            background: #ececec !important;
            transform: translateY(-1px) !important;
        }
        .recovery-btn-continue:active {
            transform: scale(0.97) !important;
        }
        @media (max-width: 600px) {
            .error-recovery-popup {
                bottom: 78px !important;
                right: 12px !important;
                left: 12px !important;
                width: auto !important;
                max-width: calc(100vw - 24px) !important;
            }
        }
    `;
    document.head.appendChild(style);
}

export function getErrorRecoveryElements() {
    ensureInjectedStyles();
    let popup = document.getElementById("errorRecoveryPopup");

    // Self-mount if absent from DOM
    if (!popup) {
        popup = document.createElement("div");
        popup.id = "errorRecoveryPopup";
        popup.className = "error-recovery-popup";
        popup.setAttribute("aria-live", "polite");
        popup.innerHTML = `
            <div class="recovery-popup-header">
                <div class="recovery-popup-title-group">
                    <i data-lucide="alert-circle" class="recovery-alert-icon"></i>
                    <span class="recovery-popup-title">Request could not be succeeded</span>
                </div>
                <button id="errorRecoveryClose" type="button" class="recovery-close-btn" aria-label="Dismiss notification">
                    <i data-lucide="x"></i>
                </button>
            </div>
            <div id="errorRecoveryMsg" class="recovery-popup-body">
                Continue from here with another model?
            </div>
            <div class="recovery-popup-actions">
                <button id="errorRecoveryCancel" type="button" class="recovery-btn recovery-btn-cancel">
                    Cancel
                </button>
                <button id="errorRecoveryContinue" type="button" class="recovery-btn recovery-btn-continue">
                    Continue
                </button>
            </div>
        `;
        document.body.appendChild(popup);
        bindErrorRecoveryEvents(popup);
        renderIcons(popup);
    }

    return {
        popup,
        continueBtn: popup.querySelector("#errorRecoveryContinue") || document.getElementById("errorRecoveryContinue"),
        cancelBtn: popup.querySelector("#errorRecoveryCancel") || document.getElementById("errorRecoveryCancel"),
        closeBtn: popup.querySelector("#errorRecoveryClose") || document.getElementById("errorRecoveryClose"),
        msgText: popup.querySelector("#errorRecoveryMsg") || document.getElementById("errorRecoveryMsg"),
        modelSelect: document.getElementById("modelSelect")
    };
}

function bindErrorRecoveryEvents(popup) {
    if (!popup) return;
    const continueBtn = popup.querySelector("#errorRecoveryContinue");
    const cancelBtn = popup.querySelector("#errorRecoveryCancel");
    const closeBtn = popup.querySelector("#errorRecoveryClose");

    if (continueBtn && !continueBtn.dataset.bound) {
        continueBtn.dataset.bound = "true";
        continueBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            continueFromFailedPoint();
        });
    }

    if (cancelBtn && !cancelBtn.dataset.bound) {
        cancelBtn.dataset.bound = "true";
        cancelBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            hideErrorRecoveryPopup();
        });
    }

    if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = "true";
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            hideErrorRecoveryPopup();
        });
    }
}

/**
 * Displays the error recovery popup in the bottom right corner above the chatbox
 */
export function showErrorRecoveryPopup(ctx) {
    recoveryContext = ctx;
    const { popup, msgText, modelSelect } = getErrorRecoveryElements();
    if (!popup) return;

    if (msgText) {
        msgText.textContent = "Continue from here with another model?";
    }

    popup.classList.add("active");
    renderIcons(popup);

    // Gently pulse the model selector in header so user knows they can switch models
    if (modelSelect) {
        modelSelect.classList.add("highlight-pulse");
        setTimeout(() => {
            modelSelect.classList.remove("highlight-pulse");
        }, 2200);
    }

    logEvent("ERROR_RECOVERY_SHOWN", {
        chatId: ctx.targetChatId,
        error: String(ctx.error?.message || ctx.error)
    });
}

/**
 * Dismisses the error recovery popup
 */
export function hideErrorRecoveryPopup() {
    const { popup } = getErrorRecoveryElements();
    if (popup) {
        popup.classList.remove("active");
    }
    recoveryContext = null;
}

/**
 * Removes the failed message and retries generation from that point
 * with the currently selected model
 */
export async function continueFromFailedPoint() {
    if (!recoveryContext) return;

    const { targetChatId, promptText, images = [], failedAIMessage } = recoveryContext;
    hideErrorRecoveryPopup();

    const chat = document.getElementById("chat");
    const modelSelect = document.getElementById("modelSelect");
    const session = state.chatSessions[targetChatId];
    if (!session || !chat) return;

    // 1. Remove the failed AI message from DOM
    if (failedAIMessage && failedAIMessage.parentNode) {
        failedAIMessage.remove();
    } else {
        // Fallback: remove last AI message in chat if marked error
        const aiMsgs = Array.from(chat.querySelectorAll(".message.ai"));
        const lastAi = aiMsgs[aiMsgs.length - 1];
        if (lastAi && (lastAi.innerText.includes("Error:") || lastAi.querySelector(".ai-error-notice"))) {
            lastAi.remove();
        }
    }

    // 2. Read the active model from selector (in case user changed it)
    const currentModel = modelSelect ? modelSelect.value : (session.model || "gemini-2.5-flash");
    session.model = currentModel;

    // 3. Clean session messages up to the user turn
    // (runAgent will re-push the user turn cleanly)
    const userMsgIndex = session.messages.findLastIndex(m => m.role === "user");
    if (userMsgIndex !== -1) {
        session.messages = session.messages.slice(0, userMsgIndex);
    }

    // 4. Create new AI message shell
    const currentAIMessage = createAIMessageShell();

    state.activeGenerations[targetChatId] = {
        isGenerating: true,
        abortRequested: false,
        abortController: new AbortController(),
        sleepResolve: null
    };

    updateSendButtonState(true);
    renderChatList();

    logEvent("ERROR_RECOVERY_CONTINUE", {
        chatId: targetChatId,
        model: currentModel,
        promptPreview: (promptText || "").slice(0, 60)
    });

    try {
        await runAgent(promptText, currentAIMessage, targetChatId, images);
    } catch (error) {
        const genState = state.activeGenerations[targetChatId];
        if (!genState?.abortRequested && error.message !== "Generation stopped by user") {
            console.error("Continued generation error:", error);
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

            // Re-show recovery popup if it fails again
            showErrorRecoveryPopup({
                targetChatId,
                promptText,
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

export function initErrorRecovery() {
    const { popup, continueBtn, cancelBtn, closeBtn } = getErrorRecoveryElements();
    bindErrorRecoveryEvents(popup);
}
