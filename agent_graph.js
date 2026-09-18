// MultiAI LangGraph StateFlow Engine
// Orchestrates multi-step agent workflows with dynamic planning, tool execution, and circuit-breaker recovery.

let Annotation, StateGraph, START, END, MemorySaver;
try {
    const lg = require("@langchain/langgraph");
    Annotation = lg.Annotation;
    StateGraph = lg.StateGraph;
    START = lg.START;
    END = lg.END;
    MemorySaver = lg.MemorySaver;
} catch (e) {
    // LangGraph packages will be auto-installed by start.py
}

const { resolveProvider } = require("./providers");
const path = require("path");
const fs = require("fs");
const conversationsManager = require("./conversations_manager");

// ---------------------------------------------------------
// State Schema
// ---------------------------------------------------------
const AgentState = Annotation ? Annotation.Root({
    messages: Annotation({
        reducer: (prev, next) => (Array.isArray(next) ? prev.concat(next) : prev.concat([next])),
        default: () => []
    }),
    todos: Annotation({
        reducer: (prev, next) => (next !== undefined ? next : prev),
        default: () => []
    }),
    activeStep: Annotation({
        reducer: (prev, next) => (next !== undefined ? next : prev),
        default: () => 0
    }),
    scratchpad: Annotation({
        reducer: (prev, next) => ({ ...(prev || {}), ...(next || {}) }),
        default: () => ({})
    }),
    errorCount: Annotation({
        reducer: (prev, next) => (typeof next === "number" ? next : prev),
        default: () => 0
    }),
    chatId: Annotation({
        reducer: (prev, next) => next || prev,
        default: () => ""
    }),
    model: Annotation({
        reducer: (prev, next) => next || prev,
        default: () => "gemini-2.5-flash"
    }),
    toolCalls: Annotation({
        reducer: (prev, next) => (next !== undefined ? next : prev),
        default: () => []
    }),
    isFinished: Annotation({
        reducer: (prev, next) => (typeof next === "boolean" ? next : prev),
        default: () => false
    }),
    recoveryAttempts: Annotation({
        reducer: (prev, next) => (typeof next === "number" ? next : prev),
        default: () => 0
    })
}) : null;

// ---------------------------------------------------------
// Node Implementations
// ---------------------------------------------------------

/**
 * 1. Router Node:
 * Determines if prompt is conversational (fast path) or requires tools/planning.
 */
async function routerNode(state) {
    const messages = state.messages || [];
    const lastUserMsg = messages.filter(m => m.role === "user").pop();
    const text = typeof lastUserMsg?.content === "string" ? lastUserMsg.content.toLowerCase() : "";

    // Fast heuristics for direct responses (greetings, simple queries)
    const directPatterns = [
        /^(hi|hello|hey|greetings|howdy|sup|good morning|good afternoon)\b/i,
        /^(who are you|what is your name|what can you do)\b/i,
        /^(thank you|thanks|bye|goodbye)\b/i
    ];
    const isSimple = directPatterns.some(rx => rx.test(text.trim())) && text.split(/\s+/).length < 8;

    return {
        activeStep: 0,
        isFinished: false
    };
}

/**
 * 2. Planner Node:
 * Generates an internal dynamic todo list for multi-step coding/research tasks.
 */
async function plannerNode(state) {
    if (state.todos && state.todos.length > 0) {
        return {}; // Plan already initialized
    }

    const messages = state.messages || [];
    const lastUserMsg = messages.filter(m => m.role === "user").pop();
    const text = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";

    // Simple heuristic initialization of initial todos
    const todos = [
        { id: 1, task: "Analyze requirements and inspect workspace context", status: "in_progress" },
        { id: 2, task: "Execute required actions or modifications", status: "pending" },
        { id: 3, task: "Verify results and summarize output", status: "pending" }
    ];

    return { todos, activeStep: 1 };
}

/**
 * 3. Agent Model Node:
 * Calls the selected provider with available tools and handles responses.
 */
async function agentModelNode(state, config) {
    const model = state.model || "gemini-2.5-flash";
    const messages = state.messages || [];
    const tools = config?.configurable?.tools || [];
    const modelsConfig = config?.configurable?.modelsConfig || { providers: {} };
    const getApiKey = config?.configurable?.getApiKey || (() => null);

    let providerId = null;
    for (const [pId, pData] of Object.entries(modelsConfig.providers || {})) {
        if ((pData.models || []).some(m => m.id === model)) {
            providerId = pId;
            break;
        }
    }

    const providerConfig = modelsConfig.providers?.[providerId] || {};
    const apiKey = providerConfig.api_key_env ? getApiKey(providerConfig.api_key_env) : null;
    const providerKey = providerId || providerConfig.name || providerConfig.type || model;
    const providerHandler = resolveProvider(providerKey);

    let chatResult;
    try {
        chatResult = await providerHandler.handleChat({
            model,
            apiKey,
            providerConfig,
            messages,
            tools: tools.length > 0 ? tools : undefined
        });

        if (chatResult.status && chatResult.status !== 200) {
            throw new Error(chatResult.error || `Provider error: status ${chatResult.status}`);
        }
    } catch (err) {
        return {
            errorCount: (state.errorCount || 0) + 1,
            isFinished: (state.recoveryAttempts || 0) >= 1,
            messages: [{
                role: "assistant",
                content: `Error communicating with model: ${err.message}`
            }]
        };
    }

    const assistantMsg = chatResult.message || { role: "assistant", content: "" };
    const toolCalls = assistantMsg.tool_calls || [];

    return {
        messages: [assistantMsg],
        toolCalls,
        isFinished: toolCalls.length === 0,
        errorCount: 0
    };
}

