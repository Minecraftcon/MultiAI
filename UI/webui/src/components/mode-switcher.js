/* =========================================================
   APPLICATION MODE SWITCHER (CHAT VS BUILD VS SUBAGENTS)
   Uses Modern Web Guidance View Transitions & Accessible Tabs
   ========================================================= */
import { state, setAppMode, getAppMode } from "../state/index.js";

const STORAGE_KEY = "multiai_app_mode";

function focusActiveBtn(mode) {
    let id = "modeChatBtn";
    if (mode === "build") id = "modeBuildBtn";
    else if (mode === "subagents") id = "modeSubagentsBtn";
    document.getElementById(id)?.focus();
}

/**
 * Updates the visual active states and accessibility attributes of the pill buttons.
 */
export function updateModePillUI(mode) {
    const chatBtn = document.getElementById("modeChatBtn");
    const buildBtn = document.getElementById("modeBuildBtn");
    const subagentsBtn = document.getElementById("modeSubagentsBtn");
    if (!chatBtn || !buildBtn) return;

    chatBtn.classList.toggle("active", mode === "chat");
    chatBtn.setAttribute("aria-selected", mode === "chat" ? "true" : "false");
    chatBtn.setAttribute("tabindex", mode === "chat" ? "0" : "-1");

    buildBtn.classList.toggle("active", mode === "build");
    buildBtn.setAttribute("aria-selected", mode === "build" ? "true" : "false");
    buildBtn.setAttribute("tabindex", mode === "build" ? "0" : "-1");

    if (subagentsBtn) {
        subagentsBtn.classList.toggle("active", mode === "subagents");
        subagentsBtn.setAttribute("aria-selected", mode === "subagents" ? "true" : "false");
        subagentsBtn.setAttribute("tabindex", mode === "subagents" ? "0" : "-1");
    }
}

/**
 * Switches the active app mode using View Transitions API and progressive enhancement.
 *
 * @param {'chat' | 'build' | 'subagents'} newMode
 */
export function switchAppMode(newMode) {
    if (newMode !== "chat" && newMode !== "build" && newMode !== "subagents") return;
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
    const subagentsBtn = document.getElementById("modeSubagentsBtn");
    const container = document.querySelector(".mode-pill, .mode-pill-container");

    if (chatBtn) {
        chatBtn.addEventListener("click", () => switchAppMode("chat"));
    }
    if (buildBtn) {
        buildBtn.addEventListener("click", () => switchAppMode("build"));
    }
    if (subagentsBtn) {
        subagentsBtn.addEventListener("click", () => switchAppMode("subagents"));
    }

    // Keyboard navigation conforming to WAI-ARIA Tabs pattern
    if (container) {
        const modes = ["chat", "build", "subagents"];
        container.addEventListener("keydown", (e) => {
            const currentIdx = modes.indexOf(getAppMode());
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                const next = (currentIdx + 1) % modes.length;
                switchAppMode(modes[next]);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                const prev = (currentIdx - 1 + modes.length) % modes.length;
                switchAppMode(modes[prev]);
            } else if (e.key === "Home") {
                e.preventDefault();
                switchAppMode(modes[0]);
            } else if (e.key === "End") {
                e.preventDefault();
                switchAppMode(modes[modes.length - 1]);
            }
        });
    }
}
