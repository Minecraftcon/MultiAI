const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("=== Testing Live Streaming Tool Badges & Diff Counter ===");

// 1. Verify CSS rules in UI/webui/styles/activity.css
const actCssPath = path.join(__dirname, "../UI/webui/styles/activity.css");
assert(fs.existsSync(actCssPath), "activity.css must exist");
const actCss = fs.readFileSync(actCssPath, "utf-8");
assert(actCss.includes(".search-badge-item.is-streaming-tool"), "activity.css must contain .search-badge-item.is-streaming-tool");
assert(actCss.includes("tabular-nums"), "activity.css must contain tabular-nums for jitter-free numbers");
assert(actCss.includes("#22c55e"), "activity.css must contain standard diff green #22c55e");
assert(actCss.includes("#f87171"), "activity.css must contain standard diff red #f87171");
assert(!actCss.includes(".badge-diff-stat.add {\n    color: var(--stat-add"), "activity.css must not bind diff stats to accent color");
console.log("✓ activity.css streaming tool badge styles verified cleanly.");

// 2. Verify orchestrator.js and chat-client.js integration
const orchPath = path.join(__dirname, "../UI/webui/src/agent/orchestrator.js");
assert(fs.existsSync(orchPath), "orchestrator.js must exist");
const orchContent = fs.readFileSync(orchPath, "utf-8");
assert(orchContent.includes("updateStreamingToolBadge"), "orchestrator.js must import updateStreamingToolBadge");
assert(orchContent.includes("syncToolBadgeArgs"), "orchestrator.js must import syncToolBadgeArgs");
assert(orchContent.includes("onToolChunk"), "orchestrator.js must provide onToolChunk to callChatModel");
console.log("✓ orchestrator.js streaming hooks and handoff verified cleanly.");

const clientPath = path.join(__dirname, "../UI/webui/src/agent/chat-client.js");
assert(fs.existsSync(clientPath), "chat-client.js must exist");
const clientContent = fs.readFileSync(clientPath, "utf-8");
assert(clientContent.includes("onToolChunk"), "chat-client.js must accept and invoke onToolChunk");
console.log("✓ chat-client.js onToolChunk SSE emitter verified cleanly.");

