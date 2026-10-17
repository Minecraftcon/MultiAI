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
                try { fs.unlinkSync(destPath); } catch (_) {}
                return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                file.close();
                try { fs.unlinkSync(destPath); } catch (_) {}
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

function getVendorList() {
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

    return downloads;
}

/**
 * Checks for missing vendor assets and downloads them if not present.
 * @param {Object} options
 * @param {boolean} [options.force=false] Force re-download even if files exist
 * @param {boolean} [options.quiet=false] Suppress console logs
 * @returns {Promise<{success: boolean, downloaded: number, total: number}>}
 */
async function ensureVendorFiles({ force = false, quiet = false } = {}) {
    const list = getVendorList();
    const missing = [];

    for (const item of list) {
        const fullDest = path.join(VENDOR_ROOT, item.dest);
        if (force || !fs.existsSync(fullDest)) {
            missing.push(item);
        } else {
            try {
                const stat = fs.statSync(fullDest);
                if (stat.size === 0) missing.push(item);
            } catch (_) {
                missing.push(item);
            }
        }
    }

    if (missing.length === 0) {
        return { success: true, downloaded: 0, total: list.length };
    }

    if (!quiet) {
        console.log(`[VENDOR] Missing ${missing.length} vendor asset(s). Downloading offline frontend libraries...`);
    }

    let successCount = 0;
    for (const item of missing) {
        const fullDest = path.join(VENDOR_ROOT, item.dest);
        try {
            if (!quiet) process.stdout.write(`[VENDOR] Downloading ${item.dest}... `);
            await downloadFile(item.url, fullDest);
            const stat = fs.statSync(fullDest);
            if (!quiet) console.log(`OK (${(stat.size / 1024).toFixed(1)} KB)`);
            successCount++;
        } catch (err) {
            if (!quiet) console.error(`FAILED: ${err.message}`);
        }
    }

    if (!quiet && successCount > 0) {
        console.log(`[VENDOR] ✓ Downloaded ${successCount}/${missing.length} vendor files.`);
    }

    return {
        success: successCount === missing.length,
        downloaded: successCount,
        total: list.length
    };
}

// Standalone execution via CLI (e.g., `npm run vendor` or `node scripts/vendor_download.js`)
if (require.main === module) {
    console.log("=== Vendoring Frontend Libraries for Offline Support ===");
    ensureVendorFiles({ force: true }).then((res) => {
        console.log(`\nCompleted: ${res.downloaded} / ${res.total} vendor files.`);
    }).catch(err => {
        console.error("Vendoring error:", err);
        process.exit(1);
    });
}

module.exports = {
    ensureVendorFiles,
    getVendorList,
    VENDOR_ROOT
};
