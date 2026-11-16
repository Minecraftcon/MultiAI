const assert = require("assert");

console.log("=== Testing Chat Title Extraction, In-flight Stripping & Stop Finalization ===");

class MockElement {
    constructor(tagName = "div") {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this._classList = new Set();
        this.dataset = {};
        this.style = { setProperty() {}, getPropertyValue() { return ""; } };
        this._innerHTML = "";
        this._textContent = "";
    }
    get classList() {
        return {
            add: (...cls) => cls.forEach(c => this._classList.add(c)),
            remove: (...cls) => cls.forEach(c => this._classList.delete(c)),
            contains: (c) => this._classList.has(c)
        };
    }
    get className() { return Array.from(this._classList).join(" "); }
    set className(val) {
        this._classList.clear();
        val.split(/\s+/).filter(Boolean).forEach(c => this._classList.add(c));
    }
    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    querySelector(sel) {
        if (sel.startsWith(".")) {
            const cls = sel.slice(1);
            if (this._classList.has(cls)) return this;
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
            if (this._classList.has(cls)) results.push(this);
            for (const c of this.children) {
                results.push(...c.querySelectorAll(sel));
            }
        }
        return results;
    }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(val) {
        this._innerHTML = val;
        this._textContent = val.replace(/<[^>]*>/g, "");
    }
    get innerText() { return this._textContent; }
    get textContent() { return this._textContent; }
    set textContent(val) {
        this._textContent = val;
        this._innerHTML = val;
    }
}

const docEl = new MockElement("html");
const bodyEl = new MockElement("body");
global.window = { addEventListener() {}, removeEventListener() {} };
global.document = {
    documentElement: docEl,
    body: bodyEl,
    createElement: (tag) => new MockElement(tag),
    getElementById: () => null
};
global.localStorage = {
    store: {},
    getItem(k) { return this.store[k] || null; },
    setItem(k, v) { this.store[k] = String(v); },
    removeItem(k) { delete this.store[k]; }
};

