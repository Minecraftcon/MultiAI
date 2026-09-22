/* =========================================================
   DEEPSEARCH LIVE STATS BAR COMPONENT
   Renders directly under model response during active DeepSearch.
   Features dynamic 0-100% progress bar, live agent telemetry,
   source counters, and final report artifact access.
   ========================================================= */

import { renderIcons } from "../utils/icons.js";

/**
 * Render the HTML shell for the DeepSearch Live Stats Box.
 * @param {Object} job
 * @returns {string}
 */
export function renderDeepSearchBar(job) {
    const progress = Math.min(100, Math.max(0, job.progress || 0));
    const isCompleted = job.status === "completed";
    const isFailed = job.status === "failed";

    return `
    <div class="deepsearch-stats-box ${isCompleted ? "is-completed" : ""} ${isFailed ? "is-failed" : ""}" id="deepsearch-box-${job.id}" data-job-id="${job.id}">
        <!-- Header Row -->
        <div class="ds-box-header">
            <div class="ds-box-title-wrap">
                <span class="ds-pulse-dot ${isCompleted ? "pulse-green" : (isFailed ? "pulse-red" : "pulse-amber")}"></span>
                <span class="ds-badge">DEEPSEARCH</span>
                <span class="ds-phase-tag" id="ds-phase-${job.id}">${job.phase || "Starting Research"}</span>
            </div>
            <div class="ds-pct-badge" id="ds-pct-${job.id}">${progress}%</div>
        </div>

        <!-- Animated Progress Bar -->
        <div class="ds-progress-track">
            <div class="ds-progress-fill" id="ds-fill-${job.id}" style="width: ${progress}%;">
                <div class="ds-progress-glow"></div>
            </div>
        </div>

        <!-- Live Status Subtext -->
        <div class="ds-status-text" id="ds-status-${job.id}">
            ${job.statusText || "Initializing multi-agent research graph..."}
        </div>

        <!-- Micro-stats Row -->
        <div class="ds-stats-row">
            <div class="ds-stat-pill" title="Candidate web sources identified">
                <i data-lucide="compass" class="ds-stat-icon"></i>
                <span id="ds-stat-sources-${job.id}">${job.stats?.sourcesFound || 0} Sources</span>
            </div>
            <div class="ds-stat-pill" title="Pages scraped and analyzed">
                <i data-lucide="file-check" class="ds-stat-icon"></i>
                <span id="ds-stat-dug-${job.id}">${job.stats?.sourcesDug || 0} Analyzed</span>
            </div>
            <div class="ds-stat-pill" title="Parallel autonomous agents">
                <i data-lucide="users" class="ds-stat-icon"></i>
                <span id="ds-stat-agents-${job.id}">4 Subagents</span>
            </div>
            
            <button type="button" class="ds-logs-toggle" id="ds-logs-btn-${job.id}" aria-label="Toggle activity log">
                <span class="ds-logs-toggle-text">Logs</span>
                <i data-lucide="chevron-down" class="ds-toggle-chevron"></i>
            </button>
        </div>

        <!-- Collapsible Activity Drawer -->
        <div class="ds-activity-drawer" id="ds-drawer-${job.id}" style="display: none;">
            <div class="ds-logs-container" id="ds-logs-${job.id}">
                ${(job.logs || []).slice(-8).map(l => `<div class="ds-log-item"><span class="ds-log-time">${new Date(l.timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span> ${escapeText(l.text)}</div>`).join("")}
            </div>
        </div>

        <!-- Completion Report Action -->
        <div class="ds-completion-row" id="ds-complete-${job.id}" style="${isCompleted ? "display: flex;" : "display: none;"}">
            <div class="ds-complete-msg">
                <i data-lucide="check-circle-2" class="ds-complete-icon"></i>
                <span>Deep research completed and verified.</span>
            </div>
            <button type="button" class="ds-view-report-btn" id="ds-view-btn-${job.id}">
                <i data-lucide="file-text" class="ds-btn-icon"></i>
                <span>Open Final Report</span>
            </button>
        </div>
    </div>
    `;
}

function escapeText(str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, m => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[m]);
}

/**
 * Wire interactive controls (Logs drawer toggle and Open Final Report view toggle).
 * @param {HTMLElement} container
 * @param {string} jobId
 */
export function wireDeepSearchBar(container, jobId) {
    if (!container || !jobId) return;

    // Wire up logs toggle button
    const logsBtn = container.querySelector(`#ds-logs-btn-${jobId}`);
    const drawer = container.querySelector(`#ds-drawer-${jobId}`);
    if (logsBtn && drawer && !logsBtn._wired) {
        logsBtn._wired = true;
        logsBtn.addEventListener("click", () => {
            const isHidden = drawer.style.display === "none";
            drawer.style.display = isHidden ? "block" : "none";
            logsBtn.classList.toggle("is-open", isHidden);
            renderIcons(logsBtn);
        });
    }

    // Wire up Open Final Report button
    const viewBtn = container.querySelector(`#ds-view-btn-${jobId}`);
    if (viewBtn && !viewBtn._wired) {
        viewBtn._wired = true;
        viewBtn.addEventListener("click", async () => {
            let reportDiv = container.querySelector(`#ds-report-view-${jobId}`);
            if (!reportDiv) {
                reportDiv = document.createElement("div");
                reportDiv.id = `ds-report-view-${jobId}`;
                reportDiv.className = "ds-report-view-container";
                reportDiv.style.display = "none";
                container.appendChild(reportDiv);
            }

            if (reportDiv.style.display === "block") {
                reportDiv.style.display = "none";
                const label = viewBtn.querySelector("span");
                if (label) label.textContent = "Open Final Report";
                return;
            }

            const label = viewBtn.querySelector("span");
            if (label) label.textContent = "Loading Report...";

            try {
                const res = await fetch(`/api/deepsearch/status/${encodeURIComponent(jobId)}`);
                const data = await res.json();
                const reportMd = data.job?.finalReport || "Report ready in artifacts directory.";
                const { parseMarkdown } = await import("./renderer.js");
                reportDiv.innerHTML = `<div class="ds-report-content markdown-body">${parseMarkdown(reportMd)}</div>`;
                reportDiv.style.display = "block";
                if (label) label.textContent = "Hide Final Report";
                const chat = document.getElementById("chat");
                if (chat) chat.scrollTop = chat.scrollHeight;
            } catch (err) {
                if (label) label.textContent = "Failed to load report";
            }
        });
    }
}

/**
 * Poll live progress for an active DeepSearch job and update the DOM element.
 * @param {string} jobId
 * @param {HTMLElement} container
 * @param {Function} [onFinished]
 */
export function startDeepSearchPolling(jobId, container, onFinished) {
    if (!jobId || !container) return;

    let isFinished = false;
    wireDeepSearchBar(container, jobId);

    const intervalId = setInterval(async () => {
        if (isFinished) {
            clearInterval(intervalId);
            return;
        }

        try {
            const res = await fetch(`/api/deepsearch/status/${encodeURIComponent(jobId)}`);
            if (!res.ok) return;
            const data = await res.json();
            const job = data.job;
            if (!job) return;

            updateDeepSearchBarDOM(container, job);

            if (job.status === "completed" || job.status === "failed") {
                isFinished = true;
                clearInterval(intervalId);
                if (typeof onFinished === "function") {
                    onFinished(job);
                }
            }
        } catch (e) {
            console.warn("[DeepSearch Poller Error]", e);
        }
    }, 1200);

    renderIcons(container);
    return intervalId;
}

/**
 * Mutate the DOM of the stats bar in-place with new telemetry.
 * @param {HTMLElement} container
 * @param {Object} job
 */
export function updateDeepSearchBarDOM(container, job) {
    const box = container.querySelector(`#deepsearch-box-${job.id}`);
    if (!box) return;

    const progress = Math.min(100, Math.max(0, job.progress || 0));
    const isCompleted = job.status === "completed";
    const isFailed = job.status === "failed";

    if (isCompleted) {
        box.classList.add("is-completed");
        box.classList.remove("is-failed");
    } else if (isFailed) {
        box.classList.add("is-failed");
        box.classList.remove("is-completed");
    }

    // Update Percentage
    const pctEl = container.querySelector(`#ds-pct-${job.id}`);
    if (pctEl) pctEl.textContent = `${progress}%`;

    // Update Progress Fill
    const fillEl = container.querySelector(`#ds-fill-${job.id}`);
    if (fillEl) fillEl.style.width = `${progress}%`;

    // Update Phase
    const phaseEl = container.querySelector(`#ds-phase-${job.id}`);
    if (phaseEl) phaseEl.textContent = job.phase || "Searching";

    // Update Status Subtext
    const statusEl = container.querySelector(`#ds-status-${job.id}`);
    if (statusEl) statusEl.textContent = job.statusText || "";

    // Update Stats counters
    const sourcesEl = container.querySelector(`#ds-stat-sources-${job.id}`);
    if (sourcesEl) sourcesEl.textContent = `${job.stats?.sourcesFound || 0} Sources`;

    const dugEl = container.querySelector(`#ds-stat-dug-${job.id}`);
    if (dugEl) dugEl.textContent = `${job.stats?.sourcesDug || 0} Analyzed`;

    // Update Pulse Dot
    const dot = box.querySelector(".ds-pulse-dot");
    if (dot) {
        dot.className = `ds-pulse-dot ${isCompleted ? "pulse-green" : (isFailed ? "pulse-red" : "pulse-amber")}`;
    }

    // Update Logs
    const logsContainer = container.querySelector(`#ds-logs-${job.id}`);
    if (logsContainer && Array.isArray(job.logs)) {
        logsContainer.innerHTML = job.logs.slice(-10).map(l => 
            `<div class="ds-log-item"><span class="ds-log-time">${new Date(l.timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span> ${escapeText(l.text)}</div>`
        ).join("");
    }

    // Update Completion state
    const completeRow = container.querySelector(`#ds-complete-${job.id}`);
    if (completeRow) {
        completeRow.style.display = isCompleted ? "flex" : "none";
        renderIcons(completeRow);
    }
}
