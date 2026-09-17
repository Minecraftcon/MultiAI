/* =========================================================
   SETTINGS SCREEN CONTROLLER (FULL IN-APP SCREEN)
   Multiple sub-screens, instant auto-save, theme-aligned
   ========================================================= */
import { state } from "../state.js";
import { renderIcons, isMobileDevice } from "../utils/dom.js";
import { closePanel } from "./gestures.js";
import { saveStoredChats } from "../services/storage.js";
import { updateModelPickerDisplay } from "./model-picker.js";
import { getUiScale, setUiScale, resetZoom } from "./ui-scale.js";
import { getAuroraTheme, setAuroraTheme, isAndroidOrMobile } from "./aurora-theme.js";

let activeSubScreen = "general";
let saveTimeout = null;

const SYSTEM_PROMPT_PRESETS = {
    default: "You are a helpful, versatile AI assistant. Answer queries accurately, concisely, and with high technical precision.",
    developer: "You are an elite senior software engineer and architect. Write clean, idiomatic, robust, and performant code with comments explaining non-obvious architecture decisions.",
    creative: "You are a brilliant and imaginative writer and thought partner. Use evocative language, rich metaphors, and original ideas.",
    concise: "You are an ultra-concise assistant. Provide only the essential facts and direct code or answers without preamble or fluff."
};

export function openSettings(targetCategory = "general") {
    const appShell = document.getElementById("appShell");
    const settingsScreen = document.getElementById("settingsScreen");
    if (!appShell || !settingsScreen) return;

    if (isMobileDevice()) {
        closePanel();
    }

    populateSettingsValues();
    appShell.classList.add("in-settings");
    settingsScreen.setAttribute("aria-hidden", "false");

    switchSubScreen(targetCategory);
    renderIcons(settingsScreen);

    // Scroll to top of content
    const content = settingsScreen.querySelector(".settings-content");
    if (content) content.scrollTop = 0;
}

export function closeSettings() {
    const appShell = document.getElementById("appShell");
    const settingsScreen = document.getElementById("settingsScreen");
    if (!appShell || !settingsScreen) return;

    appShell.classList.remove("in-settings");
    settingsScreen.setAttribute("aria-hidden", "true");

    const input = document.getElementById("input");
    if (input && !isMobileDevice()) {
        input.focus();
    }
}

export function switchSubScreen(screenId) {
    activeSubScreen = screenId;
    const settingsScreen = document.getElementById("settingsScreen");
    if (!settingsScreen) return;

    // Update nav items
    const navItems = settingsScreen.querySelectorAll(".settings-nav-item");
    navItems.forEach(btn => {
        const isMatch = btn.dataset.subscreen === screenId;
        btn.classList.toggle("active", isMatch);
        btn.setAttribute("aria-selected", isMatch ? "true" : "false");
        if (isMatch && isMobileDevice()) {
            try {
                btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
            } catch (_) {}
        }
    });

    // Update sub-screens visibility
    const subs = settingsScreen.querySelectorAll(".settings-subscreen");
    subs.forEach(panel => {
        const isMatch = panel.id === `subScreen_${screenId}`;
        panel.classList.toggle("active", isMatch);
    });

    // Reset content scroll so user starts at the top of the newly chosen section
    const content = settingsScreen.querySelector(".settings-content");
    if (content) {
        content.scrollTop = 0;
    }

    // Update header badge or label
    const badge = document.getElementById("settingsActiveBadge");
    if (badge) {
        badge.textContent = screenId.toUpperCase();
    }

    // Refresh Lucide icons inside newly shown subscreen
    renderIcons(settingsScreen);
}

/**
 * Populates all settings form controls from state.config
 */
