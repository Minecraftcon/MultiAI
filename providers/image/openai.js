// OpenAI DALL-E Image Generation Provider
const BaseImageProvider = require("./base");

class OpenAIImageProvider extends BaseImageProvider {
    static id = "openai_image";
    static displayName = "OpenAI DALL-E";
    static matchPatterns = [
        /^openai[-_]?image$/i,
        /^dall[-_]?e$/i,
        /^dall[-_]?e[-_]?[23]$/i
    ];

    async generateImage({ prompt, model = "dall-e-3", aspectRatio = "1:1", apiKey, options = {} }) {
        if (!apiKey) {
            throw new Error("OpenAI API key is required for DALL-E image generation.");
        }
        if (!prompt || typeof prompt !== "string") {
            throw new Error("Prompt is required for image generation.");
        }

        const cleanPrompt = prompt.trim();
        const safeModel = String(model).toLowerCase().includes("dall-e-2") ? "dall-e-2" : "dall-e-3";

        let size = "1024x1024";
        if (safeModel === "dall-e-3") {
            if (aspectRatio === "16:9" || aspectRatio === "21:9" || aspectRatio === "3:2") {
                size = "1792x1024";
            } else if (aspectRatio === "9:16" || aspectRatio === "2:3" || aspectRatio === "3:4") {
                size = "1024x1792";
            } else {
                size = "1024x1024";
            }
        } else {
            // DALL-E 2 sizes: 256x256, 512x512, 1024x1024
            size = "1024x1024";
        }

        const payload = {
            model: safeModel,
            prompt: cleanPrompt,
            n: 1,
            size,
            quality: options.quality || "standard",
            response_format: "url"
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        try {
            const res = await fetch("https://api.openai.com/v1/images/generations", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeout);

            const resText = await res.text();
            if (!res.ok) {
                let errMsg = `OpenAI Image error (${res.status}): ${resText.slice(0, 300)}`;
                try {
                    const parsed = JSON.parse(resText);
                    if (parsed.error?.message) errMsg = parsed.error.message;
                } catch (_) {}
                throw new Error(errMsg);
            }

            const data = JSON.parse(resText);
            const item = data.data?.[0];
            if (!item || !item.url) {
                throw new Error("OpenAI returned no image URL in response.");
            }

            const [wStr, hStr] = size.split("x");
            return {
                success: true,
                url: item.url,
                markdown: this.formatMarkdown(item.revised_prompt || cleanPrompt, item.url),
                prompt: cleanPrompt,
                revised_prompt: item.revised_prompt || cleanPrompt,
                model: safeModel,
                provider: this.constructor.id,
                dimensions: {
                    width: parseInt(wStr, 10) || 1024,
                    height: parseInt(hStr, 10) || 1024,
                    aspectRatio
                }
            };
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === "AbortError") {
                throw new Error("OpenAI image generation timed out after 60s.");
            }
            throw err;
        }
    }
}

module.exports = OpenAIImageProvider;
