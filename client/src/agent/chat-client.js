import { state } from "../state/index.js";
import { modelProviderMap } from "../components/side-panel.js";
import { sanitizeMessage, cleanErrorMessage } from "./sanitizer.js";

/**
 * Sends messages to LLM backends (either Puter.js in-browser or /api/chat backend endpoint)
 * and normalizes the response.
 *
 * @param {Array<Object>} messages
 * @param {Object} options
 * @param {string} options.model
 * @param {Array<Object>} options.tools
 * @returns {Promise<Object>}
 */
export async function callChatModel(messages, { model, tools, signal } = {}) {
    let effectiveModel = model;
    if (effectiveModel === "dots-3-note-preview:free") {
        effectiveModel = "dots-studio/dots-3-note-preview:free";
    }

    const modelSelect = typeof document !== "undefined" ? document.getElementById("modelSelect") : null;
    const selectedOption = modelSelect?.selectedOptions?.[0];
    const providerFromSelect = (selectedOption && selectedOption.value === model) ? selectedOption.dataset.provider : null;
    const currentSession = (state.currentChatId && state.chatSessions[state.currentChatId]) ? state.chatSessions[state.currentChatId] : null;

    const provider = providerFromSelect || currentSession?.provider || modelProviderMap[model] || modelProviderMap[effectiveModel] || (
        (typeof model === "string" && (model.includes("free") || model.includes("dots") || model.startsWith("claude-") || model.startsWith("gpt-") || model.startsWith("deepseek-"))) ? "puter" : null
    );

    const cleanedMessages = Array.isArray(messages) ? messages.map(sanitizeMessage).filter(Boolean) : [];

    if (provider === "puter") {
        if (typeof puter === "undefined" || !puter?.ai?.chat) {
            const err = new Error("Puter client library is not loaded.");
            err.statusCode = 503;
            throw err;
        }
        try {
            const puterRes = await puter.ai.chat(cleanedMessages, { model: effectiveModel, tools });
            if (!puterRes || puterRes.error) {
                const cleanErr = cleanErrorMessage(puterRes?.error || "Puter model returned no response");
                const err = new Error(cleanErr);
                err.statusCode = 400;
                throw err;
            }
            return puterRes;
        } catch (err) {
            const cleanErr = cleanErrorMessage(err?.message || (typeof err === "object" ? JSON.stringify(err) : String(err)));
            const e = new Error(cleanErr);
            e.statusCode = err?.statusCode || 400;
            throw e;
        }
    }

    const activeSignal = signal || (state.currentChatId && state.activeGenerations[state.currentChatId]?.abortController?.signal);

    let res;
    try {
        res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                provider,
                messages: cleanedMessages,
                tools
            }),
            signal: activeSignal
        });
    } catch (netErr) {
        if (netErr.name === "AbortError" || activeSignal?.aborted) {
            const err = new Error("Generation stopped by user");
            err.name = "AbortError";
            throw err;
        }
        const err = new Error("Network connection failed or backend server unreachable.");
        err.statusCode = 0;
        throw err;
    }

    // Intercept ANY HTTP status code other than 200 OK (e.g. 429, 400, 401, 403, 404, 500, 502, 503)
    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const rawErr = errorData.error || `HTTP error ${res.status}: ${res.statusText || "Request failed"}`;
        const cleanErr = cleanErrorMessage(rawErr);
        const err = new Error(cleanErr);
        err.statusCode = res.status;
        err.rawError = rawErr;
        throw err;
    }

    const data = await res.json().catch(() => null);
    if (!data) {
        const err = new Error("Invalid or empty response from server.");
        err.statusCode = 502;
        throw err;
    }

    // Intercept if response contains an error payload even when HTTP status is 200
    if (data.error) {
        const cleanErr = cleanErrorMessage(data.error);
        const err = new Error(cleanErr);
        err.statusCode = data.status || 400;
        err.rawError = data.error;
        throw err;
    }

    // Intercept if response is not an actual response (no message content or tool calls)
    if (!data.message && !data.choices && !data.content) {
        const err = new Error("Model returned no message in response.");
        err.statusCode = 204;
        throw err;
    }

    return data;
}