export function populateSettingsValues() {
    const cfg = state.config || {};
    const gen = cfg.General || {};
    const agent = cfg.Agent || {};
    const tools = cfg.Tools || {};
    const ui = cfg.UI || {};

    // 1. General
    populateModelOptions();
    const startupLLM = document.getElementById("cfgStartupLLM");
    if (startupLLM && gen.DefaultStartupLLM) {
        startupLLM.value = gen.DefaultStartupLLM;
    }

    const presetSelect = document.getElementById("cfgSystemPreset");
    const customPromptText = document.getElementById("cfgCustomSystemPrompt");
    const storedPreset = localStorage.getItem("multiai_system_preset") || "default";
    const storedCustom = localStorage.getItem("multiai_custom_system_prompt") || "";

    if (presetSelect) presetSelect.value = storedPreset;
    if (customPromptText) {
        customPromptText.value = storedCustom || SYSTEM_PROMPT_PRESETS[storedPreset] || "";
        const row = document.getElementById("cfgCustomPromptRow");
        if (row) row.style.display = (storedPreset === "custom") ? "flex" : "none";
    }

    const sendKey = document.getElementById("cfgSendKey");
    if (sendKey) {
        sendKey.value = localStorage.getItem("multiai_send_key") || "enter";
    }

    // 2. Models & AI
    const tempSlider = document.getElementById("cfgTemperature");
    const tempVal = document.getElementById("cfgTemperatureVal");
    const storedTemp = localStorage.getItem("multiai_temperature") || "0.7";
    if (tempSlider) tempSlider.value = storedTemp;
    if (tempVal) tempVal.textContent = parseFloat(storedTemp).toFixed(2);

    const streamReasoning = document.getElementById("cfgStreamReasoning");
    if (streamReasoning) streamReasoning.checked = agent.StreamReasoning !== false;

    const turnTimeout = document.getElementById("cfgTurnTimeout");
    if (turnTimeout) turnTimeout.value = String(agent.TurnTimeoutSeconds || 120);

    const maxHistory = document.getElementById("cfgMaxHistory");
    if (maxHistory) maxHistory.value = String(gen.MaxChatHistory || 100);

    // 3. Image Generation
    const imgProvider = document.getElementById("cfgImageProvider");
    if (imgProvider && gen.DefaultImageProvider) imgProvider.value = gen.DefaultImageProvider;

    const imgRatio = document.getElementById("cfgImageRatio");
    if (imgRatio && gen.DefaultImageAspectRatio) imgRatio.value = gen.DefaultImageAspectRatio;

    const imgModel = document.getElementById("cfgImageModel");
    if (imgModel && gen.DefaultImageModel) imgModel.value = gen.DefaultImageModel;

    // 4. Tools & Automation
    const toolSearch = document.getElementById("cfgEnableWebSearch");
    if (toolSearch) toolSearch.checked = tools.EnableWebSearch !== false;

    const toolTerminal = document.getElementById("cfgEnableTerminal");
    if (toolTerminal) toolTerminal.checked = tools.EnableTerminal !== false;

    const toolFiles = document.getElementById("cfgEnableFileOperations");
    if (toolFiles) toolFiles.checked = tools.EnableFileOperations !== false;

    const toolImg = document.getElementById("cfgEnableImageGeneration");
    if (toolImg) toolImg.checked = tools.EnableImageGeneration !== false;

    const maxToolRounds = document.getElementById("cfgMaxToolRounds");
    const maxToolRoundsVal = document.getElementById("cfgMaxToolRoundsVal");
    const storedRounds = agent.MaxToolRounds || 50;
    if (maxToolRounds) maxToolRounds.value = storedRounds;
    if (maxToolRoundsVal) maxToolRoundsVal.textContent = storedRounds;

    // 5. Appearance
    const themeSelect = document.getElementById("cfgTheme");
    if (themeSelect) themeSelect.value = ui.Theme || "dark";

    const auroraThemeSelect = document.getElementById("cfgAuroraTheme");
    if (auroraThemeSelect) {
        if (isAndroidOrMobile()) {
            const row = auroraThemeSelect.closest(".settings-row");
            if (row) row.style.display = "none";
        } else {
            auroraThemeSelect.value = getAuroraTheme();
        }
    }

    const showLineNumbers = document.getElementById("cfgShowLineNumbers");
    if (showLineNumbers) showLineNumbers.checked = ui.ShowLineNumbers !== false;

    const autoScroll = document.getElementById("cfgAutoScroll");
    if (autoScroll) autoScroll.checked = agent.AutoScroll !== false;

    const compactMobile = document.getElementById("cfgCompactMobileView");
    if (compactMobile) compactMobile.checked = ui.CompactMobileView !== false;

    const uiScaleSlider = document.getElementById("cfgUiScale");
    const uiScaleVal = document.getElementById("cfgUiScaleVal");
    if (uiScaleSlider && uiScaleVal) {
        const cur = Math.round(getUiScale() * 100);
        uiScaleSlider.value = cur;
        uiScaleVal.textContent = `${cur}%`;
    }

    // 6. Storage & History
    const recordHistory = document.getElementById("cfgRecordHistory");
    if (recordHistory) recordHistory.checked = gen.RecordChatHistory !== false;

    const recordDate = document.getElementById("cfgRecordDate");
    if (recordDate) recordDate.checked = gen.RecordDate !== false;

    updateStorageSummary();
    updateAboutDiagnostics();
}

