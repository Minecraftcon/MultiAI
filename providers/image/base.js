// BaseImageProvider: Abstract contract for image generation providers
class BaseImageProvider {
    static id = "base_image";
    static displayName = "Base Image Provider";
    static matchPatterns = [];

    static matches(identifier) {
        if (!identifier) return false;
        const str = String(identifier).trim().toLowerCase();
        if (str === this.id.toLowerCase()) return true;
        return this.matchPatterns.some(pattern => {
            if (pattern instanceof RegExp) return pattern.test(str);
            return String(pattern).toLowerCase() === str;
        });
    }

    /**
     * Map aspect ratio string to standard pixel dimensions.
     */
    getDimensions(aspectRatio = "1:1", customWidth, customHeight) {
        if (customWidth && customHeight) {
            return {
                width: parseInt(customWidth, 10),
                height: parseInt(customHeight, 10),
                aspectRatio: `${customWidth}:${customHeight}`
            };
        }

        const standard = {
            "1:1": { width: 1024, height: 1024 },
            "16:9": { width: 1344, height: 768 },
            "9:16": { width: 768, height: 1344 },
            "4:3": { width: 1152, height: 864 },
            "3:4": { width: 864, height: 1152 },
            "3:2": { width: 1216, height: 832 },
            "2:3": { width: 832, height: 1216 },
            "21:9": { width: 1536, height: 640 }
        };

        const ar = String(aspectRatio || "1:1").trim();
        const dim = standard[ar] || standard["1:1"];
        return {
            width: dim.width,
            height: dim.height,
            aspectRatio: ar in standard ? ar : "1:1"
        };
    }

    /**
     * Format a markdown embed snippet for the generated image.
     */
    formatMarkdown(prompt, url) {
        const alt = String(prompt || "Generated Image").replace(/[\[\]]/g, "").slice(0, 80);
        return `![${alt}](${url})`;
    }

    /**
     * Abstract method to generate an image. Must return a promise resolving to:
     * {
     *   success: true,
     *   url: string,
     *   markdown: string,
     *   prompt: string,
     *   model: string,
     *   provider: string,
     *   dimensions: { width: number, height: number }
     * }
     */
    async generateImage({ prompt, model, aspectRatio, width, height, apiKey, options = {} }) {
        throw new Error(`generateImage() is not implemented on ${this.constructor.name}`);
    }
}

module.exports = BaseImageProvider;
