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
import { isMobileBrowser } from "../utils/dom.js";
import { toggleModelPicker } from "./model-picker.js";

class ChatBoxComponent {
    constructor() {
        this.container = null;
        this.root = null;
        this.inputEl = null;
        this.sendBtn = null;
        this.attachBtn = null;
        this.stagedStrip = null;
        this.clearBtn = null;
        this.heroModelPickerBtn = null;

        this.isComposing = false;
        this.hasAttachments = false;
        this.sendCallbacks = [];
    }

    /**
     * Return the HTML template for the ChatBox dock.
     * Includes start page hero header and footer model selector for new chats.
     */
    renderTemplate() {
        return `
        <!-- Start Page Hero Header (Visible only when in start page mode) -->
        <div class="start-page-hero" id="startPageHero">
            <h1 class="start-page-title">How can I assist you today?</h1>
        </div>

        <div class="composer-dock composer composer-compact" id="chatboxDock">
            <!-- Start Page Dynamic Cloud Glow Effect (Visible only in start page mode) -->
            <div class="start-page-glow-aura" aria-hidden="true">
                <div class="glow-cloud glow-cloud-1"></div>
                <div class="glow-cloud glow-cloud-2"></div>
                <div class="glow-cloud glow-cloud-3"></div>
                <div class="glow-cloud glow-cloud-4"></div>
                <div class="glow-cloud-shimmer"></div>
            </div>

            <!-- Top: Staged Attachments Strip (Spanning from the left corner over the plus button) -->
            <div id="stagedAttachments" class="staged-attachments-strip" style="display: none;"></div>

            <!-- Bottom: Main input row -->
            <div class="composer-input-row">
                <!-- Left: Plus Attachment Button (Original 36x36 size, bottom-aligned) -->
                <button id="attachSheetBtn" type="button" class="icon-btn attach-btn" aria-label="Add attachments" title="Add attachments">
                    <i data-lucide="plus"></i>
                </button>

                <!-- Center: Main column with auto-expanding textarea -->
                <div class="composer-main-col">
                    <textarea 
                        id="input" 
                        class="composer-textarea" 
                        placeholder="Message AI..." 
                        rows="1" 
                        aria-label="Message AI"
                        enterkeyhint="enter"
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
        </div>

        <!-- Start Page Footer (Visible only when in start page mode, positioned under left corner of chatbox) -->
        <div class="start-page-footer" id="startPageFooter">
            <button id="heroModelPickerBtn" class="hero-model-picker-btn" type="button" aria-haspopup="dialog" aria-expanded="false" title="Select AI Model">
                <i data-lucide="bot" class="hero-model-icon"></i>
                <span id="heroModelPickerName" class="model-picker-name">Select Model</span>
                <i data-lucide="chevron-down" class="hero-model-chevron"></i>
            </button>
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
        this.heroModelPickerBtn = this.container.querySelector("#heroModelPickerBtn");

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

        // Safe Enter handling:
        // On mobile browsers: Enter never sends; it inserts a newline instead.
        // On desktop browsers: Enter sends, Shift+Enter inserts a newline.
        this.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                if (this.isComposing || e.isComposing) return;

                if (isMobileBrowser()) {
                    // Mobile browsers: do NOT send on Enter.
                    // Allow the native textarea action to insert a newline.
                    // The 'input' event will fire immediately after to resize and expand the chatbox.
                    return;
                }

                // Desktop browsers: Enter sends, Shift+Enter creates a newline
                if (!e.shiftKey) {
                    e.preventDefault();
                    this.triggerSend();
                }
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

        // Hero Model Picker button click (start page)
        if (this.heroModelPickerBtn) {
            this.heroModelPickerBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                toggleModelPicker();
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

        const isStartPage = document.getElementById("appShell")?.classList.contains("is-start-page");
        const text = this.inputEl.value || "";
        const hasNewline = text.includes("\n");
        const hasStaged = this.hasAttachments || 
            (this.stagedStrip && this.stagedStrip.children.length > 0 && this.stagedStrip.style.display !== "none");

        const baseHeight = 24;
        const maxHeight = 180;

        if (hasNewline || hasStaged) {
            this.inputEl.style.height = baseHeight + "px";
            const scrollH = this.inputEl.scrollHeight;
            const targetHeight = Math.min(Math.max(scrollH, 48), maxHeight);
            this.inputEl.style.height = targetHeight + "px";
            this.inputEl.style.overflowY = scrollH > maxHeight ? "auto" : "hidden";
        } else {
            this.inputEl.style.height = baseHeight + "px";
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

/**
 * Toggles the Start Page (hero state for new chats) vs Active Chat mode.
 * In Start Page mode:
 *   - The chat messages view is hidden.
 *   - The chatbox is centered in the viewport, spacious, and expanded.
 *   - The hero title is displayed above the chatbox.
 *   - The model selector sits directly below the left corner of the chatbox.
 * In Active Chat mode:
 *   - The chatbox docks to the bottom.
 *   - The hero title and hero model selector are hidden.
 *   - Chat messages are visible.
 */
export function setStartPageMode(isStartPage) {
    const shell = document.getElementById("appShell");
    if (!shell) return;

    if (isStartPage) {
        shell.classList.add("is-start-page");
        chatbox.handleInputResize();
    } else {
        shell.classList.remove("is-start-page");
        chatbox.handleInputResize();
    }
}
