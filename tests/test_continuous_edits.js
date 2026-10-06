const assert = require("assert");

// Lightweight DOM mock for testing client badge components in Node.js
class MockElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this._classList = new Set();
        this.dataset = {};
        this.attributes = {};
        this._innerHTML = "";
        this._textContent = "";
        this.style = {};
    }

    get classList() {
        return {
            add: (...cls) => cls.forEach(c => this._classList.add(c)),
            remove: (...cls) => cls.forEach(c => this._classList.delete(c)),
            contains: (c) => this._classList.has(c)
        };
    }

    get className() {
        return Array.from(this._classList).join(" ");
    }

    set className(val) {
        this._classList.clear();
        if (val) val.split(/\s+/).filter(Boolean).forEach(c => this._classList.add(c));
    }

    setAttribute(name, val) {
        this.attributes[name] = String(val);
    }

    getAttribute(name) {
        return this.attributes[name] || null;
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    insertBefore(newNode, refNode) {
        const idx = this.children.indexOf(refNode);
        if (idx !== -1) {
            newNode.parentNode = this;
            this.children.splice(idx, 0, newNode);
        } else {
            this.appendChild(newNode);
        }
        return newNode;
    }

    insertAdjacentElement(position, element) {
        if (!this.parentNode) return;
        const siblings = this.parentNode.children;
        const idx = siblings.indexOf(this);
        if (position === "afterend") {
            element.parentNode = this.parentNode;
            siblings.splice(idx + 1, 0, element);
        } else if (position === "beforebegin") {
            element.parentNode = this.parentNode;
            siblings.splice(idx, 0, element);
        }
    }

    remove() {
        if (this.parentNode) {
            const idx = this.parentNode.children.indexOf(this);
            if (idx !== -1) this.parentNode.children.splice(idx, 1);
            this.parentNode = null;
        }
    }

    get textContent() {
        if (this.children.length === 0) return this._textContent;
        return this.children.map(c => c.textContent).join("");
    }

    set textContent(val) {
        this._textContent = String(val);
        this.children = [];
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(html) {
        this._innerHTML = html;
        this.children = [];
        this._parseSimpleHTML(html);
    }

    _parseSimpleHTML(html) {
        // Simple regex-based element extractor to populate mock tree
        const tagRegex = /<([a-z0-9-]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-z0-9-]+)([^>]*)\/?>/gi;
        let match;
        while ((match = tagRegex.exec(html)) !== null) {
            const tagName = match[1] || match[4];
            const attrsStr = match[2] || match[5] || "";
            const inner = match[3] || "";

            const child = new MockElement(tagName);
            child.parentNode = this;

            const classMatch = attrsStr.match(/class=["']([^"']+)["']/i);
            if (classMatch) child.className = classMatch[1];

            const roleMatch = attrsStr.match(/role=["']([^"']+)["']/i);
            if (roleMatch) child.setAttribute("role", roleMatch[1]);

            if (inner) {
                if (inner.includes("<")) {
                    child.innerHTML = inner;
                } else {
                    child.textContent = inner;
                }
            }
            this.children.push(child);
        }
    }

    querySelector(selector) {
        const matches = this.querySelectorAll(selector);
        return matches.length > 0 ? matches[0] : null;
    }

    querySelectorAll(selector) {
        const results = [];
        const match = (el) => {
            if (selector.startsWith(".")) {
                const requiredClasses = selector.split(".").filter(Boolean);
                if (requiredClasses.every(cls => {
                    const pure = cls.split("[")[0];
                    return el._classList.has(pure);
                })) {
                    results.push(el);
                }
            } else if (selector.startsWith("#")) {
                if (el.id === selector.slice(1)) results.push(el);
            } else if (el.tagName.toLowerCase() === selector.toLowerCase()) {
                results.push(el);
            }
        };

        const traverse = (el) => {
            for (const child of el.children) {
                match(child);
                traverse(child);
            }
        };

        traverse(this);
        return results;
    }
}

