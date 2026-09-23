import { toolFetch } from "../http.js";
import { state } from "../../state/index.js";

/* =========================================================
   MEDIA GENERATION TOOLS
   ========================================================= */

export const mediaTools = [
    {
        name: "generate_image",
        schema: {
            type: "function",
            function: {
                name: "generate_image",
                description: "Generate an image from a detailed visual text prompt. Automatically backgrounded after 15 seconds if slow so you can continue reasoning without blocking.",
                parameters: {
                    type: "object",
                    properties: {
                        prompt: {
                            type: "string",
                            description: "Detailed visual description of the image: scene, characters, setting, art style, lighting, camera angle, and colors."
                        },
                        aspect_ratio: {
                            type: "string",
                            enum: ["1:1", "16:9", "9:16", "4:3", "3:2"],
                            description: "Aspect ratio of the generated image (default: '1:1')"
                        },
                        model: {
                            type: "string",
                            description: "Optional model/engine: 'flux' (default, high quality), 'turbo' (ultra-fast), or 'dall-e-3'"
                        },
                        background: {
                            type: "boolean",
                            description: "If true, starts image generation in the background and immediately returns a task ID so you can continue other work without waiting."
                        }
                    },
                    required: ["prompt"]
                }
            }
        },
        handler: async (args, { genState }) => {
            const payload = { ...args };
            if (!payload.aspect_ratio && state.config?.General?.DefaultImageAspectRatio) {
                payload.aspect_ratio = state.config.General.DefaultImageAspectRatio;
            }
            if (!payload.provider && state.config?.General?.DefaultImageProvider) {
                payload.provider = state.config.General.DefaultImageProvider;
            }
            if (!payload.model && state.config?.General?.DefaultImageModel) {
                payload.model = state.config.General.DefaultImageModel;
            }
            if (!payload.chatId && state.currentChatId) {
                payload.chatId = state.currentChatId;
            }
            return await toolFetch("/api/image/generate", { method: "POST", body: payload, genState });
        }
    },
    {
        name: "get_image_status",
        schema: {
            type: "function",
            function: {
                name: "get_image_status",
                description: "Check the status and result of a background image generation task by task_id.",
                parameters: {
                    type: "object",
                    properties: {
                        task_id: {
                            type: "string",
                            description: "The task_id returned by generate_image."
                        }
                    },
                    required: ["task_id"]
                }
            }
        },
        handler: async (args, { genState }) => {
            return await toolFetch(`/api/image/status/${encodeURIComponent(args.task_id)}`, { method: "GET", genState });
        }
    }
];
