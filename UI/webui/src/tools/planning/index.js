import { state } from "../../state/index.js";
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

export const askQuestionsTool = {
    name: "ask_questions",
    schema: {
        type: "function",
        function: {
            name: "ask_questions",
            description: "Ask the user clarifying multiple-choice or open-ended questions with an interactive questionnaire directly in the composer. Execution pauses until the user answers or skips.",
            parameters: {
                type: "object",
                properties: {
                    questions: {
                        type: "array",
                        description: "List of questions to ask the user.",
                        items: {
                            type: "object",
                            properties: {
                                question: {
                                    type: "string",
                                    description: "The question prompt or title."
                                },
                                options: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "List of 2-5 selectable choices for the user."
                                },
                                is_multi_select: {
                                    type: "boolean",
                                    description: "Whether the user can select multiple options."
                                },
                                allow_custom: {
                                    type: "boolean",
                                    description: "Whether to include a 'Write yourself' input box (default: true)."
                                }
                            },
                            required: ["question", "options"]
                        }
                    },
                    question: {
                        type: "string",
                        description: "Single question convenience shortcut prompt if asking only one question."
                    },
                    options: {
                        type: "array",
                        items: { type: "string" },
                        description: "Selectable choices when asking a single question."
                    },
                    is_multi_select: {
                        type: "boolean",
                        description: "Whether multiple choices can be selected for a single question."
                    },
                    allow_custom: {
                        type: "boolean",
                        description: "Whether to allow custom write-in answers (default: true)."
                    }
                }
            }
        }
    },
    handler: async (args, { genState }) => {
        const { promptUserQuestions, dismissQuestionPrompt } = await import("../../components/chat-question-prompt.js");
        const payload = Array.isArray(args.questions) ? args.questions : (args.question ? [args] : []);
        if (genState?.abortController?.signal?.aborted) {
            return { status: "cancelled", reason: "Generation stopped" };
        }
        const promise = promptUserQuestions(payload);
        if (genState?.abortController?.signal) {
            genState.abortController.signal.addEventListener("abort", () => {
                dismissQuestionPrompt("Generation stopped");
            }, { once: true });
        }
        return await promise;
    }
};

// Internal handler alias so calls to 'ask_question' resolve smoothly without publishing a duplicate schema
export const askQuestionTool = {
    name: "ask_question",
    schema: null, // Omit duplicate schema to prevent LLM confusion/hallucination
    handler: askQuestionsTool.handler
};

/**
 * Defines a reusable custom subagent specification with custom persona and scoped tools.
 */
export const defineSubagentTool = {
    name: "define_subagent",
    schema: {
        type: "function",
        function: {
            name: "define_subagent",
            description: "Define a reusable custom subagent specification with a specialized persona/system prompt and scoped tool permissions. Once defined, the subagent can be invoked repeatedly via invoke_subagent.",
            parameters: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "Unique identifier for the custom subagent (e.g. 'security-auditor', 'db-migration', 'benchmark-runner')."
                    },
                    description: {
                        type: "string",
                        description: "Clear 1-sentence description of what this subagent does and when to use it."
                    },
                    system_prompt: {
                        type: "string",
                        description: "Full system instructions and behavioral guidelines defining the subagent's role and constraints."
                    },
                    tools: {
                        type: "array",
                        items: { type: "string" },
                        description: "Optional list of allowed tool names (e.g. ['read_file', 'list_dir', 'grep_search', 'run_task', 'web_search']). If omitted, defaults to standard inspection and execution tools."
                    }
                },
                required: ["name", "description", "system_prompt"]
            }
        }
    },
    handler: async (args) => {
        const name = args?.name || args?.Name;
        const description = args?.description || args?.Description || "";
        const systemPrompt = args?.system_prompt || args?.SystemPrompt || args?.systemPrompt || "";
        const tools = args?.tools || args?.Tools || [];

        if (!name || typeof name !== "string") {
            return { error: "Parameter 'name' is required for define_subagent." };
        }
        if (!systemPrompt || typeof systemPrompt !== "string") {
            return { error: "Parameter 'system_prompt' is required for define_subagent." };
        }

        const { registerCustomSubagent } = await import("../../agent/subagent.js");
        const entry = registerCustomSubagent({
            name,
            description,
            systemPrompt,
            tools
        });

        return {
            status: "defined",
            name: entry.name,
            description: entry.description,
            allowed_tools: entry.tools,
            message: `Custom subagent '${entry.name}' registered. Invoke it using: invoke_subagent(subagent_type: "${entry.name}", task: "...")`
        };
    }
};

