/* =========================================================
   PRODUCTION TOUCH GESTURE ENGINE (rAF Buffer + Slop Lock)
   ========================================================= */

let isPanelOpen = false;

let touchStartX = 0;
let touchStartY = 0;
let lastX = 0;
let lastTime = 0;
let velocityX = 0;

let isTracking = false;
let isLocked = false;
let isHorizontal = false;
let initialVisualX = 0;

let pendingX = 0;
let rafId = null;
let closeTimeout = null;

const SLOP_H = 6;
const SLOP_V = 10;

function getElements() {
    return {
        sidePanel: document.getElementById("sidePanel"),
        appShell: document.getElementById("appShell"),
        backdrop: document.getElementById("backdrop"),
        panelToggle: document.getElementById("panelToggle"),
        panelClose: document.getElementById("panelClose")
    };
}

export function getPanelWidth() {
    const { sidePanel } = getElements();
    if (!sidePanel) return 336;
    // Prefer offsetWidth (unscaled layout CSS pixels) over getBoundingClientRect to avoid CSS zoom distortion
    return sidePanel.offsetWidth || (sidePanel.getBoundingClientRect ? sidePanel.getBoundingClientRect().width : 0) || 336;
}

export function getCurrentVisualX() {
    const { sidePanel } = getElements();
    const width = getPanelWidth();
    if (!sidePanel) return isPanelOpen ? width : 0;
    try {
        const style = window.getComputedStyle(sidePanel);
        const transform = style.transform || style.webkitTransform;
        if (!transform || transform === "none") {
            return isPanelOpen ? width : 0;
        }
        if (typeof DOMMatrixReadOnly !== "undefined") {
            const matrix = new DOMMatrixReadOnly(transform);
            const x = matrix.m41 + width;
            if (!isNaN(x)) return Math.max(0, Math.min(width, x));
        }
        // Fallback parser for older Android WebViews
        const match = transform.match(/matrix(?:3d)?\((.+)\)/);
        if (match) {
            const values = match[1].split(/,\s*/);
            const rawX = values.length === 6 ? parseFloat(values[4]) : parseFloat(values[12]);
            const x = rawX + width;
            if (!isNaN(x)) return Math.max(0, Math.min(width, x));
        }
        return isPanelOpen ? width : 0;
    } catch {
        return isPanelOpen ? width : 0;
    }
}

export function renderTransform(x, withAnimation = false) {
    const { sidePanel, backdrop } = getElements();
    if (!sidePanel || !backdrop) return;

    const width = getPanelWidth();
    const clampedX = Math.max(0, Math.min(width, x));
    const progress = clampedX / width;

    if (withAnimation) {
        sidePanel.classList.add("animate-transition");
        backdrop.classList.add("animate-transition");
    } else {
        sidePanel.classList.remove("animate-transition");
        backdrop.classList.remove("animate-transition");
    }

    if (clampedX === 0) {
        sidePanel.style.transform = "translate3d(-100%, 0, 0)";
        backdrop.style.opacity = "0";
        backdrop.style.pointerEvents = "none";
        return;
    }

    if (clampedX === width) {
        sidePanel.style.transform = "translate3d(0, 0, 0)";
        backdrop.style.opacity = "1";
        backdrop.style.pointerEvents = "auto";
        return;
    }

    sidePanel.style.transform = `translate3d(${clampedX - width}px, 0, 0)`;
    backdrop.style.opacity = progress.toString();
    if (progress > 0.05 && backdrop.style.pointerEvents !== "auto") {
        backdrop.style.pointerEvents = "auto";
    } else if (progress <= 0.05 && backdrop.style.pointerEvents !== "none") {
        backdrop.style.pointerEvents = "none";
    }
}

export function requestRender(x) {
    pendingX = x;
    if (!rafId) {
        rafId = requestAnimationFrame(() => {
            renderTransform(pendingX, false);
            rafId = null;
        });
    }
}

export function openPanel(animated = true) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (closeTimeout) { clearTimeout(closeTimeout); closeTimeout = null; }
    isPanelOpen = true;

    const { sidePanel, panelToggle, backdrop } = getElements();
    if (sidePanel) sidePanel.setAttribute("aria-hidden", "false");
    if (panelToggle) panelToggle.setAttribute("aria-expanded", "true");
    if (backdrop) {
        backdrop.style.opacity = "1";
        backdrop.style.pointerEvents = "auto";
    }

    const width = getPanelWidth();
    pendingX = width;
    renderTransform(width, animated);
}

export function closePanel(animated = true) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (closeTimeout) { clearTimeout(closeTimeout); closeTimeout = null; }
    isPanelOpen = false;

    const { sidePanel, panelToggle, backdrop } = getElements();
    if (panelToggle) panelToggle.setAttribute("aria-expanded", "false");
    if (backdrop) {
        backdrop.style.opacity = "0";
        backdrop.style.pointerEvents = "none";
    }

    pendingX = 0;
    renderTransform(0, animated);

    // Keep sidePanel active during close animation so touches/interruption can catch it
    if (animated) {
        closeTimeout = setTimeout(() => {
            if (!isPanelOpen && !isTracking) {
                const { sidePanel: sp } = getElements();
                if (sp) sp.setAttribute("aria-hidden", "true");
            }
            closeTimeout = null;
        }, 340);
    } else {
        if (sidePanel) sidePanel.setAttribute("aria-hidden", "true");
    }
}

