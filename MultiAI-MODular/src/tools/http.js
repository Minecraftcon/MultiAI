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
export async function toolFetch(url, { method = "POST", body = null, genState = null } = {}) {
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

    if (genState && genState.abortController) {
        opts.signal = genState.abortController.signal;
    }

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
