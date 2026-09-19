/* =========================================================
   TASK COMPLETION & FINAL ANSWER TOOL ('end')
   Allows the AI to signal completion of multi-step tasks
   and present the clean final answer to the user.
   ========================================================= */

export const endTool = {
    name: "end",
    schema: {
        type: "function",
        function: {
            name: "end",
            description: "Call this tool to terminate your multi-step loop and deliver the final answer or solution to the user. All previous intermediate tool executions and thoughts will be minimized into the activity accordion, and only your final_answer will be presented to the user.",
            parameters: {
                type: "object",
                properties: {
                    final_answer: {
                        type: "string",
                        description: "The complete, detailed final answer, explanation, or code solution to present to the user."
                    }
                },
                required: ["final_answer"]
            }
        }
    },
    handler: async (args) => {
        return {
            status: "completed",
            final_answer: args.final_answer || ""
        };
    }
};

export const endTools = [endTool];
