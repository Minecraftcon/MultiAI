/* =========================================================
   START PAGE AURORA & CELESTIAL THEME CONTROLLER
   - Themes: saturn, aurora, clouds, nebula, eclipse, none
   - Handles celestial backdrop rendering, ring geometry,
     chatbox dock aura coordination, and persistence.
   ========================================================= */
import { state } from "../state.js";
import { startSaturnWebGL, pauseSaturnWebGL, resumeSaturnWebGL, destroySaturnWebGL } from "./saturn-webgl.js";

export const AURORA_THEMES = {
    saturn: "Saturn (3D Rings & Nebula)",
    aurora: "Northern Lights (Boreal Aurora)",
    clouds: "Lunar Mist (Monochromatic Cloud)",
    nebula: "Cosmic Nebula (Cyan & Magenta)",
    eclipse: "Solar Eclipse (Amber Corona)",
    none: "Off (No Glow)"
};

const STORAGE_KEY = "multiai_aurora_theme";
export const DEFAULT_AURORA_THEME = "clouds";

let currentTheme = DEFAULT_AURORA_THEME;

export function getAuroraTheme() {
    return currentTheme;
}

/**
 * Return HTML markup for the celestial backdrop of a given theme
 */
function getBackdropTemplate(theme) {
    switch (theme) {
        case "saturn":
            return `
            <div class="saturn-stage" id="saturnStage" aria-hidden="true">
                <div class="saturn-ambient-glow"></div>
            </div>`;

        case "aurora":
            return `
            <div class="aurora-stage" aria-hidden="true">
                <div class="boreal-curtain boreal-curtain-1"></div>
                <div class="boreal-curtain boreal-curtain-2"></div>
                <div class="boreal-horizon-glow"></div>
            </div>`;

        case "nebula":
            return `
            <div class="nebula-stage" aria-hidden="true">
                <div class="nebula-cloud nebula-cyan"></div>
                <div class="nebula-cloud nebula-magenta"></div>
            </div>`;

        case "eclipse":
            return `
            <div class="eclipse-stage" aria-hidden="true">
                <div class="eclipse-corona-flare"></div>
                <div class="eclipse-solar-ring">
                    <div class="eclipse-moon-disk"></div>
                </div>
            </div>`;

        case "clouds":
            return `
            <div class="clouds-stage" aria-hidden="true">
                <div class="lunar-mist-ambient"></div>
            </div>`;

        case "none":
        default:
            return "";
    }
}

/**
 * Applies the selected aurora theme to the document and updates the backdrop.
 */
export function setAuroraTheme(theme, save = false) {
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

        // If Saturn 3D theme is selected, mount the WebGL experience
        if (target === "saturn") {
            const shell = document.getElementById("appShell");
            if (shell && shell.classList.contains("is-start-page")) {
                const stage = document.getElementById("saturnStage") || backdropEl;
                startSaturnWebGL(stage);
            }
        } else {
            destroySaturnWebGL();
        }
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
 * Follows Modern Web Guidance: pauses 3D WebGL rendering when chatting
 */
export function onStartPageModeChange(isStartPage) {
    if (currentTheme === "saturn") {
        if (isStartPage) {
            const backdropEl = document.getElementById("startPageBackdrop");
            const stage = document.getElementById("saturnStage") || backdropEl;
            if (stage) {
                startSaturnWebGL(stage);
            }
        } else {
            pauseSaturnWebGL();
        }
    }
}

/**
 * Initializes the aurora theme on startup from config or localStorage.
 */
export function initAuroraTheme() {
    let saved = null;
    try {
        saved = localStorage.getItem(STORAGE_KEY);
    } catch (e) {}

    const configTheme = state.config?.UI?.AuroraTheme;
    const initialTheme = configTheme || saved || DEFAULT_AURORA_THEME;

    setAuroraTheme(initialTheme, false);
}

