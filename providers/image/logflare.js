// Logfare Image Generation Provider
const BaseImageProvider = require("./base");

class LogflareImageProvider extends BaseImageProvider {
    static id = "logflare_image";
    static displayName = "Logfare Images";
    static matchPatterns = [
        /^log[-_]?f[l]?a[r]?e[-_]?image$/i,
        /^sdxl[-_]?lightning$/i,
        /^flux[-_]?[12]/i,
        /^phoenix[-_]?1\.?0?$/i,
        /^lucid[-_]?origin$/i,
        "logflare_image",
        "logfare_image"
    ];

    async generateImage({ prompt, model = "sdxl-lightning", aspectRatio = "1:1", width, height, apiKey, options = {} }) {
        if (!prompt || typeof prompt !== "string") {
            throw new Error("Prompt is required for Logfare image generation.");
        }

        const cleanPrompt = prompt.trim();
        const dim = this.getDimensions(aspectRatio, width, height);
        const safeModel = model || "sdxl-lightning";

        const payload = {
            model: safeModel,
            prompt: cleanPrompt,
            n: 1,
            size: `${dim.width}x${dim.height}`
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        try {
            const res = await fetch("https://logfare.ai/v1/images/generations", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Logfare image generation failed (${res.status}): ${errText}`);
            }

            const data = await res.json();
            const item = data.data?.[0];
            let imageUrl = item?.url;

            if (!imageUrl && item?.b64_json) {
                imageUrl = `data:image/png;base64,${item.b64_json}`;
            }

            if (!imageUrl) {
                throw new Error("Logfare did not return an image URL or data.");
            }

            return {
                success: true,
                url: imageUrl,
                markdown: this.formatMarkdown(cleanPrompt, imageUrl),
                prompt: cleanPrompt,
                model: safeModel,
                provider: "logflare",
                dimensions: {
                    width: dim.width,
                    height: dim.height,
                    aspectRatio: dim.aspectRatio
                }
            };
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === "AbortError") {
                throw new Error("Logfare image generation timed out after 60s.");
            }
            throw err;
        }
    }
}

module.exports = LogflareImageProvider;
