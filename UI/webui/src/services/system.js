/* =========================================================
   HOST SYSTEM ENVIRONMENT & WORKSPACE PROMPT SERVICE
   ========================================================= */
import { 
    DEFAULT_PERSONA_PROMPT, 
    SYSTEM_PROMPT_PRESETS, 
    CORE_TOOLS_PROMPT, 
    FOLLOWUP_SYSTEM_PROMPT 
} from "../config.js";
import { state, setActiveSystemPrompt } from "../state.js";
import { McpActiveTools } from "../tools/mcp/index.js";

let cachedSystemInfo = null;

// Rebuild system prompt whenever active MCP tools change
if (typeof window !== "undefined") {
    McpActiveTools.onChange(() => {
        rebuildActiveSystemPrompt();
    });
}

export function getActivePersonaPrompt() {
    if (state.activePersonaPrompt && state.activePersonaPrompt.trim()) {
        return state.activePersonaPrompt.trim();
    }
    const storedPreset = localStorage.getItem("multiai_system_preset") || "default";
    if (storedPreset === "custom") {
        const storedCustom = localStorage.getItem("multiai_custom_system_prompt");
        if (storedCustom && storedCustom.trim()) return storedCustom.trim();
    } else if (SYSTEM_PROMPT_PRESETS[storedPreset]) {
        return SYSTEM_PROMPT_PRESETS[storedPreset];
    }
    return DEFAULT_PERSONA_PROMPT;
}

export function buildFullSystemPrompt(workspace = null, personaOverride = null) {
    const persona = (typeof personaOverride === "string" && personaOverride.trim())
        ? personaOverride.trim()
        : getActivePersonaPrompt();

    const sections = [
        persona,
        CORE_TOOLS_PROMPT
    ];

    if (state.config?.Tools?.EnableMcp !== false) {
        const mcpTools = McpActiveTools.getActiveTools();
        if (mcpTools && mcpTools.length > 0) {
            let mcpPrompt = `[EXTERNAL MODEL CONTEXT PROTOCOL (MCP) TOOLS]:\n`;
            mcpPrompt += `You have access to the following active external MCP tools registered from connected Model Context Protocol servers:\n`;
            for (const t of mcpTools) {
                const desc = t.schema?.function?.description || t.description || "External MCP tool execution";
                mcpPrompt += `- ${t.name}: ${desc}\n`;
            }
            mcpPrompt += `\nWhen the user asks you to perform tasks matching these capabilities or inquires about your available tools, invoke or reference these MCP tools directly by their registered names.`;
            sections.push(mcpPrompt.trim());
        }
    }

    if (cachedSystemInfo) {
        let envPrompt = `[HOST SYSTEM & CLOUD WORKSPACE ARCHITECTURE]\n`;
        envPrompt += `- Operating System: ${cachedSystemInfo.osName} (${cachedSystemInfo.arch})\n`;
        envPrompt += `- Terminal Shell: ${cachedSystemInfo.shellName}\n`;
        
        const effectiveWorkdir = (workspace && workspace.workdir) || cachedSystemInfo.cwd || "/tmp/workspace";
        envPrompt += `- Active Workspace Directory: ${effectiveWorkdir}\n`;
        envPrompt += `- User Uploads Directory: /tmp/user/files\n`;
        if (cachedSystemInfo.username) envPrompt += `- Current User: ${cachedSystemInfo.username}\n`;

        envPrompt += `\n[WORKSPACE & UPLOAD AUTONOMY GUIDELINES]:\n`;
        envPrompt += `1. ISOLATION: The MultiAI application source code is isolated. Your default working directory for all tasks, file creations, and git clones is '${effectiveWorkdir}'. Do NOT create or modify files inside MultiAI server directories unless explicitly instructed.\n`;
        envPrompt += `2. USER UPLOAD AUTONOMY: When the user asks about uploaded files, documents, archives, or datasets, autonomously inspect '/tmp/user/files' using list_dir(DirectoryPath: "/tmp/user/files") or read_file. Files uploaded by the user via the cloud UI land directly in '/tmp/user/files'.\n`;
        envPrompt += `3. WORKSPACE PATH RESOLUTION: Relative paths in read_file, write_file, and run_task resolve against the Active Workspace Directory ('${effectiveWorkdir}').`;

        if (Array.isArray(cachedSystemInfo.instructions) && cachedSystemInfo.instructions.length > 0) {
            envPrompt += `\n\n[TERMINAL & SHELL INSTRUCTIONS FOR THIS SYSTEM]:\n`;
            cachedSystemInfo.instructions.forEach(ins => {
                envPrompt += `- ${ins}\n`;
            });
        }
        sections.push(envPrompt.trim());
    }

    if (workspace && workspace.scratchDir) {
        const wsText = workspace.workspacePrompt || [
            `[SCRATCHPAD & CONVERSATION WORKSPACE]:`,
            `- Active Chat ID: ${workspace.chatId}`,
            `- Conversation Root: ${workspace.chatDir}`,
            `- Scratchsheet Directory ($SCRATCH): ${workspace.scratchDir}`,
            `- Images Directory: ${workspace.imagesDir}`,
            `- SCRATCHPAD & TEMPORARY FILE GUIDELINES:`,
            `  1. You have a dedicated scratchsheet directory (${workspace.scratchDir}) for this conversation accessible via '$SCRATCH'.`,
            `  2. For non-relevant, temporary scripts, one-off test files, mock data, scratchpad notes, or benchmarks, write them using '$SCRATCH/<filename>' (or the full path ${workspace.scratchDir}/<filename>). Paths starting with '$SCRATCH/' automatically resolve to this directory.`,
            `  3. In run_task, you can directly use '$SCRATCH/<filename>' or '$SCRATCH_DIR/<filename>' in terminal commands.`,
            `  4. Regular relative paths resolve normally against the project workspace.`
        ].join("\n");
        sections.push(wsText.trim());
    }

    sections.push(FOLLOWUP_SYSTEM_PROMPT);

    return sections.filter(Boolean).join("\n\n");
}

export function rebuildActiveSystemPrompt(workspace = null, personaOverride = null) {
    const currentWorkspace = workspace || (state.currentChatId ? state.chatSessions[state.currentChatId]?.workspace : null);
    const full = buildFullSystemPrompt(currentWorkspace, personaOverride);
    setActiveSystemPrompt(full);
    return full;
}

export async function initSystemEnvironment() {
    try {
        const res = await fetch("/api/system-info");
        if (!res.ok) return;
        cachedSystemInfo = await res.json();
        state.hostSystemInfo = cachedSystemInfo;

        const currentSession = state.currentChatId ? state.chatSessions[state.currentChatId] : null;
        rebuildActiveSystemPrompt(currentSession?.workspace);
    } catch (e) {
        console.warn("Could not fetch system info:", e);
    }
}

export function syncActiveWorkspacePrompt(workspace) {
    rebuildActiveSystemPrompt(workspace);
}
