/* =========================================================
   FULLSCREEN IMPLEMENTATION PLAN MODAL
   Clean overlay modal displaying the full implementation plan
   with Copy, Download, Review/Commenting, and Proceed actions.
   ========================================================= */
import { escapeHTML } from "../utils/dom.js";
import { chatbox } from "./chatbox.js";
import { attachCommenting, formatCommentsFeedbackPrompt } from "./plan-commenting.js";

let modalOverlay = null;
let commentingCleanup = null;
let currentComments = [];

/**
 * Opens the fullscreen Implementation Plan modal.
 *
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.markdown
 * @param {string} [options.artifactPath]
 * @param {Function} [options.onProceed]
 * @param {Function} [options.onCommentsSubmit]
 */
export function openPlanModal({
    title = "Implementation Plan",
    markdown = "",
    artifactPath = "",
    onProceed = null,
    onCommentsSubmit = null
}) {
    closePlanModal();

    modalOverlay = document.createElement("div");
    modalOverlay.id = "plan-modal-overlay";
    modalOverlay.className = "plan-modal-overlay";
    modalOverlay.setAttribute("role", "dialog");
    modalOverlay.setAttribute("aria-modal", "true");
    modalOverlay.setAttribute("aria-label", title);

    currentComments = [];

    // Parse markdown content
    let renderedHtml = "";
    if (typeof marked !== "undefined" && typeof marked.parse === "function") {
        try {
            renderedHtml = marked.parse(markdown);
            if (typeof DOMPurify !== "undefined" && typeof DOMPurify.sanitize === "function") {
                renderedHtml = DOMPurify.sanitize(renderedHtml);
            }
        } catch (_) {
            renderedHtml = `<pre>${escapeHTML(markdown)}</pre>`;
        }
    } else {
        renderedHtml = `<pre>${escapeHTML(markdown)}</pre>`;
    }

    modalOverlay.innerHTML = `
        <div class="plan-modal-container">
            <header class="plan-modal-header">
                <div class="plan-modal-header-left">
                    <span class="plan-modal-title">${escapeHTML(title || "Implementation Plan")}</span>
                    ${artifactPath ? `<span class="plan-modal-path" title="${escapeHTML(artifactPath)}">${escapeHTML(artifactPath.split("/").pop())}</span>` : ""}
                </div>
                <div class="plan-modal-header-actions">
                    <button type="button" class="plan-action-icon-btn plan-copy-btn" title="Copy markdown to clipboard" aria-label="Copy Plan">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                    <button type="button" class="plan-action-icon-btn plan-download-btn" title="Download plan markdown" aria-label="Download Plan">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                    <div class="plan-modal-review-indicator" title="Select any text to add comments">
                        <span>Review</span>
                        <span class="plan-comments-count-pill" style="display: none;">0</span>
                    </div>
                    <button type="button" class="plan-modal-proceed-btn" title="Approve and proceed with execution">
                        Proceed
                    </button>
                    <button type="button" class="plan-modal-close-btn" title="Close (Esc)" aria-label="Close">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </header>
            <main class="plan-modal-body">
                <article class="plan-modal-content" id="plan-modal-rendered-content">
                    ${renderedHtml}
                </article>
            </main>
        </div>
    `;

    document.body.appendChild(modalOverlay);
    document.body.classList.add("plan-modal-open");

    const contentEl = modalOverlay.querySelector("#plan-modal-rendered-content");
    const proceedBtn = modalOverlay.querySelector(".plan-modal-proceed-btn");
    const countPill = modalOverlay.querySelector(".plan-comments-count-pill");
    const copyBtn = modalOverlay.querySelector(".plan-copy-btn");
    const downloadBtn = modalOverlay.querySelector(".plan-download-btn");
    const closeBtn = modalOverlay.querySelector(".plan-modal-close-btn");

    // Live commenting setup
    if (contentEl) {
        commentingCleanup = attachCommenting(contentEl, (comments) => {
            currentComments = comments;
            if (comments.length > 0) {
                if (countPill) {
                    countPill.textContent = String(comments.length);
                    countPill.style.display = "inline-block";
                }
                if (proceedBtn) {
                    proceedBtn.textContent = `Submit Feedback (${comments.length})`;
                    proceedBtn.classList.add("has-feedback");
                }
            } else {
                if (countPill) countPill.style.display = "none";
                if (proceedBtn) {
                    proceedBtn.textContent = "Proceed";
                    proceedBtn.classList.remove("has-feedback");
                }
            }
        });
    }

    // Action: Copy
    if (copyBtn) {
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(markdown);
                copyBtn.classList.add("copied");
                setTimeout(() => copyBtn.classList.remove("copied"), 2000);
            } catch (_) {}
        };
    }

    // Action: Download
    if (downloadBtn) {
        downloadBtn.onclick = () => {
            const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const filename = (title || "implementation_plan")
                .toLowerCase()
                .replace(/[^a-z0-9_-]+/g, "_") + ".md";
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };
    }

    // Action: Proceed / Submit Feedback
    if (proceedBtn) {
        proceedBtn.onclick = () => {
            if (currentComments.length > 0) {
                const prompt = formatCommentsFeedbackPrompt(currentComments, title);
                closePlanModal();
                if (typeof onCommentsSubmit === "function") {
                    onCommentsSubmit(prompt, currentComments);
                } else {
                    chatbox.setValue(prompt);
                    chatbox.triggerSend();
                }
            } else {
                closePlanModal();
                if (typeof onProceed === "function") {
                    onProceed();
                } else {
                    chatbox.setValue("Proceed with the implementation plan.");
                    chatbox.triggerSend();
                }
            }
        };
    }

    // Action: Close
    if (closeBtn) {
        closeBtn.onclick = () => closePlanModal();
    }

    // Backdrop click
    modalOverlay.onclick = (e) => {
        if (e.target === modalOverlay) {
            closePlanModal();
        }
    };

    // Keyboard navigation
    function onKeyDown(e) {
        if (e.key === "Escape") {
            // Only close modal if comment popover is not open
            const popover = document.getElementById("plan-comment-popover");
            if (popover && popover.style.display !== "none") {
                return;
            }
            e.preventDefault();
            closePlanModal();
        }
    }
    window.addEventListener("keydown", onKeyDown);
    modalOverlay._keyListener = onKeyDown;
}

/**
 * Closes and disposes the Implementation Plan modal.
 */
export function closePlanModal() {
    if (commentingCleanup) {
        commentingCleanup();
        commentingCleanup = null;
    }
    if (modalOverlay) {
        if (modalOverlay._keyListener) {
            window.removeEventListener("keydown", modalOverlay._keyListener);
        }
        if (modalOverlay.parentNode) {
            modalOverlay.parentNode.removeChild(modalOverlay);
        }
        modalOverlay = null;
    }
    document.body.classList.remove("plan-modal-open");
    currentComments = [];
}
