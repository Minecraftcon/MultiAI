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
        if (data.status === "answered" && Array.isArray(data.answers)) {
            return `Answered by user:\n` + data.answers.map(a => `• ${a.question}\n  → ${Array.isArray(a.answer) ? a.answer.join(", ") : a.answer}`).join("\n");
        }
        if (data.status === "skipped") {
            return `Questionnaire was skipped by the user.`;
        }

        if (typeof data.output === "string" && !data.stdout && !data.stderr) {
            return data.output;
        }

        // Text file read: return the file contents, never just path metadata
        if (data.type === "text" && typeof data.content === "string") {
            const header = [];
            if (data.path) header.push(`path: ${data.path}`);
            if (data.total_lines !== undefined) {
                const from = data.start_line ?? 1;
                const to = data.end_line ?? data.total_lines;
                header.push(`lines: ${from}-${to} of ${data.total_lines}${data.is_truncated ? " (truncated)" : ""}`);
            }
            return header.length > 0 ? `${header.join("\n")}\n\n${data.content}` : data.content;
        }

        // Clean, structured format for task / terminal / command results
        if (data.stdout !== undefined || data.stderr !== undefined || data.exit_code !== undefined || data.task_id || data.running !== undefined) {
            const parts = [];
            const isRunning = data.running === true || data.status === "running" || data.status === "in_progress";
            if (data.task_id) parts.push(`task_id: ${data.task_id}`);
            if (isRunning) {
                parts.push(`status: running (auto-backgrounded after ${data.ran_for || data.elapsed_seconds || 10}s)`);
                parts.push(`note: The command did not complete within the 10s wait window and is continuing in the background under task supervisor. You do not need to wait or pause; continue executing your plan or proceed with other actions.`);
            } else if (data.status) {
                parts.push(`status: ${data.status}`);
            }
            if (!isRunning && data.exit_code !== undefined && data.exit_code !== null) {
                parts.push(`exit_code: ${data.exit_code}`);
            }
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

        // Clean instruct format for file and artifact operations (anti-json-waste)
        if (data.path || data.bytes_written !== undefined || data.is_artifact !== undefined || data.chunks_applied !== undefined || data.lines_diff !== undefined) {
            const parts = [];
            if (data.status) parts.push(`status: ${data.status}`);
            if (data.path) parts.push(`path: ${data.path}`);
            if (data.is_artifact !== undefined) parts.push(`is_artifact: ${data.is_artifact}`);
            if (data.artifact_id) parts.push(`artifact_id: ${data.artifact_id}`);
            if (data.resolved_path && data.resolved_path !== data.path) parts.push(`resolved_path: ${data.resolved_path}`);
            if (data.bytes_written !== undefined) parts.push(`bytes_written: ${data.bytes_written}`);
            if (data.lines_before !== undefined && data.lines_after !== undefined) {
                parts.push(`lines: ${data.lines_before} -> ${data.lines_after} (${data.lines_diff >= 0 ? "+" : ""}${data.lines_diff})`);
            }
            if (data.lines_added !== undefined && data.lines_removed !== undefined) {
                parts.push(`changes: +${data.lines_added} -${data.lines_removed}`);
            }
            if (data.chunks_applied !== undefined) parts.push(`chunks_applied: ${data.chunks_applied}`);
            if (data.message) parts.push(`message: ${data.message}`);
            if (data.error) parts.push(`error: ${data.error}`);
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
    const jsonMatch = trimmed.match(/(?:```(?:json)?\s*)?(\{[\s\S]*?["\x27](?:chatname|chat_name|chatName|title)["\x27]\s*:\s*["\x27][^"\x27]+["\x27][\s\S]*?\})(?:\s*```)?/i);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[1]);
            const title = parsed.chatname || parsed.chat_name || parsed.chatName || parsed.title;
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
            const titleMatch = jsonMatch[1].match(/["\x27](?:chatname|chat_name|chatName|title)["\x27]\s*:\s*["\x27]([^"\x27]+)["\x27]/i);
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

/**
 * Hides in-flight unclosed chat title JSON while streaming.
 *
 * @param {string} rawText
 * @returns {string}
 */
export function stripInFlightChatTitle(rawText) {
    if (!rawText || typeof rawText !== "string") return rawText;
    const partialMatch = rawText.match(/^\s*(?:```(?:json)?\s*)?\{[\s\S]*?["\x27](?:chatname|chat_name|chatName|title)["\x27][^}]*$/i);
    if (partialMatch) {
        return "";
    }
    const minimalStart = rawText.match(/^\s*(?:```(?:json)?\s*)?\{\s*(?:["\x27](?:c|ch|cha|chat|chatn|chatna|chatnam|chatname|title)?)?$/i);
    if (minimalStart) {
        return "";
    }
    return rawText;
}