async function runTests() {
    const { extractChatTitleAndContent, stripInFlightChatTitle } = await import("../UI/webui/src/utils/dom.js");
    const { extractThoughtAndContent } = await import("../UI/webui/src/components/renderer.js");
    const { finalizeStopped } = await import("../UI/webui/src/components/chat-ui.js");
    const { state } = await import("../UI/webui/src/state.js");

    // 1. extractChatTitleAndContent Unit Tests
    console.log("1. Testing extractChatTitleAndContent...");
    {
        const sample1 = '{"chatname": "The Last Cartographer\'s Voyage"}\n\n# The Salt Meridian\nPart One...';
        const res1 = extractChatTitleAndContent(sample1);
        assert.strictEqual(res1.title, "The Last Cartographer's Voyage");
        assert.ok(!res1.content.includes("chatname"), "JSON must be removed from content");
        assert.ok(res1.content.startsWith("# The Salt Meridian"), "Content must begin with actual story text");

        const sample2 = '```json\n{"chat_name": "Deep Sea Expedition"}\n```\n\nDeep beneath the waves...';
        const res2 = extractChatTitleAndContent(sample2);
        assert.strictEqual(res2.title, "Deep Sea Expedition");
        assert.strictEqual(res2.content, "Deep beneath the waves...");

        const sample3 = '{"title": "Quantum Physics"}';
        const res3 = extractChatTitleAndContent(sample3);
        assert.strictEqual(res3.title, "Quantum Physics");
        assert.strictEqual(res3.content, "");

        const sample4 = 'Just a normal response without any title JSON.';
        const res4 = extractChatTitleAndContent(sample4);
        assert.strictEqual(res4.title, null);
        assert.strictEqual(res4.content, sample4);

        console.log("✓ extractChatTitleAndContent tests passed cleanly.");
    }

    // 2. stripInFlightChatTitle Unit Tests
    console.log("2. Testing stripInFlightChatTitle...");
    {
        assert.strictEqual(stripInFlightChatTitle('{"chatname": "The Last Cart'), "", "In-flight title JSON must be hidden");
        assert.strictEqual(stripInFlightChatTitle('{"chat'), "", "In-flight minimal JSON start must be hidden");
        assert.strictEqual(stripInFlightChatTitle('```json\n{"chatname": "Test'), "", "In-flight code-fenced JSON must be hidden");
        assert.strictEqual(stripInFlightChatTitle('Normal text here'), "Normal text here", "Normal text must not be stripped");
        console.log("✓ stripInFlightChatTitle tests passed cleanly.");
    }

    // 3. extractThoughtAndContent Integration
    console.log("3. Testing extractThoughtAndContent with thinking and title JSON...");
    {
        const streamText = '<think>I need a title first.</think>{"chatname": "The Last Cartographer\'s Voyage"}\n\n# The Salt Meridian';
        const parsed = extractThoughtAndContent(streamText);
        assert.strictEqual(parsed.title, "The Last Cartographer's Voyage", "Title must be extracted");
        assert.ok(!parsed.content.includes("chatname"), "Content must not contain chatname JSON");
        assert.ok(parsed.content.startsWith("# The Salt Meridian"), "Content must start with markdown heading");
        assert.ok(parsed.thoughtHtml.includes("I need a title first."), "Thought content must be formatted into thoughtHtml");

        // Test in-flight title right after thinking finishes
        const inFlightStream = '<think>Thinking done.</think>{"chatname": "The Incomplete';
        const parsedInFlight = extractThoughtAndContent(inFlightStream);
        assert.strictEqual(parsedInFlight.content, "", "Content must be empty while title JSON is in-flight");
        console.log("✓ extractThoughtAndContent tests passed cleanly.");
    }

    // 4. finalizeStopped Title Preservation & Content Placement
    console.log("4. Testing finalizeStopped...");
    {
        const aiMsg = new MockElement("div");
        aiMsg.classList.add("message");
        aiMsg.classList.add("ai");

        const preContent = new MockElement("div");
        preContent.classList.add("pre-search-content");
        aiMsg.appendChild(preContent);

        const thoughtBox = new MockElement("details");
        thoughtBox.classList.add("thought-box");
        thoughtBox.innerHTML = '<summary>Thought</summary><div class="thought-content">Reasoning text</div>';
        preContent.appendChild(thoughtBox);

        const finalContent = new MockElement("div");
        finalContent.classList.add("final-content");
        finalContent.innerHTML = "# The Salt Meridian\n\nStory text here...";
        aiMsg.appendChild(finalContent);

        aiMsg.dataset.streamedTitle = "The Last Cartographer's Voyage";

        const chatId = "test_chat_stop_1";
        state.currentChatId = chatId;
        state.chatSessions[chatId] = {
            id: chatId,
            title: "write me a huge story",
            messages: [{ role: "user", content: "write me a huge story" }]
        };

        finalizeStopped(aiMsg, Date.now() - 3000, false);

        // Verify title updated on session
        assert.strictEqual(state.chatSessions[chatId].title, "The Last Cartographer's Voyage", "Chat title must be updated to streamed title on stop");

        // Verify (Generation stopped) placed in finalContent, NOT inside preContent
        assert(!preContent.innerHTML.includes("(Generation stopped)"), "(Generation stopped) must NEVER be inside preContent reasoning container");
        assert(finalContent.innerHTML.includes("(Generation stopped)"), "(Generation stopped) must be inside finalContent");
        assert(finalContent.innerHTML.includes("# The Salt Meridian"), "Existing story text must remain preserved in finalContent");

        console.log("✓ finalizeStopped tests passed cleanly.");
    }

    console.log("\n=== ALL CHAT TITLE & STREAMING STRIPPING TESTS PASSED! ===");
    process.exit(0);
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
