/* =========================================================
   PLAN COMMENTING ENGINE (INLINE SELECTION & ANNOTATION)
   Supports live text selection, floating Comment bubble,
   inline mark wrapping, and comment bundling for agent prompt.
   ========================================================= */

let activeComments = [];
let cleanupFn = null;

/**
 * Formats a list of comments into a clear prompt for the model to update the plan.
 *
 * @param {Array<Object>} comments
 * @param {string} [planTitle]
 * @returns {string}
 */
export function formatCommentsFeedbackPrompt(comments, planTitle = "Implementation Plan") {
    if (!comments || comments.length === 0) {
        return "Proceed with the implementation plan.";
    }

    let prompt = `[Implementation Plan Review Feedback]:\nPlease update the implementation plan ("${planTitle}") based on the following inline comments:\n\n`;

    comments.forEach((c, idx) => {
        prompt += `${idx + 1}. Regarding:\n> "${c.quote}"\nFeedback: ${c.text}\n\n`;
    });

    prompt += `Please update the plan artifact and write_todos to reflect these changes, then present the revised plan.`;
    return prompt;
}

/**
 * Attaches live commenting to a rendered plan container.
 *
 * @param {HTMLElement} containerEl
 * @param {Function} onCommentsUpdated
 * @returns {Function} Teardown function
 */
export function attachCommenting(containerEl, onCommentsUpdated) {
    if (cleanupFn) {
        cleanupFn();
    }
    activeComments = [];

    // Create or locate the floating comment bubble
    let bubble = document.getElementById("plan-comment-bubble");
    if (!bubble) {
        bubble = document.createElement("div");
        bubble.id = "plan-comment-bubble";
        bubble.className = "plan-comment-bubble";
        bubble.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>Comment</span>
            <kbd>Ctrl+Alt+M</kbd>
        `;
        document.body.appendChild(bubble);
    }
    bubble.style.display = "none";

    // Create or locate the comment drafting popover
    let popover = document.getElementById("plan-comment-popover");
    if (!popover) {
        popover = document.createElement("div");
        popover.id = "plan-comment-popover";
        popover.className = "plan-comment-popover";
        popover.innerHTML = `
            <div class="plan-popover-quote"></div>
            <textarea class="plan-popover-input" placeholder="Add feedback or change request..." rows="2"></textarea>
            <div class="plan-popover-actions">
                <button type="button" class="plan-popover-btn cancel">Cancel</button>
                <button type="button" class="plan-popover-btn add">Add Comment</button>
            </div>
        `;
        document.body.appendChild(popover);
    }
    popover.style.display = "none";

    let currentRange = null;
    let currentQuote = "";

    function hideBubble() {
        if (bubble) bubble.style.display = "none";
    }

    function hidePopover() {
        if (popover) {
            popover.style.display = "none";
            const input = popover.querySelector(".plan-popover-input");
            if (input) input.value = "";
        }
        currentRange = null;
        currentQuote = "";
    }

    function handleSelectionChange() {
        // If popover is currently open, don't move or dismiss it
        if (popover && popover.style.display === "flex") {
            return;
        }

        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
            hideBubble();
            return;
        }

        const range = sel.getRangeAt(0);
        // Ensure selection is inside containerEl
        if (!containerEl.contains(range.commonAncestorContainer)) {
            hideBubble();
            return;
        }

        const text = sel.toString().trim();
        if (text.length < 3) {
            hideBubble();
            return;
        }

        currentRange = range.cloneRange();
        currentQuote = text;

        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            hideBubble();
            return;
        }

        // Position bubble above the selection
        bubble.style.display = "inline-flex";
        const bubbleWidth = bubble.offsetWidth || 140;
        let top = rect.top - 38 + window.scrollY;
        let left = rect.left + (rect.width / 2) - (bubbleWidth / 2) + window.scrollX;

        // Keep inside viewport bounds
        if (top < 10) top = rect.bottom + 8 + window.scrollY;
        if (left < 10) left = 10;
        if (left + bubbleWidth > window.innerWidth - 10) {
            left = window.innerWidth - bubbleWidth - 10;
        }

        bubble.style.top = `${top}px`;
        bubble.style.left = `${left}px`;
    }

    function openDraftPopover() {
        if (!currentRange || !currentQuote) return;
        hideBubble();

        const quoteEl = popover.querySelector(".plan-popover-quote");
        const inputEl = popover.querySelector(".plan-popover-input");
        if (quoteEl) {
            quoteEl.textContent = currentQuote.length > 80 ? currentQuote.slice(0, 80) + "…" : currentQuote;
        }

        popover.style.display = "flex";
        const rect = currentRange.getBoundingClientRect();
        let top = rect.bottom + 8 + window.scrollY;
        let left = rect.left + window.scrollX;
        const popoverWidth = 320;

        if (left + popoverWidth > window.innerWidth - 20) {
            left = window.innerWidth - popoverWidth - 20;
        }
        if (top + 160 > window.innerHeight + window.scrollY) {
            top = rect.top - 150 + window.scrollY;
        }

        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;

        if (inputEl) {
            inputEl.value = "";
            inputEl.focus();
        }
    }

    function submitComment() {
        const inputEl = popover.querySelector(".plan-popover-input");
        const text = inputEl ? inputEl.value.trim() : "";
        if (!text || !currentRange) {
            hidePopover();
            return;
        }

        const commentId = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const commentObj = {
            id: commentId,
            quote: currentQuote,
            text,
            createdAt: Date.now()
        };
        activeComments.push(commentObj);

        // Highlight selection in DOM
        try {
            const mark = document.createElement("mark");
            mark.className = "plan-comment-mark";
            mark.setAttribute("data-comment-id", commentId);
            mark.title = `Comment: ${text}`;
            currentRange.surroundContents(mark);
        } catch (_) {
            // If surroundContents fails due to cross-node boundaries, fallback without breaking
        }

        hidePopover();
        window.getSelection()?.removeAllRanges();

        if (typeof onCommentsUpdated === "function") {
            onCommentsUpdated([...activeComments]);
        }
    }

    bubble.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDraftPopover();
    };

    const cancelBtn = popover.querySelector(".plan-popover-btn.cancel");
    if (cancelBtn) {
        cancelBtn.onclick = (e) => {
            e.preventDefault();
            hidePopover();
        };
    }

    const addBtn = popover.querySelector(".plan-popover-btn.add");
    if (addBtn) {
        addBtn.onclick = (e) => {
            e.preventDefault();
            submitComment();
        };
    }

    const inputEl = popover.querySelector(".plan-popover-input");
    if (inputEl) {
        inputEl.onkeydown = (e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submitComment();
            } else if (e.key === "Escape") {
                e.preventDefault();
                hidePopover();
            }
        };
    }

    function onKeyDown(e) {
        // Ctrl+Alt+M or Cmd+Alt+M
        if (e.altKey && (e.ctrlKey || e.metaKey) && (e.key === "m" || e.key === "M")) {
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && sel.toString().trim().length >= 3) {
                e.preventDefault();
                handleSelectionChange();
                openDraftPopover();
            }
        }
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("keydown", onKeyDown);

    cleanupFn = () => {
        document.removeEventListener("selectionchange", handleSelectionChange);
        document.removeEventListener("keydown", onKeyDown);
        hideBubble();
        hidePopover();
        if (bubble && bubble.parentNode) bubble.parentNode.removeChild(bubble);
        if (popover && popover.parentNode) popover.parentNode.removeChild(popover);
        cleanupFn = null;
    };

    return cleanupFn;
}

export function getActiveComments() {
    return [...activeComments];
}

export function clearActiveComments() {
    activeComments = [];
}
