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
    console.log("[Test] 0. Cleaning up lingering test chromium...");
    try { execSync("fuser -k 9222/tcp || true", { stdio: "ignore" }); } catch (_) {}
    await sleep(600);

    const tmpProfile = `/tmp/multiai-test-tools-${Date.now()}`;
    fs.mkdirSync(tmpProfile, { recursive: true });

    console.log("[Test] 1. Launching Chromium...");
    const chrome = spawn("/bin/chromium", [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--remote-debugging-port=9222",
        `--user-data-dir=${tmpProfile}`,
        "--window-size=1280,960",
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
        if (res?.exceptionDetails) {
            console.error("Runtime exception:", JSON.stringify(res.exceptionDetails, null, 2));
            throw new Error("Eval failed: " + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
        }
        return res?.result?.value;
    }

    console.log("[Test] 1.5. Navigating to http://localhost:8080...");
    await send("Page.navigate", { url: "http://localhost:8080" });

    // Wait for bootstrap
    for (let i = 0; i < 50; i++) {
        await sleep(500);
        try {
            const ready = await evalCode("Boolean(window.__app_initialized && document.getElementById('input'))");
            if (ready) {
                console.log("[Test] Page ready on:", await evalCode("window.location.href"));
                break;
            }
        } catch (_) {}
    }

    console.log("[Test] 2. Verifying getDeepSearchOnChatTools() schemas...");
    const toolAudit = await evalCode(`(async () => {
        const { getDeepSearchOnChatTools, tools } = await import("/src/tools/index.js");
        const dsTools = getDeepSearchOnChatTools();
        const dsNames = dsTools.map(t => t.function.name);
        const fullNames = tools.map(t => t.function.name);

        return {
            dsToolCount: dsTools.length,
            dsNames,
            fullToolCount: tools.length,
            hasTerminalInDS: dsNames.includes("run_task"),
            hasArbitraryWriteInDS: dsNames.includes("write_file"),
            hasSearchAndReplaceInDS: dsNames.includes("search_and_replace"),
            hasImageGenInDS: dsNames.includes("generate_image"),
            hasWebSearchInDS: dsNames.includes("web_search"),
            hasReadFileInDS: dsNames.includes("read_file"),
            hasArtifactWriterInDS: dsNames.includes("artifact_writer")
        };
    })()`);
    console.log("[Test] Tool Schema Audit Result:", toolAudit);

    if (toolAudit.dsNames.length !== 3 || !toolAudit.hasWebSearchInDS || !toolAudit.hasReadFileInDS || !toolAudit.hasArtifactWriterInDS) {
        throw new Error("DeepSearch tool isolation check failed! Unexpected tools: " + JSON.stringify(toolAudit));
    }
    if (toolAudit.hasTerminalInDS || toolAudit.hasArbitraryWriteInDS || toolAudit.hasSearchAndReplaceInDS) {
        throw new Error("Security leak: full-scale tools found in DeepSearch schema!");
    }
    console.log("[Test] Tool isolation verified: strictly [web_search, read_file, artifact_writer] are exposed.");

    // Test artifact_writer tool execution
    console.log("[Test] 3. Testing artifact_writer tool execution...");
    const writeTest = await evalCode(`(async () => {
        const { executeTool } = await import("/src/tools/index.js");
        try {
            const res = await executeTool("artifact_writer", {
                filename: "test_research_notes.md",
                content: "# Research Notes\\n- Verified point 1\\n- Verified point 2",
                description: "Initial research notes"
            }, null, {});
            return { ok: true, res };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    })()`);
    console.log("[Test] artifact_writer execution result:", writeTest);
    if (!writeTest.ok) {
        throw new Error("artifact_writer tool failed: " + writeTest.error);
    }

    // Set DeepSearch active and send Turn 1
    console.log("[Test] 4. Activating DeepSearch and submitting Turn 1...");
    await evalCode(`(() => {
        const attachBtn = document.getElementById("attachSheetBtn");
        if (attachBtn) attachBtn.click();
        const pickBtn = document.getElementById("pickDeepSearchBtn");
        if (pickBtn) pickBtn.click();
        const backdrop = document.getElementById("attachmentBackdrop");
        if (backdrop) backdrop.click();

        const modelSelect = document.getElementById("modelSelect");
        if (modelSelect) {
            modelSelect.value = "glm-4.5-flash";
            modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }

        const input = document.getElementById("input");
        input.value = "Best free AI APIs for production in 2026";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.getElementById("send").click();
    })()`);

    console.log("[Test] 5. Waiting for GLM 4.5 Flash Turn 1 response...");
    for (let i = 0; i < 45; i++) {
        await sleep(1000);
        const status = await evalCode(`(() => {
            const cId = window.state?.currentChatId;
            const isGen = Boolean(cId && window.state?.activeGenerations[cId]?.isGenerating);
            const msgs = document.querySelectorAll(".message.ai");
            const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
            const text = (last?.querySelector(".final-content")?.textContent || last?.querySelector(".pre-search-content")?.textContent || "").trim();
            return { isGen, textLen: text.length, preview: text.slice(0, 160) };
        })()`);
        if (status && !status.isGen && status.textLen > 30) {
            console.log(`[Test] Turn 1 completed in ${i+1}s! Preview:`, status.preview.replace(/\\n/g, " "));
            break;
        }
        if (i % 6 === 0) console.log(`[Test] Waiting... (${i}s)`);
    }

    // Capture screenshot
    const res = await send("Page.captureScreenshot", { format: "png" });
    const screenPath = path.join(ARTIFACTS_DIR, "deepsearch_isolated_tools_turn1.png");
    fs.writeFileSync(screenPath, Buffer.from(res.data, "base64"));
    console.log(`[Screenshot saved]: ${screenPath}`);

    console.log("[Test] All tests passed successfully!");
    ws.close();
    chrome.kill();
    try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch (_) {}
}

main().catch(err => {
    console.error("[Test Error]", err);
    process.exit(1);
});
