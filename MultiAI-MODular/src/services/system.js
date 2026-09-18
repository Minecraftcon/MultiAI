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

let cachedSystemInfo = null;

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

    if (cachedSystemInfo) {
        let envPrompt = `[HOST SYSTEM ENVIRONMENT]\n`;
        envPrompt += `- Operating System: ${cachedSystemInfo.osName} (${cachedSystemInfo.arch})\n`;
        envPrompt += `- Terminal Shell: ${cachedSystemInfo.shellName}\n`;
        envPrompt += `- Working Directory: ${cachedSystemInfo.cwd}\n`;
        if (cachedSystemInfo.username) envPrompt += `- Current User: ${cachedSystemInfo.username}\n`;

        if (Array.isArray(cachedSystemInfo.instructions) && cachedSystemInfo.instructions.length > 0) {
            envPrompt += `\n[TERMINAL & SHELL INSTRUCTIONS FOR THIS SYSTEM]:\n`;
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
            `- Scratchsheet Directory: ${workspace.scratchDir}`,
            `- Images Directory: ${workspace.imagesDir}`,
            `- Scratchpad Instructions: You have a dedicated scratchsheet directory (${workspace.scratchDir}) for this conversation. Always use it when writing temporary scripts, data files, analysis notes, code snippets, or intermediate tool outputs.`
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
