const fs = require("fs");
const path = require("path");
const https = require("https");

const VENDOR_ROOT = path.join(__dirname, "../client/vendor");

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const file = fs.createWriteStream(destPath);
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // Follow redirect
                file.close();
                fs.unlinkSync(destPath);
                return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                file.close();
                fs.unlinkSync(destPath);
                return reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
            }
            res.pipe(file);
            file.on("finish", () => {
                file.close(() => resolve(destPath));
            });
        }).on("error", (err) => {
            file.close();
            try { fs.unlinkSync(destPath); } catch (_) {}
            reject(err);
        });
    });
}

async function main() {
    console.log("=== Vendoring Frontend Libraries for Offline Support ===");

    const downloads = [
        // Marked
        { url: "https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js", dest: "marked/marked.min.js" },
        // DOMPurify
        { url: "https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js", dest: "dompurify/purify.min.js" },
        // Highlight.js
        { url: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js", dest: "highlightjs/highlight.min.js" },
        { url: "https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github-dark.min.css", dest: "highlightjs/github-dark.min.css" },
        { url: "https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github.min.css", dest: "highlightjs/github.min.css" },
        // KaTeX
        { url: "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css", dest: "katex/katex.min.css" },
        { url: "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js", dest: "katex/katex.min.js" },
        { url: "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/contrib/auto-render.min.js", dest: "katex/auto-render.min.js" },
        // Lucide
        { url: "https://cdn.jsdelivr.net/npm/lucide@0.475.0/dist/umd/lucide.min.js", dest: "lucide/lucide.min.js" },
        // Mermaid
        { url: "https://cdn.jsdelivr.net/npm/mermaid@10.9.3/dist/mermaid.min.js", dest: "mermaid/mermaid.min.js" },
        // Three.js
        { url: "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js", dest: "three/three.min.js" }
    ];

    // KaTeX fonts
    const fontNames = [
        "KaTeX_AMS-Regular",
        "KaTeX_Caligraphic-Bold",
        "KaTeX_Caligraphic-Regular",
        "KaTeX_Fraktur-Bold",
        "KaTeX_Fraktur-Regular",
        "KaTeX_Main-BoldItalic",
        "KaTeX_Main-Bold",
        "KaTeX_Main-Italic",
        "KaTeX_Main-Regular",
        "KaTeX_Math-BoldItalic",
        "KaTeX_Math-Italic",
        "KaTeX_SansSerif-Bold",
        "KaTeX_SansSerif-Italic",
        "KaTeX_SansSerif-Regular",
        "KaTeX_Script-Regular",
        "KaTeX_Size1-Regular",
        "KaTeX_Size2-Regular",
        "KaTeX_Size3-Regular",
        "KaTeX_Size4-Regular",
        "KaTeX_Typewriter-Regular"
    ];
    for (const name of fontNames) {
        downloads.push({
            url: `https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/fonts/${name}.woff2`,
            dest: `katex/fonts/${name}.woff2`
        });
        downloads.push({
            url: `https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/fonts/${name}.woff`,
            dest: `katex/fonts/${name}.woff`
        });
        downloads.push({
            url: `https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/fonts/${name}.ttf`,
            dest: `katex/fonts/${name}.ttf`
        });
    }

    let successCount = 0;
    for (const item of downloads) {
        const fullDest = path.join(VENDOR_ROOT, item.dest);
        try {
            process.stdout.write(`Downloading ${item.dest}... `);
            await downloadFile(item.url, fullDest);
            const stat = fs.statSync(fullDest);
            console.log(`OK (${(stat.size / 1024).toFixed(1)} KB)`);
            successCount++;
        } catch (err) {
            console.error(`FAILED: ${err.message}`);
        }
    }

    console.log(`\nDownloaded ${successCount} / ${downloads.length} vendor files.`);
}

main().catch(err => {
    console.error("Vendoring error:", err);
    process.exit(1);
});
