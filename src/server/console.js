/**
 * MultiAI Server-Side Interactive Console (Node.js fallback)
 * Provides interactive commands when running directly via `node src/index.js` or `npm start`.
 */

const readline = require("readline");
const { execSync } = require("child_process");
const { cleanupAndExit } = require("./supervisor");

function initConsole({ port = 8080, host = "localhost" } = {}) {
    // If supervised by start.py, let Python supervisor handle the terminal console
    if (process.env.MULTIAI_SUPERVISED) {
        return;
    }
    // If not an interactive TTY, do not attach readline
    if (!process.stdin || !process.stdin.isTTY) {
        return;
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "multiai> "
    });

    const startTime = Date.now();
    const repoRoot = process.env.MULTIAI_REPO_DIR || process.cwd();

    function printHelp() {
        console.log("\nMultiAI Server Console Commands:");
        console.log("  stop | exit | quit  - Stop server and exit cleanly");
        console.log("  restart | reload    - Restart server");
        console.log("  pull                - Fetch latest git updates and reload if updated");
        console.log("  status | info       - Show server status, port, PID, and uptime");
        console.log("  clear | cls         - Clear terminal screen");
        console.log("  help | ?            - Show this help message\n");
    }

    function printStatus() {
        const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
        const hrs = Math.floor(uptimeSec / 3600);
        const mins = Math.floor((uptimeSec % 3600) / 60);
        const secs = uptimeSec % 60;
        const uptimeStr = hrs > 0 ? `${hrs}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;

        let branch = "unknown";
        let commit = "unknown";
        try {
            branch = execSync("git branch --show-current", { cwd: repoRoot, encoding: "utf8" }).trim();
            commit = execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
        } catch (_) {}

        console.log("\n=== MultiAI Server Status ===");
        console.log(`  State:        Running`);
        console.log(`  Web URL:      http://${host}:${port}`);
        console.log(`  Uptime:       ${uptimeStr}`);
        console.log(`  Git Branch:   ${branch} (${commit})`);
        console.log(`  PID:          ${process.pid}`);
        console.log(`  Memory:       ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB / ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);
        console.log("=============================\n");
    }

    function doPull() {
        console.log("[MultiAI] Fetching latest changes from git...");
        try {
            const out = execSync("git pull", { cwd: repoRoot, encoding: "utf8" }).trim();
            console.log(out);
            if (!out.includes("Already up to date.")) {
                console.log("[MultiAI] Updates pulled successfully. Exiting for restart...");
                cleanupAndExit(0);
            }
        } catch (err) {
            console.error(`[MultiAI ERROR] Git pull failed: ${err.message}`);
        }
    }

    rl.on("line", (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }

        const [cmd, ...rest] = input.split(/\s+/);
        const command = cmd.toLowerCase();

        switch (command) {
            case "stop":
            case "exit":
            case "quit":
            case "q":
                console.log("[MultiAI] Stopping server...");
                rl.close();
                cleanupAndExit(0);
                break;

            case "restart":
            case "reload":
            case "r":
                console.log("[MultiAI] Restarting server...");
                rl.close();
                cleanupAndExit(0);
                break;

            case "pull":
            case "update":
                doPull();
                rl.prompt();
                break;

            case "status":
            case "info":
            case "st":
                printStatus();
                rl.prompt();
                break;

            case "clear":
            case "cls":
                console.clear();
                rl.prompt();
                break;

            case "help":
            case "?":
            case "h":
                printHelp();
                rl.prompt();
                break;

            default:
                console.log(`Unknown command: '${command}'. Type 'help' for commands.`);
                rl.prompt();
                break;
        }
    });

    console.log(`\nServer Console ready. Type 'help' for commands (stop, restart, pull, status).\n`);
    rl.prompt();
}

module.exports = { initConsole };