/**
 * Monitors and terminates subagent lifecycles:
 * - list: returns all active subagents, conversation IDs, and status
 * - kill: terminates specific subagents by ConversationIds
 * - kill_all: terminates all active subagents
 */
export const manageSubagentsTool = {
    name: "manage_subagents",
    schema: {
        type: "function",
        function: {
            name: "manage_subagents",
            description: "Monitors and terminates subagent lifecycles. Supports listing all active subagents with their conversation IDs and statuses, terminating specific subagents by ID, or killing all subagents.",
            parameters: {
                type: "object",
                properties: {
                    Action: {
                        type: "string",
                        enum: ["list", "kill", "kill_all"],
                        description: "\"list\" (returns all active subagents, conversation IDs, and status), \"kill\", or \"kill_all\"."
                    },
                    ConversationIds: {
                        type: "array",
                        items: { type: "string" },
                        description: "Array of IDs to terminate (required when Action: \"kill\")."
                    }
                },
                required: ["Action"]
            }
        }
    },
    handler: async (args) => {
        const action = String(args?.Action || args?.action || "list").toLowerCase().trim();
        const rawIds = args?.ConversationIds || args?.conversation_ids || args?.conversationIds || args?.ConversationId || args?.conversation_id;
        const conversationIds = Array.isArray(rawIds) ? rawIds : (rawIds ? [String(rawIds)] : []);

        const { listActiveSubagents, killSubagent, killAllSubagents } = await import("../../agent/subagent.js");

        if (action === "list") {
            const list = listActiveSubagents();
            return {
                status: "success",
                action: "list",
                subagents: list,
                count: list.length,
                message: list.length > 0 ? `Found ${list.length} active subagent(s).` : "No active subagents currently running."
            };
        } else if (action === "kill") {
            if (!conversationIds.length) {
                return {
                    status: "error",
                    error: "Parameter 'ConversationIds' array is required when Action is 'kill'."
                };
            }
            const killed = [];
            const notFound = [];
            for (const id of conversationIds) {
                const ok = killSubagent(id);
                if (ok) killed.push(id);
                else notFound.push(id);
            }
            return {
                status: "success",
                action: "kill",
                killed,
                notFound,
                message: `Terminated ${killed.length} subagent(s).`
            };
        } else if (action === "kill_all") {
            const count = killAllSubagents();
            return {
                status: "success",
                action: "kill_all",
                killed_count: count,
                message: `Terminated all active subagents (${count} total).`
            };
        } else {
            return {
                status: "error",
                error: `Unknown Action '${action}'. Expected: 'list', 'kill', or 'kill_all'.`
            };
        }
    }
};

/**
 * Inter-agent communication over the background messaging bus:
 * Guidance, new input, or followup response sent to the subagent.
 */
export const sendMessageTool = {
    name: "send_message",
    schema: {
        type: "function",
        function: {
            name: "send_message",
            description: "Inter-agent communication over the background messaging bus. Sends guidance, new input, or followup responses to a running or existing subagent.",
            parameters: {
                type: "object",
                properties: {
                    Recipient: {
                        type: "string",
                        description: "The conversationId of the target subagent."
                    },
                    Message: {
                        type: "string",
                        description: "Guidance, new input, or followup response sent to the subagent."
                    }
                },
                required: ["Recipient", "Message"]
            }
        }
    },
    handler: async (args, toolContext) => {
        let recipient = args?.Recipient || args?.recipient || args?.target || args?.target_id;
        const message = args?.Message || args?.message || args?.content || args?.text;

        if (!recipient || typeof recipient !== "string") {
            if (toolContext?.isSubagent || args?.parentChatId) {
                recipient = "coordinator";
            } else {
                return {
                    status: "error",
                    error: "Parameter 'Recipient' (the conversationId of the target subagent, or 'coordinator') is required."
                };
            }
        }

        if (!message || typeof message !== "string") {
            return {
                status: "error",
                error: "Parameter 'Message' is required."
            };
        }

        const { sendMessageToSubagent } = await import("../../agent/subagent.js");
        try {
            const result = await sendMessageToSubagent(recipient.trim(), message.trim(), {
                parentChatId: args?.parentChatId || toolContext?.parentChatId || null,
                senderName: args?.senderName || toolContext?.senderName || "Agent"
            });
            return {
                status: "delivered",
                recipient: recipient.trim(),
                subagent_type: result?.subagent_type || "subagent",
                message: message.trim(),
                response: result?.report || result?.message || "Message delivered over inter-agent bus."
            };
        } catch (err) {
            return {
                status: "error",
                recipient: recipient.trim(),
                error: err.message || String(err)
            };
        }
    }
};

