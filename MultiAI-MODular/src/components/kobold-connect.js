/* =========================================================
   KOBOLDCPP CONNECT — Rolling URL prompt & model injection
   ========================================================= */
import { renderIcons } from "../utils/icons.js";
import { availableModels, modelProviderMap } from "./side-panel.js";

// Session-level cache — clears on tab close (not on page navigate)
// Server-side memory is the source of truth for "restart reset"
const SESSION_KEY = "kobold_base_url";

let _onConnectSuccess = null;

/**
 * Returns the currently known KoboldCPP base URL from sessionStorage,
 * or null if not yet connected this browser session.
 */
export function getKoboldSessionUrl() {
    try {
        return sessionStorage.getItem(SESSION_KEY) || null;
    } catch (_) {
        return null;
    }
}

/**
 * Clears the session-level KoboldCPP URL (e.g. on explicit disconnect).
 */
export function clearKoboldSession() {
    try {
        sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
}

/**
 * Checks if the server already has a koboldBaseUrl cached (from a previous
 * probe this server session). If yes, re-registers the model without showing
 * the modal again.
 * Returns true if auto-reconnected, false if modal needs to show.
 */
export async function tryKoboldAutoReconnect(onSuccess) {
    try {
        const res = await fetch("/api/kobold/base_url");
        if (!res.ok) return false;
        const { base_url } = await res.json();
        if (!base_url) return false;
        // Server already has a URL — silently probe to get model info
        const probeRes = await fetch("/api/kobold/probe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base_url })
        });
        if (!probeRes.ok) return false;
        const data = await probeRes.json();
        if (data.success) {
            _injectKoboldModel(data);
            if (typeof onSuccess === "function") onSuccess(data);
            return true;
        }
    } catch (_) {}
    return false;
}

/**
 * Opens the KoboldCPP connection modal.
 * @param {function} onSuccess - Called with probe result on successful connect.
 */
export function showKoboldConnectModal(onSuccess) {
    _onConnectSuccess = onSuccess;
    _renderModal();
}

function _renderModal() {
    // Remove any stale modal
    document.getElementById("koboldConnectModal")?.remove();
    document.getElementById("koboldConnectBackdrop")?.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "koboldConnectBackdrop";
    backdrop.className = "kobold-backdrop";
    backdrop.addEventListener("click", _closeModal);

    const modal = document.createElement("div");
    modal.id = "koboldConnectModal";
    modal.className = "kobold-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "koboldModalTitle");

    // Pre-fill with last known URL
    const lastUrl = getKoboldSessionUrl() || "http://localhost:5001";

    modal.innerHTML = `
        <div class="kobold-modal-header">
            <div class="kobold-modal-icon">
                <i data-lucide="cpu"></i>
            </div>
            <div>
                <h2 id="koboldModalTitle" class="kobold-modal-title">Connect to KoboldCPP</h2>
                <p class="kobold-modal-subtitle">Auto-detects loaded model &amp; context length</p>
            </div>
            <button class="kobold-close-btn" id="koboldModalClose" aria-label="Close">
                <i data-lucide="x"></i>
            </button>
        </div>

        <div class="kobold-modal-body">
            <label class="kobold-label" for="koboldUrlInput">Base URL</label>
            <div class="kobold-input-row">
                <input
                    id="koboldUrlInput"
                    class="kobold-input"
                    type="url"
                    placeholder="http://localhost:5001"
                    value="${lastUrl}"
                    autocomplete="url"
                    spellcheck="false"
                />
            </div>
            <p class="kobold-hint">Enter the address where KoboldCPP is running. Leave port as-is if using the default.</p>

            <div id="koboldStatus" class="kobold-status" aria-live="polite"></div>
        </div>

        <div class="kobold-modal-footer">
            <button class="kobold-btn-secondary" id="koboldCancelBtn">Cancel</button>
            <button class="kobold-btn-primary" id="koboldConnectBtn">
                <i data-lucide="zap"></i>
                Connect
            </button>
        </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    renderIcons(modal);

    // Stop modal click from closing
    modal.addEventListener("click", e => e.stopPropagation());

    document.getElementById("koboldModalClose")?.addEventListener("click", _closeModal);
    document.getElementById("koboldCancelBtn")?.addEventListener("click", _closeModal);
    document.getElementById("koboldConnectBtn")?.addEventListener("click", _handleConnect);

    const input = document.getElementById("koboldUrlInput");
    input?.focus();
    input?.addEventListener("keydown", e => {
        if (e.key === "Enter") _handleConnect();
        if (e.key === "Escape") _closeModal();
    });

    // Animate in
    requestAnimationFrame(() => {
        backdrop.classList.add("is-visible");
        modal.classList.add("is-visible");
    });
}

function _closeModal() {
    const modal = document.getElementById("koboldConnectModal");
    const backdrop = document.getElementById("koboldConnectBackdrop");
    if (modal) {
        modal.classList.remove("is-visible");
        modal.classList.add("is-closing");
    }
    if (backdrop) {
        backdrop.classList.remove("is-visible");
    }
    setTimeout(() => {
        modal?.remove();
        backdrop?.remove();
    }, 220);
}

async function _handleConnect() {
    const input = document.getElementById("koboldUrlInput");
    const btn = document.getElementById("koboldConnectBtn");
    const statusEl = document.getElementById("koboldStatus");

    const rawUrl = (input?.value || "").trim();
    if (!rawUrl) {
        _showStatus("error", "Please enter a URL.");
        input?.focus();
        return;
    }

    // Basic URL validation
    try {
        new URL(rawUrl);
    } catch (_) {
        _showStatus("error", "Invalid URL format. Example: http://localhost:5001");
        input?.focus();
        return;
    }

    // Loading state
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="kobold-spinner"></span> Connecting…`;
    }
    _showStatus("loading", "Reaching KoboldCPP…");

    try {
        const res = await fetch("/api/kobold/probe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base_url: rawUrl }),
            signal: AbortSignal.timeout(10000)
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            const msg = data.error || `Server error (${res.status})`;
            _showStatus("error", msg);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i data-lucide="zap"></i> Connect`;
                renderIcons(btn);
            }
            return;
        }

        // Success
        try {
            sessionStorage.setItem(SESSION_KEY, data.base_url);
        } catch (_) {}

        _showStatus("success", `Connected — ${data.model_name} (${data.context_size.toLocaleString()} ctx)`);

        _injectKoboldModel(data);

        if (typeof _onConnectSuccess === "function") {
            _onConnectSuccess(data);
        }

        // Auto-close after brief success display
        setTimeout(_closeModal, 1100);

    } catch (err) {
        const msg = err.name === "TimeoutError"
            ? "Timed out — is KoboldCPP running at that URL?"
            : (err.message || "Connection failed");
        _showStatus("error", msg);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="zap"></i> Connect`;
            renderIcons(btn);
        }
    }
}

