/* =========================================================
   START PAGE AURORA & CELESTIAL THEME CONTROLLER
   - Themes: saturn, aurora, clouds, nebula, eclipse, none
   - Handles celestial backdrop rendering, ring geometry,
     chatbox dock aura coordination, and persistence.
   ========================================================= */
import { state } from "../state.js";

export const AURORA_THEMES = {
    saturn: "Saturn (Corner Planet & Rings)",
    aurora: "Northern Lights (Boreal Aurora)",
    clouds: "Lunar Mist (Monochromatic Cloud)",
    nebula: "Cosmic Nebula (Cyan & Magenta)",
    eclipse: "Solar Eclipse (Amber Corona)",
    none: "Off (No Glow)"
};

const STORAGE_KEY = "multiai_aurora_theme";
export const DEFAULT_AURORA_THEME = "saturn";

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
            <div class="saturn-stage" aria-hidden="true">
                <!-- Cosmic Starlight Dust -->
                <div class="celestial-stars">
                    <span class="star star-1"></span>
                    <span class="star star-2"></span>
                    <span class="star star-3"></span>
                    <span class="star star-4"></span>
                    <span class="star star-5"></span>
                    <span class="star star-6"></span>
                    <span class="star star-7"></span>
                    <span class="star star-8"></span>
                </div>

                <!-- Ambient Planetary Corona Glow -->
                <div class="saturn-ambient-glow"></div>

                <!-- Saturn Complex (Planet Body + Tilted Multi-band Rings) -->
                <div class="saturn-system">
                    <!-- Back Ring Arc (passes behind planet) -->
                    <div class="saturn-ring saturn-ring-back">
                        <div class="ring-band ring-a"></div>
                        <div class="ring-cassini"></div>
                        <div class="ring-band ring-b"></div>
                        <div class="ring-band ring-c"></div>
                    </div>

                    <!-- Planet Body (Half-sphere peeking into screen with atmospheric bands) -->
                    <div class="saturn-planet">
                        <div class="saturn-bands"></div>
                        <div class="saturn-terminator"></div>
                        <div class="saturn-atmosphere-rim"></div>
                        <div class="saturn-ring-shadow"></div>
                    </div>

                    <!-- Front Ring Arc (passes in front of planet) -->
                    <div class="saturn-ring saturn-ring-front">
                        <div class="ring-band ring-a"></div>
                        <div class="ring-cassini"></div>
                        <div class="ring-band ring-b"></div>
                        <div class="ring-band ring-c"></div>
                    </div>
                </div>
            </div>`;

        case "aurora":
            return `
            <div class="aurora-stage" aria-hidden="true">
                <div class="celestial-stars">
                    <span class="star star-1"></span>
                    <span class="star star-3"></span>
                    <span class="star star-5"></span>
                    <span class="star star-7"></span>
                </div>
                <div class="boreal-curtain boreal-curtain-1"></div>
                <div class="boreal-curtain boreal-curtain-2"></div>
                <div class="boreal-curtain boreal-curtain-3"></div>
                <div class="boreal-horizon-glow"></div>
            </div>`;

        case "nebula":
            return `
            <div class="nebula-stage" aria-hidden="true">
                <div class="celestial-stars">
                    <span class="star star-2"></span>
                    <span class="star star-4"></span>
                    <span class="star star-6"></span>
                    <span class="star star-8"></span>
                </div>
                <div class="nebula-cloud nebula-cyan"></div>
                <div class="nebula-cloud nebula-magenta"></div>
                <div class="nebula-cloud nebula-violet"></div>
            </div>`;

        case "eclipse":
            return `
            <div class="eclipse-stage" aria-hidden="true">
                <div class="celestial-stars">
                    <span class="star star-1"></span>
                    <span class="star star-4"></span>
                    <span class="star star-7"></span>
                </div>
                <div class="eclipse-corona-flare"></div>
                <div class="eclipse-solar-ring">
                    <div class="eclipse-moon-disk"></div>
                    <div class="eclipse-diamond-glint"></div>
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
