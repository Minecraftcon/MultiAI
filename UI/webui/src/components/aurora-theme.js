/* =========================================================
   START PAGE AURORA & CELESTIAL THEME CONTROLLER
   - Themes: saturn, aurora, clouds, nebula, eclipse, none
   - Handles celestial backdrop rendering, ring geometry,
     chatbox dock aura coordination, and persistence.
   ========================================================= */
import { state } from "../state.js";
import { startSaturnWebGL, pauseSaturnWebGL, resumeSaturnWebGL, destroySaturnWebGL } from "./saturn-webgl.js";

export const AURORA_THEMES = {
    none: "Off (Minimalist)",
    subtle: "Subtle Ambient"
};

const STORAGE_KEY = "multiai_aurora_theme";
export const DEFAULT_AURORA_THEME = "none";

let currentTheme = DEFAULT_AURORA_THEME;

/**
 * Detects if the current client is an Android or mobile touch device
 */
export function isAndroidOrMobile() {
    if (typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        return true;
    }
    if (typeof document !== "undefined" && document.documentElement && document.documentElement.classList.contains("is-android")) {
        return true;
    }
    if (typeof window !== "undefined" && window.matchMedia && (window.matchMedia("(max-width: 768px)").matches || window.matchMedia("(pointer: coarse)").matches)) {
        return true;
    }
    return false;
}

export function getAuroraTheme() {
    if (isAndroidOrMobile()) {
        return "none";
    }
    return currentTheme;
}

/**
 * Return HTML markup for the subtle backdrop of a given theme
 */
function getBackdropTemplate(theme) {
    if (isAndroidOrMobile() || theme === "none") {
        return "";
    }
    if (theme === "subtle") {
        return `
        <div class="clouds-stage" aria-hidden="true">
            <div class="lunar-mist-ambient"></div>
        </div>`;
    }
    return "";
}

/**
 * Applies the selected aurora theme to the document and updates the backdrop.
 */
export function setAuroraTheme(theme, save = false) {
    // If Android or mobile, completely disable theme effects
    if (isAndroidOrMobile()) {
        document.documentElement.classList.add("is-android");
        document.documentElement.setAttribute("data-aurora-theme", "none");
        currentTheme = "none";
        destroySaturnWebGL();
        const backdropEl = document.getElementById("startPageBackdrop");
        if (backdropEl) {
            backdropEl.innerHTML = "";
            backdropEl.className = "start-page-backdrop theme-none";
        }
        const select = document.getElementById("cfgAuroraTheme");
        if (select) {
            const row = select.closest(".settings-row");
            if (row) row.style.display = "none";
        }
        return "none";
    }

    const validThemes = Object.keys(AURORA_THEMES);
    const target = validThemes.includes(theme) ? theme : DEFAULT_AURORA_THEME;
    currentTheme = target;

    // Apply data attribute for CSS targeting across shell & composer dock
    document.documentElement.setAttribute("data-aurora-theme", target);

    // Update backdrop DOM
    const backdropEl = document.getElementById("startPageBackdrop");
    if (backdropEl) {
        backdropEl.innerHTML = getBackdropTemplate(target);
        backdropEl.className = `start-page-backdrop theme-${target}`;
        destroySaturnWebGL();
    }

    try {
        localStorage.setItem(STORAGE_KEY, target);
    } catch (e) {}

    // Synchronize Settings dropdown if present
    const select = document.getElementById("cfgAuroraTheme");
    if (select && select.value !== target) {
        select.value = target;
    }

    // Save to server config if requested
    if (save) {
        import("./settings-view.js").then(({ saveSetting }) => {
            saveSetting("UI", "AuroraTheme", target);
        }).catch(() => {});
    }

    return target;
}

/**
 * Lifecycle hook called when switching between Start Page mode and Chat mode
 */
export function onStartPageModeChange(isStartPage) {
    destroySaturnWebGL();
}

/**
 * Initializes the aurora theme on startup from config or localStorage.
 */
export function initAuroraTheme() {
    if (isAndroidOrMobile()) {
        document.documentElement.classList.add("is-android");
        setAuroraTheme("none", false);
        return;
    }

    let saved = null;
    try {
        saved = localStorage.getItem(STORAGE_KEY);
    } catch (e) {}

    const configTheme = state.config?.UI?.AuroraTheme;
    const initialTheme = configTheme || saved || DEFAULT_AURORA_THEME;

    setAuroraTheme(initialTheme, false);
}

