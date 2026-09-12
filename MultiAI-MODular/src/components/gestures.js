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

let pendingX = 0;
let rafId = null;

const SLOP = 12;

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
    return (sidePanel ? sidePanel.getBoundingClientRect().width : 0) || 280;
}

export function renderTransform(x, withAnimation = false) {
    const { sidePanel, appShell, backdrop } = getElements();
    if (!sidePanel || !appShell || !backdrop) return;

    const width = getPanelWidth();
    const clampedX = Math.max(0, Math.min(width, x));
    const progress = clampedX / width;

    if (withAnimation) {
        sidePanel.classList.add("animate-transition");
        appShell.classList.add("animate-transition");
        backdrop.classList.add("animate-transition");
    } else {
        sidePanel.classList.remove("animate-transition");
        appShell.classList.remove("animate-transition");
        backdrop.classList.remove("animate-transition");
    }

    sidePanel.style.transform = `translate3d(${clampedX - width}px, 0, 0)`;
    appShell.style.transform = `translate3d(${clampedX}px, 0, 0)`;
    backdrop.style.opacity = progress;
    backdrop.style.pointerEvents = progress > 0.05 ? "auto" : "none";
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
    isPanelOpen = true;
    renderTransform(getPanelWidth(), animated);

    const { sidePanel, panelToggle, backdrop } = getElements();
    if (sidePanel) sidePanel.setAttribute("aria-hidden", "false");
    if (panelToggle) panelToggle.setAttribute("aria-expanded", "true");
    if (backdrop) {
        backdrop.style.opacity = "1";
        backdrop.style.pointerEvents = "auto";
    }
}

export function closePanel(animated = true) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    isPanelOpen = false;
    renderTransform(0, animated);

    const { sidePanel, panelToggle, backdrop } = getElements();
    if (sidePanel) sidePanel.setAttribute("aria-hidden", "true");
    if (panelToggle) panelToggle.setAttribute("aria-expanded", "false");
    if (backdrop) {
        backdrop.style.opacity = "0";
        backdrop.style.pointerEvents = "none";
    }
}

export function togglePanel() {
    const { sidePanel, panelToggle } = getElements();
    const isVisuallyOpen = isPanelOpen ||
        (sidePanel && sidePanel.getAttribute("aria-hidden") === "false") ||
        (panelToggle && panelToggle.getAttribute("aria-expanded") === "true");
    isVisuallyOpen ? closePanel(true) : openPanel(true);
}

export function getIsPanelOpen() {
    return isPanelOpen;
}

export function initGestures() {
    const { panelToggle, panelClose, backdrop } = getElements();

    let lastToggleTime = 0;
    const handleToggle = (e) => {
        const now = Date.now();
        if (now - lastToggleTime < 300) return;
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

    const handleClose = (e) => {
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
        if (target.closest('button, a, input, textarea, select, pre, .table-wrapper, table, .mobile-msg-actions, .composer, .command-output-box')) {
            return;
        }

        const t = e.touches[0];
        // Stop browser native back-swipe if near edge
        if (!isPanelOpen && t.clientX <= 32) {
            e.preventDefault();
        }

        touchStartX = t.clientX;
        touchStartY = t.clientY;
        lastX = t.clientX;
        lastTime = performance.now();
        velocityX = 0;

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

        if (!isLocked) {
            if (absX < SLOP && absY < SLOP) {
                return;
            }
            isLocked = true;
            if (absX > absY * 1.5) {
                isHorizontal = true;
            } else {
                isTracking = false;
                return;
            }
        }

        if (!isHorizontal) return;

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

        const width = getPanelWidth();
        const startOffset = isPanelOpen ? width : 0;
        const currentX = Math.max(0, Math.min(width, startOffset + dx));

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

        if (velocityX > 0.3) {
            openPanel(true);
        } else if (velocityX < -0.3) {
            closePanel(true);
        } else {
            if (pendingX > width * 0.45) {
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
        isPanelOpen ? openPanel(true) : closePanel(true);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isPanelOpen) {
            closePanel(true);
        }
    });
}