/**
 * Dynamically fills default startup LLM select options
 */
function populateModelOptions() {
    const startupLLM = document.getElementById("cfgStartupLLM");
    const modelSelect = document.getElementById("modelSelect");
    if (!startupLLM || !modelSelect) return;

    const currentVal = startupLLM.value || state.config?.General?.DefaultStartupLLM || "";
    startupLLM.innerHTML = "";

    Array.from(modelSelect.options).forEach(opt => {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.textContent;
        if (opt.value === currentVal) option.selected = true;
        startupLLM.appendChild(option);
    });
}

function updateStorageSummary() {
    const totalSessions = Object.keys(state.chatSessions || {}).length;
    const countEl = document.getElementById("settingsChatCount");
    if (countEl) countEl.textContent = `${totalSessions} conversation${totalSessions === 1 ? "" : "s"}`;

    const sizeEl = document.getElementById("settingsStorageSize");
    if (sizeEl) {
        try {
            const raw = localStorage.getItem("multiai_chats") || "";
            const kb = (new Blob([raw]).size / 1024).toFixed(1);
            sizeEl.textContent = `~${kb} KB`;
        } catch (_) {
            sizeEl.textContent = "Local";
        }
    }
}

function updateAboutDiagnostics() {
    const portEl = document.getElementById("aboutServerPort");
    if (portEl) portEl.textContent = state.config?.General?.Port || "8080";

    const hostEl = document.getElementById("aboutServerHost");
    if (hostEl) hostEl.textContent = state.config?.General?.Host || "0.0.0.0";

    const modelsEl = document.getElementById("aboutModelCount");
    const modelSelect = document.getElementById("modelSelect");
    if (modelsEl && modelSelect) {
        modelsEl.textContent = `${modelSelect.options.length} models`;
    }
}

/**
 * Dispatches an asynchronous update to the backend config and updates live state
 */
export async function saveSetting(section, key, value) {
    if (!state.config) state.config = {};
    if (!state.config[section]) state.config[section] = {};
    state.config[section][key] = value;

    const statusEl = document.getElementById("settingsSaveStatus");
    if (statusEl) {
        statusEl.className = "settings-save-status saving";
        statusEl.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>Saving...</span>';
        renderIcons(statusEl);
    }

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            const res = await fetch("/api/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [section]: { [key]: value } })
            });

            if (res.ok) {
                if (statusEl) {
                    statusEl.className = "settings-save-status saved";
                    statusEl.innerHTML = '<i data-lucide="check"></i><span>Saved</span>';
                    renderIcons(statusEl);
                    setTimeout(() => {
                        if (statusEl) {
                            statusEl.className = "settings-save-status";
                            statusEl.innerHTML = '<i data-lucide="check"></i><span>Auto-saved</span>';
                            renderIcons(statusEl);
                        }
                    }, 1400);
                }
            }
        } catch (err) {
            console.warn("[SETTINGS] Failed to save config to server:", err.message);
            if (statusEl) {
                statusEl.className = "settings-save-status";
                statusEl.innerHTML = '<span>Saved locally</span>';
            }
        }
    }, 250);
}

