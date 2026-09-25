/**
 * MultiAI Tool Call Extractor & Normalizer
 * Extracts, parses, and normalizes tool calls across heterogeneous LLM formatting dialects:
 * - GLM-4 / Qwen2.5 / Hermes delimited section begin/end tokens
 * - Template tokens <|tool_call>call:NAME{args}<|tool_call|>
 * - Standard XML wrapped <tool_call> JSON </tool_call>
 * - Fenced code blocks ```tool_call ... ```
 * - Bracketed requests [tool_call] NAME(...)
 * - Direct function invocations NAME(...)
 * - Leaked XML argument repair & hallucinated alias normalization
 */

/**
 * Extracts image data from tool result content if present.
 */
function extractImageFromToolResult(content) {
    if (!content) return null;
    let obj = content;
    if (typeof content === "string") {
        if (!content.includes("data_url") && !content.includes("data:image/")) return null;
        try {
            obj = JSON.parse(content);
        } catch (_) {
            if (/truncated|omitted/i.test(content)) {
                return null;
            }
            const match = content.match(/data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)/);
            if (match && match[2].length >= 16) {
                return {
                    mime: match[1],
                    base64: match[2],
                    dataUrl: match[0],
                    path: "image",
                    humanSize: "",
                    cleanContent: content.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "[embedded image data]")
                };
            }
            return null;
        }
    }
    if (obj && (obj.type === "image" || (typeof obj.mime === "string" && obj.mime.startsWith("image/")))) {
        const rawUrl = obj.data_url || obj.url;
        if (rawUrl && typeof rawUrl === "string") {
            const match = rawUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
            if (match && match[2].length >= 16) {
                const cleanObj = {
                    path: obj.path || "image",
                    type: "image",
                    mime: match[1],
                    size_bytes: obj.size_bytes,
                    human_size: obj.human_size,
                    status: "success",
                    message: `Image read successfully: ${obj.path || "image"} (${obj.human_size || match[1]})`
                };
                return {
                    mime: match[1],
                    base64: match[2],
                    dataUrl: rawUrl,
                    path: obj.path || "image",
                    humanSize: obj.human_size || "",
                    cleanContent: JSON.stringify(cleanObj)
                };
            }
        }
    }
    return null;
}

/**
 * Cleans frontend thought-box markup and HTML tags from assistant messages
 * before sending conversation history back to upstream LLMs.
 * Prevents LLM context contamination and tag hallucination.
 */
function cleanPromptContent(text) {
    if (!text || typeof text !== "string") return text;
    let cleaned = text;
    const thoughtBoxRegex = /<details class="thought-box"[^>]*>[\s\S]*?<div class="thought-content[^"]*">([\s\S]*?)<\/div>\s*<\/div>\s*<\/details>/gi;
    cleaned = cleaned.replace(thoughtBoxRegex, (match, inner) => {
        const cleanInner = inner.replace(/<[^>]+>/g, "").trim();
        return cleanInner ? `<think>\n${cleanInner}\n</think>\n\n` : "";
    });
    cleaned = cleaned.replace(/<\/?(?:details|summary|svg|path|span)[^>]*>/gi, "");
    return cleaned.trim();
}

/**
 * Parses tool call argument string supporting standard JSON or delimited key:<|"|>val<|"|> syntax.
 */
function parseToolCallArgs(rawArgs) {
    if (!rawArgs || typeof rawArgs !== "string") return {};
    const trimmed = rawArgs.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
            return JSON.parse(trimmed);
        } catch (_) { }
    }
    const argsObj = {};
    const argRegex = /["\x27]?([a-zA-Z0-9_\-]+)["\x27]?\s*:\s*(?:<\|"\|>([\s\S]*?)<\|"\|>|"([^"]*)"|'([^']*)'|([^,}\s]+))/g;
    let match;
    let found = false;
    while ((match = argRegex.exec(trimmed)) !== null) {
        found = true;
        const key = match[1];
        let val = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : (match[4] !== undefined ? match[4] : match[5]));
        if (val === "true") val = true;
        else if (val === "false") val = false;
        else if (val === "null") val = null;
        else if (!isNaN(Number(val)) && val !== "") val = Number(val);
        argsObj[key] = val;
    }
    if (found) return argsObj;
    return trimmed;
}

/**
 * Extracts unparsed or leaked tool calls from raw response content or reasoning text.
 */
