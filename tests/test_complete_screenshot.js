const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ARTIFACTS_DIR = "/home/shado/.gemini/antigravity-ide/brain/14ed73ac-4121-4843-961d-2ecf22abfa71";

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getJson(url) {
    const res = await fetch(url);
    return await res.json();
}

async function main() {
    console.log("[Capture] 0. Cleaning up lingering test chromium...");
    try { execSync("fuser -k 9222/tcp || true", { stdio: "ignore" }); } catch (_) {}
    await sleep(600);

    const tmpProfile = `/tmp/multiai-test-chrome-view-${Date.now()}`;
    fs.mkdirSync(tmpProfile, { recursive: true });

    console.log("[Capture] 1. Launching Chromium to capture completed 100% DeepSearch view...");
    const chrome = spawn("/bin/chromium", [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--remote-debugging-port=9222",
        `--user-data-dir=${tmpProfile}`,
        "--window-size=1280,1000",
        "http://localhost:8080"
    ], { stdio: "ignore" });

    let targets = null;
    for (let i = 0; i < 30; i++) {
        await sleep(500);
        try {
            targets = await getJson("http://localhost:9222/json");
            if (Array.isArray(targets) && targets.length > 0) break;
        } catch (e) {}
    }

    const pageTarget = targets.find(t => t.type === "page") || targets[0];
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

    let id = 1;
    const callbacks = new Map();
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.id && callbacks.has(data.id)) {
                const cb = callbacks.get(data.id);
                callbacks.delete(data.id);
                cb(data);
            }
        } catch (e) {}
    };

    function send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const msgId = id++;
            callbacks.set(msgId, (res) => {
                if (res.error) reject(new Error(res.error.message || JSON.stringify(res.error)));
                else resolve(res.result);
            });
            ws.send(JSON.stringify({ id: msgId, method, params }));
        });
    }

    await new Promise((resolve) => {
        if (ws.readyState === WebSocket.OPEN) resolve();
        else ws.onopen = resolve;
    });

    await send("Page.enable");
    await send("Runtime.enable");

    async function evalCode(expression) {
        const res = await send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true
        });
        return res?.result?.value;
    }

    async function screenshot(filename) {
        const res = await send("Page.captureScreenshot", { format: "png" });
        const filePath = path.join(ARTIFACTS_DIR, filename);
        fs.writeFileSync(filePath, Buffer.from(res.data, "base64"));
        console.log(`[Screenshot saved]: ${filePath}`);
        return filePath;
    }

    // Wait for bootstrap and backend disk sync
    for (let i = 0; i < 40; i++) {
        await sleep(500);
        const ready = await evalCode("Boolean(window.__app_initialized && document.querySelector('.chat-item'))");
        if (ready) break;
    }
    await sleep(1500);

    // Click the recent chat
    console.log("[Capture] Clicking the completed DeepSearch chat...");
    const switched = await evalCode(`(() => {
        const item = document.querySelector('.chat-item[data-chat-id="chat_1790011154670_ui0zl"]') || document.querySelector('.chat-item');
        if (item) {
            item.click();
            return { clicked: true, id: item.dataset.chatId };
        }
        return { clicked: false };
    })()`);
    console.log("[Capture] Switched to chat:", switched);
    await sleep(2500);

    // Scroll chat to bottom
    await evalCode(`(() => {
        const chat = document.getElementById("chat");
        if (chat) chat.scrollTop = chat.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
    })()`);
    await sleep(800);

    // Verify stats box state
    const info = await evalCode(`(() => {
        const box = document.querySelector(".deepsearch-stats-box");
        return {
            found: Boolean(box),
            pct: box?.querySelector(".ds-pct-badge")?.textContent,
            phase: box?.querySelector(".ds-phase-tag")?.textContent,
            status: box?.querySelector(".ds-status-text")?.textContent,
            hasReportBtn: Boolean(box?.querySelector(".ds-view-report-btn"))
        };
    })()`);
    console.log("[Capture] Stats box state on load:", info);

    await screenshot("deepsearch_06_100pct_complete_stats_bar.png");

    // Click "Open Final Report" button
    console.log("[Capture] Clicking 'Open Final Report'...");
    const clicked = await evalCode(`(() => {
        const btn = document.querySelector(".ds-view-report-btn");
        if (btn) {
            btn.click();
            return true;
        }
        return false;
    })()`);
    console.log("[Capture] Clicked Open Final Report:", clicked);
    
    // Wait for report content to load and render
    for (let i = 0; i < 20; i++) {
        await sleep(500);
        const reportLoaded = await evalCode(`Boolean(document.querySelector(".ds-report-view-container[style*='display: block'] .ds-report-content") || document.querySelector(".ds-report-content"))`);
        if (reportLoaded) {
            console.log("[Capture] Final Report rendered inline in chat!");
            break;
        }
    }
    await evalCode(`(() => {
        const chat = document.getElementById("chat");
        if (chat) chat.scrollTop = chat.scrollHeight;
    })()`);
    await sleep(800);

    await screenshot("deepsearch_07_final_report_inline_viewer.png");

    console.log("[Capture] Finished capturing completed report screenshots!");
    ws.close();
    chrome.kill();
    try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch (_) {}
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
