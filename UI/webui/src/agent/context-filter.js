/**
 * Context Filterer Engine
 * =======================
 * Intercepts and filters prompts, message content, and tool outputs
 * before they reach the LLM API. Supports multiple filter types:
 * - Keyword (exact string or word-boundary match)
 * - Regex (custom regular expressions with flags)
 * - Preset Patterns (API Keys, Email, IPv4/IPv6, File Paths, Phone Numbers, Social Security/Credit Cards)
 * - Block/Halt (raises an exception if a forbidden pattern is detected, preventing dispatch)
 */

export const CONTEXT_FILTER_STORAGE_KEY = "multiai_context_filters";
export const CONTEXT_FILTER_ENABLED_KEY = "multiai_context_filters_enabled";

export const BUILTIN_PRESETS = [
    {
        id: "preset_api_keys",
        name: "Common API Keys & Tokens",
        pattern: "(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|xox[baprs]-[0-9a-zA-Z]{10,48}|AIza[0-9A-Za-z-_]{35}|Bearer\\s+[a-zA-Z0-9_.-]{20,})",
        flags: "g",
        replacement: "[REDACTED_API_KEY]"
    },
    {
        id: "preset_email",
        name: "Email Addresses",
        pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
        flags: "gi",
        replacement: "[REDACTED_EMAIL]"
    },
    {
        id: "preset_ip",
        name: "IP Addresses (IPv4)",
        pattern: "\\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\b",
        flags: "g",
        replacement: "[REDACTED_IP]"
    },
    {
        id: "preset_system_paths",
        name: "Local Home & System Paths",
        pattern: "(?:\\/home\\/[a-zA-Z0-9_.-]+|\\/Users\\/[a-zA-Z0-9_.-]+|[a-zA-Z]:\\\\[Uu]sers\\\\[a-zA-Z0-9_.-]+)",
        flags: "gi",
        replacement: "[REDACTED_PATH]"
    },
    {
        id: "preset_phone",
        name: "Phone Numbers",
        pattern: "(?:\\+?\\d{1,3}[-.\s]?)?\\(?\\d{3}\\)?[-.\s]?\\d{3}[-.\s]?\\d{4}\\b",
        flags: "g",
        replacement: "[REDACTED_PHONE]"
    }
];

export const DEFAULT_FILTERS = [
    {
        id: "flt_default_keys",
        name: "Mask API Secrets & Bearer Tokens",
        type: "preset",
        presetId: "preset_api_keys",
        pattern: BUILTIN_PRESETS[0].pattern,
        flags: "g",
        replacement: "[REDACTED_API_KEY]",
        action: "replace",
        scope: "all",
        enabled: true
    },
    {
        id: "flt_default_paths",
        name: "Scrub Local User Paths",
        type: "preset",
        presetId: "preset_system_paths",
        pattern: BUILTIN_PRESETS[3].pattern,
        flags: "gi",
        replacement: "/home/[USER]",
        action: "replace",
        scope: "all",
        enabled: false
    }
];

