import { extractText } from "../utils/dom.js";

/**
 * Sanitizes an API or history message object into the standard OpenAI-compatible format.
 * Preserves thought signatures for Gemini/reasoning models.
 */
export function sanitizeMessage(msg) {
    if (!msg || typeof msg !== "object") return null;
    const role = msg.role || "user";
    if (role === "assistant") {
        const clean = {
            role: "assistant",
            content: typeof msg.content === "string" ? msg.content : (msg.content === null ? null : extractText(msg))
        };
        if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            clean.tool_calls = msg.tool_calls.map(tc => {
                const call = {
                    id: String(tc.id || ("call_" + Math.random().toString(36).substring(2, 9))),
                    type: "function",
                    function: {
                        name: String(tc.function?.name || ""),
                        arguments: typeof tc.function?.arguments === "string"
                            ? tc.function.arguments
                            : JSON.stringify(tc.function?.arguments || {})
                    }
                };
                const sig = tc.thoughtSignature || tc.thought_signature || tc.function?.thoughtSignature || tc.function?.thought_signature;
                if (sig) {
                    call.thoughtSignature = sig;
                }
                return call;
            });
        }
        return clean;
    }
    if (role === "tool") {
        return {
            role: "tool",
            name: msg.name ? String(msg.name) : undefined,
            tool_call_id: String(msg.tool_call_id || ""),
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
    }
    if (role === "user") {
        if (Array.isArray(msg.content)) {
            return {
                role: "user",
                content: msg.content.map(p => {
                    if (p.type === "text") return { type: "text", text: String(p.text || "") };
                    if (p.type === "image_url") return { type: "image_url", image_url: { url: String(p.image_url?.url || "") } };
                    return p;
                })
            };
        }
        return {
            role: "user",
            content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
        };
    }
    return {
        role,
        content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
    };
}

/**
 * Extracts and cleans error messages from server or third-party responses.
 */
export function cleanErrorMessage(raw) {
    if (!raw) return "Request could not be completed";
    let str = typeof raw === "string" ? raw : (raw.message || JSON.stringify(raw));

    // Extract JSON error payload if embedded
    const firstBrace = str.indexOf("{");
    const lastBrace = str.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
            const parsed = JSON.parse(str.slice(firstBrace, lastBrace + 1));
            if (parsed.error?.message) {
                return parsed.error.message;
            }
            if (parsed.message) {
                return parsed.message;
            }
        } catch (_) {}
    }

    str = str.replace(/^Error:\s*/i, "").trim();
    return str;
}
