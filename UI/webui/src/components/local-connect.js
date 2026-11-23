/* =========================================================
   LOCAL CONNECT — Rolling URL prompt, format selector & generation controls
   Supports: KoboldCPP, llama.cpp, vLLM, Ollama, any OpenAI-compat server
   ========================================================= */
import { renderIcons } from "../utils/icons.js";
import { availableModels, modelProviderMap } from "./side-panel.js";

const SESSION_KEY = "local_base_url";
const SESSION_FMT  = "local_api_format";
const SESSION_OPTS = "local_gen_opts";

const API_FORMATS = [
    { id: "kobold",  label: "KoboldCPP",     badge: "api/v1",           hint: "Standard endpoint" },
    { id: "openai",  label: "OpenAI-compat", badge: "v1/",              hint: "LM Studio, LocalAI" },
    { id: "llama",   label: "llama.cpp",     badge: "chat/completions", hint: "Bare server" },
    { id: "vllm",    label: "vLLM",          badge: "v1/",              hint: "vLLM server" },
    { id: "ollama",  label: "Ollama",        badge: "api/chat",         hint: "Native API" },
];

let _onConnectSuccess = null;

/* ── Session helpers ────────────────────────────────────────────────────── */

export function getKoboldSessionUrl() {
    try { return sessionStorage.getItem(SESSION_KEY) || null; } catch (_) { return null; }
}
export function getLocalSessionUrl() { return getKoboldSessionUrl(); }

export function clearKoboldSession() {
    try {
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_FMT);
        sessionStorage.removeItem(SESSION_OPTS);
    } catch (_) {}
}
export function clearLocalSession() { clearKoboldSession(); }

function _saveSession(baseUrl, format, opts = {}) {
    try {
        sessionStorage.setItem(SESSION_KEY, baseUrl);
        sessionStorage.setItem(SESSION_FMT, format);
        sessionStorage.setItem(SESSION_OPTS, JSON.stringify(opts));
    } catch (_) {}
}
function _loadSessionOpts() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_OPTS) || "{}"); } catch (_) { return {}; }
}

/* ── Auto-reconnect ─────────────────────────────────────────────────────── */

export async function tryKoboldAutoReconnect(onSuccess) {
    return tryLocalAutoReconnect(onSuccess);
}

export async function tryLocalAutoReconnect(onSuccess) {
    try {
        const res = await fetch("/api/local/session");
        if (!res.ok) return false;
        const session = await res.json();
        if (!session.base_url) return false;

        const probeRes = await fetch("/api/local/probe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(session)
        });
        if (!probeRes.ok) return false;
        const data = await probeRes.json();
        if (data.success) {
            if (session.compactor_model) {
                try {
                    localStorage.setItem("multiai_compactor_model", session.compactor_model);
                    const currentOpts = _loadSessionOpts();
                    currentOpts.compactor_model = session.compactor_model;
                    sessionStorage.setItem(SESSION_OPTS, JSON.stringify(currentOpts));
                } catch (_) {}
            }
            _injectLocalModel(data);
            if (typeof onSuccess === "function") onSuccess(data);
            return true;
        }
    } catch (_) {}
    return false;
}

/* ── Modal open ─────────────────────────────────────────────────────────── */

export function showKoboldConnectModal(onSuccess) { showLocalConnectModal(onSuccess); }
export function openKoboldConnectModal(onSuccess) { showLocalConnectModal(onSuccess); }
export function openLocalConnectModal(onSuccess) { showLocalConnectModal(onSuccess); }

export function showLocalConnectModal(onSuccess) {
    _onConnectSuccess = onSuccess;
    _renderModal();
}

/* ── Modal render ───────────────────────────────────────────────────────── */