function extractToolCallsFromText(text, parseArgs = parseToolCallArgs) {
    if (!text || typeof text !== "string") return { cleanedText: text || "", toolCalls: [] };
    const toolCalls = [];

    // Protect non-tool markdown code blocks and inline code spans so examples (e.g. ```json ... ```) are never falsely extracted
    const protectedBlocks = [];
    let cleaned = text.replace(/```(?!tool_call|tool\b)[a-zA-Z0-9_\-]*\n[\s\S]*?```|`[^`\n]+`/g, (match) => {
        const placeholder = `__PROTECTED_CODE_BLOCK_${protectedBlocks.length}__`;
        protectedBlocks.push({ placeholder, match });
        return placeholder;
    });

    // 0. GLM-4/Qwen2.5/Hermes section-begin format:
    //    <|tool_calls_section_begin|>
    //    <|tool_call_begin|>functions.NAME:INDEX<|tool_call_argument_begin|>{...JSON...}
    //    <|tool_call_end|>
    //    <|tool_calls_section_end|>
    const sectionRegex = /<\|tool_calls_section_begin\|>([\s\S]*?)<\|tool_calls_section_end\|>/gi;
    let sm;
    while ((sm = sectionRegex.exec(cleaned)) !== null) {
        const sectionBody = sm[1];
        const callRegex = /<\|tool_call_begin\|>\s*(?:functions\.)?([a-zA-Z0-9_\-]+)(?::\d+)?\s*<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_end\|>/gi;
        let cm;
        while ((cm = callRegex.exec(sectionBody)) !== null) {
            const name = cm[1];
            const rawArgs = cm[2].trim();
            const parsedArgs = parseArgs(rawArgs);
            toolCalls.push({
                id: "call_" + Math.random().toString(36).substring(2, 9),
                type: "function",
                function: {
                    name,
                    arguments: typeof parsedArgs === "string" ? parsedArgs : JSON.stringify(parsedArgs || {})
                }
            });
        }
        cleaned = cleaned.replace(sm[0], "").trim();
    }

    // Also handle orphaned individual tool_call_begin (no wrapping section)
    const orphanCallRegex = /<\|tool_call_begin\|>\s*(?:functions\.)?([a-zA-Z0-9_\-]+)(?::\d+)?\s*<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_end\|>/gi;
    let om;
    while ((om = orphanCallRegex.exec(cleaned)) !== null) {
        const name = om[1];
        const rawArgs = om[2].trim();
        const parsedArgs = parseArgs(rawArgs);
        toolCalls.push({
            id: "call_" + Math.random().toString(36).substring(2, 9),
            type: "function",
            function: {
                name,
                arguments: typeof parsedArgs === "string" ? parsedArgs : JSON.stringify(parsedArgs || {})
            }
        });
        cleaned = cleaned.replace(om[0], "").trim();
    }

    // 1. Template tokens: <|tool_call>call:NAME{...}<tool_call|> or call:NAME{...}
    const callDelimRegex = /(?:<\|?(?:tool_call|tool)\|?>\s*)?call:([a-zA-Z0-9_\-]+)\s*\{([\s\S]*?)\}(?:\s*<\|?\/?(?:tool_call|tool)\|?>)?/gi;
    let m;
    while ((m = callDelimRegex.exec(cleaned)) !== null) {
        const name = m[1];
        const rawArgs = m[2];
        const parsedArgs = parseArgs(rawArgs);
        toolCalls.push({
            id: "call_" + Math.random().toString(36).substring(2, 9),
            type: "function",
            function: {
                name,
                arguments: typeof parsedArgs === "string" ? parsedArgs : JSON.stringify(parsedArgs)
            }
        });
        cleaned = cleaned.replace(m[0], "").trim();
    }

    // 2. XML wrapped calls: <tool_call> JSON </tool_call>
    const xmlRegex = /<\|?(?:tool_call|tool)\|?>\s*([\s\S]*?)\s*<\|?\/(?:tool_call|tool)\|?>/gi;
    while ((m = xmlRegex.exec(cleaned)) !== null) {
        try {
            const parsed = JSON.parse(m[1].trim());
            const name = parsed.name || parsed.tool || parsed.function?.name;
            const rawArgs = parsed.arguments !== undefined ? parsed.arguments : (parsed.args !== undefined ? parsed.args : parsed.parameters);
            if (name) {
                toolCalls.push({
                    id: "call_" + Math.random().toString(36).substring(2, 9),
                    type: "function",
                    function: {
                        name,
                        arguments: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs || {})
                    }
                });
                cleaned = cleaned.replace(m[0], "").trim();
            }
        } catch (_) { }
    }

    // 3. Fenced code block calls: ```tool_call ... ```
    const codeBlockRegex = /```(?:tool_call|tool)\s*(\{[\s\S]*?\})\s*```/gi;
    while ((m = codeBlockRegex.exec(cleaned)) !== null) {
        try {
            const parsed = JSON.parse(m[1].trim());
            const name = parsed.name || parsed.tool || parsed.function?.name;
            const rawArgs = parsed.arguments !== undefined ? parsed.arguments : (parsed.args !== undefined ? parsed.args : parsed.parameters);
            if (name) {
                toolCalls.push({
                    id: "call_" + Math.random().toString(36).substring(2, 9),
                    type: "function",
                    function: {
                        name,
                        arguments: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs || {})
                    }
                });
                cleaned = cleaned.replace(m[0], "").trim();
            }
        } catch (_) { }
    }

    // 4. Bracketed tool request format: [tool request] NAME(...) or [tool_call] NAME(...) or [tool] NAME(...)
    const bracketedCallRegex = /\[(?:tool[ _]request|tool[ _]call|tool)\]\s*(?:functions\.)?([a-zA-Z0-9_\-]+)\s*(?:\(\s*([\s\S]*?)\s*\)|\s*(\{[\s\S]*?\}))/gi;
    while ((m = bracketedCallRegex.exec(cleaned)) !== null) {
        const name = m[1];
        const rawArgs = m[2] || m[3];
        const parsedArgs = parseArgs(rawArgs);
        if (parsedArgs && typeof parsedArgs === "object" && Object.keys(parsedArgs).length > 0) {
            toolCalls.push({
                id: "call_" + Math.random().toString(36).substring(2, 9),
                type: "function",
                function: {
                    name,
                    arguments: typeof parsedArgs === "string" ? parsedArgs : JSON.stringify(parsedArgs)
                }
            });
            cleaned = cleaned.replace(m[0], "").trim();
        }
    }

    // 5. Raw known tool invocation: (run_task|read_file|...)(...) or (run_task|read_file|...){...}
    const knownToolsRegex = /(?:^|[\n.\s])(run_task|read_file|write_file|grep_search|search_and_replace|fetch_web_content|web_search|idle|run_python|generate_image|task_send_input|task_stdout|task_kill)\s*(?:\(\s*([\s\S]*?)\s*\)|(\{[\s\S]*?\}))(?:\s*\1)?/gi;
    while ((m = knownToolsRegex.exec(cleaned)) !== null) {
        const name = m[1];
        const rawArgs = m[2] || m[3];
        const parsedArgs = parseArgs(rawArgs);
        if (parsedArgs && typeof parsedArgs === "object" && Object.keys(parsedArgs).length > 0) {
            toolCalls.push({
                id: "call_" + Math.random().toString(36).substring(2, 9),
                type: "function",
                function: {
                    name,
                    arguments: typeof parsedArgs === "string" ? parsedArgs : JSON.stringify(parsedArgs)
                }
            });
            cleaned = cleaned.replace(m[0], "").trim();
        }
    }

    // Restore protected markdown code blocks
    for (const block of protectedBlocks) {
        cleaned = cleaned.replace(block.placeholder, block.match);
    }

    return { cleanedText: cleaned, toolCalls };
}

/**
 * Normalizes hallucinated tool aliases and repairs XML fragment leaks inside function names.
 */
function normalizeToolCalls(tool_calls, parseArgs = parseToolCallArgs) {
    if (!Array.isArray(tool_calls)) return [];
    return tool_calls.map(tc => {
        if (!tc || typeof tc !== "object") return tc;
        let name = String(tc.function?.name || tc.name || "").trim();
        let rawArgs = tc.function?.arguments !== undefined ? tc.function.arguments : (tc.arguments !== undefined ? tc.arguments : tc.parameters);
        let argsObj = {};

        if (typeof rawArgs === "object" && rawArgs !== null) {
            argsObj = { ...rawArgs };
        } else if (typeof rawArgs === "string") {
            try {
                argsObj = JSON.parse(rawArgs);
            } catch (_) {
                argsObj = parseArgs(rawArgs);
                if (typeof argsObj !== "object" || argsObj === null) argsObj = {};
            }
        }

        // Check for XML fragment leaks in function name, e.g.:
        // "read_task_command</arg_key><arg_value>cd "$SCRATCH/apk" && unzip -l ...</arg_value>"
        // or "<arg_value>...</arg_value>"
        const xmlArgMatch = /<\/arg_key><arg_value>([\s\S]*?)(?:<\/arg_value>|$)/i.exec(name) ||
            /<arg_value>([\s\S]*?)(?:<\/arg_value>|$)/i.exec(name);
        if (xmlArgMatch) {
            const extractedValue = xmlArgMatch[1].trim();
            name = name.replace(/<\/?(?:arg_key|arg_value)[^>]*>[\s\S]*/gi, "").trim();
            if (extractedValue && !argsObj.command) {
                argsObj.command = extractedValue;
            }
        }

        // Strip any remaining XML or HTML tags from the tool name
        name = name.replace(/<[^>]+>/g, "").trim();

        // Known alias & hallucination mapping to valid system tools:
        const nameLower = name.toLowerCase();
        if (nameLower === "read_task_command" || nameLower === "task_command" || nameLower === "exec_command" ||
            nameLower === "run_command" || nameLower === "execute_command" || nameLower === "terminal" ||
            nameLower === "bash" || nameLower === "shell" || nameLower === "sh" || nameLower === "cmd") {
            name = "run_task";
            if (argsObj.cmd && !argsObj.command) argsObj.command = argsObj.cmd;
        } else if (nameLower === "view_file" || nameLower === "cat" || nameLower === "open_file" || nameLower === "get_file") {
            name = "read_file";
            if (argsObj.file && !argsObj.path) argsObj.path = argsObj.file;
            if (argsObj.filepath && !argsObj.path) argsObj.path = argsObj.filepath;
        } else if (nameLower === "write_to_file" || nameLower === "create_file" || nameLower === "save_file") {
            name = "write_file";
            if (argsObj.file && !argsObj.path) argsObj.path = argsObj.file;
            if (argsObj.filepath && !argsObj.path) argsObj.path = argsObj.filepath;
        } else if (nameLower === "edit_file" || nameLower === "replace_in_file" || nameLower === "str_replace") {
            name = "search_and_replace";
            if (argsObj.file && !argsObj.path) argsObj.path = argsObj.file;
        } else if (nameLower === "find_in_files" || nameLower === "grep" || nameLower === "search_files") {
            name = "grep_search";
        } else if (nameLower === "fetch_web_content" || nameLower === "web_fetch" || nameLower === "fetch_url" || nameLower === "curl" || nameLower === "scrape") {
            name = "web_search";
            if (!argsObj.type) argsObj.type = "fetch";
            if (!argsObj.query && argsObj.url) argsObj.query = argsObj.url;
        } else if (nameLower === "google_search" || nameLower === "duckduckgo_search" || nameLower === "search") {
            name = "web_search";
            if (!argsObj.type) argsObj.type = "search";
        } else if (nameLower === "manage_task" || nameLower === "task_manager") {
            name = "manage_tasks";
        } else if (nameLower === "task_send_input" || nameLower === "send_input") {
            name = "manage_tasks";
            if (!argsObj.action) argsObj.action = "send_input";
        } else if (nameLower === "task_kill" || nameLower === "kill_task") {
            name = "manage_tasks";
            if (!argsObj.action) argsObj.action = "kill_task";
        } else if (nameLower === "task_stdout" || nameLower === "get_task_output") {
            name = "manage_tasks";
            if (!argsObj.action) argsObj.action = "status";
        } else if (nameLower === "sleep" || nameLower === "wait") {
            name = "idle";
        }

        return {
            id: String(tc.id || ("call_" + Math.random().toString(36).substring(2, 9))),
            type: "function",
            function: {
                name,
                arguments: JSON.stringify(argsObj)
            },
            thoughtSignature: tc.thoughtSignature || tc.thought_signature || tc.function?.thoughtSignature || tc.function?.thought_signature
        };
    });
}

module.exports = {
    extractImageFromToolResult,
    cleanPromptContent,
    parseToolCallArgs,
    extractToolCallsFromText,
    normalizeToolCalls
};
