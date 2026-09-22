import { state } from "../state/index.js";

/**
 * Shared HTTP client helper for tool executions.
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {string} [options.method="POST"]
 * @param {Object} [options.body]
 * @param {Object} [options.genState]
 * @returns {Promise<any>}
 */
export async function toolFetch(url, { method = "POST", body = null, genState = null, timeoutMs = 120000 } = {}) {
    if (genState && genState.abortRequested) {
        throw new Error("Generation stopped by user");
    }

    const opts = {
        method,
        headers: {
            "Content-Type": "application/json",
            "x-chat-id": state.currentChatId || ""
        }
    };

    // Combine user-stop signal with a per-request deadline so stalled servers
    // never leave badges stuck at "Running..." indefinitely.
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (genState && genState.abortController && genState.abortController.signal) {
        signals.push(genState.abortController.signal);
    }
    opts.signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

    if (method === "POST" && body !== null && body !== undefined) {
        opts.body = JSON.stringify(body);
    }

    let response;
    try {
        response = await fetch(url, opts);
    } catch (e) {
        if ((genState && genState.abortRequested) || e.name === "AbortError") {
            throw new Error("Generation stopped by user");
        }
        if (e.name === "TimeoutError") {
            throw new Error(`Tool request timed out after ${Math.round(timeoutMs / 1000)}s — server may be unavailable.`);
        }
        throw e;
    }

    let data;
    const text = await response.text();
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(`API error (${response.status}): ${text.slice(0, 70)}...`);
    }

    if (!response.ok) {
        throw new Error(data.error || "Tool call execution failed");
    }

    return data;
}
