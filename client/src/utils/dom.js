/* =========================================================
   DOM HELPERS & FORMATTERS
   ========================================================= */

export { renderIcons, initIconObserver, scheduleIconRender } from "./icons.js";


export function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function formatRelativeTime(ts) {
    if (!ts) return "";
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatChatDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    if (d.getFullYear() === now.getFullYear()) {
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export function wrapTablesForScroll(container) {
    container.querySelectorAll("table").forEach(table => {
        if (table.parentElement && table.parentElement.classList.contains("table-wrapper")) return;
        const wrapper = document.createElement("div");
        wrapper.className = "table-wrapper";
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
    });
}

export function isMobileDevice() {
    return window.matchMedia("(max-width: 768px)").matches || 
           (window.matchMedia("(pointer: coarse)").matches && window.innerWidth <= 1024);
}

/**
 * Detects if the client is running on a mobile browser.
 * Checks navigator.userAgentData.mobile, user agent strings, and pointer capabilities.
 */
export function isMobileBrowser() {
    if (typeof navigator !== "undefined") {
        if (navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean") {
            if (navigator.userAgentData.mobile) return true;
        }
        const ua = navigator.userAgent || navigator.vendor || "";
        if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) {
            return true;
        }
    }
    if (typeof window !== "undefined" && window.matchMedia) {
        const isCoarse = window.matchMedia("(pointer: coarse)").matches;
        const isFine = window.matchMedia("(pointer: fine)").matches;
        if (isCoarse && !isFine) {
            return true;
        }
    }
    return false;
}

export function extractText(response) {
    const content = response?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map(x => x.text || "").join("");
    if (typeof response === "string") return response;
    if (response?.text) return response.text;
    return "";
}

export function formatToolResult(data) {
    if (data && typeof data === "object") {
        if (typeof data.output === "string" && !data.stdout && !data.stderr) {
            return data.output;
        }

        // Clean, structured format for task / terminal / command results
        if (data.stdout !== undefined || data.stderr !== undefined || data.exit_code !== undefined || data.task_id) {
            const parts = [];
            if (data.task_id) parts.push(`task_id: ${data.task_id}`);
            if (data.status) parts.push(`status: ${data.status}`);
            if (data.exit_code !== undefined && data.exit_code !== null) parts.push(`exit_code: ${data.exit_code}`);
            if (data.ran_for || data.elapsed_seconds) parts.push(`elapsed_time: ${data.ran_for || data.elapsed_seconds}s`);
            if (data.scratch_log_path) parts.push(`log_file: ${data.scratch_log_path}`);
            if (data.stdout && data.stdout.trim()) {
                parts.push(`stdout:\n${data.stdout.trimEnd()}`);
            }
            if (data.stderr && data.stderr.trim()) {
                parts.push(`stderr:\n${data.stderr.trimEnd()}`);
            }
            if (data.error && !data.stderr) {
                parts.push(`error: ${data.error}`);
            }
            if (parts.length > 0) {
                return parts.join("\n");
            }
        }

        return JSON.stringify(data);
    }
    return String(data);
}

export function extractChatTitleAndContent(rawText) {
    if (!rawText) return { title: null, content: rawText };
    const trimmed = rawText.trim();

    // 1. Try parsing full response as a JSON object
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
            const title = parsed.chatname || parsed.chat_name || parsed.chatName || parsed.title;
            const reply = parsed.reply || parsed.response || parsed.message || parsed.content || parsed.answer;
            if (title && typeof title === "string") {
                return {
                    title: title.trim(),
                    content: (reply !== undefined && reply !== null) ? String(reply).trim() : ""
                };
            }
        }
    } catch (e) {}

    // 2. Try regex match for JSON snippet: {"chatname": "..."}
    const jsonMatch = trimmed.match(/(?:```(?:json)?\s*)?(\{[\s\S]*?["\x27]chatname["\x27]\s*:\s*["\x27][^"\x27]+["\x27][\s\S]*?\})(?:\s*```)?/i);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[1]);
            const title = parsed.chatname || parsed.chat_name || parsed.chatName;
            if (title && typeof title === "string") {
                let cleanContent = trimmed.replaceAll(jsonMatch[0], "").trim();
                if (!cleanContent && (parsed.reply || parsed.response || parsed.content)) {
                    cleanContent = parsed.reply || parsed.response || parsed.content;
                }
                return {
                    title: title.trim(),
                    content: cleanContent.trim()
                };
            }
        } catch (e) {
            const titleMatch = jsonMatch[1].match(/["\x27]chatname["\x27]\s*:\s*["\x27]([^"\x27]+)["\x27]/i);
            if (titleMatch) {
                let cleanContent = trimmed.replaceAll(jsonMatch[0], "").trim();
                return {
                    title: titleMatch[1].trim(),
                    content: cleanContent.trim()
                };
            }
        }
    }

    return { title: null, content: rawText };
}

