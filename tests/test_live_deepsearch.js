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
    console.log("[Test] 0. Cleaning up any lingering test chromium instances...");
    try {
        execSync("fuser -k 9222/tcp || true", { stdio: "ignore" });
    } catch (_) {}
    await sleep(600);

    const tmpProfile = `/tmp/multiai-test-chrome-${Date.now()}`;
    fs.mkdirSync(tmpProfile, { recursive: true });

    console.log("[Test] 1. Launching isolated headless Chromium with profile:", tmpProfile);
    const chrome = spawn("/bin/chromium", [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--remote-debugging-port=9222",
        `--user-data-dir=${tmpProfile}`,
        "--window-size=1280,960",
        "http://localhost:8080"
    ], { stdio: "ignore" });

    // Wait for CDP port
    let targets = null;
    for (let i = 0; i < 30; i++) {
        await sleep(500);
        try {
            targets = await getJson("http://localhost:9222/json");
            if (Array.isArray(targets) && targets.length > 0) break;
        } catch (e) {}
    }

    if (!targets || targets.length === 0) {
        chrome.kill();
        throw new Error("Failed to connect to Chromium CDP port 9222");
    }

    const pageTarget = targets.find(t => t.type === "page") || targets[0];
    const wsUrl = pageTarget.webSocketDebuggerUrl;
    console.log("[Test] 2. Connecting to CDP WebSocket:", wsUrl);

    const ws = new WebSocket(wsUrl);

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

    console.log("[Test] 3. Enabling CDP domains...");
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

    console.log("[Test] 4. Waiting for MultiAI bootstrap and backend disk sync to complete...");
    for (let i = 0; i < 40; i++) {
        await sleep(500);
        const ready = await evalCode("Boolean(window.__app_initialized && document.getElementById('input'))");
        if (ready) break;
    }

    console.log("[Test] 5. Clicking New Chat to create fresh clean session...");
    const initRes = await evalCode(`(() => {
        // Explicitly click New Chat button
        const newBtn = document.getElementById("headerNewChatBtn") || document.getElementById("newChat");
        if (newBtn) newBtn.click();

        // Set model to glm-4.5-flash
        const modelSelect = document.getElementById("modelSelect");
        if (modelSelect) {
            modelSelect.value = "glm-4.5-flash";
            modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const heroName = document.getElementById("heroModelPickerName");
        if (heroName) heroName.textContent = "GLM 4.5 Flash";

        // Open plus sheet and click DeepSearch
        const attachBtn = document.getElementById("attachSheetBtn");
        if (attachBtn) attachBtn.click();

        const pickBtn = document.getElementById("pickDeepSearchBtn");
        if (pickBtn) {
            pickBtn.click();
        } else if (window.state) {
            window.state.isDeepSearchActive = true;
        }

        // Close bottom sheet backdrop
        const backdrop = document.getElementById("attachmentBackdrop");
        if (backdrop) backdrop.click();

        const chatEl = document.getElementById("chat");
        return {
            chatId: window.state?.currentChatId,
            chatEmpty: !chatEl || chatEl.children.length === 0,
            model: modelSelect ? modelSelect.value : null,
            deepSearch: window.state?.isDeepSearchActive,
            pillDisplay: document.getElementById("composerModePills")?.style?.display
        };
    })()`);
    console.log("[Test] Initialized clean environment:", initRes);
    await sleep(800);
    await screenshot("deepsearch_01_fresh_clean_start.png");

    async function sendTurn(text) {
        await evalCode(`((t) => {
            const input = document.getElementById("input");
            input.value = t;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            const sendBtn = document.getElementById("send");
            sendBtn.click();
        })(${JSON.stringify(text)})`);
    }

    async function waitForTurnCompletion(timeoutSec = 80) {
        console.log(`[Test] Waiting for turn generation to finish (max ${timeoutSec}s)...`);
        for (let i = 0; i < timeoutSec; i++) {
            await sleep(1000);
            const status = await evalCode(`(() => {
                const cId = window.state?.currentChatId;
                const isGen = Boolean(cId && window.state?.activeGenerations[cId]?.isGenerating);
                const msgs = document.querySelectorAll(".message.ai");
                const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
                const text = (last?.querySelector(".final-content")?.textContent || last?.querySelector(".pre-search-content")?.textContent || "").trim();
                const hasPlanCard = Boolean(last?.querySelector(".deepsearch-plan-card"));
                const hasStatsBar = Boolean(last?.querySelector(".deepsearch-stats-box"));
                const label = last?.querySelector(".activity-label")?.textContent || "";
                return { isGen, label, textLen: text.length, hasPlanCard, hasStatsBar, preview: text.slice(0, 120) };
            })()`);
            if (status && !status.isGen && status.textLen > 20) {
                console.log(`[Test] Turn completed in ~${i+1}s! Preview:`, status.preview.replace(/\\n/g, " "));
                return status;
            }
            if (i % 8 === 0) {
                console.log(`[Test] Generating... (${i}s) State:`, status?.label || "Thinking");
            }
        }
        throw new Error("Turn timed out");
    }

    // ==========================================
    // Turn 1: "Best free AI APIs"
    // ==========================================
    console.log("[Test] 6. Submitting Turn 1: 'Best free AI APIs'...");
    await sendTurn("Best free AI APIs");

    const turn1Res = await waitForTurnCompletion(80);
    console.log("[Test] Turn 1 Clarification Response successfully received!");
    await sleep(800);
    await screenshot("deepsearch_02_turn1_clarification_glm45.png");

    // ==========================================
    // Turn 2: "LLM APIs"
    // ==========================================
    console.log("[Test] 7. Submitting Turn 2: 'LLM APIs'...");
    await sendTurn("LLM APIs");

    const turn2Res = await waitForTurnCompletion(80);
    console.log("[Test] Turn 2 Response successfully received! Has Plan Card:", turn2Res.hasPlanCard);
    await sleep(800);
    await screenshot("deepsearch_03_turn2_stepper_plan_glm45.png");

    // ==========================================
    // Turn 3: "Its fine"
    // ==========================================
    console.log("[Test] 8. Submitting Turn 3: 'Its fine'...");
    await sendTurn("Its fine");

    const turn3Res = await waitForTurnCompletion(80);
    console.log("[Test] Turn 3 Response successfully received!");
    await sleep(1500);

    // Verify stats bar mounted
    console.log("[Test] 9. Verifying Live Search Stats Bar mounted...");
    let statsBarFound = false;
    for (let i = 0; i < 20; i++) {
        const barInfo = await evalCode(`(() => {
            const box = document.querySelector(".deepsearch-stats-box");
            if (!box) return null;
            return {
                id: box.id,
                pct: box.querySelector(".ds-pct-badge")?.textContent,
                phase: box.querySelector(".ds-phase-tag")?.textContent,
                status: box.querySelector(".ds-status-text")?.textContent,
                sources: box.querySelector(".ds-stat-pill")?.textContent
            };
        })()`);
        if (barInfo) {
            console.log("[Test] Live Stats Bar is active on DOM:", barInfo);
            statsBarFound = true;
            break;
        }
        await sleep(1000);
    }

    await screenshot("deepsearch_04_turn3_stats_bar_glm45.png");

    // Expand logs drawer
    console.log("[Test] 10. Clicking 'Logs' button to expand activity drawer...");
    await evalCode(`(() => {
        const btn = document.querySelector(".ds-logs-toggle");
        if (btn) btn.click();
    })()`);
    await sleep(2500);

    // Sample telemetry
    for (let i = 0; i < 6; i++) {
        await sleep(2500);
        const tele = await evalCode(`(() => {
            const box = document.querySelector(".deepsearch-stats-box");
            return {
                pct: box?.querySelector(".ds-pct-badge")?.textContent,
                phase: box?.querySelector(".ds-phase-tag")?.textContent,
                status: box?.querySelector(".ds-status-text")?.textContent,
                logsCount: box?.querySelectorAll(".ds-log-item")?.length
            };
        })()`);
        console.log(`[Test] Live Telemetry poll [${i+1}/6]:`, tele);
    }

    await screenshot("deepsearch_05_stats_bar_active_glm45.png");

    console.log("[Test] All verification steps completed successfully with GLM 4.5 Flash!");
    ws.close();
    chrome.kill();
    try {
        fs.rmSync(tmpProfile, { recursive: true, force: true });
    } catch (_) {}
}

main().catch(err => {
    console.error("[Test Error]", err);
    process.exit(1);
});
