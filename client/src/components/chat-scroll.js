/* =========================================================
   CHAT SCROLL & SCROLL-TO-BOTTOM AFFORDANCE
   Manages frame-throttled scrolling, bottom sentinel, and jump button
   ========================================================= */
import { renderIcons } from "../utils/icons.js";

let streamScrollRafId = null;

export function requestScrollToBottom(chat, force = false) {
    if (!chat) return;
    if (force) {
        if (streamScrollRafId) {
            cancelAnimationFrame(streamScrollRafId);
            streamScrollRafId = null;
        }
        chat.scrollTop = chat.scrollHeight;
        return;
    }
    if (streamScrollRafId) return;
    streamScrollRafId = requestAnimationFrame(() => {
        streamScrollRafId = null;
        const isNearBottom = (chat.scrollHeight - chat.scrollTop - chat.clientHeight) < 140;
        if (isNearBottom) {
            chat.scrollTop = chat.scrollHeight;
        }
    });
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

    const SCROLL_THRESHOLD = 90; // pixels from bottom before affordance appears
    let isTicking = false;

    function updateVisibility() {
        const appShell = document.getElementById("appShell");
        const isStartPage = appShell?.classList.contains("is-start-page");
        if (isStartPage) {
            btn.classList.remove("visible");
            return;
        }

        const distanceFromBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
        const hasScrollableContent = chat.scrollHeight > chat.clientHeight + 60;

        if (hasScrollableContent && distanceFromBottom > SCROLL_THRESHOLD) {
            btn.classList.add("visible");
        } else {
            btn.classList.remove("visible");
        }
    }

    // Passive scroll listener with requestAnimationFrame throttling
    chat.addEventListener("scroll", () => {
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
                    btn.classList.remove("visible");
                } else {
                    updateVisibility();
                }
            }
        }, { root: chat, threshold: 0.1 });
    }
    ensureSentinel();

    // Scroll to bottom on click (instant on mobile to prevent animation thrashing)
    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isMobile = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches ||
                         document.documentElement.classList.contains("is-android");
        const scrollBehavior = isMobile ? "auto" : "smooth";
        chat.scrollTo({
            top: chat.scrollHeight,
            behavior: scrollBehavior
        });
        btn.classList.remove("visible");

        // Follow-up checks in case any dynamic content or code blocks render during scroll
        const ensureAtEnd = () => {
            const distance = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
            if (distance > 30) {
                chat.scrollTo({
                    top: chat.scrollHeight,
                    behavior: scrollBehavior
                });
            }
        };
        if ("onscrollend" in window) {
            chat.addEventListener("scrollend", ensureAtEnd, { once: true });
        }
        setTimeout(ensureAtEnd, isMobile ? 50 : 350);
        setTimeout(ensureAtEnd, isMobile ? 120 : 750);
    });

    // Update whenever chat session changes or messages update
    document.addEventListener("chatsUpdated", () => {
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
