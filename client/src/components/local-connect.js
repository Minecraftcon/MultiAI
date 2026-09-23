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
    { id: "kobold",  label: "KoboldCPP  (api/v1)",           hint: "Default KoboldCPP endpoint" },
    { id: "openai",  label: "OpenAI-compat  (v1/)",           hint: "llama.cpp server, LocalAI, LM Studio…" },
    { id: "llama",   label: "llama.cpp  (/chat/completions)", hint: "Bare llama.cpp without /v1 prefix" },
    { id: "vllm",    label: "vLLM  (v1/)",                   hint: "vLLM OpenAI-compatible server" },
    { id: "ollama",  label: "Ollama  (api/chat)",             hint: "Ollama native API" },
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
            <div class="kobold-modal-icon">
                <i data-lucide="cpu"></i>
            </div>
            <div>
                <h2 id="localModalTitle" class="kobold-modal-title">Connect Local LLM</h2>
                <p class="kobold-modal-subtitle">KoboldCPP · llama.cpp · vLLM · Ollama · any OpenAI-compat server</p>
            </div>
            <button class="kobold-close-btn" id="localModalClose" aria-label="Close">
                <i data-lucide="x"></i>
            </button>
        </div>

        <div class="kobold-modal-body local-connect-body">

            <!-- Base URL -->
            <div class="lc-field-group">
                <label class="lc-label" for="localUrlInput">
                    <i data-lucide="link"></i>
                    Base URL
                </label>
                <input
                    id="localUrlInput"
                    class="kobold-input"
                    type="url"
                    placeholder="http://localhost:5001"
                    value="${lastUrl}"
                    autocomplete="url"
                    spellcheck="false"
                />
                <p class="lc-hint">The root address of your running LLM server (no path suffix needed).</p>
            </div>

            <!-- API Format -->
            <div class="lc-field-group">
                <label class="lc-label" for="localFormatSelect">
                    <i data-lucide="layers"></i>
                    API Format
                </label>
                <div class="lc-format-grid">
                    ${API_FORMATS.map(f => `
                        <label class="lc-format-chip ${f.id === lastFmt ? "is-selected" : ""}" data-format="${f.id}">
                            <input type="radio" name="localApiFormat" value="${f.id}" ${f.id === lastFmt ? "checked" : ""} />
                            <span class="lc-format-label">${f.label}</span>
                            <span class="lc-format-hint">${f.hint}</span>
                        </label>
                    `).join("")}
                </div>
            </div>

            <!-- Generation Controls (collapsible) -->
            <details class="lc-advanced" ${Object.keys(lastOpts).some(k => lastOpts[k] !== null && lastOpts[k] !== "") ? "open" : ""}>
                <summary class="lc-advanced-toggle">
                    <i data-lucide="sliders-horizontal"></i>
                    Generation Settings
                    <span class="lc-advanced-badge">optional</span>
                    <i data-lucide="chevron-down" class="lc-chevron"></i>
                </summary>

                <div class="lc-gen-grid">
                    <div class="lc-gen-field">
                        <label class="lc-gen-label" for="lcTemperature">
                            Temperature
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
                        <p class="lc-gen-hint">0 = deterministic · 1 = default · 2 = very creative</p>
                    </div>

                    <div class="lc-gen-field">
                        <label class="lc-gen-label" for="lcTopP">
                            Top-P (nucleus sampling)
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
                        <p class="lc-gen-hint">Restrict sampling to top cumulative probability mass</p>
                    </div>

                    <div class="lc-gen-field">
                        <label class="lc-gen-label" for="lcTopK">
                            Top-K
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
                        <p class="lc-gen-hint">0 = disabled · 40 = KoboldCPP default</p>
                    </div>

                    <div class="lc-gen-field">
                        <label class="lc-gen-label" for="lcRepPenalty">
                            Repetition Penalty
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
                        <p class="lc-gen-hint">1 = disabled · 1.1 = mild · 1.3 = strong</p>
                    </div>
                </div>

                <button class="lc-reset-btn" id="lcResetGenBtn" type="button">
                    <i data-lucide="rotate-ccw"></i> Reset to server defaults
                </button>
            </details>

            <div id="localStatus" class="kobold-status" aria-live="polite"></div>
        </div>

        <div class="kobold-modal-footer">
            <button class="kobold-btn-secondary" id="localCancelBtn">Cancel</button>
            <button class="kobold-btn-primary" id="localConnectBtn">
                <i data-lucide="zap"></i>
                Connect
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

/* ── Close ──────────────────────────────────────────────────────────────── */

function _closeModal() {
    const modal    = document.getElementById("localConnectModal");
    const backdrop = document.getElementById("localConnectBackdrop");
    if (modal) { modal.classList.remove("is-visible"); modal.classList.add("is-closing"); }
    if (backdrop) backdrop.classList.remove("is-visible");
    setTimeout(() => { modal?.remove(); backdrop?.remove(); }, 220);
}

/* ── Connect handler ────────────────────────────────────────────────────── */

async function _handleConnect() {
    const btn      = document.getElementById("localConnectBtn");
    const urlInput = document.getElementById("localUrlInput");

    const rawUrl = (urlInput?.value || "").trim();
    if (!rawUrl) { _showStatus("error", "Please enter a URL."); urlInput?.focus(); return; }
    try { new URL(rawUrl); } catch (_) {
        _showStatus("error", "Invalid URL — example: http://localhost:5001");
        urlInput?.focus();
        return;
    }

    const selectedFormat = document.querySelector("input[name='localApiFormat']:checked")?.value || "kobold";

    const numVal = id => {
        const el = document.getElementById(id);
        const v  = el ? parseFloat(el.value) : NaN;
        return isNaN(v) || el.value === "" ? null : v;
    };
    const genOpts = {
        temperature:         numVal("lcTemperature"),
        top_p:               numVal("lcTopP"),
        top_k:               numVal("lcTopK") !== null ? Math.round(numVal("lcTopK")) : null,
        repetition_penalty:  numVal("lcRepPenalty"),
    };

    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="kobold-spinner"></span> Connecting…`; }
    _showStatus("loading", "Reaching server…");

    try {
        const res = await fetch("/api/local/probe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base_url: rawUrl, api_format: selectedFormat, ...genOpts }),
            signal: AbortSignal.timeout(10000)
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            _showStatus("error", data.error || `Server error (${res.status})`);
            if (btn) { btn.disabled = false; btn.innerHTML = `<i data-lucide="zap"></i> Connect`; renderIcons(btn); }
            return;
        }

        _saveSession(data.base_url, selectedFormat, genOpts);
        _showStatus("success", `Connected — ${data.model_name} (${data.context_size?.toLocaleString() ?? "?"} ctx)`);
        _injectLocalModel(data);

        if (typeof _onConnectSuccess === "function") _onConnectSuccess(data);
        setTimeout(_closeModal, 1100);

    } catch (err) {
        const msg = err.name === "TimeoutError"
            ? "Timed out — is the server running at that URL?"
            : (err.message || "Connection failed");
        _showStatus("error", msg);
        if (btn) { btn.disabled = false; btn.innerHTML = `<i data-lucide="zap"></i> Connect`; renderIcons(btn); }
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
