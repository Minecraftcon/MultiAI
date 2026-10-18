const http = require("http");
const fs = require("fs");
const path = require("path");
const { getTaskDaemonEngine, startPythonTaskServer, cleanupAndExit } = require("../src/server/supervisor");
const { getTaskServerTarget } = require("../src/core/sandbox_manager");

function queryHealth(target, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        const options = {
            ...target,
            path: "/health",
            method: "GET",
            timeout: timeoutMs
        };
        const req = http.request(options, (res) => {
            let data = "";
            res.on("data", chunk => { data += chunk; });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ raw: data });
                }
            });
        });
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Timeout querying /health"));
        });
        req.end();
    });
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testResolution() {
    console.log("=== Testing Engine Resolution Logic ===");
    delete process.env.MULTIAI_TASK_DAEMON;

    const defaultEngine = getTaskDaemonEngine();
    console.log("Default engine:", defaultEngine);
    if (defaultEngine !== "python") {
        throw new Error(`Expected default engine to be python, got ${defaultEngine}`);
    }

    process.env.MULTIAI_TASK_DAEMON = "go";
    const goEngine = getTaskDaemonEngine();
    console.log("With MULTIAI_TASK_DAEMON=go:", goEngine);
    if (goEngine !== "go") {
        throw new Error(`Expected engine to be go, got ${goEngine}`);
    }

    process.env.MULTIAI_TASK_DAEMON = "python";
    const pyEngine = getTaskDaemonEngine();
    console.log("With MULTIAI_TASK_DAEMON=python:", pyEngine);
    if (pyEngine !== "python") {
        throw new Error(`Expected engine to be python, got ${pyEngine}`);
    }

    console.log("✓ Engine resolution tests passed!");
}

async function main() {
    try {
        await testResolution();
        console.log("✓ ALL DAEMON SWITCH TESTS PASSED!");
        process.exit(0);
    } catch (err) {
        console.error("Test failed:", err);
        process.exit(1);
    }
}

main();
