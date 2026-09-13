/* =========================================================
   MODULAR CHATBOX COMPONENT
   Smoothly expanding layout:
     - Plus button [36x36] and Send button [36x36] stay locked at their
       original sizes and bottom-aligned positions.
     - Only the top expands upwards smoothly via modern CSS animation.
     - Single-line / empty: sleek compact pill matching backup.
     - Multi-line (\n) / attachments: center column expands top with
       butter-smooth transition.
   ========================================================= */
import { renderIcons } from "../utils/icons.js";

class ChatBoxComponent {
    constructor() {
        this.container = null;
        this.root = null;
        this.inputEl = null;
        this.sendBtn = null;
        this.attachBtn = null;
        this.stagedStrip = null;
        this.clearBtn = null;

        this.isComposing = false;
        this.hasAttachments = false;
        this.sendCallbacks = [];
    }

    /**
     * Return the HTML template for the ChatBox dock.
     * Keeps original component sizes and layout (Plus on bottom-left,
     * Send on bottom-right, center column expanding upwards).
     */
    renderTemplate() {
        return `
        <div class="composer-dock composer composer-compact" id="chatboxDock">
            <!-- Left: Plus Attachment Button (Original 36x36 size, bottom-aligned) -->
            <button id="attachSheetBtn" type="button" class="icon-btn attach-btn" aria-label="Add attachments" title="Add attachments">
                <i data-lucide="plus"></i>
            </button>

            <!-- Center: Main column with staged attachments preview & auto-expanding textarea -->
            <div class="composer-main-col">
                <div id="stagedAttachments" class="staged-attachments-strip" style="display: none;"></div>
                <textarea 
                    id="input" 
                    class="composer-textarea" 
                    placeholder="Message AI..." 
                    rows="1" 
                    aria-label="Message AI"
                    autocomplete="off"
                    autocorrect="on"
                    spellcheck="true"></textarea>
            </div>

            <!-- Right: Actions with Clear and Send Button (Original 36x36 size, bottom-aligned) -->
            <div class="composer-actions">
                <button type="button" class="composer-clear-btn" id="composerClearBtn" title="Clear text" aria-label="Clear text" style="display: none;">
                    <i data-lucide="x"></i>
                </button>
                <button id="send" type="button" class="composer-send-btn" aria-label="Send message" title="Send message">
                    <i data-lucide="arrow-up"></i>
                </button>
            </div>
        </div>
        `;
    }

    /**
     * Mounts the ChatBox component into the given DOM container.
     */
    mount(container) {
        if (!container) return;
        this.container = container;
        this.container.innerHTML = this.renderTemplate();

        this.root = this.container.querySelector("#chatboxDock");
        this.inputEl = this.container.querySelector("#input");
        this.sendBtn = this.container.querySelector("#send");
        this.attachBtn = this.container.querySelector("#attachSheetBtn");
        this.stagedStrip = this.container.querySelector("#stagedAttachments");
        this.clearBtn = this.container.querySelector("#composerClearBtn");

        this.bindEvents();
        this.updateLayoutMode();
        renderIcons(this.container);
    }