async function runTests() {
    console.log("=== Testing Continuous File Editing Badges & Live Diff Ticker ===");

    global.document = {
        createElement: (tag) => new MockElement(tag),
        getElementById: (id) => (id === "chat" ? chatEl : null)
    };

    const chatEl = new MockElement("div");
    chatEl.id = "chat";

    const badgesModule = await import("../client/src/components/chat-tool-badges.js");
    const { addToolBadge, finalizeFileEditBadges } = badgesModule;
    const { onToolComplete } = await import("../client/src/tools/badge-sync.js");

    // Create AI message shell
    const aiMessage = new MockElement("div");
    aiMessage.className = "message ai";
    const wrapper = new MockElement("div");
    wrapper.className = "activity-wrapper";
    const searchContainer = new MockElement("div");
    searchContainer.className = "search-items-container";
    wrapper.appendChild(searchContainer);
    aiMessage.appendChild(wrapper);
    chatEl.appendChild(aiMessage);

    const targetFile = "src/components/button.js";

    // 1. First edit on targetFile
    console.log("Step 1: First edit badge creation");
    const badge1 = addToolBadge(aiMessage, "replace_file_content", {
        path: targetFile,
        target_content: "const a = 1;",
        replacement_content: "const a = 2;\nconst b = 3;"
    });

    assert(badge1, "Badge must be returned");
    assert(badge1.classList.contains("file-edit-badge"), "Badge must have file-edit-badge class");
    assert(badge1.classList.contains("is-editing"), "Badge must have is-editing class during edit");
    assert.strictEqual(badge1.dataset.editFile, targetFile, "Badge must store target file in dataset.editFile");
    assert.strictEqual(badge1.querySelector(".search-label").textContent, "Editing", "Label must be 'Editing'");
    assert.strictEqual(badge1.querySelector(".badge-edit-count").textContent, "(1 edit)", "Edit count must show (1 edit)");

    // Complete edit 1
    onToolComplete("replace_file_content", { path: targetFile }, badge1, {
        path: targetFile,
        lines_added: 5,
        lines_removed: 2,
        diff: "--- a/file\n+++ b/file\n@@ -1,2 +1,5 @@\n-old\n+new"
    });

    const stats1 = badge1.querySelector(".badge-diff-stats");
    assert(stats1, "Diff stats container must exist");
    assert.strictEqual(badge1._totalAdded, 5, "_totalAdded must be 5");
    assert.strictEqual(badge1._totalRemoved, 2, "_totalRemoved must be 2");
    assert.strictEqual(badge1._editSteps.length, 1, "Must have 1 step tracked");

    // 2. Second edit on the SAME targetFile
    console.log("Step 2: Second continuous edit on same file (badge reuse & increment)");
    const badge2 = addToolBadge(aiMessage, "replace_file_content", {
        path: targetFile,
        instruction: "Add click handler"
    });

    assert.strictEqual(badge2, badge1, "Badge must be reused in-place, not duplicated");
    assert.strictEqual(searchContainer.querySelectorAll(".file-edit-badge").length, 1, "There must only be 1 badge in container");
    assert.strictEqual(badge2.querySelector(".search-label").textContent, "Editing", "Label must remain 'Editing'");
    assert.strictEqual(badge2.querySelector(".badge-edit-count").textContent, "(2 edits)", "Edit count must update to (2 edits)");

    // Complete edit 2
    onToolComplete("replace_file_content", { path: targetFile, instruction: "Add click handler" }, badge2, {
        path: targetFile,
        lines_added: 8,
        lines_removed: 1,
        diff: "@@ -10,1 +10,8 @@\n-old click\n+new click"
    });

    assert.strictEqual(badge2._totalAdded, 13, "_totalAdded must accumulate to 13 (5 + 8)");
    assert.strictEqual(badge2._totalRemoved, 3, "_totalRemoved must accumulate to 3 (2 + 1)");
    assert.strictEqual(badge2._editSteps.length, 2, "Must have 2 steps tracked");

    // Verify breakdown timeline in collapse inner
    const collapseInner = badge2._collapseDiv.querySelector(".badge-collapse-inner");
    assert(collapseInner, "Collapse inner element must exist");
    assert(collapseInner.innerHTML.includes("Modified across 2 edits"), "Summary header must mention 2 edits");
    assert(collapseInner.innerHTML.includes("#1"), "Timeline must contain step #1");
    assert(collapseInner.innerHTML.includes("#2"), "Timeline must contain step #2");
    assert(collapseInner.innerHTML.includes("+13"), "Must show accumulated +13 in diff");
    assert(collapseInner.innerHTML.includes("-3"), "Must show accumulated -3 in diff");

    // 3. Third continuous edit on same file
    console.log("Step 3: Third continuous edit (further accumulation)");
    const badge3 = addToolBadge(aiMessage, "replace_file_content", {
        path: targetFile,
        description: "Fix border radius"
    });

    assert.strictEqual(badge3, badge1, "Must reuse same badge for 3rd edit");
    assert.strictEqual(badge3.querySelector(".badge-edit-count").textContent, "(3 edits)", "Edit count must be (3 edits)");

    onToolComplete("replace_file_content", { path: targetFile, description: "Fix border radius" }, badge3, {
        path: targetFile,
        lines_added: 4,
        lines_removed: 0,
        diff: "@@ -20,0 +20,4 @@\n+border-radius: 4px;"
    });

    assert.strictEqual(badge3._totalAdded, 17, "_totalAdded must accumulate to 17 (13 + 4)");
    assert.strictEqual(badge3._totalRemoved, 3, "_totalRemoved must remain 3 (3 + 0)");
    assert.strictEqual(badge3._editSteps.length, 3, "Must have 3 steps tracked");

    // 4. Finalize edits (e.g. model finished generation turn)
    console.log("Step 4: Finalizing badges on turn finish");
    finalizeFileEditBadges(aiMessage);

    assert(!badge1.classList.contains("is-editing"), "is-editing class must be removed after finalization");
    assert.strictEqual(badge1.querySelector(".search-label").textContent, "Multi-edited file", "Label must transition to 'Multi-edited file'");
    assert.strictEqual(badge1.querySelector(".badge-edit-count").textContent, "(3 edits)", "Edit count must persist after finalization");
    assert.strictEqual(badge1._totalAdded, 17, "Cumulative +17 must persist after finalization");
    assert.strictEqual(badge1._totalRemoved, 3, "Cumulative -3 must persist after finalization");

    // 5. Distinct file badge isolation test
    console.log("Step 5: Separate file gets separate badge");
    const otherFile = "src/utils/helpers.js";
    const otherBadge = addToolBadge(aiMessage, "replace_file_content", { path: otherFile });
    assert.notStrictEqual(otherBadge, badge1, "Different file must get its own distinct badge");
    assert.strictEqual(searchContainer.querySelectorAll(".file-edit-badge").length, 2, "There must now be 2 badges in container");

    finalizeFileEditBadges(aiMessage);
    assert.strictEqual(otherBadge.querySelector(".search-label").textContent, "Edited file", "Single edit file gets 'Edited file'");

    console.log("✓ ALL CONTINUOUS EDIT BADGE TESTS PASSED!");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
