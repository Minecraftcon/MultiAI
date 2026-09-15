// Logfare AI Provider
const BaseProvider = require("./base");

class LogflareProvider extends BaseProvider {
    static id = "logflare";
    static displayName = "Logfare AI";
    static matchPatterns = [
        /^(log[-_]?f[l]?a[r]?e|logfare|logflare)$/i,
        "logflare",
        "logfare",
        "logfare.ai"
    ];

    getEndpoint(config = {}, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "https://logfare.ai/v1";
        return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false, options = {} }) {
        // moondream3.1 is vision-capable; other models are text-only unless specified
        const isVisionModel = Boolean(supportsVision || /vision|moondream/i.test(model));

        const payload = super.formatPayload({
            model,
            messages,
            tools,
            tool_choice,
            config,
            supportsTools,
            supportsVision: isVisionModel,
            options
        });

        // Ensure sufficient token budget for reasoning models
        if (!payload.max_tokens && !payload.max_completion_tokens) {
            payload.max_tokens = config.default_max_tokens || 4096;
        }

        return payload;
    }

    parseResponse(data) {
        const choice = data?.choices?.[0];
        const rawMessage = choice?.message || {};
        let content = rawMessage.content || "";
        let reasoning = rawMessage.reasoning_content ? String(rawMessage.reasoning_content).trim() : "";
        if (reasoning === "null" || reasoning === "undefined" || reasoning === "{}" || reasoning === "[]") {
            reasoning = "";
        }

        // Format reasoning / thinking steps (e.g. gemma-4-26b or logfare/auto)
        if (reasoning && content) {
            const durationStr = data?._durationSec ? `${data._durationSec} seconds` : "a few seconds";
            content = `<details class="thought-box" open data-duration="${data?._durationSec || ''}"><summary class="thought-summary"><span class="thought-header"><svg class="thought-brain-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/><path d="M12 8h4"/><path d="M12 12h3"/><path d="M12 16h4"/><path d="M8 8h4"/><path d="M9 12h3"/><path d="M8 16h4"/></svg><span class="thought-label">Thought for ${durationStr}</span><span class="thought-chevron">›</span></span></summary><div class="thought-body"><div class="thought-content">\n\n${reasoning}\n\n</div></div></details>\n\n${content.trim()}`;
        } else if (reasoning && !content) {
            content = reasoning;
        }

        return {
            message: this.formatAssistantResponse({
                content,
                tool_calls: rawMessage.tool_calls
            })
        };
    }
}

module.exports = LogflareProvider;
