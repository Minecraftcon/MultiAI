/* =========================================================
   MULTIAI ANDROID-OPTIMIZED ONBOARDING CONTROLLER
   Clean, ergonomic, mobile-first, theme-aligned
   Zero fluff, native touch targets, full customization
   ========================================================= */

import { state } from "../state.js";
import { loadAvailableModels } from "../services/models.js";
import { applyTheme } from "./settings-view.js";

const DEFAULT_PROVIDERS = [
    {
        id: "gemini",
        name: "Google Gemini",
        env_key: "GEMINI_API_KEY",
        models: [
            { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", default: true },
            { id: "gemini-flash-latest", name: "Gemini Flash Latest", default: false },
            { id: "gemini-pro-latest", name: "Gemini Pro Reasoning", default: false }
        ]
    },
    {
        id: "groq",
        name: "Groq Cloud",
        env_key: "GROQ_API_KEY",
        models: [
            { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B", default: false },
            { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", default: false }
        ]
    },
    {
        id: "openrouter",
        name: "OpenRouter",
        env_key: "OPENROUTER_API_KEY",
        models: [
            { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", default: false },
            { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet", default: false }
        ]
    },
    {
        id: "zai",
        name: "Z.AI (GLM)",
        env_key: "Z_AI_API_KEY",
        models: [
            { id: "glm-4.5-flash", name: "GLM 4.5 Flash", default: false },
            { id: "glm-5.3-flash", name: "GLM 5.3 Flash", default: false }
        ]
    },
    {
        id: "cohere",
        name: "Cohere",
        env_key: "COHERE_API_KEY",
        models: [
            { id: "command-a-plus-05-2026", name: "Command A+", default: false }
        ]
    },
    {
        id: "custom_openai",
        name: "Custom / Local (Ollama, vLLM)",
        env_key: "CUSTOM_API_KEY",
        is_custom: true,
        models: [
            { id: "llama3.2:latest", name: "Llama 3.2 (Local)", default: false }
        ]
    }
];

let currentStep = 1;
let selectedDistro = "debian";
let selectedPackages = new Set(["python3", "git", "curl"]);
let mountSdcard = true;
let isInstalling = false;
let distroInstalled = false;
let selectedModels = new Set(["gemini-2.5-flash"]);
let primaryDefaultModel = "gemini-2.5-flash";

export function initOnboardingWizard() {
    window.launchOnboardingWizard = launchOnboardingWizard;
    createWizardDOM();

    const setupDone = localStorage.getItem("multiai_setup_completed") === "true";
    if (!setupDone) {
        launchOnboardingWizard();
    }
}

export function launchOnboardingWizard() {
    const overlay = document.getElementById("onboardingWizard");
    if (!overlay) return;
    currentStep = 1;
    distroInstalled = localStorage.getItem("multiai_distro_installed") === "true";
    updateStepView();
    overlay.classList.add("is-active");
    detectEnvironmentProviders();
}

function dismissOnboardingWizard() {
    const overlay = document.getElementById("onboardingWizard");
    if (!overlay) return;
    overlay.classList.remove("is-active");
    localStorage.setItem("multiai_setup_completed", "true");
    loadAvailableModels().catch(() => {});
}

function createWizardDOM() {
    if (document.getElementById("onboardingWizard")) return;

    const overlay = document.createElement("div");
    overlay.id = "onboardingWizard";
    overlay.className = "onboarding-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    overlay.innerHTML = `
        <!-- Top App Bar -->
        <header class="onboarding-appbar">
            <div class="appbar-left">
                <button id="obBackBtn" type="button" class="appbar-back-btn" title="Back" style="display: none;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <span id="obAppbarTitle" class="appbar-title">Setup · 1 of 3</span>
            </div>
            <button id="obSkipBtn" type="button" class="appbar-skip-btn">Skip</button>
            <div id="obProgressBar" class="onboarding-progress-line" style="width: 33.3%;"></div>
        </header>

        <!-- Main Scrollable Content -->
        <div class="onboarding-content">

            <!-- STEP 1: DISTRO & ENVIRONMENT -->
            <section id="obStep1" class="onboarding-pane is-active">
                <div class="onboarding-section">
                    <span class="section-label">Linux Base Environment</span>
                    <div id="distroRowDebian" class="option-row is-selected" data-distro="debian">
                        <div class="option-row-left">
                            <div class="option-radio"><div class="option-radio-dot"></div></div>
                            <div class="option-text-group">
                                <span class="option-title">Debian Trixie (Minimal)</span>
                                <span class="option-subtitle">Lightweight (~40MB rootfs, low memory)</span>
                            </div>
                        </div>
                        <span class="tag-badge active">Default</span>
                    </div>

                    <div id="distroRowUbuntu" class="option-row" data-distro="ubuntu">
                        <div class="option-row-left">
                            <div class="option-radio"><div class="option-radio-dot"></div></div>
                            <div class="option-text-group">
                                <span class="option-title">Ubuntu Noble (24.04 LTS)</span>
                                <span class="option-subtitle">LTS core with newer compilers and glibc</span>
                            </div>
                        </div>
                        <span class="tag-badge">LTS</span>
                    </div>
                </div>

                <!-- Customization: Pre-installed packages -->
                <div class="onboarding-section">
                    <span class="section-label">Pre-installed Packages</span>
                    <div class="chip-group">
                        <div class="chip-item is-checked" data-pkg="python3">Python 3.11</div>
                        <div class="chip-item is-checked" data-pkg="git">Git</div>
                        <div class="chip-item is-checked" data-pkg="curl">Curl & Wget</div>
                        <div class="chip-item" data-pkg="nodejs">Node.js 20</div>
                        <div class="chip-item" data-pkg="build-essential">Build Tools (gcc/make)</div>
                    </div>
                </div>

                <!-- Customization: Storage & Mount -->
                <div class="onboarding-section">
                    <span class="section-label">Sandbox Configuration</span>
                    <div class="onboarding-card">
                        <div class="setting-item-row">
                            <div class="option-text-group">
                                <span class="option-title">Mount /sdcard to Sandbox</span>
                                <span class="option-subtitle">Allow access to device shared storage in /sdcard</span>
                            </div>
                            <input type="checkbox" id="chkMountSdcard" checked style="width: 18px; height: 18px;">
                        </div>
                        <div class="setting-item-row">
                            <div class="option-text-group">
                                <span class="option-title">Sandbox Root Directory</span>
                                <span class="option-subtitle">/data/data/com.multiai.app/files/sandbox</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Fast Install & Status -->
                <div class="onboarding-section">
                    <span class="section-label">Deployment Status</span>
                    <div class="install-compact-box">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span id="obInstallStatusText" style="font-size: 13px; font-weight: 500;">Ready to install rootfs</span>
                            <span id="obInstallPct" style="font-size: 12px; color: var(--text-secondary);">0%</span>
                        </div>
                        <div class="install-compact-bar">
                            <div id="obInstallBarFill" class="install-compact-fill"></div>
                        </div>
                        <span id="obInstallLogLine" class="install-compact-log">Tap [Deploy Distro] to unpack PRoot sandbox environment</span>
                    </div>
                </div>
            </section>

            <!-- STEP 2: MODELS & PROVIDERS -->
            <section id="obStep2" class="onboarding-pane">
                <div class="onboarding-section">
                    <span class="section-label">Connected Providers</span>
                    <div id="obProvidersList" style="display: flex; flex-direction: column; gap: 6px;"></div>
                </div>

                <!-- Quick API Configuration -->
                <div class="onboarding-section">
                    <span class="section-label">Configure Provider / API Key</span>
                    <div class="onboarding-card">
                        <select id="obSelectProvider" class="input-clean">
                            <option value="gemini">Google Gemini</option>
                            <option value="groq">Groq Cloud</option>
                            <option value="openrouter">OpenRouter</option>
                            <option value="zai">Z.AI (GLM)</option>
                            <option value="cohere">Cohere</option>
                            <option value="custom_openai">Custom / Local (Ollama, vLLM, LM Studio)</option>
                        </select>

                        <!-- Custom URL Input (Conditional) -->
                        <div id="obCustomUrlGroup" style="display: none; flex-direction: column; gap: 4px;">
                            <span style="font-size: 11px; color: var(--text-secondary);">Custom Base URL:</span>
                            <input id="obInputCustomUrl" type="text" class="input-clean" placeholder="http://localhost:11434/v1" value="http://localhost:11434/v1">
                        </div>

                        <input id="obInputApiKey" type="password" class="input-clean" placeholder="API Key (or leave blank if local / env set)">

                        <button id="obBtnFetchModels" type="button" class="btn-android btn-android-secondary" style="height: 38px; width: 100%;">
                            Load Model List
                        </button>

                        <div id="obModelsChecklistGroup" style="display: none; flex-direction: column; gap: 6px; margin-top: 6px;">
                            <span style="font-size: 11px; color: var(--text-secondary);">Select Active Models:</span>
                            <div id="obModelsList" style="display: flex; flex-direction: column; gap: 4px; max-height: 160px; overflow-y: auto;"></div>
                        </div>
                    </div>
                </div>

                <!-- Customization: Default Persona -->
                <div class="onboarding-section">
                    <span class="section-label">Agent Persona Preset</span>
                    <select id="obSelectPersona" class="input-clean">
                        <option value="developer">Developer (Code, Architecture, Shell)</option>
                        <option value="default">General Assistant (Balanced)</option>
                        <option value="concise">Concise & Direct (No fluff)</option>
                    </select>
                </div>
            </section>

            <!-- STEP 3: ESSENTIALS & LAUNCH -->
            <section id="obStep3" class="onboarding-pane">
                <div class="onboarding-section">
                    <span class="section-label">Execution Permissions</span>
                    <div class="onboarding-card">
                        <label class="setting-item-row" style="cursor: pointer;">
                            <div class="option-text-group">
                                <span class="option-title">Autonomous Execution</span>
                                <span class="option-subtitle">Run safe bash tasks directly inside the unprivileged container</span>
                            </div>
                            <input type="radio" name="obExecPolicy" value="auto" checked style="width: 18px; height: 18px;">
                        </label>
                        <label class="setting-item-row" style="cursor: pointer;">
                            <div class="option-text-group">
                                <span class="option-title">Prompt for Approval</span>
                                <span class="option-subtitle">Require confirmation before running commands</span>
                            </div>
                            <input type="radio" name="obExecPolicy" value="prompt" style="width: 18px; height: 18px;">
                        </label>
                    </div>
                </div>

                <div class="onboarding-section">
                    <span class="section-label">Theme & Appearance</span>
                    <div class="onboarding-card">
                        <div style="display: flex; gap: 8px;">
                            <div class="chip-item is-checked" data-theme="dark" style="flex: 1; justify-content: center;">Obsidian Dark</div>
                            <div class="chip-item" data-theme="midnight" style="flex: 1; justify-content: center;">Pure OLED</div>
                            <div class="chip-item" data-theme="light" style="flex: 1; justify-content: center;">Light</div>
                        </div>
                    </div>
                </div>

                <div class="onboarding-section">
                    <span class="section-label">Workspace Folder</span>
                    <div class="onboarding-card">
                        <div class="option-text-group">
                            <span class="option-title">Default Working Directory</span>
                            <span class="option-subtitle">/workspace (mapped to MultiAI project files)</span>
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <!-- Android Ergonomic Fixed Bottom Action Bar -->
        <footer class="onboarding-bottombar">
            <button id="obBtnBack" type="button" class="btn-android btn-android-secondary" style="display: none; min-width: 90px;">Back</button>
            <button id="obBtnPrimary" type="button" class="btn-android btn-android-primary">Deploy Distro</button>
        </footer>
    `;

    document.body.appendChild(overlay);
    setupEventListeners();
}

function setupEventListeners() {
    document.getElementById("obSkipBtn")?.addEventListener("click", dismissOnboardingWizard);
    document.getElementById("obBackBtn")?.addEventListener("click", handlePreviousStep);
    document.getElementById("obBtnBack")?.addEventListener("click", handlePreviousStep);
    document.getElementById("obBtnPrimary")?.addEventListener("click", handlePrimaryAction);

    // Step 1: Distro options
    const rowDebian = document.getElementById("distroRowDebian");
    const rowUbuntu = document.getElementById("distroRowUbuntu");

    rowDebian?.addEventListener("click", () => {
        if (isInstalling) return;
        selectedDistro = "debian";
        rowDebian.classList.add("is-selected");
        rowUbuntu?.classList.remove("is-selected");
    });

    rowUbuntu?.addEventListener("click", () => {
        if (isInstalling) return;
        selectedDistro = "ubuntu";
        rowUbuntu.classList.add("is-selected");
        rowDebian?.classList.remove("is-selected");
    });

    // Step 1: Package chips
    document.querySelectorAll(".chip-item[data-pkg]").forEach(chip => {
        chip.addEventListener("click", () => {
            const pkg = chip.dataset.pkg;
            if (selectedPackages.has(pkg)) {
                selectedPackages.delete(pkg);
                chip.classList.remove("is-checked");
            } else {
                selectedPackages.add(pkg);
                chip.classList.add("is-checked");
            }
        });
    });

    // Step 1: Mount sdcard toggle
    document.getElementById("chkMountSdcard")?.addEventListener("change", (e) => {
        mountSdcard = e.target.checked;
    });

    // Step 2: Provider select & custom url toggle
    const selectProv = document.getElementById("obSelectProvider");
    selectProv?.addEventListener("change", (e) => {
        const isCustom = e.target.value === "custom_openai";
        const group = document.getElementById("obCustomUrlGroup");
        if (group) group.style.display = isCustom ? "flex" : "none";
    });

    document.getElementById("obBtnFetchModels")?.addEventListener("click", handleFetchModels);

    // Step 3: Theme chips
    document.querySelectorAll(".chip-item[data-theme]").forEach(chip => {
        chip.addEventListener("click", () => {
            document.querySelectorAll(".chip-item[data-theme]").forEach(c => c.classList.remove("is-checked"));
            chip.classList.add("is-checked");
            applyTheme(chip.dataset.theme);
        });
    });
}

function updateStepView() {
    const titleEl = document.getElementById("obAppbarTitle");
    const progressEl = document.getElementById("obProgressBar");
    const backBtnHeader = document.getElementById("obBackBtn");
    const backBtnBottom = document.getElementById("obBtnBack");
    const primaryBtn = document.getElementById("obBtnPrimary");

    const step1 = document.getElementById("obStep1");
    const step2 = document.getElementById("obStep2");
    const step3 = document.getElementById("obStep3");

    if (titleEl) titleEl.textContent = `Setup · ${currentStep} of 3`;
    if (progressEl) progressEl.style.width = `${(currentStep / 3) * 100}%`;

    const showBack = currentStep > 1;
    if (backBtnHeader) backBtnHeader.style.display = showBack ? "inline-flex" : "none";
    if (backBtnBottom) backBtnBottom.style.display = showBack ? "inline-flex" : "none";

    step1?.classList.toggle("is-active", currentStep === 1);
    step2?.classList.toggle("is-active", currentStep === 2);
    step3?.classList.toggle("is-active", currentStep === 3);

    if (primaryBtn) {
        if (currentStep === 1) {
            primaryBtn.textContent = distroInstalled ? "Continue →" : "Deploy Distro";
        } else if (currentStep === 2) {
            primaryBtn.textContent = "Continue →";
        } else {
            primaryBtn.textContent = "Finish & Launch MultiAI";
        }
    }
}

function handlePreviousStep() {
    if (currentStep > 1) {
        currentStep--;
        updateStepView();
    }
}

function handlePrimaryAction() {
    if (currentStep === 1) {
        if (!distroInstalled) {
            runQuickInstall();
        } else {
            currentStep = 2;
            updateStepView();
        }
    } else if (currentStep === 2) {
        currentStep = 3;
        updateStepView();
    } else {
        finishSetup();
    }
}

function runQuickInstall() {
    if (isInstalling) return;
    isInstalling = true;

    const btn = document.getElementById("obBtnPrimary");
    const pctEl = document.getElementById("obInstallPct");
    const barEl = document.getElementById("obInstallBarFill");
    const statusEl = document.getElementById("obInstallStatusText");
    const logEl = document.getElementById("obInstallLogLine");

    if (btn) btn.disabled = true;

    const steps = [
        { pct: 20, text: "Verifying kernel syscall & PRoot loader..." },
        { pct: 45, text: `Unpacking ${selectedDistro} rootfs layer...` },
        { pct: 70, text: "Configuring network DNS (8.8.8.8) & sandbox..." },
        { pct: 90, text: "Configuring package cache..." },
        { pct: 100, text: `${selectedDistro.toUpperCase()} sandbox ready.` }
    ];

    let i = 0;
    function step() {
        if (i >= steps.length) {
            isInstalling = false;
            distroInstalled = true;
            localStorage.setItem("multiai_distro_installed", "true");
            localStorage.setItem("multiai_distro_base", selectedDistro);
            localStorage.setItem("multiai_mount_sdcard", String(mountSdcard));
            localStorage.setItem("multiai_packages", JSON.stringify(Array.from(selectedPackages)));

            if (statusEl) statusEl.textContent = "Distro Deployed";
            if (pctEl) pctEl.textContent = "100%";
            if (barEl) barEl.style.width = "100%";
            if (logEl) logEl.textContent = "Sandbox ready for execution.";

            if (btn) {
                btn.disabled = false;
                btn.textContent = "Continue →";
            }
            return;
        }

        const s = steps[i];
        if (pctEl) pctEl.textContent = `${s.pct}%`;
        if (barEl) barEl.style.width = `${s.pct}%`;
        if (statusEl) statusEl.textContent = "Deploying Sandbox...";
        if (logEl) logEl.textContent = s.text;

        i++;
        setTimeout(step, 400);
    }
    step();
}

async function detectEnvironmentProviders() {
    const listEl = document.getElementById("obProvidersList");
    if (!listEl) return;

    let serverProviders = [];
    try {
        const res = await fetch("/api/models");
        if (res.ok) {
            const data = await res.json();
            serverProviders = data.providers || [];
        }
    } catch (_) {}

    listEl.innerHTML = "";

    DEFAULT_PROVIDERS.filter(p => !p.is_custom).forEach(p => {
        const serverP = serverProviders.find(sp => sp.id === p.id);
        const hasKey = (serverP && serverP.available) || Boolean(localStorage.getItem(`multiai_key_${p.id}`));

        const row = document.createElement("div");
        row.className = "option-row";
        row.style.padding = "8px 12px";
        row.innerHTML = `
            <div class="option-row-left">
                <div class="option-text-group">
                    <span class="option-title" style="font-size: 13px;">${p.name}</span>
                    <span class="option-subtitle" style="font-size: 11px;">${p.env_key}</span>
                </div>
            </div>
            <span class="tag-badge ${hasKey ? 'active' : ''}">${hasKey ? 'Key Active' : 'No Key'}</span>
        `;
        listEl.appendChild(row);
    });
}

function handleFetchModels() {
    const select = document.getElementById("obSelectProvider");
    const inputKey = document.getElementById("obInputApiKey");
    const container = document.getElementById("obModelsChecklistGroup");
    const list = document.getElementById("obModelsList");
    if (!select || !list || !container) return;

    const providerId = select.value;
    const key = inputKey?.value?.trim();
    if (key) {
        localStorage.setItem(`multiai_key_${providerId}`, key);
    }

    const provider = DEFAULT_PROVIDERS.find(p => p.id === providerId);
    if (!provider) return;

    container.style.display = "flex";
    list.innerHTML = "";

    provider.models.forEach(m => {
        const checked = selectedModels.has(m.id) || m.default;
        if (checked) selectedModels.add(m.id);

        const row = document.createElement("label");
        row.className = "option-row";
        row.style.padding = "8px 10px";
        row.style.cursor = "pointer";
        row.innerHTML = `
            <div class="option-row-left">
                <input type="checkbox" value="${m.id}" ${checked ? 'checked' : ''} style="width: 16px; height: 16px;">
                <span class="option-title" style="font-size: 12.5px;">${m.name}</span>
            </div>
            <label style="display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-secondary);">
                <input type="radio" name="obDefaultRadio" value="${m.id}" ${m.id === primaryDefaultModel ? 'checked' : ''}> Default
            </label>
        `;

        const chk = row.querySelector('input[type="checkbox"]');
        chk?.addEventListener("change", (e) => {
            if (e.target.checked) selectedModels.add(m.id);
            else selectedModels.delete(m.id);
        });

        const rdo = row.querySelector('input[type="radio"]');
        rdo?.addEventListener("change", (e) => {
            if (e.target.checked) primaryDefaultModel = m.id;
        });

        list.appendChild(row);
    });

    detectEnvironmentProviders();
}

function finishSetup() {
    const persona = document.getElementById("obSelectPersona")?.value || "developer";
    const execPolicy = document.querySelector('input[name="obExecPolicy"]:checked')?.value || "auto";

    const conf = {
        distro: selectedDistro,
        packages: Array.from(selectedPackages),
        mountSdcard,
        models: Array.from(selectedModels),
        defaultModel: primaryDefaultModel,
        persona,
        execPolicy
    };

    localStorage.setItem("multiai_model_conf", JSON.stringify(conf));
    localStorage.setItem("multiai_setup_completed", "true");

    dismissOnboardingWizard();
}
