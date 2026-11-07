/* =========================================================
   UI SCALING CONTROLLER (VS CODE STYLE)
   - Ctrl + = / Ctrl + + : Zoom In (Scale Bigger)
   - Ctrl + -            : Zoom Out (Scale Smaller)
   - Ctrl + 0            : Reset Zoom to 100%
   - Ctrl + Wheel        : Trackpad / Mousewheel Zoom
   - Floating HUD toast badge showing current percentage
   - LocalStorage persistence
   ========================================================= */

const STORAGE_KEY = "multiai_ui_scale";
export const DEFAULT_SCALE = 1.0;
export const MIN_SCALE = 0.6;
export const MAX_SCALE = 1.8;
export const SCALE_STEP = 0.1;

let currentScale = DEFAULT_SCALE;
let hudTimeout = null;
let hudEl = null;

export function getUiScale() {
    return currentScale;
}

function createHudElement() {
    if (hudEl && document.body.contains(hudEl)) return hudEl;
    
    // Remove stale element if any
    const existing = document.querySelector(".ui-scale-hud");
    if (existing) existing.remove();

    hudEl = document.createElement("div");
    hudEl.className = "ui-scale-hud";
    hudEl.setAttribute("aria-live", "polite");
    hudEl.innerHTML = `
        <span class="ui-scale-hud-icon">
            <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                <line x1="11" y1="8" x2="11" y2="14"></line>
                <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
        </span>
        <span class="ui-scale-hud-text">100%</span>
    `;
    document.body.appendChild(hudEl);
    return hudEl;
}

export function showScaleHud(scale) {
    const el = createHudElement();
    const textEl = el.querySelector(".ui-scale-hud-text");
    const percent = Math.round(scale * 100);
    
    if (textEl) {
        if (Math.abs(scale - DEFAULT_SCALE) < 0.01) {
            textEl.textContent = `Zoom: 100% (Default)`;
        } else {
            textEl.textContent = `Zoom: ${percent}%`;
        }
    }

    // Trigger animation
    el.classList.remove("is-visible");
    void el.offsetWidth; // Force reflow
    el.classList.add("is-visible");

    if (hudTimeout) {
        clearTimeout(hudTimeout);
    }
    hudTimeout = setTimeout(() => {
        el.classList.remove("is-visible");
        hudTimeout = null;
    }, 1200);
}

export function isMobileDevice() {
    return window.matchMedia("(max-width: 600px), ((hover: none) and (pointer: coarse))").matches;
}

export function setUiScale(scale, showHud = true) {
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(scale * 100) / 100));
    currentScale = clamped;

    if (isMobileDevice() || Math.abs(currentScale - 1.0) < 0.001) {
        // Native 100% scale or mobile: never apply CSS zoom to avoid coordinate drift & browser layout overhead
        document.documentElement.style.setProperty("--ui-scale", "1");
        document.documentElement.style.zoom = "";
    } else {
        document.documentElement.style.setProperty("--ui-scale", currentScale);
        document.documentElement.style.zoom = currentScale;
    }

    try {
        localStorage.setItem(STORAGE_KEY, currentScale.toFixed(2));
    } catch (e) {}

    // Synchronize settings slider & label if present
    const slider = document.getElementById("cfgUiScale");
    const val = document.getElementById("cfgUiScaleVal");
    if (slider) slider.value = Math.round(currentScale * 100);
    if (val) val.textContent = `${Math.round(currentScale * 100)}%`;

    if (showHud && !isMobileDevice()) {
        showScaleHud(currentScale);
    }

    return currentScale;
}

export function zoomIn(showHud = true) {
    if (isMobileDevice()) return 1;
    return setUiScale(currentScale + SCALE_STEP, showHud);
}

export function zoomOut(showHud = true) {
    if (isMobileDevice()) return 1;
    return setUiScale(currentScale - SCALE_STEP, showHud);
}

export function resetZoom(showHud = true) {
    if (isMobileDevice()) return 1;
    return setUiScale(DEFAULT_SCALE, showHud);
}

export function initUiScale() {
    // 1. Restore saved scale preference on desktop only
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = parseFloat(saved);
            if (!isNaN(parsed) && parsed >= MIN_SCALE && parsed <= MAX_SCALE) {
                setUiScale(parsed, false);
            }
        }
    } catch (e) {}

    // 2. Clear any lingering document zoom if running on mobile
    if (isMobileDevice()) {
        document.documentElement.style.setProperty("--ui-scale", "1");
        document.documentElement.style.zoom = "";
    }

    // 3. React to viewport size / orientation changes
    window.matchMedia("(max-width: 600px)").addEventListener("change", (e) => {
        if (e.matches) {
            document.documentElement.style.setProperty("--ui-scale", "1");
            document.documentElement.style.zoom = "";
        } else {
            document.documentElement.style.setProperty("--ui-scale", currentScale);
            document.documentElement.style.zoom = currentScale;
        }
    });

    // 2. Global Keyboard Shortcuts: Ctrl/Cmd + '=', '-', '0'
    document.addEventListener("keydown", (e) => {
        const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
        const modifier = isMac ? e.metaKey : e.ctrlKey;
        if (!modifier || e.altKey) return;

        // Zoom In: '=' or '+' or NumpadAdd
        if (e.key === "=" || e.key === "+" || e.code === "Equal" || e.code === "NumpadAdd") {
            e.preventDefault();
            e.stopPropagation();
            zoomIn(true);
            return;
        }

        // Zoom Out: '-' or '_' or NumpadSubtract
        if (e.key === "-" || e.key === "_" || e.code === "Minus" || e.code === "NumpadSubtract") {
            e.preventDefault();
            e.stopPropagation();
            zoomOut(true);
            return;
        }

        // Reset Zoom: '0' or Numpad0
        if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") {
            e.preventDefault();
            e.stopPropagation();
            resetZoom(true);
            return;
        }
    }, { capture: true });

    // 3. Ctrl + Wheel: Zoom with mousewheel / trackpad pinch
    document.addEventListener("wheel", (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            if (e.deltaY < 0) {
                zoomIn(true);
            } else if (e.deltaY > 0) {
                zoomOut(true);
            }
        }
    }, { passive: false });
}
