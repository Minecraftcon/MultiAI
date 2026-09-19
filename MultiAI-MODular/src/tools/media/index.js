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
                description: "Generate an image from a detailed visual text prompt. Use this whenever the user asks to draw, generate, visualize, or create an image or artwork.",
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
    }
];
