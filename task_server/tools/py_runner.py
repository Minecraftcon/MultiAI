"""
Dedicated Python Execution Engine (run_python tool)
===================================================
Executes Python snippets with timeout safety, standard stream capture,
and REPL-style expression evaluation.
"""
import sys
import os
import time
import subprocess
import tempfile
from typing import Dict, Any, Optional


def execute_python_code(
    code: str,
    timeout: Optional[float] = 30.0,
    cwd: Optional[str] = None,
    scratch_dir: Optional[str] = None,
    artifacts_dir: Optional[str] = None,
) -> Dict[str, Any]:
    if not code or not code.strip():
        return {
            "success": False,
            "stdout": "",
            "stderr": "Error: Provided Python code snippet is empty.",
            "return_value": None,
            "exit_code": 1,
            "elapsed_seconds": 0.0,
        }
    raw_code = str(code or "").strip()

    timeout_sec = min(300, max(1, int(timeout or 30)))
    target_cwd = cwd or scratch_dir or os.getcwd()

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    if scratch_dir:
        env["SCRATCH"] = scratch_dir
        env["SCRATCH_DIR"] = scratch_dir
    if artifacts_dir:
        env["ARTIFACTS"] = artifacts_dir
        env["ARTIFACTS_DIR"] = artifacts_dir

    # Wrapper runner script to capture execution and evaluate trailing expression
    runner_script = f"""
import sys
import ast
import traceback

raw_code = {repr(raw_code)}

try:
    parsed = ast.parse(raw_code)
    # Check if the last node is an unassigned Expr (like Jupyter cell result)
    last_expr = None
    if parsed.body and isinstance(parsed.body[-1], ast.Expr):
        last_expr = parsed.body.pop()
    
    global_scope = {{"__name__": "__main__"}}
    exec(compile(parsed, "<multi_ai_exec>", "exec"), global_scope)
    
    if last_expr is not None:
        expr_val = eval(compile(ast.Expression(body=last_expr.value), "<multi_ai_eval>", "eval"), global_scope)
        if expr_val is not None:
            # Output result with a special delimiter
            print("\\n[EXPR_RESULT]:" + repr(expr_val))
except Exception:
    traceback.print_exc()
    sys.exit(1)
"""

    start_time = time.perf_counter()
    python_bin = sys.executable or "python3"

    try:
        proc = subprocess.run(
            [python_bin, "-c", runner_script],
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            cwd=target_cwd,
            env=env
        )
        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

        stdout_raw = proc.stdout or ""
        stderr_raw = proc.stderr or ""
        result_val = None

        if "[EXPR_RESULT]:" in stdout_raw:
            parts = stdout_raw.split("[EXPR_RESULT]:", 1)
            stdout_raw = parts[0]
            result_val = parts[1].strip()

        return {
            "success": proc.returncode == 0,
            "exit_code": proc.returncode,
            "stdout": stdout_raw,
            "stderr": stderr_raw,
            "result": result_val,
            "execution_time_ms": elapsed_ms
        }

    except subprocess.TimeoutExpired:
        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return {
            "success": False,
            "error": f"Execution timed out after {timeout_sec} seconds",
            "stdout": "",
            "stderr": f"TimeoutExpired: Python process exceeded {timeout_sec}s time limit.",
            "result": None,
            "execution_time_ms": elapsed_ms
        }
    except Exception as e:
        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return {
            "success": False,
            "error": str(e),
            "stdout": "",
            "stderr": str(e),
            "result": None,
            "execution_time_ms": elapsed_ms
        }
