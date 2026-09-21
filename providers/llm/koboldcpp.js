// KoboldCPP Local LLM Provider
// Wraps KoboldCPP's OpenAI-compatible /api/v1/chat/completions endpoint.
// No API key required. base_url is discovered at runtime via the rolling flow.
const BaseProvider = require("./base");

class KoboldCPPProvider extends BaseProvider {
    static id = "koboldcpp";
    static displayName = "KoboldCPP (Local)";
    static matchPatterns = [
        /^(kobold[-_]?cpp|kobold|kcpp)$/i,
        "koboldcpp",
        "kobold-cpp",
        "kcpp"
    ];

    getEndpoint(config = {}, model, apiKey) {
        const baseUrl = config.base_url || config.endpoint || "http://localhost:5001";
        const clean = baseUrl.replace(/\/+$/, "");
        // KoboldCPP OpenAI-compat endpoint
        return `${clean}/api/v1/chat/completions`;
    }

    getHeaders(apiKey, options = {}) {
        // KoboldCPP doesn't require auth — no Authorization header
        return {
            "Content-Type": "application/json"
        };
    }

    formatPayload({ model, messages, tools, tool_choice, config = {}, supportsTools = true, supportsVision = false, options = {} }) {
        const payload = super.formatPayload({
            model,
            messages,
            tools,
            tool_choice,
            config,
            supportsTools,
            supportsVision,
            options
        });

        // KoboldCPP uses its own max_context_length — omit max_tokens if not set
        // to avoid overriding the server's loaded context window
        if (!config.max_tokens && !options.max_tokens) {
            delete payload.max_tokens;
        }

        return payload;
    }

    cleanKoboldText(text) {
        if (!text || typeof text !== "string") return text;
        return text
            .replace(/<\|?begin_of_response\|?>/gi, "")
            .replace(/<\|?end_of_response\|?>/gi, "")
            .replace(/<\|?begin_of_thought\|?>/gi, "")
            .replace(/<\|?end_of_thought\|?>/gi, "")
            .replace(/<\|?im_start\|?>/gi, "")
            .replace(/<\|?im_end\|?>/gi, "")
            .replace(/<\|?start_header_id\|?>/gi, "")
            .replace(/<\|?end_header_id\|?>/gi, "")
            .replace(/<\|?eot_id\|?>/gi, "")
            .replace(/<\|?observation\|?>/gi, "")
            .replace(/<\|?thought\|?>/gi, "")
            .replace(/\{['"](?:task_name|name)['"]:\s*['"][^'"]+['"],\s*['"]output['"]:\s*[\s\S]*?\}/gi, "")
            .trim();
    }

    parseResponse(data) {
        const choice = data?.choices?.[0];
        if (choice?.message) {
            let content = choice.message.content || "";
            let reasoning = choice.message.reasoning_content || choice.message.reasoning || "";

            // Strip special template boundary tokens emitted by KoboldCPP/GGUF models
            content = this.cleanKoboldText(content);
            reasoning = this.cleanKoboldText(reasoning);

            choice.message.content = content;

            // KoboldCPP quirk: When models don't emit separate thinking tokens, KoboldCPP
            // frequently mirrors the completion into reasoning_content, or copies content into reasoning.
            // If reasoning is identical to content or a prefix/suffix mirror, clear reasoning_content
            // so base.js does not falsely wrap the real answer in a thought box and duplicate it.
            if (reasoning) {
                const trimmedC = content.trim();
                const trimmedR = reasoning.trim();
                // KoboldCPP sometimes mirrors the full answer into reasoning_content.
                // Only suppress reasoning if it is nearly identical to content
                // (within 15% length difference AND one fully contains the other at boundary).
                // Broad substring or startsWith checks are intentionally avoided to prevent
                // false-positives on models that genuinely produce short reasoning followed
                // by a longer answer.
                const longer = Math.max(trimmedC.length, trimmedR.length);
                const shorter = Math.min(trimmedC.length, trimmedR.length);
                const isMirror = longer > 0 && shorter / longer >= 0.85 && (
                    trimmedR === trimmedC ||
                    trimmedC.startsWith(trimmedR + "\n") ||
                    trimmedC.endsWith("\n" + trimmedR) ||
                    trimmedR.startsWith(trimmedC + "\n") ||
                    trimmedR.endsWith("\n" + trimmedC)
                );
                if (isMirror) {
                    choice.message.reasoning_content = "";
                    if (choice.message.reasoning) choice.message.reasoning = "";
                } else {
                    choice.message.reasoning_content = reasoning;
                }
            }
        }
        return super.parseResponse(data);
    }
}

module.exports = KoboldCPPProvider;