    /**
     * Bind internal interactions and keyboard ergonomics.
     */
    bindEvents() {
        if (!this.inputEl) return;

        // Auto-resize and adapt mode smoothly on input
        this.inputEl.addEventListener("input", () => {
            this.handleInputResize();
            this.updateInputMeta();
        });

        // IME composition protection (Japanese, Chinese, Korean, etc.)
        this.inputEl.addEventListener("compositionstart", () => {
            this.isComposing = true;
        });
        this.inputEl.addEventListener("compositionend", () => {
            this.isComposing = false;
        });

        // Safe Enter to submit; Shift+Enter creates a newline and smoothly expands the top
        this.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                if (this.isComposing || e.isComposing) return;
                e.preventDefault();
                this.triggerSend();
            } else if (e.key === "Escape") {
                if (this.inputEl.value) {
                    e.preventDefault();
                    this.clearInput();
                }
            }
        });

        // Send button click
        if (this.sendBtn) {
            this.sendBtn.addEventListener("click", () => {
                this.triggerSend();
            });
        }

        // Clear button click
        if (this.clearBtn) {
            this.clearBtn.addEventListener("click", () => {
                this.clearInput();
                this.focus();
            });
        }
    }

    /**
     * Tracks whether the input is single-line or multi-line/staged.
     */
    updateLayoutMode() {
        if (!this.root || !this.inputEl) return;

        const text = this.inputEl.value || "";
        const hasNewline = text.includes("\n");
        const hasStaged = this.hasAttachments || 
            (this.stagedStrip && this.stagedStrip.children.length > 0 && this.stagedStrip.style.display !== "none");

        const shouldExpand = hasNewline || hasStaged;

        if (shouldExpand) {
            if (!this.root.classList.contains("composer-expanded")) {
                this.root.classList.remove("composer-compact");
                this.root.classList.add("composer-expanded");
            }
        } else {
            if (!this.root.classList.contains("composer-compact")) {
                this.root.classList.remove("composer-expanded");
                this.root.classList.add("composer-compact");
            }
        }
    }

    /**
     * Smoothly calculates target height for the textarea.
     * Keeps buttons fixed at the bottom while the top expands upwards.
     */
    handleInputResize() {
        if (!this.inputEl) return;
        this.updateLayoutMode();

        const text = this.inputEl.value || "";
        const hasNewline = text.includes("\n");
        const hasStaged = this.hasAttachments || 
            (this.stagedStrip && this.stagedStrip.children.length > 0 && this.stagedStrip.style.display !== "none");

        if (hasNewline || hasStaged) {
            this.inputEl.style.height = "24px";
            const scrollH = this.inputEl.scrollHeight;
            const targetHeight = Math.min(Math.max(scrollH, 48), 180);
            this.inputEl.style.height = targetHeight + "px";
            this.inputEl.style.overflowY = scrollH > 180 ? "auto" : "hidden";
        } else {
            this.inputEl.style.height = "24px";
            this.inputEl.style.overflowY = "hidden";
        }
    }

    updateInputMeta() {
        const val = (this.inputEl?.value || "").trim();
        if (this.clearBtn) {
            this.clearBtn.style.display = val.length > 0 ? "inline-flex" : "none";
        }
    }

    setHasAttachments(hasAtts) {
        this.hasAttachments = !!hasAtts;
        this.handleInputResize();
    }

    triggerSend() {
        for (const cb of this.sendCallbacks) {
            try {
                cb({
                    text: this.getValue()
                });
            } catch (err) {
                console.error("ChatBox onSend error:", err);
            }
        }
    }

    /* =========================================================
       PUBLIC API FOR EXTERNAL COMPONENTS / SCRIPTS
       ========================================================= */

    onSend(cb) {
        if (typeof cb === "function") this.sendCallbacks.push(cb);
    }

    getValue() {
        return (this.inputEl?.value || "").trim();
    }

    setValue(val) {
        if (this.inputEl) {
            this.inputEl.value = val;
            this.handleInputResize();
            this.updateInputMeta();
        }
    }

    clearInput() {
        if (this.inputEl) {
            this.inputEl.value = "";
            this.handleInputResize();
            this.updateInputMeta();
        }
    }

    focus() {
        if (this.inputEl && !this.inputEl.disabled) {
            this.inputEl.focus();
        }
    }

    setGenerating(active) {
        if (!this.sendBtn || !this.inputEl) return;
        const modelSelect = document.getElementById("modelSelect");

        if (active) {
            this.sendBtn.classList.add("generating");
            this.sendBtn.title = "Stop generation";
            this.sendBtn.setAttribute("aria-label", "Stop generation");
            this.sendBtn.innerHTML = '<i data-lucide="square"></i>';
            renderIcons(this.sendBtn);
            this.inputEl.disabled = true;
            if (modelSelect) modelSelect.disabled = true;
            if (this.attachBtn) this.attachBtn.disabled = true;
        } else {
            this.sendBtn.classList.remove("generating");
            this.sendBtn.title = "Send message";
            this.sendBtn.setAttribute("aria-label", "Send message");
            this.sendBtn.innerHTML = '<i data-lucide="arrow-up"></i>';
            renderIcons(this.sendBtn);
            this.inputEl.disabled = false;
            if (modelSelect) modelSelect.disabled = false;
            if (this.attachBtn) this.attachBtn.disabled = false;
            this.focus();
        }
    }
}

export const chatbox = new ChatBoxComponent();
