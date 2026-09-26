import { state } from "../../state/index.js";
import { runSubagent } from "../../agent/subagent.js";
import { toolFetch } from "../http.js";
import { formatTodosMarkdown, persistPlanArtifact } from "./plan-serializer.js";

export { formatTodosMarkdown, persistPlanArtifact };

/**
 * Creates, tracks, and updates the task checklist for complex or multi-step tasks.
 */
export const writeTodosTool = {
    name: "write_todos",
    schema: {
        type: "function",
        function: {
            name: "write_todos",
            description: "Create, track, and update the task checklist for complex or multi-step engineering tasks. Call this immediately when starting a non-trivial task to outline your plan, and call it again as steps progress from 'pending' to 'in_progress' to 'completed'. Automatically generates a persistent plan artifact at $ARTIFACTS/Tasklist-{name}.md.",
            parameters: {
                type: "object",
                properties: {
                    todos: {
                        type: "array",
                        description: "List of planned tasks/steps with their current status.",
                        items: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string",
                                    description: "Optional short identifier for the task, e.g. 'step-1', 'audit', 'fix'"
                                },
                                content: {
                                    type: "string",
                                    description: "Clear, specific description of the task or milestone"
                                },
                                status: {
                                    type: "string",
                                    enum: ["pending", "in_progress", "completed"],
                                    description: "Status of the task: 'pending' (not yet started), 'in_progress' (currently executing), or 'completed' (successfully finished)"
                                }
                            },
                            required: ["content", "status"]
                        }
                    }
                },
                required: ["todos"]
            }
        }
    },
    handler: async (args, { badgeEl, genState }) => {
        const rawTodos = Array.isArray(args.todos) ? args.todos : [];
        const normalized = rawTodos.map((t, idx) => ({
            id: String(t.id || (idx + 1)),
            content: String(t.content || "").trim(),
            status: ["pending", "in_progress", "completed"].includes(t.status) ? t.status : "pending"
        })).filter(t => t.content.length > 0);

        const activeChatId = state.currentChatId;
        const session = (activeChatId && state.chatSessions) ? state.chatSessions[activeChatId] : null;
        if (session) {
            session.todos = normalized;
        }

        const completedCount = normalized.filter(t => t.status === "completed").length;
        const inProgressCount = normalized.filter(t => t.status === "in_progress").length;
        const pendingCount = normalized.filter(t => t.status === "pending").length;

        // Auto-generate and persist plan artifact file to $ARTIFACTS/Tasklist-{cleanName}.md
        const artifactPath = await persistPlanArtifact(session?.title || "Build Task", normalized, activeChatId, toolFetch, genState);

        try {
            document.dispatchEvent(new CustomEvent("todosUpdated", {
                detail: { chatId: activeChatId, todos: normalized, artifactPath }
            }));
        } catch (_) {}

        return {
            status: "success",
            total: normalized.length,
            completed: completedCount,
            in_progress: inProgressCount,
            pending: pendingCount,
            artifact_path: artifactPath,
            todos: normalized
        };
    }
};

/**
 * Spawns an isolated subagent to execute a dedicated task autonomously.
 */
export const subagentTaskTool = {
    name: "task",
    schema: {
        type: "function",
        function: {
            name: "task",
            description: "Spawn an isolated subagent to execute a focused investigation, research, file analysis, or test run autonomously. The subagent runs its own sub-loop with tools and returns a consolidated summary report to you.",
            parameters: {
                type: "object",
                properties: {
                    instruction: {
                        type: "string",
                        description: "Complete, detailed instruction for the subagent to perform."
                    },
                    subagent_type: {
                        type: "string",
                        enum: ["general-purpose", "researcher", "auditor", "tester"],
                        description: "Role or persona for the subagent (defaults to 'general-purpose')."
                    }
                },
                required: ["instruction"]
            }
        }
    },
    handler: async (args, { badgeEl, genState }) => {
        const instruction = args.instruction || "";
        const subagentType = args.subagent_type || "general-purpose";
        return await runSubagent(instruction, subagentType, genState);
    }
};

export const planningTools = [
    writeTodosTool,
    subagentTaskTool
];