/**
 * Binds all interactive controls on the Settings Screen
 */
export function initSettingsView() {
    const settingsScreen = document.getElementById("settingsScreen");
    const settingsBackBtn = document.getElementById("settingsBackBtn");
    if (!settingsScreen) return;

    // Back to Chat
    if (settingsBackBtn) {
        settingsBackBtn.addEventListener("click", closeSettings);
    }

    // Tab Navigation
    settingsScreen.querySelectorAll(".settings-nav-item").forEach(btn => {
        btn.addEventListener("click", () => {
            const screenId = btn.dataset.subscreen;
            if (screenId) switchSubScreen(screenId);
        });
    });

    // Keyboard navigation (Escape exits settings)
    document.addEventListener("keydown", (e) => {
        const appShell = document.getElementById("appShell");
        if (e.key === "Escape" && appShell?.classList.contains("in-settings")) {
            e.preventDefault();
            closeSettings();
        }
    });

    // 1. General Controls
    const startupLLM = document.getElementById("cfgStartupLLM");
    if (startupLLM) {
        startupLLM.addEventListener("change", (e) => {
            saveSetting("General", "DefaultStartupLLM", e.target.value);
            const modelSelect = document.getElementById("modelSelect");
            if (modelSelect && !state.currentChatId) {
                modelSelect.value = e.target.value;
                updateModelPickerDisplay();
            }
        });
    }

    const presetSelect = document.getElementById("cfgSystemPreset");
    const customPromptText = document.getElementById("cfgCustomSystemPrompt");
    const customPromptRow = document.getElementById("cfgCustomPromptRow");

    if (presetSelect) {
        presetSelect.addEventListener("change", (e) => {
            const val = e.target.value;
            localStorage.setItem("multiai_system_preset", val);
            if (val === "custom") {
                if (customPromptRow) customPromptRow.style.display = "flex";
                if (customPromptText) state.activeSystemPrompt = customPromptText.value.trim();
            } else {
                if (customPromptRow) customPromptRow.style.display = "none";
                state.activeSystemPrompt = SYSTEM_PROMPT_PRESETS[val] || SYSTEM_PROMPT_PRESETS.default;
            }
            saveSetting("General", "SystemPreset", val);
        });
    }

    if (customPromptText) {
        customPromptText.addEventListener("input", (e) => {
            const val = e.target.value;
            localStorage.setItem("multiai_custom_system_prompt", val);
            if (presetSelect?.value === "custom") {
                state.activeSystemPrompt = val.trim() || SYSTEM_PROMPT_PRESETS.default;
            }
        });
    }

    const sendKey = document.getElementById("cfgSendKey");
    if (sendKey) {
        sendKey.addEventListener("change", (e) => {
            localStorage.setItem("multiai_send_key", e.target.value);
        });
    }

    // 2. Models & AI Controls
    const tempSlider = document.getElementById("cfgTemperature");
    const tempVal = document.getElementById("cfgTemperatureVal");
    if (tempSlider && tempVal) {
        tempSlider.addEventListener("input", (e) => {
            tempVal.textContent = parseFloat(e.target.value).toFixed(2);
        });
        tempSlider.addEventListener("change", (e) => {
            localStorage.setItem("multiai_temperature", e.target.value);
            saveSetting("Agent", "Temperature", parseFloat(e.target.value));
        });
    }

    const streamReasoning = document.getElementById("cfgStreamReasoning");
    if (streamReasoning) {
        streamReasoning.addEventListener("change", (e) => {
            saveSetting("Agent", "StreamReasoning", e.target.checked);
        });
    }

    const turnTimeout = document.getElementById("cfgTurnTimeout");
    if (turnTimeout) {
        turnTimeout.addEventListener("change", (e) => {
            saveSetting("Agent", "TurnTimeoutSeconds", parseInt(e.target.value, 10));
        });
    }

    const maxHistory = document.getElementById("cfgMaxHistory");
    if (maxHistory) {
        maxHistory.addEventListener("change", (e) => {
            saveSetting("General", "MaxChatHistory", parseInt(e.target.value, 10));
        });
    }

    // 3. Image Generation Controls
    const imgProvider = document.getElementById("cfgImageProvider");
    if (imgProvider) {
        imgProvider.addEventListener("change", (e) => {
            saveSetting("General", "DefaultImageProvider", e.target.value);
        });
    }

    const imgRatio = document.getElementById("cfgImageRatio");
    if (imgRatio) {
        imgRatio.addEventListener("change", (e) => {
            saveSetting("General", "DefaultImageAspectRatio", e.target.value);
        });
    }

    const imgModel = document.getElementById("cfgImageModel");
    if (imgModel) {
        imgModel.addEventListener("change", (e) => {
            saveSetting("General", "DefaultImageModel", e.target.value);
        });
    }

    // 4. Tools & Automation Controls
    const toolSearch = document.getElementById("cfgEnableWebSearch");
    if (toolSearch) {
        toolSearch.addEventListener("change", (e) => {
            saveSetting("Tools", "EnableWebSearch", e.target.checked);
        });
    }

    const toolTerminal = document.getElementById("cfgEnableTerminal");
    if (toolTerminal) {
        toolTerminal.addEventListener("change", (e) => {
            saveSetting("Tools", "EnableTerminal", e.target.checked);
        });
    }

    const toolFiles = document.getElementById("cfgEnableFileOperations");
    if (toolFiles) {
        toolFiles.addEventListener("change", (e) => {
            saveSetting("Tools", "EnableFileOperations", e.target.checked);
        });
    }

    const toolImg = document.getElementById("cfgEnableImageGeneration");
    if (toolImg) {
        toolImg.addEventListener("change", (e) => {
            saveSetting("Tools", "EnableImageGeneration", e.target.checked);
        });
    }

    const maxToolRounds = document.getElementById("cfgMaxToolRounds");
    const maxToolRoundsVal = document.getElementById("cfgMaxToolRoundsVal");
    if (maxToolRounds && maxToolRoundsVal) {
        maxToolRounds.addEventListener("input", (e) => {
            maxToolRoundsVal.textContent = e.target.value;
        });
        maxToolRounds.addEventListener("change", (e) => {
            saveSetting("Agent", "MaxToolRounds", parseInt(e.target.value, 10));
        });
    }

    // 5. Appearance Controls
    const themeSelect = document.getElementById("cfgTheme");
    if (themeSelect) {
        themeSelect.addEventListener("change", (e) => {
            const val = e.target.value;
            saveSetting("UI", "Theme", val);
            document.documentElement.setAttribute("data-theme", val);
        });
    }

    const auroraThemeSelect = document.getElementById("cfgAuroraTheme");
    if (auroraThemeSelect) {
        auroraThemeSelect.addEventListener("change", (e) => {
            const val = e.target.value;
            setAuroraTheme(val, true);
        });
    }

    const showLineNumbers = document.getElementById("cfgShowLineNumbers");
    if (showLineNumbers) {
        showLineNumbers.addEventListener("change", (e) => {
            saveSetting("UI", "ShowLineNumbers", e.target.checked);
        });
    }

    const uiScaleSlider = document.getElementById("cfgUiScale");
    const uiScaleVal = document.getElementById("cfgUiScaleVal");
    const uiScaleResetBtn = document.getElementById("cfgUiScaleResetBtn");

    if (uiScaleSlider && uiScaleVal) {
        uiScaleSlider.addEventListener("input", (e) => {
            const val = parseInt(e.target.value, 10);
            uiScaleVal.textContent = `${val}%`;
            setUiScale(val / 100, true);
        });
    }

    if (uiScaleResetBtn) {
        uiScaleResetBtn.addEventListener("click", () => {
            resetZoom(true);
            if (uiScaleSlider) uiScaleSlider.value = 100;
            if (uiScaleVal) uiScaleVal.textContent = "100%";
        });
    }

    const autoScroll = document.getElementById("cfgAutoScroll");
    if (autoScroll) {
        autoScroll.addEventListener("change", (e) => {
            saveSetting("Agent", "AutoScroll", e.target.checked);
        });
    }

    const compactMobile = document.getElementById("cfgCompactMobileView");
    if (compactMobile) {
        compactMobile.addEventListener("change", (e) => {
            saveSetting("UI", "CompactMobileView", e.target.checked);
        });
    }

    // 6. Storage & History Controls
    const recordHistory = document.getElementById("cfgRecordHistory");
    if (recordHistory) {
        recordHistory.addEventListener("change", (e) => {
            saveSetting("General", "RecordChatHistory", e.target.checked);
        });
    }

    const recordDate = document.getElementById("cfgRecordDate");
    if (recordDate) {
        recordDate.addEventListener("change", (e) => {
            saveSetting("General", "RecordDate", e.target.checked);
        });
    }

    // Export All Chats Button
    const exportBtn = document.getElementById("settingsExportAllBtn");
    if (exportBtn) {
        exportBtn.addEventListener("click", () => {
            const payload = JSON.stringify(state.chatSessions || {}, null, 2);
            const blob = new Blob([payload], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.download = `multiai_backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.href = url;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 150);
        });
    }

    // Clear All Chats Button
    const clearBtn = document.getElementById("settingsClearAllBtn");
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            if (confirm("Are you sure you want to clear all stored conversation history? This cannot be undone.")) {
                state.chatSessions = {};
                state.currentChatId = null;
                saveStoredChats();
                const chat = document.getElementById("chat");
                if (chat) chat.innerHTML = "";
                updateStorageSummary();
                closeSettings();
            }
        });
    }

    // Reset Defaults Button
    const resetBtn = document.getElementById("settingsResetDefaultsBtn");
    if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
            if (confirm("Reset all settings to initial defaults?")) {
                localStorage.removeItem("multiai_system_preset");
                localStorage.removeItem("multiai_custom_system_prompt");
                localStorage.removeItem("multiai_temperature");
                localStorage.removeItem("multiai_send_key");

                const defaults = {
                    General: {
                        DefaultStartupLLM: "gemini-2.5-flash",
                        DefaultImageProvider: "pollinations",
                        DefaultImageModel: "flux",
                        DefaultImageAspectRatio: "3:2",
                        RecordDate: true,
                        RecordChatHistory: true,
                        MaxChatHistory: 100
                    },
                    Agent: {
                        MaxToolRounds: 50,
                        MaxToolsPerRound: 10,
                        AutoScroll: true,
                        StreamReasoning: true,
                        TurnTimeoutSeconds: 120
                    },
                    Tools: {
                        EnableTerminal: true,
                        EnableWebSearch: true,
                        EnableImageGeneration: true,
                        EnableFileOperations: true
                    },
                    UI: {
                        Theme: "dark",
                        ShowLineNumbers: true,
                        CompactMobileView: true
                    }
                };

                state.config = defaults;
                try {
                    await fetch("/api/config", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(defaults)
                    });
                } catch (_) {}

                populateSettingsValues();
            }
        });
    }
}