function _showStatus(type, message) {
    const el = document.getElementById("koboldStatus");
    if (!el) return;
    el.className = `kobold-status kobold-status--${type}`;
    const icons = { error: "alert-circle", success: "check-circle", loading: "loader" };
    el.innerHTML = `<i data-lucide="${icons[type] || "info"}"></i><span>${message}</span>`;
    renderIcons(el);
}

/**
 * Injects the connected KoboldCPP model into the model picker's <select>
 * and availableModels list so it's immediately usable.
 */
export function _injectKoboldModel(data) {
    const modelSelect = document.getElementById("modelSelect");
    if (!modelSelect) return;

    const modelId = data.model_id;
    const modelName = `${data.model_name} [Local]`;

    // Remove any previous koboldcpp entries to avoid duplicates
    modelSelect.querySelectorAll("option[data-provider='koboldcpp']").forEach(o => o.remove());
    modelSelect.querySelectorAll("optgroup[data-provider='koboldcpp']").forEach(g => g.remove());

    // Build or reuse the KoboldCPP optgroup
    let group = modelSelect.querySelector("optgroup[label='KoboldCPP (Local)']");
    if (!group) {
        group = document.createElement("optgroup");
        group.label = "KoboldCPP (Local)";
        group.dataset.provider = "koboldcpp";
        modelSelect.appendChild(group);
    } else {
        group.innerHTML = "";
    }

    const opt = document.createElement("option");
    opt.value = modelId;
    opt.textContent = modelName;
    opt.dataset.provider = "koboldcpp";
    opt.dataset.vision = "false";
    group.appendChild(opt);

    // Update availableModels flat list
    const existingIdx = availableModels.findIndex(m => m.provider === "koboldcpp");
    const modelEntry = {
        id: modelId,
        name: modelName,
        provider: "koboldcpp",
        supports_tools: false,
        supports_vision: false,
        max_context_tokens: data.context_size || 4096
    };
    if (existingIdx >= 0) {
        availableModels[existingIdx] = modelEntry;
    } else {
        availableModels.push(modelEntry);
    }
    modelProviderMap[modelId] = "koboldcpp";

    // Select the newly added model
    modelSelect.value = modelId;
    modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
}
