function normalizeMessage(msg, supportsTools = true, supportsVision = true) {
    if (!msg || typeof msg !== "object") return null;
    const role = msg.role;

    if (role === "system") {
        return {
            role: "system",
            content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
        };
    }

    if (role === "user") {
        if (Array.isArray(msg.content)) {
            if (supportsVision) {
                const parts = [];
                for (const part of msg.content) {
                    if (part.type === "text") {
                        parts.push({ type: "text", text: String(part.text || "") });
                    } else if (part.type === "image_url" && part.image_url?.url) {
                        parts.push({
                            type: "image_url",
                            image_url: { url: String(part.image_url.url) }
                        });
                    }
                }
                return { role: "user", content: parts };
            } else {
                let text = "";
                let imgCount = 0;
                for (const part of msg.content) {
                    if (part.type === "text") text += (part.text || "") + " ";
                    if (part.type === "image_url") imgCount++;
                }
                if (imgCount > 0) {
                    text += `\n[Note: ${imgCount} image(s) attached, but model is text-only]`;
                }
                return { role: "user", content: text.trim() };
            }
        }
        return {
            role: "user",
            content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
        };
    }

    if (role === "assistant") {
        const hasToolCalls = msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
        if (hasToolCalls) {
            if (supportsTools) {
                return {
                    role: "assistant",
                    content: typeof msg.content === "string" ? msg.content : null,
                    tool_calls: msg.tool_calls.map(tc => ({
                        id: String(tc.id || ("call_" + Math.random().toString(36).substring(2, 9))),
                        type: "function",
                        function: {
                            name: String(tc.function?.name || ""),
                            arguments: typeof tc.function?.arguments === "string"
                                ? tc.function.arguments
                                : JSON.stringify(tc.function?.arguments || {})
                        }
                    }))
                };
            } else {
                const toolNames = msg.tool_calls.map(tc => tc.function?.name).filter(Boolean).join(", ");
                return {
                    role: "assistant",
                    content: msg.content || (toolNames ? `[Action taken: ${toolNames}]` : "[Action taken]")
                };
            }
        }
        return {
            role: "assistant",
            content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
        };
    }

    if (role === "tool") {
        if (supportsTools) {
            return {
                role: "tool",
                name: msg.name ? String(msg.name) : undefined,
                tool_call_id: String(msg.tool_call_id || ""),
                content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
            };
        } else {
            return {
                role: "user",
                content: `[Tool Result]: ${typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)}`
            };
        }
    }

    return {
        role: "user",
        content: typeof msg.content === "string" ? msg.content : String(msg.content || "")
    };
}

function normalizeMessages(messages, supportsTools = true, supportsVision = true) {
    if (!Array.isArray(messages)) return [];
    return messages.map(m => normalizeMessage(m, supportsTools, supportsVision)).filter(Boolean);
}

function formatAssistantResponse(rawMessage) {
    if (!rawMessage || typeof rawMessage !== "object") {
        return { role: "assistant", content: "" };
    }
    const clean = {
        role: "assistant",
        content: typeof rawMessage.content === "string"
            ? rawMessage.content
            : (Array.isArray(rawMessage.content) ? rawMessage.content.map(c => c.text || "").join("") : (rawMessage.content || ""))
    };
    if (rawMessage.tool_calls && Array.isArray(rawMessage.tool_calls) && rawMessage.tool_calls.length > 0) {
        clean.tool_calls = rawMessage.tool_calls.map(tc => ({
            id: String(tc.id || ("call_" + Math.random().toString(36).substring(2, 9))),
            type: "function",
            function: {
                name: String(tc.function?.name || ""),
                arguments: typeof tc.function?.arguments === "string"
                    ? tc.function.arguments
                    : JSON.stringify(tc.function?.arguments || {})
            }
        }));
    }
    return clean;
}

module.exports = {
    normalizeMessage,
    normalizeMessages,
    formatAssistantResponse
};