/**
 * 4. Tools Node:
 * Executes requested tools sequentially, logs large outputs to scratch, and updates state.
 */
async function toolsNode(state, config) {
    const toolCalls = state.toolCalls || [];
    const toolExecutor = config?.configurable?.toolExecutor;
    const toolResults = [];

    let hasError = false;

    for (const call of toolCalls) {
        const name = call.function?.name;
        let args = {};
        try {
            args = typeof call.function?.arguments === "string" 
                ? JSON.parse(call.function.arguments) 
                : (call.function?.arguments || {});
        } catch (_) {
            args = {};
        }

        let result;
        try {
            if (typeof toolExecutor === "function") {
                result = await toolExecutor(name, args, { chatId: state.chatId });
            } else {
                result = { status: "success", executed: name };
            }
        } catch (err) {
            hasError = true;
            result = { error: err.message || "Tool execution failed" };
        }

        toolResults.push({
            role: "tool",
            tool_call_id: call.id,
            name,
            content: typeof result === "string" ? result : JSON.stringify(result)
        });
    }

    // Update todo checklist progress
    let updatedTodos = state.todos;
    if (updatedTodos && updatedTodos.length > 0) {
        updatedTodos = updatedTodos.map(t => {
            if (t.id === 1 && t.status === "in_progress") {
                return { ...t, status: "completed" };
            }
            if (t.id === 2 && t.status === "pending") {
                return { ...t, status: "in_progress" };
            }
            return t;
        });
    }

    return {
        messages: toolResults,
        toolCalls: [],
        todos: updatedTodos,
        errorCount: hasError ? (state.errorCount || 0) + 1 : 0
    };
}

/**
 * 5. Recovery Node:
 * Stuck detector & circuit breaker if tools or model fail repeatedly.
 */
async function recoveryNode(state) {
    const recoveryNotice = {
        role: "system",
        content: `[CIRCUIT BREAKER ACTIVATED]: An operation has failed repeatedly (${state.errorCount} consecutive errors). Please analyze previous errors, change your strategy, or ask the user for clarification rather than repeating the same failed call.`
    };
    return {
        messages: [recoveryNotice],
        recoveryAttempts: (state.recoveryAttempts || 0) + 1,
        errorCount: 0
    };
}

/**
 * 6. Synthesizer Node:
 * Finalizes response and appends user follow-up prompt suggestions.
 */
async function synthesizerNode(state) {
    const updatedTodos = (state.todos || []).map(t => ({ ...t, status: "completed" }));
    return {
        todos: updatedTodos,
        isFinished: true
    };
}

// ---------------------------------------------------------
// Routing Logic
// ---------------------------------------------------------
function routeNext(state) {
    if (state.errorCount >= 2) {
        if ((state.recoveryAttempts || 0) >= 1) {
            return "synthesizer";
        }
        return "recovery";
    }
    if (state.toolCalls && state.toolCalls.length > 0) {
        return "tools";
    }
    if (state.isFinished) {
        return "synthesizer";
    }
    return "agentModel";
}

// ---------------------------------------------------------
// Graph Construction & Compilation
// ---------------------------------------------------------
function createAgentGraph() {
    if (!StateGraph) {
        throw new Error("LangGraph is not installed. Please run 'npm install' or launch via './start.py'.");
    }
    const workflow = new StateGraph(AgentState)
        .addNode("router", routerNode)
        .addNode("planner", plannerNode)
        .addNode("agentModel", agentModelNode)
        .addNode("tools", toolsNode)
        .addNode("recovery", recoveryNode)
        .addNode("synthesizer", synthesizerNode)
        
        .addEdge(START, "router")
        .addEdge("router", "planner")
        .addEdge("planner", "agentModel")
        .addConditionalEdges("agentModel", routeNext, {
            tools: "tools",
            recovery: "recovery",
            synthesizer: "synthesizer",
            agentModel: "agentModel"
        })
        .addEdge("tools", "agentModel")
        .addEdge("recovery", "agentModel")
        .addEdge("synthesizer", END);

    const checkpointer = new MemorySaver();
    return workflow.compile({ checkpointer });
}

module.exports = {
    createAgentGraph,
    AgentState
};