function _renderModal() {
    document.getElementById("localConnectModal")?.remove();
    document.getElementById("localConnectBackdrop")?.remove();
    // Also clean up old kobold modal IDs for backward compat
    document.getElementById("koboldConnectModal")?.remove();
    document.getElementById("koboldConnectBackdrop")?.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "localConnectBackdrop";
    backdrop.className = "kobold-backdrop";
    backdrop.addEventListener("click", _closeModal);

    const lastUrl  = getLocalSessionUrl() || "http://localhost:5001";
    const lastFmt  = sessionStorage.getItem(SESSION_FMT) || "kobold";
    const lastOpts = _loadSessionOpts();

    const modal = document.createElement("div");
    modal.id = "localConnectModal";
    modal.className = "kobold-modal local-connect-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "localModalTitle");

    modal.innerHTML = `
        <div class="kobold-modal-header">
            <div>
                <h2 id="localModalTitle" class="kobold-modal-title">Connect Local Model</h2>
                <p class="kobold-modal-subtitle">KoboldCPP, llama.cpp, vLLM, Ollama, or OpenAI-compatible server</p>
            </div>
            <button class="kobold-close-btn" id="localModalClose" aria-label="Close">
                <i data-lucide="x"></i>
            </button>
        </div>

        <div class="kobold-modal-body local-connect-body">

            <!-- Base URL -->
            <div class="lc-field-group">
                <label class="lc-label" for="localUrlInput">
                    Server Address
                </label>
                <div class="kobold-input-row">
                    <input
                        id="localUrlInput"
                        class="kobold-input"
                        type="url"
                        placeholder="http://localhost:5001"
                        value="${lastUrl}"
                        autocomplete="url"
                        spellcheck="false"
                    />
                </div>
            </div>

            <!-- API Format -->
            <div class="lc-field-group">
                <label class="lc-label">
                    Server Type
                </label>
                <div class="lc-format-grid">
                    ${API_FORMATS.map(f => `
                        <label class="lc-format-chip ${f.id === lastFmt ? "is-selected" : ""}" data-format="${f.id}">
                            <input type="radio" name="localApiFormat" value="${f.id}" ${f.id === lastFmt ? "checked" : ""} />
                            <div class="lc-format-header">
                                <span class="lc-format-label">${f.label}</span>
                                <span class="lc-format-badge">${f.badge}</span>
                            </div>
                            <span class="lc-format-hint">${f.hint}</span>
                        </label>
                    `).join("")}
                </div>
            </div>

            <!-- Custom System Prompt -->
            <div class="lc-field-group">
                <label class="lc-label" for="localSystemPromptInput">
                    System Instructions <span class="lc-label-tag">Optional</span>
                </label>
                <textarea
                    id="localSystemPromptInput"
                    class="kobold-textarea"
                    rows="2"
                    placeholder="Custom directives prepended to system instructions for this local model..."
                    spellcheck="false"
                >${lastOpts.system_prompt || ""}</textarea>
            </div>

            <!-- Context Compactor (Use different model for compaction) -->
            <div class="lc-field-group">
                <label class="lc-label" for="lcCompactorTrigger">
                    Context Compactor <span class="lc-label-tag">Optional</span>
                </label>
                <div class="lc-compactor-picker" id="lcCompactorPicker">
                    <button type="button" class="lc-compactor-trigger" id="lcCompactorTrigger" aria-haspopup="listbox" aria-expanded="false">
                        <span class="lc-compactor-text" id="lcCompactorCurrentLabel">Default (Active Local Model)</span>
                        <div class="lc-compactor-actions">
                            <button type="button" class="lc-compactor-clear-btn" id="lcCompactorClearBtn" title="Reset to default compactor" aria-label="Reset to default compactor">&times;</button>
                            <i data-lucide="chevron-down" class="lc-compactor-arrow"></i>
                        </div>
                    </button>
                    <input type="hidden" id="lcCompactorSelect" value="" />

                    <div class="lc-compactor-menu" id="lcCompactorMenu" role="listbox">
                        <div class="lc-compactor-search-wrap">
                            <input type="text" class="lc-compactor-search" id="lcCompactorSearch" placeholder="Search model or provider…" autocomplete="off" spellcheck="false" />
                        </div>
                        <div class="lc-compactor-options" id="lcCompactorOptionsList"></div>
                    </div>
                </div>
                <span class="lc-format-hint">
                    Select any configured model to run context compaction instead of this local model.
                </span>
            </div>

            <!-- Generation Controls (collapsible) -->
            <details class="lc-advanced" id="lcAdvancedDetails" ${Object.keys(lastOpts).some(k => k !== "system_prompt" && lastOpts[k] !== null && lastOpts[k] !== "") ? "open" : ""}>
                <summary class="lc-advanced-toggle">
                    <i data-lucide="sliders" style="width: 14px; height: 14px;"></i>
                    Sampling Parameters
                    <span class="lc-advanced-badge">Optional</span>
                    <i data-lucide="chevron-down" class="lc-chevron"></i>
                </summary>

                <div class="lc-advanced-content">
                    <div class="lc-gen-grid">
                        <div class="lc-gen-field">
                            <label class="lc-gen-label" for="lcTemperature">
                                <span>Temperature</span>
                                <span class="lc-gen-value" id="lcTemperatureVal">${lastOpts.temperature ?? ""}</span>
                            </label>
                            <div class="lc-range-row">
                                <input type="range" id="lcTemperatureRange" class="lc-range"
                                    min="0" max="2" step="0.05"
                                    value="${lastOpts.temperature ?? 1.0}" />
                                <input type="number" id="lcTemperature" class="lc-num-input"
                                    min="0" max="2" step="0.05"
                                    placeholder="default"
                                    value="${lastOpts.temperature ?? ""}" />
                            </div>
                        </div>

                        <div class="lc-gen-field">
                            <label class="lc-gen-label" for="lcTopP">
                                <span>Top-P</span>
                                <span class="lc-gen-value" id="lcTopPVal">${lastOpts.top_p ?? ""}</span>
                            </label>
                            <div class="lc-range-row">
                                <input type="range" id="lcTopPRange" class="lc-range"
                                    min="0" max="1" step="0.01"
                                    value="${lastOpts.top_p ?? 1.0}" />
                                <input type="number" id="lcTopP" class="lc-num-input"
                                    min="0" max="1" step="0.01"
                                    placeholder="default"
                                    value="${lastOpts.top_p ?? ""}" />
                            </div>
                        </div>

                        <div class="lc-gen-field">
                            <label class="lc-gen-label" for="lcTopK">
                                <span>Top-K</span>
                                <span class="lc-gen-value" id="lcTopKVal">${lastOpts.top_k ?? ""}</span>
                            </label>
                            <div class="lc-range-row">
                                <input type="range" id="lcTopKRange" class="lc-range"
                                    min="0" max="200" step="1"
                                    value="${lastOpts.top_k ?? 40}" />
                                <input type="number" id="lcTopK" class="lc-num-input"
                                    min="0" max="200" step="1"
                                    placeholder="default"
                                    value="${lastOpts.top_k ?? ""}" />
                            </div>
                        </div>

                        <div class="lc-gen-field">
                            <label class="lc-gen-label" for="lcRepPenalty">
                                <span>Repetition Penalty</span>
                                <span class="lc-gen-value" id="lcRepPenaltyVal">${lastOpts.repetition_penalty ?? ""}</span>
                            </label>
                            <div class="lc-range-row">
                                <input type="range" id="lcRepPenaltyRange" class="lc-range"
                                    min="1" max="2" step="0.01"
                                    value="${lastOpts.repetition_penalty ?? 1.1}" />
                                <input type="number" id="lcRepPenalty" class="lc-num-input"
                                    min="1" max="2" step="0.01"
                                    placeholder="default"
                                    value="${lastOpts.repetition_penalty ?? ""}" />
                            </div>
                        </div>
                    </div>

                    <button class="lc-reset-btn" id="lcResetGenBtn" type="button">
                        <i data-lucide="rotate-ccw"></i> Reset to defaults
                    </button>
                </div>
            </details>

            <div id="localStatus" class="kobold-status" aria-live="polite"></div>
        </div>

        <div class="kobold-modal-footer">
            <button class="kobold-btn-secondary" id="localCancelBtn">Cancel</button>
            <button class="kobold-btn-primary" id="localConnectBtn">
                Connect Server
            </button>
        </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    renderIcons(modal);

    modal.addEventListener("click", e => e.stopPropagation());

    // Wire close buttons
    document.getElementById("localModalClose")?.addEventListener("click", _closeModal);
    document.getElementById("localCancelBtn")?.addEventListener("click", _closeModal);
    document.getElementById("localConnectBtn")?.addEventListener("click", _handleConnect);

    // Format chips
    modal.querySelectorAll(".lc-format-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            modal.querySelectorAll(".lc-format-chip").forEach(c => c.classList.remove("is-selected"));
            chip.classList.add("is-selected");
            const radio = chip.querySelector("input[type=radio]");
            if (radio) radio.checked = true;
        });
    });

    // Sync range ↔ number inputs
    const syncPairs = [
        ["lcTemperatureRange", "lcTemperature", "lcTemperatureVal"],
        ["lcTopPRange",        "lcTopP",        "lcTopPVal"],
        ["lcTopKRange",        "lcTopK",        "lcTopKVal"],
        ["lcRepPenaltyRange",  "lcRepPenalty",  "lcRepPenaltyVal"],
    ];
    syncPairs.forEach(([rangeId, numberId, valId]) => {
        const rangeEl = document.getElementById(rangeId);
        const numEl   = document.getElementById(numberId);
        const valEl   = document.getElementById(valId);
        if (!rangeEl || !numEl) return;

        rangeEl.addEventListener("input", () => {
            numEl.value = rangeEl.value;
            if (valEl) valEl.textContent = rangeEl.value;
        });
        numEl.addEventListener("input", () => {
            const v = parseFloat(numEl.value);
            if (!isNaN(v)) { rangeEl.value = v; if (valEl) valEl.textContent = v; }
            else if (valEl) valEl.textContent = "";
        });
    });

    // Setup Custom Compactor Picker
    const resetCompactorPicker = _setupCompactorPicker(modal, lastOpts);

    // Reset gen settings
    document.getElementById("lcResetGenBtn")?.addEventListener("click", () => {
        document.getElementById("lcTemperature").value = "";
        document.getElementById("lcTopP").value = "";
        document.getElementById("lcTopK").value = "";
        document.getElementById("lcRepPenalty").value = "";
        document.getElementById("lcTemperatureRange").value = 1.0;
        document.getElementById("lcTopPRange").value = 1.0;
        document.getElementById("lcTopKRange").value = 40;
        document.getElementById("lcRepPenaltyRange").value = 1.1;
        ["lcTemperatureVal","lcTopPVal","lcTopKVal","lcRepPenaltyVal"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = "";
        });
        const sysPrompt = document.getElementById("localSystemPromptInput");
        if (sysPrompt) sysPrompt.value = "";
        if (typeof resetCompactorPicker === "function") resetCompactorPicker();
        try { localStorage.removeItem("multiai_compactor_model"); } catch (_) {}
    });

    const urlInput = document.getElementById("localUrlInput");
    urlInput?.focus();
    urlInput?.addEventListener("keydown", e => {
        if (e.key === "Enter") _handleConnect();
        if (e.key === "Escape") _closeModal();
    });

    requestAnimationFrame(() => {
        backdrop.classList.add("is-visible");
        modal.classList.add("is-visible");
    });
}

/* ── Custom Compactor Picker ─────────────────────────────────────────────── */

function _setupCompactorPicker(modal, lastOpts) {
    const pickerWrap   = modal.querySelector(".lc-compactor-picker");
    const triggerBtn   = modal.querySelector("#lcCompactorTrigger");
    const hiddenInput  = modal.querySelector("#lcCompactorSelect");
    const currentLabel = modal.querySelector("#lcCompactorCurrentLabel");
    const clearBtn     = modal.querySelector("#lcCompactorClearBtn");
    const searchInput  = modal.querySelector("#lcCompactorSearch");
    const optionsList  = modal.querySelector("#lcCompactorOptionsList");

    if (!pickerWrap || !triggerBtn || !hiddenInput || !optionsList) return () => {};

    // Collect available models grouped by provider
    const modelSelect = typeof document !== "undefined" ? document.getElementById("modelSelect") : null;
    const groups = []; // [{ label: string, models: [{ id, name }] }]

    if (modelSelect && modelSelect.options.length > 0) {
        Array.from(modelSelect.children).forEach(child => {
            if (child.tagName === "OPTGROUP") {
                const groupProvider = child.dataset.provider;
                if (groupProvider === "local" || groupProvider === "koboldcpp") return;

                const groupModels = [];
                Array.from(child.children).forEach(opt => {
                    if (opt.dataset.rolling === "true" || opt.value.startsWith("__rolling_connect__")) return;
                    groupModels.push({
                        id: opt.value,
                        name: opt.textContent.replace(/\s*\[Vision\]/i, "").trim()
                    });
                });
                if (groupModels.length > 0) {
                    groups.push({
                        label: child.label.replace(/\s*\(No Key\)/i, "").trim(),
                        models: groupModels
                    });
                }
            } else if (child.tagName === "OPTION") {
                if (!child.value.startsWith("__rolling_connect__") && child.value !== "local" && child.value !== "koboldcpp") {
                    groups.push({
                        label: "General",
                        models: [{ id: child.value, name: child.textContent }]
                    });
                }
            }
        });
    } else if (Array.isArray(availableModels) && availableModels.length > 0) {
        const provMap = {};
        availableModels.forEach(m => {
            if (!m.id || m.provider === "local" || m.provider === "koboldcpp") return;
            const p = m.provider || "Other";
            if (!provMap[p]) provMap[p] = [];
            provMap[p].push({
                id: m.id,
                name: (m.name || m.id).replace(/\s*\[Vision\]/i, "").trim()
            });
        });
        Object.entries(provMap).forEach(([prov, models]) => {
            groups.push({
                label: prov.charAt(0).toUpperCase() + prov.slice(1),
                models
            });
        });
    }

    const savedCompactor = lastOpts.compactor_model || (typeof localStorage !== "undefined" ? localStorage.getItem("multiai_compactor_model") : "") || "";

    function updateSelection(val) {
        hiddenInput.value = val || "";
        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));

        if (!val) {
            currentLabel.textContent = "Default (Active Local Model)";
            currentLabel.title = "Default (Active Local Model)";
            if (clearBtn) clearBtn.style.display = "none";
        } else {
            let matchedName = val;
            for (const g of groups) {
                const found = g.models.find(m => m.id === val);
                if (found) { matchedName = found.name; break; }
            }
            currentLabel.textContent = matchedName;
            currentLabel.title = `${matchedName} (${val})`;
            if (clearBtn) clearBtn.style.display = "inline-flex";
        }

        optionsList.querySelectorAll(".lc-compactor-item").forEach(item => {
            const isMatch = item.dataset.value === (val || "");
            item.classList.toggle("is-selected", isMatch);
        });

        try {
            if (val) {
                localStorage.setItem("multiai_compactor_model", val);
            } else {
                localStorage.removeItem("multiai_compactor_model");
            }
        } catch (_) {}
    }

    function renderOptions(filter = "") {
        const q = filter.trim().toLowerCase();
        optionsList.innerHTML = "";

        const defaultMatches = !q || "default active local model".includes(q);
        if (defaultMatches) {
            const defItem = document.createElement("div");
            defItem.className = `lc-compactor-item ${!hiddenInput.value ? "is-selected" : ""}`;
            defItem.dataset.value = "";
            defItem.innerHTML = `
                <span class="lc-compactor-item-name">Default (Active Local Model)</span>
                <span class="lc-compactor-badge-tag">Local</span>
            `;
            defItem.addEventListener("click", () => {
                updateSelection("");
                closeMenu();
            });
            optionsList.appendChild(defItem);
        }

        let totalVisible = defaultMatches ? 1 : 0;

        groups.forEach(g => {
            const filteredModels = g.models.filter(m => {
                if (!q) return true;
                return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || g.label.toLowerCase().includes(q);
            });

            if (filteredModels.length > 0) {
                const header = document.createElement("div");
                header.className = "lc-compactor-group-title";
                header.textContent = g.label;
                optionsList.appendChild(header);

                filteredModels.forEach(m => {
                    const item = document.createElement("div");
                    const isSelected = hiddenInput.value === m.id;
                    item.className = `lc-compactor-item ${isSelected ? "is-selected" : ""}`;
                    item.dataset.value = m.id;
                    item.innerHTML = `
                        <span class="lc-compactor-item-name" title="${m.id}">${m.name}</span>
                    `;
                    item.addEventListener("click", () => {
                        updateSelection(m.id);
                        closeMenu();
                    });
                    optionsList.appendChild(item);
                    totalVisible++;
                });
            }
        });

        if (totalVisible === 0) {
            const empty = document.createElement("div");
            empty.className = "lc-compactor-empty";
            empty.textContent = "No models match your search";
            optionsList.appendChild(empty);
        }

        renderIcons(optionsList);
    }

    function openMenu() {
        pickerWrap.classList.add("is-open");
        triggerBtn.setAttribute("aria-expanded", "true");
        if (searchInput) {
            searchInput.value = "";
            renderOptions("");
            setTimeout(() => searchInput.focus(), 40);
        }
    }

    function closeMenu() {
        pickerWrap.classList.remove("is-open");
        triggerBtn.setAttribute("aria-expanded", "false");
    }

    triggerBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (pickerWrap.classList.contains("is-open")) {
            closeMenu();
        } else {
            openMenu();
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            updateSelection("");
        });
    }

    searchInput?.addEventListener("input", (e) => {
        renderOptions(e.target.value);
    });

    searchInput?.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeMenu();
            triggerBtn.focus();
        }
    });

    modal.addEventListener("click", (e) => {
        if (!pickerWrap.contains(e.target)) {
            closeMenu();
        }
    });

    updateSelection(savedCompactor);
    renderOptions("");

    return () => updateSelection("");
}

/* ── Close ──────────────────────────────────────────────────────────────── */

function _closeModal() {
    const modal    = document.getElementById("localConnectModal");
    const backdrop = document.getElementById("localConnectBackdrop");
    if (modal) { modal.classList.remove("is-visible"); modal.classList.add("is-closing"); }
    if (backdrop) backdrop.classList.remove("is-visible");
    setTimeout(() => { modal?.remove(); backdrop?.remove(); }, 220);
}

/* ── URL Normalization ─────────────────────────────────────────────────── */

export function normalizeServerUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    let url = rawUrl.trim();
    url = url.replace(/^['"]+|['"]+$/g, "");
    if (!url) return "";

    // If scheme is missing, intelligently prepend https:// or http://
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
        if (/trycloudflare\.com|ngrok|loca\.lt|hf\.space|runpod\.net|\.app$|\.dev$|\.org$|\.io$/i.test(url) && !/:\d+/.test(url)) {
            url = "https://" + url;
        } else {
            url = "http://" + url;
        }
    }

    try {
        const parsed = new URL(url);
        let pathname = parsed.pathname.replace(/\/+$/, "");

        const suffixesToStrip = [
            "/v1/chat/completions",
            "/chat/completions",
            "/v1/models",
            "/api/v1/model",
            "/api/v1/chat/completions",
            "/api/v1/generate",
            "/api/v1",
            "/v1",
            "/api/tags",
            "/api/chat"
        ];

        for (const suffix of suffixesToStrip) {
            if (pathname.endsWith(suffix)) {
                pathname = pathname.slice(0, -suffix.length);
                break;
            }
        }

        parsed.pathname = pathname;
        return parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname);
    } catch (_) {
        return url.replace(/\/+$/, "");
    }
}

/* ── Connect handler ────────────────────────────────────────────────────── */

async function _handleConnect() {
    const btn      = document.getElementById("localConnectBtn");
    const urlInput = document.getElementById("localUrlInput");

    const rawUrl = (urlInput?.value || "").trim();
    if (!rawUrl) { _showStatus("error", "Please enter a URL."); urlInput?.focus(); return; }

    const normalizedUrl = normalizeServerUrl(rawUrl);
    try {
        new URL(normalizedUrl);
    } catch (_) {
        _showStatus("error", "Invalid URL format. Example: http://localhost:5001 or https://your-tunnel.trycloudflare.com");
        urlInput?.focus();
        return;
    }

    // If scheme was missing, prepend protocol in input field while preserving trailing slash
    if (urlInput && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawUrl)) {
        const proto = /trycloudflare\.com|ngrok|loca\.lt|hf\.space|runpod\.net|\.app$|\.dev$|\.org$|\.io$/i.test(rawUrl) && !/:\d+/.test(rawUrl) ? "https://" : "http://";
        urlInput.value = proto + rawUrl;
    }

    const selectedFormat = document.querySelector("input[name='localApiFormat']:checked")?.value || "kobold";

    const numVal = id => {
        const el = document.getElementById(id);
        const v  = el ? parseFloat(el.value) : NaN;
        return isNaN(v) || el.value === "" ? null : v;
    };
    const sysPromptInput = document.getElementById("localSystemPromptInput");
    const compactorSelect = document.getElementById("lcCompactorSelect");
    const compactorModel = compactorSelect?.value?.trim() || null;
    const genOpts = {
        temperature:         numVal("lcTemperature"),
        top_p:               numVal("lcTopP"),
        top_k:               numVal("lcTopK") !== null ? Math.round(numVal("lcTopK")) : null,
        repetition_penalty:  numVal("lcRepPenalty"),
        system_prompt:       sysPromptInput?.value?.trim() || null,
        compactor_model:     compactorModel,
    };

    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="kobold-spinner"></span> Connecting…`; }
    _showStatus("loading", "Reaching server…");

    try {
        const res = await fetch("/api/local/probe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base_url: normalizedUrl, api_format: selectedFormat, ...genOpts }),
            signal: AbortSignal.timeout(10000)
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            _showStatus("error", data.error || `Server error (${res.status})`);
            if (btn) { btn.disabled = false; btn.innerHTML = `Connect Server`; }
            return;
        }

        _saveSession(data.base_url, selectedFormat, genOpts);
        try {
            if (compactorModel) {
                localStorage.setItem("multiai_compactor_model", compactorModel);
            } else {
                localStorage.removeItem("multiai_compactor_model");
            }
        } catch (_) {}
        _showStatus("success", `Connected — ${data.model_name} (${data.context_size?.toLocaleString() ?? "?"} ctx)`);
        _injectLocalModel(data);

        if (typeof _onConnectSuccess === "function") _onConnectSuccess(data);
        setTimeout(_closeModal, 1100);

    } catch (err) {
        const msg = err.name === "TimeoutError"
            ? "Timed out — is the server running at that URL?"
            : (err.message || "Connection failed");
        _showStatus("error", msg);
        if (btn) { btn.disabled = false; btn.innerHTML = `Connect Server`; }
    }
}

