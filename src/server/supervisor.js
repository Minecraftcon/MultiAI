/**
 * MultiAI Supervisor & Signal Lifecycle
 * =====================================
 * Handles graceful process termination and signal trapping for Node.js.
 */

let isShuttingDown = false;

function cleanupAndExit(exitCode = 0) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("[PROCESS] Cleaning up MultiAI process...");
    process.exit(exitCode);
}

function initSupervisor() {
    process.on("SIGINT", () => {
        console.log("\n[PROCESS] Received SIGINT (Ctrl+C). Cleaning up...");
        cleanupAndExit(0);
    });

    process.on("SIGTERM", () => {
        console.log("\n[PROCESS] Received SIGTERM. Cleaning up...");
        cleanupAndExit(0);
    });

    process.on("uncaughtException", (err) => {
        console.error("[PROCESS] Uncaught exception:", err);
        cleanupAndExit(1);
    });
}

module.exports = {
    initSupervisor,
    cleanupAndExit
};