function escapeRegExp(string) {
    return String(string || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class ContextFilterer {
    constructor(filters = [], enabled = true) {
        this.enabled = enabled;
        this.filters = [];
        this.compileFilters(filters);
    }

    compileFilters(filters = []) {
        this.filters = (filters || []).map(f => {
            if (!f || f.enabled === false) return null;
            let regex = null;
            try {
                if (f.type === "keyword") {
                    const kw = String(f.pattern || "").trim();
                    if (!kw) return null;
                    const escaped = escapeRegExp(kw);
                    const isCaseInsensitive = f.flags?.includes("i") !== false;
                    const patternStr = f.wholeWord !== false ? `\\b${escaped}\\b` : escaped;
                    regex = new RegExp(patternStr, isCaseInsensitive ? "gi" : "g");
                } else if (f.type === "regex" || f.type === "preset") {
                    const rawPat = String(f.pattern || "").trim();
                    if (!rawPat) return null;
                    const flags = f.flags || "g";
                    regex = new RegExp(rawPat, flags.includes("g") ? flags : flags + "g");
                }
            } catch (err) {
                console.warn("[ContextFilterer] Invalid filter pattern:", f.pattern, err.message);
                return null;
            }

            return {
                ...f,
                compiledRegex: regex,
                replacement: f.replacement !== undefined ? String(f.replacement) : "[REDACTED]",
                action: f.action || "replace", // "replace" | "block"
                scope: f.scope || "all" // "all" | "user" | "assistant" | "tool"
            };
        }).filter(Boolean);
    }

    /**
     * Filters a text string against applicable rules
     */
    filterText(text, role = "user") {
        if (!this.enabled || !text || typeof text !== "string") return text;
        let result = text;

        for (const f of this.filters) {
            if (f.scope !== "all" && f.scope !== role) continue;
            if (!f.compiledRegex) continue;

            // Reset regex lastIndex
            f.compiledRegex.lastIndex = 0;

            if (f.action === "block") {
                if (f.compiledRegex.test(result)) {
                    throw new Error(`[Context Filter Blocked] Message violates policy: '${f.name || f.pattern}'.`);
                }
            } else {
                result = result.replace(f.compiledRegex, f.replacement);
            }
        }

        return result;
    }

    /**
     * Sanitizes an array of message objects before they get sent to the LLM
     */
    filterMessages(messages) {
        if (!this.enabled || !Array.isArray(messages)) return messages;

        return messages.map(msg => {
            if (!msg || typeof msg !== "object") return msg;
            const role = msg.role || "user";
            const copy = { ...msg };

            if (typeof copy.content === "string") {
                copy.content = this.filterText(copy.content, role);
            } else if (Array.isArray(copy.content)) {
                copy.content = copy.content.map(part => {
                    if (part && part.type === "text" && typeof part.text === "string") {
                        return { ...part, text: this.filterText(part.text, role) };
                    }
                    return part;
                });
            }

            // Sanitize tool call arguments if model generated them or if assistant message
            if (Array.isArray(copy.tool_calls)) {
                copy.tool_calls = copy.tool_calls.map(tc => {
                    if (!tc || !tc.function) return tc;
                    let args = tc.function.arguments;
                    if (typeof args === "string") {
                        args = this.filterText(args, role);
                    }
                    return {
                        ...tc,
                        function: {
                            ...tc.function,
                            arguments: args
                        }
                    };
                });
            }

            return copy;
        });
    }
}

/**
 * Loads current filters and enabled state from localStorage or defaults
 */
export function loadContextFilters() {
    if (typeof localStorage === "undefined") {
        return { enabled: true, filters: [...DEFAULT_FILTERS] };
    }
    const enabledRaw = localStorage.getItem(CONTEXT_FILTER_ENABLED_KEY);
    const enabled = enabledRaw === null ? true : enabledRaw === "true";

    const raw = localStorage.getItem(CONTEXT_FILTER_STORAGE_KEY);
    if (!raw) {
        return { enabled, filters: [...DEFAULT_FILTERS] };
    }
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return { enabled, filters: parsed };
        }
    } catch (_) {}
    return { enabled, filters: [...DEFAULT_FILTERS] };
}

/**
 * Saves filters and enabled state to localStorage
 */
export function saveContextFilters(filters, enabled = true) {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CONTEXT_FILTER_ENABLED_KEY, String(enabled));
    localStorage.setItem(CONTEXT_FILTER_STORAGE_KEY, JSON.stringify(filters || []));
}

// Global active singleton instance
let activeFilterer = null;

export function getActiveContextFilterer() {
    if (!activeFilterer) {
        const { enabled, filters } = loadContextFilters();
        activeFilterer = new ContextFilterer(filters, enabled);
    }
    return activeFilterer;
}

export function refreshActiveContextFilterer() {
    const { enabled, filters } = loadContextFilters();
    activeFilterer = new ContextFilterer(filters, enabled);
    return activeFilterer;
}