function _showStatus(type, message) {
    const el = document.getElementById("localStatus");
    if (!el) return;
    el.className = `kobold-status kobold-status--${type}`;
    const icons = { error: "alert-circle", success: "check-circle", loading: "loader" };
    el.innerHTML = `<i data-lucide="${icons[type] || "info"}"></i><span>${message}</span>`;
    renderIcons(el);
}

/* ── Model injection ────────────────────────────────────────────────────── */

export function _injectKoboldModel(data) { _injectLocalModel(data); }

export function _injectLocalModel(data) {
    const modelSelect = document.getElementById("modelSelect");
    if (!modelSelect) return;

    const modelId   = data.model_id;
    const modelName = `${data.model_name} [Local]`;

    // Remove any existing local / koboldcpp entries to avoid duplicates
    ["local", "koboldcpp"].forEach(pId => {
        modelSelect.querySelectorAll(`option[data-provider='${pId}']`).forEach(o => o.remove());
        modelSelect.querySelectorAll(`optgroup[data-provider='${pId}']`).forEach(g => g.remove());
    });

    // Build optgroup
    let group = modelSelect.querySelector("optgroup[data-provider='local']");
    if (!group) {
        group = document.createElement("optgroup");
        group.label = "Local";
        group.dataset.provider = "local";
        modelSelect.appendChild(group);
    } else {
        group.innerHTML = "";
    }

    const opt = document.createElement("option");
    opt.value = modelId;
    opt.textContent = modelName;
    opt.dataset.provider = "local";
    opt.dataset.vision   = "false";
    group.appendChild(opt);

    // Update availableModels
    const existingIdx = availableModels.findIndex(m => m.provider === "local" || m.provider === "koboldcpp");
    const modelEntry  = {
        id: modelId,
        name: modelName,
        provider: "local",
        supports_tools: data.supports_tools !== false,
        supports_vision: false,
        max_context_tokens: data.context_size || 4096,
    };
    if (existingIdx >= 0) availableModels[existingIdx] = modelEntry;
    else availableModels.push(modelEntry);
    modelProviderMap[modelId] = "local";

    modelSelect.value = modelId;
    modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
}
