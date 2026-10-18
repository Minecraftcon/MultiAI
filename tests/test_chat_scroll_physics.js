const assert = require("assert");

async function runTests() {
    console.log("=== Running Unit Tests for Chat Scroll Smooth Pull & Detachment ===");

    // Mock browser environment for Node.js
    const listeners = {};
    const chatElement = {
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 600, // At bottom (1000 - 400 = 600)
        addEventListener: (event, handler) => {
            listeners[event] = listeners[event] || [];
            listeners[event].push(handler);
        },
        dispatchEvent: (event) => {
            (listeners[event.type] || []).forEach(cb => cb(event));
        },
        contains: () => true,
        appendChild: () => {},
        clientWidth: 800
    };

    const classSet = new Set();
    const btnElement = {
        style: {},
        classList: {
            add: (...classes) => classes.forEach(cls => classSet.add(cls)),
            remove: (...classes) => classes.forEach(cls => classSet.delete(cls)),
            contains: (cls) => classSet.has(cls)
        },
        addEventListener: () => {}
    };

    global.document = {
        getElementById: (id) => {
            if (id === "chat") return chatElement;
            if (id === "scrollToBottomBtn") return btnElement;
            if (id === "appShell") return { classList: { contains: () => false } };
            return null;
        },
        createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, className: "", id: "", querySelectorAll: () => [] }),
        querySelectorAll: () => [],
        addEventListener: () => {}
    };

    let rafCallbacks = [];
    global.requestAnimationFrame = (cb) => {
        const id = rafCallbacks.length + 1;
        rafCallbacks.push({ id, cb });
        return id;
    };
    global.cancelAnimationFrame = (id) => {
        rafCallbacks = rafCallbacks.filter(item => item.id !== id);
    };
    global.performance = {
        now: () => Date.now()
    };

    // Dynamically import chat-scroll.js
    const scrollModule = await import("../client/src/components/chat-scroll.js");
    const { 
        getIsUserDetached, 
        detachUserScroll, 
        reengageUserScroll, 
        requestScrollToBottom, 
        forceReengageAutoScroll,
        smoothPullToBottom 
    } = scrollModule;

    // Test 1: Initial state
    console.log("Test 1: Initial state");
    assert.strictEqual(getIsUserDetached(), false, "Should initially not be detached");

    // Test 2: Detach when inspecting above
    console.log("Test 2: Detachment");
    detachUserScroll();
    assert.strictEqual(getIsUserDetached(), true, "Should be detached after detachUserScroll");

    // Test 3: Content expansion while detached must NOT move scrollTop
    console.log("Test 3: Content expansion while detached");
    chatElement.scrollHeight = 1400; // New tokens or tool badge arrived
    chatElement.scrollTop = 200;    // User is inspecting at top
    requestScrollToBottom(chatElement);

    assert.strictEqual(chatElement.scrollTop, 200, "Scroll position must NOT move when detached");
    assert.strictEqual(btnElement.classList.contains("has-unread"), true, "Button should flag has-unread");
    assert.strictEqual(btnElement.classList.contains("visible"), true, "Button should be visible");

    // Test 4: Re-engagement
    console.log("Test 4: Re-engagement");
    reengageUserScroll();
    assert.strictEqual(getIsUserDetached(), false, "Should no longer be detached");
    assert.strictEqual(btnElement.classList.contains("has-unread"), false, "has-unread should be cleared");

    // Test 5: Smooth pull animation progression
    console.log("Test 5: Smooth pull physics loop");
    chatElement.scrollTop = 700;
    chatElement.scrollHeight = 1200; // maxScroll = 1200 - 400 = 800
    rafCallbacks = [];
    smoothPullToBottom(chatElement);

    assert(rafCallbacks.length > 0, "requestAnimationFrame should be scheduled for smooth pull");
    const nextTick = rafCallbacks.shift();
    nextTick.cb(performance.now() + 16);

    assert(chatElement.scrollTop > 700, "chat.scrollTop should smoothly advance forward");
    assert(chatElement.scrollTop <= 800, "chat.scrollTop should not overshoot maxScroll");
    console.log(`  Smoothly pulled from 700 -> ${chatElement.scrollTop.toFixed(2)} towards 800`);

    // Test 6: Force re-engage (user sends message)
    console.log("Test 6: Force re-engage on user action");
    detachUserScroll();
    assert.strictEqual(getIsUserDetached(), true);
    forceReengageAutoScroll(chatElement);
    assert.strictEqual(getIsUserDetached(), false, "forceReengageAutoScroll must clear detachment");

    console.log("✓ ALL CHAT SCROLL PHYSICS & DETACHMENT TESTS PASSED!");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
