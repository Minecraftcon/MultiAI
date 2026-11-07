/* =========================================================
   CHAT SCROLL & SCROLL-TO-BOTTOM AFFORDANCE
   Physics-based smooth pull, intelligent detachment, and jump affordance
   ========================================================= */
import { renderIcons } from "../utils/icons.js";

let animRafId = null;
let isProgrammaticScroll = false;
let isUserDetached = false;
let lastPullTime = 0;
const SCROLL_THRESHOLD = 90; // Pixels from bottom before affordance appears

/**
 * Returns whether user is currently detached and inspecting content above.
 */
export function getIsUserDetached() {
    return isUserDetached;
}

/**
 * Detaches the auto-scroll lock when user actively inspects earlier content.
 */
export function detachUserScroll() {
    isUserDetached = true;
    if (animRafId) {
        cancelAnimationFrame(animRafId);
        animRafId = null;
    }
    updateVisibility();
}

/**
 * Re-engages the auto-scroll lock when user returns to bottom.
 */
export function reengageUserScroll() {
    isUserDetached = false;
    const btn = document.getElementById("scrollToBottomBtn");
    if (btn) {
        btn.classList.remove("has-unread");
    }
}

/**
 * Smoothly pulls the scroll position towards bottom using continuous lerp physics.
 * Adapts frame-by-frame as new stream tokens or tool badges expand the container.
 */
export function smoothPullToBottom(chat) {
    if (!chat) chat = document.getElementById("chat");
    if (!chat || isUserDetached) return;

    if (!animRafId) {
        lastPullTime = performance.now();
        animRafId = requestAnimationFrame(pullTick);
    }
}

function pullTick(now) {
    animRafId = null;
    const chat = document.getElementById("chat");
    if (!chat || isUserDetached) return;

    const current = chat.scrollTop;
    const maxScroll = Math.max(0, chat.scrollHeight - chat.clientHeight);
    const diff = maxScroll - current;

    // Subpixel landing check: finish cleanly at bottom
    if (Math.abs(diff) <= 0.8) {
        if (current !== maxScroll) {
            isProgrammaticScroll = true;
            chat.scrollTop = maxScroll;
            isProgrammaticScroll = false;
        }
        updateVisibility();
        return;
    }

    // Refresh-rate-independent physics time step (60Hz / 120Hz / 144Hz)
    const dt = Math.min((now - (lastPullTime || now)) / 1000, 0.05);
    lastPullTime = now;

    // Fluid critically-damped exponential approach (lambda ~ 22)
    // Produces a smooth magnetic pull without sudden teleports or frame drops
    const lambda = 22;
    const factor = 1 - Math.exp(-lambda * dt);
    let step = diff * factor;

    // Minimum 0.75px progress per tick to avoid subpixel stalls
    if (Math.abs(step) < 0.75) {
        step = diff > 0 ? 0.75 : -0.75;
    }

    isProgrammaticScroll = true;
    chat.scrollTop = current + step;
    isProgrammaticScroll = false;

    animRafId = requestAnimationFrame(pullTick);
}

/**
 * Requests scrolling to the bottom.
 * If user is actively inspecting earlier content (isUserDetached = true),
 * this preserves the user's viewport without pulling and flags unread content.
 * If forceReengage is passed (e.g. user prompt submission), it re-engages and pulls.
 */
export function requestScrollToBottom(chat, forceOrOptions = false) {
    if (!chat) chat = document.getElementById("chat");
    if (!chat) return;

    const forceReengage = typeof forceOrOptions === "boolean"
        ? forceOrOptions && !isUserDetached
        : Boolean(forceOrOptions?.forceReengage);

    const immediate = typeof forceOrOptions === "object" && Boolean(forceOrOptions?.immediate);

    if (forceReengage) {
        isUserDetached = false;
        const btn = document.getElementById("scrollToBottomBtn");
        if (btn) btn.classList.remove("has-unread");
    }

    if (isUserDetached) {
        const btn = document.getElementById("scrollToBottomBtn");
        if (btn) {
            btn.classList.add("visible", "has-unread");
        }
        return;
    }

    if (immediate) {
        if (animRafId) {
            cancelAnimationFrame(animRafId);
            animRafId = null;
        }
        isProgrammaticScroll = true;
        chat.scrollTop = Math.max(0, chat.scrollHeight - chat.clientHeight);
        isProgrammaticScroll = false;
        updateVisibility();
        return;
    }

    smoothPullToBottom(chat);
}

/**
 * Force re-engages auto-scroll and smoothly pulls to bottom.
 * Used when the user performs an explicit bottom action (e.g. sending a message or clicking jump button).
 */
export function forceReengageAutoScroll(chat) {
    if (!chat) chat = document.getElementById("chat");
    if (!chat) return;

    isUserDetached = false;
    const btn = document.getElementById("scrollToBottomBtn");
    if (btn) btn.classList.remove("has-unread");

    smoothPullToBottom(chat);
}

function updateVisibility() {
    const chat = document.getElementById("chat");
    const btn = document.getElementById("scrollToBottomBtn");
    if (!chat || !btn) return;

    const appShell = document.getElementById("appShell");
    const isStartPage = appShell?.classList.contains("is-start-page");
    if (isStartPage) {
        btn.classList.remove("visible", "has-unread");
        return;
    }

    const distanceFromBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
    const hasScrollableContent = chat.scrollHeight > chat.clientHeight + 40;

    if (hasScrollableContent && (distanceFromBottom > SCROLL_THRESHOLD || isUserDetached)) {
        btn.classList.add("visible");
    } else {
        btn.classList.remove("visible", "has-unread");
        if (distanceFromBottom <= 30) {
            isUserDetached = false;
        }
    }
}