export function togglePanel() {
    const visualX = getCurrentVisualX();
    const width = getPanelWidth();
    if (isPanelOpen || visualX > width * 0.4) {
        closePanel(true);
    } else {
        openPanel(true);
    }
}

export function getIsPanelOpen() {
    return isPanelOpen;
}

export function initGestures() {
    closePanel(false);
    const { panelToggle, panelClose, backdrop } = getElements();

    let lastToggleTime = 0;
    const handleToggle = (e) => {
        const now = Date.now();
        if (now - lastToggleTime < 150) return;
        lastToggleTime = now;
        if (e && e.type !== "click" && e.cancelable) {
            e.preventDefault();
        }
        togglePanel();
    };

    if (panelToggle) {
        panelToggle.addEventListener("click", handleToggle);
        panelToggle.addEventListener("touchend", handleToggle);
    }

    let lastCloseTime = 0;
    const handleClose = (e) => {
        const now = Date.now();
        if (now - lastCloseTime < 150) return;
        lastCloseTime = now;
        if (e && e.type !== "click" && e.cancelable) {
            e.preventDefault();
        }
        closePanel(true);
    };

    if (panelClose) {
        panelClose.addEventListener("click", handleClose);
        panelClose.addEventListener("touchend", handleClose);
    }

    if (backdrop) {
        backdrop.addEventListener("click", handleClose);
        backdrop.addEventListener("touchend", handleClose);
    }

    window.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) return;

        const target = e.target;
        // Don't intercept touches on interactive inputs, controls, or code blocks
        if (target.closest('button, a, input, textarea, select, pre, .table-wrapper, table, .mobile-msg-actions, .composer, .command-output-box, .model-picker-dropdown')) {
            return;
        }

        const t = e.touches[0];
        const width = getPanelWidth();
        const visualX = getCurrentVisualX();

        // Edge / Left-zone constraint:
        // When drawer is fully closed, initiate drawer swipe from a generous left zone
        // (up to 45% of screen width, minimum 160px).
        // This eliminates the restrictive 36px sliver and avoids Android OS gesture back conflicts.
        const maxOpenStartX = Math.max(160, window.innerWidth * 0.45);
        if (visualX <= 2 && !isPanelOpen && t.clientX > maxOpenStartX) {
            isTracking = false;
            return;
        }

        // Interrupt any ongoing transition immediately!
        if (closeTimeout) {
            clearTimeout(closeTimeout);
            closeTimeout = null;
        }
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        const { sidePanel, backdrop } = getElements();
        if (sidePanel) {
            sidePanel.classList.remove("animate-transition");
            sidePanel.setAttribute("aria-hidden", "false");
        }
        if (backdrop) backdrop.classList.remove("animate-transition");

        // Freeze in-flight transforms instantly without jump
        if (visualX > 0 && visualX < width) {
            renderTransform(visualX, false);
        }

        touchStartX = t.clientX;
        touchStartY = t.clientY;
        lastX = t.clientX;
        lastTime = performance.now();
        velocityX = 0;
        initialVisualX = visualX;
        pendingX = visualX;

        isTracking = true;
        isLocked = false;
        isHorizontal = false;
    }, { passive: false });

    window.addEventListener("touchmove", (e) => {
        if (!isTracking) return;

        const t = e.touches[0];
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        const width = getPanelWidth();

        if (!isLocked) {
            // Priority 1: Detect vertical scroll intent
            if (absY >= SLOP_V && absY > absX * 1.4) {
                isLocked = true;
                isHorizontal = false;
                isTracking = false;
                return;
            }

            // Priority 2: Detect horizontal drawer intent
            if (absX >= SLOP_H && absX > absY * 0.75) {
                // If closed, must be pulling rightwards
                if (initialVisualX <= 2 && dx <= 0) {
                    isTracking = false;
                    return;
                }
                // If open, must be pulling leftwards
                if (initialVisualX >= width - 2 && dx >= 0) {
                    isTracking = false;
                    return;
                }

                isLocked = true;
                isHorizontal = true;
            } else {
                return;
            }
        }

        if (!isHorizontal) return;

        // Prevent native browser back-navigation & vertical scroll hijacking
        if (e.cancelable) {
            e.preventDefault();
        }

        const now = performance.now();
        const dt = now - lastTime;
        if (dt > 0) {
            const instantV = (t.clientX - lastX) / dt;
            velocityX = 0.6 * instantV + 0.4 * velocityX;
            lastX = t.clientX;
            lastTime = now;
        }

        const currentX = Math.max(0, Math.min(width, initialVisualX + dx));
        requestRender(currentX);
    }, { passive: false });

    window.addEventListener("touchend", () => {
        if (!isTracking || !isHorizontal) {
            isTracking = false;
            return;
        }
        isTracking = false;

        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        const width = getPanelWidth();

        // High velocity flick
        if (velocityX > 0.3) {
            openPanel(true);
        } else if (velocityX < -0.3) {
            closePanel(true);
        } else {
            // Position threshold:
            // If dragging from closed, 30% drag is enough to open
            // If dragging from open, closing past 30% commits to close
            const threshold = initialVisualX <= 2 ? width * 0.3 : width * 0.7;
            if (pendingX > threshold) {
                openPanel(true);
            } else {
                closePanel(true);
            }
        }
    }, { passive: true });

    window.addEventListener("touchcancel", () => {
        if (!isTracking) return;
        isTracking = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        const width = getPanelWidth();
        if (pendingX > width * 0.5) {
            openPanel(true);
        } else {
            closePanel(true);
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isPanelOpen) {
            closePanel(true);
        }
    });
}

