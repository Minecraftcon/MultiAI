/* =========================================================
   APPLICATION MODE SWITCHER (CHAT VS BUILD)
   Uses Modern Web Guidance View Transitions & Accessible Tabs
   ========================================================= */
import { state, setAppMode, getAppMode } from "../state/index.js";

const STORAGE_KEY = "multiai_app_mode";

function focusActiveBtn(mode) {
    const btn = mode === "build" ? document.getElementById("modeBuildBtn") : document.getElementById("modeChatBtn");
    btn?.focus();
}

/**
 * Updates the visual active states and accessibility attributes of the pill buttons.
 */
export function updateModePillUI(mode) {
    const chatBtn = document.getElementById("modeChatBtn");
    const buildBtn = document.getElementById("modeBuildBtn");
    if (!chatBtn || !buildBtn) return;

    const isBuild = mode === "build";
    chatBtn.classList.toggle("active", !isBuild);
    chatBtn.setAttribute("aria-selected", isBuild ? "false" : "true");
    chatBtn.setAttribute("tabindex", isBuild ? "-1" : "0");

    buildBtn.classList.toggle("active", isBuild);
    buildBtn.setAttribute("aria-selected", isBuild ? "true" : "false");
    buildBtn.setAttribute("tabindex", isBuild ? "0" : "-1");
}

/**
 * Switches the active app mode using View Transitions API and progressive enhancement.
 *
 * @param {'chat' | 'build'} newMode
 */
export function switchAppMode(newMode) {
    if (newMode !== "chat" && newMode !== "build") return;
    if (getAppMode() === newMode) return;

    const previousMode = getAppMode();
    setAppMode(newMode);
    try {
        localStorage.setItem(STORAGE_KEY, newMode);
    } catch (_) {}
    document.documentElement.setAttribute("data-app-mode", newMode);
    updateModePillUI(newMode);
    window.dispatchEvent(new CustomEvent("app-mode-changed", { detail: { mode: newMode, previousMode } }));
    focusActiveBtn(newMode);
}

/**
 * Initializes the Mode Switcher component event listeners and restores saved mode.
 */
export function initModeSwitcher() {
    let savedMode = "chat";
    try {
        savedMode = localStorage.getItem(STORAGE_KEY) || "chat";
    } catch (_) {}

    setAppMode(savedMode);
    document.documentElement.setAttribute("data-app-mode", savedMode);
    updateModePillUI(savedMode);

    const chatBtn = document.getElementById("modeChatBtn");
    const buildBtn = document.getElementById("modeBuildBtn");
    const container = document.querySelector(".mode-pill, .mode-pill-container");

    if (chatBtn) {
        chatBtn.addEventListener("click", () => switchAppMode("chat"));
    }
    if (buildBtn) {
        buildBtn.addEventListener("click", () => switchAppMode("build"));
    }

    // Keyboard navigation conforming to WAI-ARIA Tabs pattern
    if (container) {
        container.addEventListener("keydown", (e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                switchAppMode("build");
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                switchAppMode("chat");
            } else if (e.key === "Home") {
                e.preventDefault();
                switchAppMode("chat");
            } else if (e.key === "End") {
                e.preventDefault();
                switchAppMode("build");
            }
        });
    }
}
