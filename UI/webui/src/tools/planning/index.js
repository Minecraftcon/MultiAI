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

export const planningTools = [
    writeTodosTool,
    askQuestionsTool,
    askQuestionTool
];