/**
 * Spawns an isolated subagent (e.g. designer, researcher, auditor, tester, or custom)
 * with a specialized toolset without cluttering the main conversation context.
 */
export const invokeSubagentTool = {
    name: "invoke_subagent",
    schema: {
        type: "function",
        function: {
            name: "invoke_subagent",
            description: "Spawn an isolated subagent with dedicated persona tools (e.g. 'designer' for UI/UX, styling, HTML/CSS, and live browser previews; 'researcher', 'auditor', 'tester', 'general-purpose', or any custom subagent defined with define_subagent) to execute a task without cluttering the main conversation context. Can run synchronously or in the background.",
            parameters: {
                type: "object",
                properties: {
                    task: {
                        type: "string",
                        description: "Clear, specific description of the objective or design task for the subagent to execute."
                    },
                    subagent_type: {
                        type: "string",
                        description: "Specialized subagent persona: 'designer', 'general-purpose', 'researcher', 'auditor', 'tester', or any custom subagent name registered via define_subagent."
                    },
                    persona: {
                        type: "string",
                        description: "Optional ad-hoc persona or system instructions override for this subagent execution."
                    },
                    tools: {
                        type: "array",
                        items: { type: "string" },
                        description: "Optional list of tool names allowed for this execution."
                    },
                    background: {
                        type: "boolean",
                        description: "Set to true to launch the subagent asynchronously in the background so the main model can finish or continue immediately."
                    }
                },
                required: ["task"]
            }
        }
    },
    handler: async (args, { badgeEl, genState }) => {
        const task = args?.task || args?.instruction || args?.prompt || "";
        const subagentType = args?.subagent_type || args?.type || args?.TypeName || "designer";
        const isBackground = args?.background === true;
        const inlinePersona = args?.persona || args?.system_prompt || args?.SystemPrompt || null;
        const inlineTools = Array.isArray(args?.tools) ? args.tools : null;
        const chatId = genState?.chatId || state.currentChatId;
        const session = chatId ? state.chatSessions?.[chatId] : null;
        const modelSelect = typeof document !== "undefined" ? document.getElementById("modelSelect") : null;
        const model = session?.model || modelSelect?.value || null;
        const provider = session?.provider || modelSelect?.selectedOptions?.[0]?.dataset?.provider || null;

        const { runSubagent, registerCustomSubagent, hasCustomSubagent, SUBAGENT_PERSONAS } = await import("../../agent/subagent.js");

        // If caller passed an ad-hoc inline persona with a custom type name, register it automatically
        if (inlinePersona && !hasCustomSubagent(subagentType) && !SUBAGENT_PERSONAS[subagentType]) {
            registerCustomSubagent({
                name: subagentType,
                description: `Ad-hoc subagent: ${subagentType}`,
                systemPrompt: inlinePersona,
                tools: inlineTools || []
            });
        }

        return await runSubagent(task, subagentType, genState, {
            background: isBackground,
            badgeEl,
            args,
            model,
            provider,
            persona: inlinePersona,
            tools: inlineTools
        });
    }
};

/**
 * Convenience alias for invoke_subagent so calls to 'task' resolve directly.
 */
export const taskTool = {
    name: "task",
    schema: null, // Omit duplicate schema in LLM prompt
    handler: invokeSubagentTool.handler
};

export const planningTools = [
    writeTodosTool,
    defineSubagentTool,
    manageSubagentsTool,
    sendMessageTool,
    askQuestionsTool,
    askQuestionTool,
    invokeSubagentTool,
    taskTool
];