export function initScrollToBottom() {
    const chat = document.getElementById("chat");
    const btn = document.getElementById("scrollToBottomBtn");
    if (!chat || !btn) return;

    renderIcons(btn);

    // Dynamic height tracking of composer so button floats cleanly above it
    const inputArea = document.getElementById("inputArea");
    const updateComposerHeight = () => {
        if (!inputArea || !btn) return;
        const rect = inputArea.getBoundingClientRect();
        const height = Math.round(rect.height || inputArea.offsetHeight || 94);
        btn.style.bottom = `${height + 22}px`;
    };

    if (inputArea && typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => {
            updateComposerHeight();
        });
        ro.observe(inputArea);
    }
    updateComposerHeight();

    let isTicking = false;

    // 1. Wheel listener: immediate detachment when scrolling UP, re-engage when hitting bottom
    chat.addEventListener("wheel", (e) => {
        if (e.deltaY < -1) {
            detachUserScroll();
        } else if (e.deltaY > 1) {
            const dist = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
            if (dist <= 30) {
                reengageUserScroll();
            }
        }
    }, { passive: true });

    // 2. Touch gestures: release when dragging down into history, re-engage on bottom
    let touchStartY = 0;
    chat.addEventListener("touchstart", (e) => {
        touchStartY = e.touches[0]?.clientY || 0;
    }, { passive: true });

    chat.addEventListener("touchmove", (e) => {
        const currentY = e.touches[0]?.clientY || 0;
        const deltaY = currentY - touchStartY;
        if (deltaY > 8) {
            // Dragging downward = viewing earlier messages
            detachUserScroll();
        } else if (deltaY < -8) {
            const dist = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
            if (dist <= 30) {
                reengageUserScroll();
            }
        }
    }, { passive: true });

    // 3. Pointer on scrollbar: immediately release
    chat.addEventListener("pointerdown", (e) => {
        if (e.offsetX >= chat.clientWidth - 16) {
            detachUserScroll();
        }
    }, { passive: true });

    // 4. Keyboard navigation keys
    chat.addEventListener("keydown", (e) => {
        if (["PageUp", "ArrowUp", "Home"].includes(e.key)) {
            detachUserScroll();
        } else if (["PageDown", "ArrowDown", "End"].includes(e.key)) {
            requestAnimationFrame(() => {
                const dist = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
                if (dist <= 30) {
                    reengageUserScroll();
                }
            });
        }
    }, { passive: true });

    // 5. Scroll listener for drag / momentum
    chat.addEventListener("scroll", () => {
        if (isProgrammaticScroll) return;

        const distanceFromBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
        if (distanceFromBottom > SCROLL_THRESHOLD) {
            if (!isUserDetached) {
                detachUserScroll();
            }
        } else if (distanceFromBottom <= 25) {
            if (isUserDetached) {
                reengageUserScroll();
            }
        }

        if (!isTicking) {
            window.requestAnimationFrame(() => {
                updateVisibility();
                isTicking = false;
            });
            isTicking = true;
        }
    }, { passive: true });

    // Ensure bottom sentinel exists and is observed
    let sentinel = document.getElementById("chatBottomSentinel");
    let observer = null;
    const ensureSentinel = () => {
        if (!sentinel || !chat.contains(sentinel)) {
            sentinel = document.getElementById("chatBottomSentinel");
            if (!sentinel) {
                sentinel = document.createElement("div");
                sentinel.id = "chatBottomSentinel";
                sentinel.className = "chat-bottom-sentinel";
                sentinel.setAttribute("aria-hidden", "true");
                chat.appendChild(sentinel);
            }
            if (observer && sentinel) {
                observer.observe(sentinel);
            }
        }
    };

    if (typeof IntersectionObserver !== "undefined") {
        observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    if (!isUserDetached) {
                        btn.classList.remove("visible", "has-unread");
                    }
                } else {
                    updateVisibility();
                }
            }
        }, { root: chat, threshold: 0.1 });
    }
    ensureSentinel();

    // Scroll to bottom on button click: force re-engage and smoothly pull
    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        forceReengageAutoScroll(chat);
        btn.classList.remove("visible", "has-unread");
    });

    // Update whenever chat session changes or messages update
    document.addEventListener("chatsUpdated", () => {
        isUserDetached = false;
        if (animRafId) {
            cancelAnimationFrame(animRafId);
            animRafId = null;
        }
        ensureSentinel();
        updateComposerHeight();
        setTimeout(updateVisibility, 80);
    });

    // MutationObserver on chat to ensure sentinel stays at bottom
    if (typeof MutationObserver !== "undefined") {
        const mutationObserver = new MutationObserver(() => {
            ensureSentinel();
            if (sentinel && sentinel.nextElementSibling) {
                chat.appendChild(sentinel);
            }
            updateVisibility();
        });
        mutationObserver.observe(chat, { childList: true, subtree: false });
    }

    // Initial check
    setTimeout(() => {
        updateComposerHeight();
        updateVisibility();
    }, 150);
}
