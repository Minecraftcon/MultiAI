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
        envPrompt += `- Active Workspace Directory (CWD): ${effectiveWorkdir}\n`;
        envPrompt += `- User Uploads Directory: /tmp/user/files\n`;
        if (workspace && workspace.chatDir) {
            envPrompt += `- Active Session Storage Root: ${workspace.chatDir}\n`;
            envPrompt += `- Session Scratch Directory ($SCRATCH): ${workspace.scratchDir || workspace.chatDir + '/scratch'}\n`;
            envPrompt += `- Session Artifacts Directory ($ARTIFACTS): ${workspace.artifactsDir || workspace.chatDir + '/artifacts'}\n`;
        }
        if (cachedSystemInfo.username) envPrompt += `- Current User: ${cachedSystemInfo.username}\n`;

        envPrompt += `\n[CLOUD SESSION PATH TOPOLOGY & DISAMBIGUATION GUIDELINES]:\n`;
        envPrompt += `1. THREE-TIER PATH TOPOLOGY: The cloud environment separates working contexts into distinct directories:\n`;
        envPrompt += `   - Project Workspace ('${effectiveWorkdir}'): Current working directory where user project files live and shell commands execute.\n`;
        envPrompt += `   - Cloud Session Root ('${workspace?.chatDir || "/tmp/multiai_cloud/chats/<chat_id>"}'): Dedicated per-conversation storage containing '$SCRATCH' and '$ARTIFACTS'.\n`;
        envPrompt += `   - User Uploads ('/tmp/user/files'): Ingestion folder for web UI uploads. They are NOT in './uploads' or '${effectiveWorkdir}'. Check '/tmp/user/files' directly when asked about user-uploaded documents.\n`;
        envPrompt += `2. SHELL VS TOOL PATH TRAPS:\n`;
        envPrompt += `   - In 'run_task', commands run in '${effectiveWorkdir}'. The conversation scratchpad does NOT exist at './scratch'. Never execute 'python scratch/script.py' or 'cd scratch'. Always use '$SCRATCH' or '$SCRATCH_DIR' (e.g. 'python3 "$SCRATCH/script.py"').\n`;
        envPrompt += `   - In tool calls ('read_file', 'write_file', 'list_dir'), '$SCRATCH/' and '$ARTIFACTS/' prefixes automatically map to this chat session's storage.\n`;
        envPrompt += `3. ISOLATION: The MultiAI application source code is isolated. Do NOT modify files inside MultiAI server directories unless explicitly instructed.\n`;
        envPrompt += `4. STORAGE DUAL-NATURE: Conversation messages, turns, and metadata are persistently stored in Supabase ('public.chats' & 'public.chat_messages'), while container storage under '/tmp' provides runtime scratchpads and artifacts for the active cloud session.`;

        if (Array.isArray(cachedSystemInfo.instructions) && cachedSystemInfo.instructions.length > 0) {
            envPrompt += `\n\n[TERMINAL & SHELL INSTRUCTIONS FOR THIS SYSTEM]:\n`;
            cachedSystemInfo.instructions.forEach(ins => {
                envPrompt += `- ${ins}\n`;
            });
        }
        sections.push(envPrompt.trim());
    }

    if (workspace && workspace.scratchDir) {
        const effectiveWorkdir = (workspace && workspace.workdir) || cachedSystemInfo?.cwd || "/tmp/workspace";
        const wsText = workspace.workspacePrompt || [
            `[SCRATCHPAD, ARTIFACTS & CLOUD SESSION PATH ARCHITECTURE]:`,
            `- Active Chat ID: ${workspace.chatId}`,
            `- Conversation Root: ${workspace.chatDir}`,
            `- Scratch Directory ($SCRATCH): ${workspace.scratchDir}`,
            `- Artifacts Directory ($ARTIFACTS): ${workspace.artifactsDir || workspace.chatDir + '/artifacts'}`,
            `- Images Directory: ${workspace.imagesDir}`,
            `- User Uploads Directory: /tmp/user/files`,
            `- Active Execution Workspace (CWD): ${effectiveWorkdir}`,
            `- CLOUD SESSION PATH AWARENESS:`,
            `  1. In 'run_task', terminal commands run in '${effectiveWorkdir}'. Do not look for './scratch' or './uploads' here; use '$SCRATCH' and '/tmp/user/files'.`,
            `  2. In tool calls ('read_file', 'write_file', 'list_dir'), '$SCRATCH/' and '$ARTIFACTS/' resolve automatically to this session.`,
            `  3. Session messages & logs are persistently mirrored in Supabase, while working files are kept in this local session root.`
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
