/* =========================================================
   TOOL REGISTRY & DISPATCH ENGINE
   ========================================================= */

const toolRegistry = new Map();

/**
 * Normalizes tool aliases, hallucinations, and repeated stream tokens into canonical tool names.
 */
export function normalizeToolName(rawName) {
    if (!rawName || typeof rawName !== "string") return "";
    let name = rawName.replace(/<[^>]+>/g, "").trim();
    // Clean repeated tool name tokens caused by streamed duplicate chunks e.g. "run_taskrun_task" -> "run_task"
    if (/^([a-zA-Z0-9_]+?)\1+$/.test(name)) {
        const unrepeated = name.replace(/^([a-zA-Z0-9_]+?)\1+$/, "$1");
        if (unrepeated) name = unrepeated;
    }
    const lower = name.toLowerCase();
    if (lower === "execute" || lower === "exec" || lower === "run_command" || lower === "execute_command" ||
        lower === "terminal" || lower === "bash" || lower === "shell" || lower === "sh" || lower === "cmd" ||
        lower === "read_task_command" || lower === "task_command") {
        return "run_task";
    }
    if (lower === "view_file" || lower === "cat" || lower === "open_file" || lower === "get_file") {
        return "read_file";
    }
    if (lower === "write_to_file" || lower === "create_file" || lower === "save_file") {
        return "write_file";
    }
    if (lower === "edit_file" || lower === "replace_in_file" || lower === "str_replace" || lower === "search_and_replace") {
        return "replace_file_content";
    }
    if (lower === "find_in_files" || lower === "grep" || lower === "search_files") {
        return "grep_search";
    }
    if (lower === "glob" || lower === "ls" || lower === "dir") {
        return "list_dir";
    }
    if (lower === "fetch_web_content" || lower === "web_fetch" || lower === "fetch_url" || lower === "curl" || lower === "scrape" || lower === "google_search" || lower === "search") {
        return "web_search";
    }
    if (lower === "manage_task" || lower === "task_manager" || lower === "task_send_input" || lower === "task_kill" || lower === "task_stdout") {
        return "manage_tasks";
    }
    if (lower === "wait") {
        return "idle";
    }
    if (lower === "list_mcp_tools" || lower === "mcp_list" || lower === "mcp_tools") {
        return "list_mcp";
    }
    if (lower === "call_mcp_tool" || lower === "mcp_call" || lower === "execute_mcp") {
        return "call_mcp";
    }
    return name;
}

/**
 * Normalizes tool arguments for hallucinated fields, nested wrappers, or raw string payloads.
 */
export function normalizeToolArguments(toolName, rawArgs = {}) {
    let args = {};
    if (typeof rawArgs === "string") {
        const trimmed = rawArgs.trim();
        try {
            args = JSON.parse(trimmed);
        } catch (_) {
            try {
                const cleaned = trimmed.replace(/,\s*([}\]])/g, "$1");
                args = JSON.parse(cleaned);
            } catch (_) {
                // If the model passed a raw string instead of a JSON object (e.g. "ls -la" or "src/index.js")
                args = { command: trimmed, path: trimmed };
            }
        }
    } else if (typeof rawArgs === "object" && rawArgs !== null) {
        args = { ...rawArgs };
    }

    // Unwrap nested function call wrappers e.g. {"arguments": {"command": "..."}} or {"parameters": {...}}
    if (args.arguments && typeof args.arguments === "object" && args.arguments !== null) {
        args = { ...args.arguments, ...args };
    }
    if (args.parameters && typeof args.parameters === "object" && args.parameters !== null) {
        args = { ...args.parameters, ...args };
    }
    if (args.input && typeof args.input === "object" && args.input !== null) {
        args = { ...args.input, ...args };
    }

    const normName = normalizeToolName(toolName);
    if (normName === "run_task") {
        const code = String(args.code || args.command || args.cmd || args.script || args.CommandLine || "");
        const shellMatch = code.match(/tools\.shell\(\s*\{\s*command:\s*(?:["'`])([\s\S]*?)(?:["'`])\s*\}\s*\)/) ||
                           code.match(/tools\.shell\(\s*(?:["'`])([\s\S]*?)(?:["'`])\s*\)/);
        if (shellMatch) {
            args.command = shellMatch[1];
        } else if (!args.command && code) {
            args.command = code;
        }
        if (!args.command && (args.CommandLine || args.cmd)) {
            args.command = args.CommandLine || args.cmd;
        }
        if (!args.command && args.instruction && typeof args.instruction === "string") {
            args.command = args.instruction;
        }
    } else if (normName === "read_file") {
        if (!args.path && args.file) args.path = args.file;
        if (!args.path && args.filepath) args.path = args.filepath;
        if (!args.path && args.AbsolutePath) args.path = args.AbsolutePath;
    } else if (normName === "write_file") {
        if (!args.path && args.file) args.path = args.file;
        if (!args.path && args.filepath) args.path = args.filepath;
        if (!args.path && args.TargetFile) args.path = args.TargetFile;
    } else if (normName === "replace_file_content") {
        if (!args.path && args.file) args.path = args.file;
        if (!args.path && args.Path) args.path = args.Path;
        if (!args.path && args.TargetFile) args.path = args.TargetFile;
        if (!args.target_content && (args.target || args.old_str || args.oldString || args.TargetContent)) {
            args.target_content = args.target || args.old_str || args.oldString || args.TargetContent;
        }
        if (!args.replacement_content && (args.replacement || args.new_str || args.newString || args.ReplacementContent)) {
            args.replacement_content = args.replacement || args.new_str || args.newString || args.ReplacementContent;
        }
    } else if (normName === "list_dir") {
        if (!args.DirectoryPath && (args.path || args.dir || args.dirPath)) {
            args.DirectoryPath = args.path || args.dir || args.dirPath;
        }
    } else if (normName === "web_search") {
        if (!args.query && args.url) {
            args.query = args.url;
            args.type = "fetch";
        }
    }
    return args;
}

/**
 * Registers a tool definition with its schema and handler.
 * @param {Object} tool
 * @param {string} tool.name
 * @param {Object} tool.schema
 * @param {Function} tool.handler
 */
export function registerTool(tool) {
    if (!tool || !tool.name || typeof tool.handler !== "function") {
        throw new Error(`Invalid tool registration: missing name or handler`);
    }
    toolRegistry.set(tool.name, tool);
}

/**
 * Retrieves a registered tool by name, checking canonical aliases if direct name not found.
 */
export function getTool(name) {
    const direct = toolRegistry.get(name);
    if (direct) return direct;
    const norm = normalizeToolName(name);
    return toolRegistry.get(norm);
}

/**
 * Returns JSON-schema array of all registered tools for the LLM.
 */
export function getAllToolSchemas() {
    const schemas = [];
    for (const tool of toolRegistry.values()) {
        if (tool.schema) {
            schemas.push(tool.schema);
        }
    }
    return schemas;
}

/**
 * Checks if a tool is registered, checking canonical aliases if direct name not found.
 */
export function hasTool(name) {
    if (toolRegistry.has(name)) return true;
    const norm = normalizeToolName(name);
    return toolRegistry.has(norm);
}

/**
 * Unregisters a tool definition by name.
 */
export function unregisterTool(name) {
    return toolRegistry.delete(name);
}
