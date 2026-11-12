/**
 * Code Grep & Python Execution Fallback
 * =====================================
 * Implements code grep and python execution handlers directly in Node.js.
 */

const { spawn } = require("child_process");
const { handleCodeGrep } = require("../tools/filesystem/code_tools");
const { resolveSafePath } = require("./utils");

/**
 * Execute Python code via python3/python subprocess if python is present,
 * or return an informative message if Python is not installed.
 */
function executePythonCode({ code, timeout = 30, cwd = null, scratchDir = null, artifactsDir = null }) {
    return new Promise((resolve) => {
        if (!code || !code.trim()) {
            return resolve({
                success: false,
                stdout: "",
                stderr: "Error: Provided Python code snippet is empty.",
                return_value: null,
                exit_code: 1,
                elapsed_seconds: 0.0
            });
        }

        const rawCode = String(code || "").trim();
        const timeoutSec = Math.min(300, Math.max(1, parseInt(timeout, 10) || 30));
        const targetCwd = cwd || scratchDir || process.cwd();

        const env = { ...process.env };
        env.PYTHONUNBUFFERED = "1";
        if (scratchDir) {
            env.SCRATCH = scratchDir;
            env.SCRATCH_DIR = scratchDir;
        }
        if (artifactsDir) {
            env.ARTIFACTS = artifactsDir;
            env.ARTIFACTS_DIR = artifactsDir;
        }

        const runnerScript = `
import sys
import ast
import traceback

raw_code = ${JSON.stringify(rawCode)}

try:
    parsed = ast.parse(raw_code)
    last_expr = None
    if parsed.body and isinstance(parsed.body[-1], ast.Expr):
        last_expr = parsed.body.pop()
    
    global_scope = {"__name__": "__main__"}
    exec(compile(parsed, "<multi_ai_exec>", "exec"), global_scope)
    
    if last_expr is not None:
        expr_val = eval(compile(ast.Expression(body=last_expr.value), "<multi_ai_eval>", "eval"), global_scope)
        if expr_val is not None:
            print("\\n[EXPR_RESULT]:" + repr(expr_val))
except Exception:
    traceback.print_exc()
    sys.exit(1)
`;

        const pythonBin = process.platform === "win32" ? "python" : "python3";
        const startTime = Date.now();
        let killed = false;

        let child;
        try {
            child = spawn(pythonBin, ["-c", runnerScript], {
                cwd: targetCwd,
                env,
                stdio: ["pipe", "pipe", "pipe"]
            });
        } catch (err) {
            return resolve({
                success: false,
                stdout: "",
                stderr: `Python environment error: ${err.message}`,
                return_value: null,
                exit_code: 127,
                elapsed_seconds: 0.0
            });
        }

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (d) => { stdout += d.toString("utf-8"); });
        child.stderr.on("data", (d) => { stderr += d.toString("utf-8"); });

        const timer = setTimeout(() => {
            killed = true;
            try { child.kill("SIGKILL"); } catch (_) {}
        }, timeoutSec * 1000);

        child.on("error", (err) => {
            clearTimeout(timer);
            resolve({
                success: false,
                stdout: "",
                stderr: `Failed to execute python: ${err.message}. Python may not be installed.`,
                return_value: null,
                exit_code: 127,
                elapsed_seconds: Number(((Date.now() - startTime) / 1000).toFixed(2))
            });
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            const elapsed = Number(((Date.now() - startTime) / 1000).toFixed(2));
            if (killed) {
                return resolve({
                    success: false,
                    stdout,
                    stderr: `TimeoutExpired: Python process exceeded ${timeoutSec}s time limit.`,
                    return_value: null,
                    exit_code: -1,
                    elapsed_seconds: elapsed
                });
            }

            let resultVal = null;
            if (stdout.includes("[EXPR_RESULT]:")) {
                const parts = stdout.split("[EXPR_RESULT]:");
                stdout = parts[0];
                resultVal = parts[1].trim();
            }

            resolve({
                success: code === 0,
                exit_code: code,
                stdout,
                stderr,
                return_value: resultVal,
                elapsed_seconds: elapsed
            });
        });
    });
}

module.exports = {
    executePythonCode,
    handleCodeGrep
};