// 3. Test Component Logic & DOM Interactions Dynamically
async function runTests() {
    class MockElement {
        constructor(tagName = "div") {
            this.tagName = tagName.toUpperCase();
            this.className = "";
            this.classList = {
                classes: new Set(),
                add: (c) => this.classList.classes.add(c),
                remove: (c) => this.classList.classes.delete(c),
                contains: (c) => this.classList.classes.has(c)
            };
            this.attributes = new Map();
            this.dataset = {};
            this.style = {
                setProperty: (k, v) => { this.style[k] = v; },
                getPropertyValue: (k) => this.style[k] || ""
            };
            this.children = [];
            this.parentNode = null;
            this.textContent = "";
            this._innerHTML = "";
        }
        setAttribute(k, v) { this.attributes.set(k, String(v)); }
        getAttribute(k) { return this.attributes.get(k) || null; }
        hasAttribute(k) { return this.attributes.has(k); }
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        }
        remove() {
            if (this.parentNode) {
                const idx = this.parentNode.children.indexOf(this);
                if (idx !== -1) this.parentNode.children.splice(idx, 1);
                this.parentNode = null;
            }
        }
        querySelector(sel) {
            if (sel.startsWith(".")) {
                const cls = sel.slice(1);
                if (this.classList.contains(cls)) return this;
                for (const c of this.children) {
                    const found = c.querySelector(sel);
                    if (found) return found;
                }
            } else if (sel.startsWith("#")) {
                const id = sel.slice(1);
                if (this.id === id) return this;
                for (const c of this.children) {
                    const found = c.querySelector(sel);
                    if (found) return found;
                }
            }
            return null;
        }
        querySelectorAll(sel) {
            const results = [];
            if (sel.startsWith(".")) {
                const cls = sel.slice(1);
                if (this.classList.contains(cls)) results.push(this);
            }
            for (const c of this.children) {
                results.push(...c.querySelectorAll(sel));
            }
            return results;
        }
        insertAdjacentElement(pos, el) {
            if (!this.parentNode) return;
            const idx = this.parentNode.children.indexOf(this);
            if (pos === "afterend") {
                this.parentNode.children.splice(idx + 1, 0, el);
                el.parentNode = this.parentNode;
            }
        }
        get innerHTML() { return this._innerHTML; }
        set innerHTML(val) {
            this._innerHTML = val;
            this.children = [];
            const classRegex = /<([a-z0-9]+)[^>]*class="([^"]+)"[^>]*>(?:([^<]*))?/gi;
            let m;
            while ((m = classRegex.exec(val)) !== null) {
                const child = new MockElement(m[1]);
                const classes = m[2].split(/\s+/).filter(Boolean);
                for (const c of classes) child.classList.add(c);
                if (m[3]) child.textContent = m[3].trim();
                this.appendChild(child);
            }
        }
    }

    // Setup dummy global objects for import in Node
    global.window = {
        addEventListener() {},
        removeEventListener() {}
    };
    global.localStorage = {
        store: {},
        getItem(k) { return this.store[k] || null; },
        setItem(k, v) { this.store[k] = String(v); },
        removeItem(k) { delete this.store[k]; },
        clear() { this.store = {}; }
    };
    const docEl = new MockElement("html");
    const bodyEl = new MockElement("body");
    global.document = {
        documentElement: docEl,
        body: bodyEl,
        addEventListener() {},
        removeEventListener() {},
        createElement(tag) { return new MockElement(tag); },
        getElementById() { return null; }
    };

    const {
        extractStreamingPath,
        extractStreamingContent,
        extractStreamingDiffCounts,
        updateStreamingToolBadge,
        syncToolBadgeArgs
    } = await import("../UI/webui/src/components/chat-tool-badges.js");

    console.log("3. Testing extractStreamingPath and extractStreamingContent...");
    {
        const json1 = '{"path": "src/components/navbar.js", "content": "export default function() {}"}';
        assert.strictEqual(extractStreamingPath(json1), "src/components/navbar.js");
        assert.strictEqual(extractStreamingContent(json1), "export default function() {}");

        const json2 = '{"path": "src/components/nav';
        assert.strictEqual(extractStreamingPath(json2), "src/components/nav");

        const json3 = '{"TargetFile": "scratch/test_story.txt", "CodeContent": "Hello\\nworld\\n\\"quoted\\""}';
        assert.strictEqual(extractStreamingPath(json3), "scratch/test_story.txt");
        assert.strictEqual(extractStreamingContent(json3), 'Hello\nworld\n"quoted"');

        const json4 = '{"file_path": "nested/dir/app.ts"}';
        assert.strictEqual(extractStreamingPath(json4), "nested/dir/app.ts");

        // Partial in-flight string that hasn't closed yet
        const json5 = '{"path": "foo.js", "content": "function test() {\\n  return 42;\\n';
        assert.strictEqual(extractStreamingContent(json5), "function test() {\n  return 42;\n");

        console.log("✓ extractStreamingPath and extractStreamingContent tests passed.");
    }

    console.log("4. Testing extractStreamingDiffCounts...");
    {
        const writeJson1 = '{"path": "story.txt", "content": "Line 1\\nLine 2\\nLine 3"}';
        const counts1 = extractStreamingDiffCounts("write_file", writeJson1);
        assert.ok(counts1);
        assert.strictEqual(counts1.adds, 3);
        assert.strictEqual(counts1.dels, 0);

        const writeJson2 = `{"path": "file.js", "content": "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n"}`;
        const counts2 = extractStreamingDiffCounts("write_file", writeJson2);
        assert.ok(counts2);
        assert.strictEqual(counts2.adds, 5);
        assert.strictEqual(counts2.dels, 0);

        const replaceJson = '{"path": "test.js", "target_content": "old 1\\nold 2", "replacement_content": "new 1\\nnew 2\\nnew 3\\nnew 4"}';
        const counts3 = extractStreamingDiffCounts("replace_file_content", replaceJson);
        assert.ok(counts3);
        assert.strictEqual(counts3.dels, 2);
        assert.strictEqual(counts3.adds, 4);

        console.log("✓ extractStreamingDiffCounts tests passed.");
    }

    console.log("5. Testing live DOM badge mounting & rolling diff ticker...");
    {
        const currentAIMessage = new MockElement("div");
        currentAIMessage.classList.add("message");
        currentAIMessage.classList.add("ai");

        const activityWrapper = new MockElement("div");
        activityWrapper.classList.add("activity-wrapper");
        currentAIMessage.appendChild(activityWrapper);

        const activityLabel = new MockElement("span");
        activityLabel.classList.add("activity-label");
        activityWrapper.appendChild(activityLabel);

        const searchContainer = new MockElement("div");
        searchContainer.classList.add("search-items-container");
        activityWrapper.appendChild(searchContainer);

        const thoughtBox = new MockElement("details");
        thoughtBox.classList.add("thought-box");
        thoughtBox.open = true;
        currentAIMessage.appendChild(thoughtBox);

        // Chunk 1: Tool call detected, start streaming write_file
        updateStreamingToolBadge(currentAIMessage, {
            index: 0,
            id: "call_test_123",
            name: "write_file",
            accumulatedArgs: '{"path": "The Keeper of Forgotten Hours.txt", "content": "Chapter 1'
        }, Date.now() - 1000);

        assert.strictEqual(thoughtBox.open, false, "Thought box should auto-collapse when tool streaming starts");
        assert.ok(currentAIMessage._streamingToolBadges, "Streaming badges map should be instantiated");
        const badgeEl = currentAIMessage._streamingToolBadges.get("call_test_123");
        assert.ok(badgeEl, "Streaming badge should be registered under tool id");
        assert.strictEqual(badgeEl.classList.contains("is-streaming-tool"), true, "Badge should have is-streaming-tool class");
        assert.ok(badgeEl._collapseDiv, "write_file badge must have _collapseDiv mounted from the start");
        assert.strictEqual(badgeEl._collapseDiv.querySelector(".badge-open-pty-btn"), null, "write_file must NOT have terminal button");
        assert.ok(badgeEl._collapseDiv.querySelector(".modern-viewer-window"), "write_file must have modern-viewer-window code card");

        // Chunk 2: More lines stream in
        updateStreamingToolBadge(currentAIMessage, {
            index: 0,
            id: "call_test_123",
            name: "write_file",
            accumulatedArgs: '{"path": "The Keeper of Forgotten Hours.txt", "content": "Chapter 1\\nLine 2\\nLine 3\\nLine 4\\nLine 5'
        }, Date.now() - 2000);

        const diffStatEl = badgeEl.querySelector(".badge-diff-stat");
        assert.ok(diffStatEl, "Diff stat element should be mounted");
        assert.strictEqual(diffStatEl.textContent, "+5", "Diff count should roll up to +5 lines");

        // Chunk 3: Stream finishes, hand off to orchestrator
        syncToolBadgeArgs(badgeEl, "write_file", {
            path: "The Keeper of Forgotten Hours.txt",
            content: "Chapter 1\nLine 2\nLine 3\nLine 4\nLine 5"
        });

        assert.strictEqual(badgeEl.classList.contains("is-streaming-tool"), false, "is-streaming-tool should be removed on handoff");
        console.log("✓ DOM mounting, live diff rolling, and zero-pause handoff tests passed cleanly.");
    }

    console.log("\n=== ALL STREAMING TOOL BADGE & DIFF COUNTER TESTS PASSED! ===");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
