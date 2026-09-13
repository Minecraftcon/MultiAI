"""
task_server_windows.py
======================
Windows-optimized Task Server for Puter MultiSearch AI Agent.

Exposes the exact same REST API as task_server.py:
- POST /api/task/run        -> Execute command, wait cooldown timeout, return initial output
- GET  /api/task/stdout/:id -> Retrieve cumulative stdout and stderr buffers
- POST /api/task/input/:id  -> Pipe text into process stdin
- POST /api/task/kill/:id   -> Terminate process (using taskkill /F /T on Windows)

Windows Optimizations:
1. Process Tree Termination: Uses `taskkill /F /T /PID <pid>` to terminate cmd.exe
   and all its child processes cleanly (avoiding orphan processes).
2. Robust Encoding: Handles UTF-8, CP1252, CP437, and OEM code pages gracefully without crashing.
3. Flexible Shell: Supports CMD.exe (default, supports '&&', '||') or PowerShell
   (configured via TASK_SERVER_SHELL environment variable or payload {"shell": "powershell"}).
4. Zero-Dependency Fallback: If Flask is not installed, seamlessly falls back to Python's
   built-in ThreadingHTTPServer. Works immediately on any standard Windows Python install!
"""

import sys
import os
import subprocess
import threading
import queue
import uuid
import time
import json
import argparse
import urllib.parse
from typing import Dict, Any, Optional

# Optional Flask import
try:
    from flask import Flask, request, jsonify
    HAS_FLASK = True
except ImportError:
    HAS_FLASK = False


class TaskManager:
    """Manages asynchronous subprocess execution on Windows."""

    def __init__(self, default_shell: str = "cmd"):
        self.tasks: Dict[str, Dict[str, Any]] = {}
        env_shell = os.environ.get("TASK_SERVER_SHELL", default_shell).lower()
        self.default_shell = env_shell if env_shell in ("cmd", "powershell", "pwsh") else "cmd"

    def _safe_decode(self, b: bytes) -> str:
        """Decode output bytes using common Windows encodings."""
        for enc in ("utf-8", "cp1252", "cp437", "oem"):
            try:
                return b.decode(enc)
            except (UnicodeDecodeError, LookupError):
                continue
        return b.decode("latin-1", errors="replace")

    def _enqueue_output(self, out, queue_obj: queue.Queue, stream_name: str):
        """Read lines from stdout/stderr pipe and push to thread-safe queue."""
        try:
            for line in iter(out.readline, b""):
                decoded = self._safe_decode(line)
                queue_obj.put((stream_name, decoded))
        except (ValueError, OSError):
            pass
        finally:
            try:
                out.close()
            except Exception:
                pass

    def run_task(self, command: str, shell_override: Optional[str] = None) -> str:
        """Spawn a new task subprocess with piped standard I/O."""
        task_id = str(uuid.uuid4())[:8]
        selected_shell = (shell_override or self.default_shell).lower()

        creationflags = 0
        if sys.platform == "win32":
            # CREATE_NEW_PROCESS_GROUP isolates the console group
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP

        # Set up shell execution
        if selected_shell in ("powershell", "pwsh"):
            ps_bin = "pwsh" if selected_shell == "pwsh" else "powershell"
            cmd_args = [
                ps_bin,
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                command
            ]
            process = subprocess.Popen(
                cmd_args,
                shell=False,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
                creationflags=creationflags
            )
        else:
            # Standard cmd.exe - supports &&, ||, dir, etc.
            process = subprocess.Popen(
                command,
                shell=True,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
                creationflags=creationflags
            )

        output_queue = queue.Queue()

        stdout_thread = threading.Thread(
            target=self._enqueue_output,
            args=(process.stdout, output_queue, "stdout"),
            daemon=True
        )
        stderr_thread = threading.Thread(
            target=self._enqueue_output,
            args=(process.stderr, output_queue, "stderr"),
            daemon=True
        )

        stdout_thread.start()
        stderr_thread.start()

        self.tasks[task_id] = {
            "process": process,
            "queue": output_queue,
            "command": command,
            "shell": selected_shell,
            "start_time": time.time()
        }

        return task_id

    def get_output(self, task_id: str) -> dict:
        """Fetch cumulative stdout and stderr buffers."""
        if task_id not in self.tasks:
            return {"error": f"Task {task_id} not found."}

        task = self.tasks[task_id]
        process = task["process"]
        q = task["queue"]

        stdout_lines, stderr_lines = [], []

        while True:
            try:
                stream, line = q.get_nowait()
                if stream == "stdout":
                    stdout_lines.append(line)
                else:
                    stderr_lines.append(line)
            except queue.Empty:
                break

        is_running = process.poll() is None

        return {
            "task_id": task_id,
            "running": is_running,
            "exit_code": process.returncode if not is_running else None,
            "stdout": "".join(stdout_lines),
            "stderr": "".join(stderr_lines)
        }

    def send_input(self, task_id: str, input_string: str) -> dict:
        """Write input text into task standard input."""
        if task_id not in self.tasks:
            return {"error": f"Task {task_id} not found."}

        process = self.tasks[task_id]["process"]
        if process.poll() is not None:
            return {"error": f"Task {task_id} is no longer running."}

        try:
            if not input_string.endswith("\n"):
                input_string += "\n"
            process.stdin.write(input_string.encode("utf-8"))
            process.stdin.flush()
            return {"status": "Input sent successfully."}
        except Exception as e:
            return {"error": f"Failed to send input: {str(e)}"}

    def kill_task(self, task_id: str) -> dict:
        """Terminate a running task and its child process tree."""
        if task_id not in self.tasks:
            return {"error": f"Task {task_id} not found."}

        process = self.tasks[task_id]["process"]
        if process.poll() is None:
            # On Windows, taskkill /F /T terminates the process tree cleanly
            if sys.platform == "win32":
                try:
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        check=False
                    )
                except Exception:
                    pass

            # Fallback to standard terminate/kill if still alive
            if process.poll() is None:
                try:
                    process.terminate()
                    time.sleep(0.1)
                    if process.poll() is None:
                        process.kill()
                except Exception:
                    pass

            return {"status": f"Task {task_id} terminated."}
        return {"status": f"Task {task_id} was already finished."}


# Global task manager instance
manager = TaskManager()


# ---------------------------------------------------------------------------
# Built-in Standard Library HTTP Server (Zero Dependencies)
# ---------------------------------------------------------------------------
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class WindowsTaskHTTPHandler(BaseHTTPRequestHandler):
    """HTTP handler implementing the task server REST API using standard library."""

    def log_message(self, format, *args):
        # Format logs cleanly
        sys.stdout.write(f"[HTTP] {format % args}\n")
        sys.stdout.flush()

    def _send_json(self, status_code: int, data: Any):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/task/stdout/"):
            task_id = path[len("/api/task/stdout/"):]
            output = manager.get_output(task_id)
            status_code = 404 if "error" in output and "not found" in output["error"] else 200
            self._send_json(status_code, output)
        elif path in ("/health", "/"):
            self._send_json(200, {
                "status": "online",
                "platform": sys.platform,
                "active_tasks": len(manager.tasks)
            })
        else:
            self._send_json(404, {"error": "Endpoint not found"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length).decode("utf-8", errors="replace") if content_length > 0 else "{}"
        try:
            data = json.loads(raw_body) if raw_body.strip() else {}
        except Exception:
            data = {}

        if path == "/api/task/run":
            command = data.get("command")
            timeout_secs = data.get("timeout", 1)
            shell_override = data.get("shell")

            if not command:
                return self._send_json(400, {"error": "No command provided"})

            task_id = manager.run_task(command, shell_override=shell_override)
            
            # Wait until process finishes with an exit code OR timeout expires
            cooldown = max(0.05, float(timeout_secs))
            end_time = time.time() + cooldown
            process = manager.tasks[task_id]['process']

            while time.time() < end_time:
                if process.poll() is not None:
                    time.sleep(0.02)
                    break
                time.sleep(0.03)

            output = manager.get_output(task_id)
            return self._send_json(200, output)

        elif path.startswith("/api/task/input/"):
            task_id = path[len("/api/task/input/"):]
            input_string = data.get("input_string", "")
            res = manager.send_input(task_id, input_string)
            status_code = 404 if "not found" in res.get("error", "") else 200
            return self._send_json(status_code, res)

        elif path.startswith("/api/task/kill/"):
            task_id = path[len("/api/task/kill/"):]
            res = manager.kill_task(task_id)
            status_code = 404 if "not found" in res.get("error", "") else 200
            return self._send_json(status_code, res)

        else:
            return self._send_json(404, {"error": "Endpoint not found"})


# ---------------------------------------------------------------------------
# Flask Application Setup (if Flask is installed)
# ---------------------------------------------------------------------------
if HAS_FLASK:
    flask_app = Flask(__name__)

    @flask_app.route("/api/task/run", methods=["POST"])
    def flask_run_task():
        data = request.json or {}
        command = data.get("command")
        timeout_secs = data.get("timeout", 1)
        shell_override = data.get("shell")

        if not command:
            return jsonify({"error": "No command provided"}), 400

        task_id = manager.run_task(command, shell_override=shell_override)
        
        # Wait until process finishes with an exit code OR timeout expires
        cooldown = max(0.05, float(timeout_secs))
        end_time = time.time() + cooldown
        process = manager.tasks[task_id]['process']

        while time.time() < end_time:
            if process.poll() is not None:
                time.sleep(0.02)
                break
            time.sleep(0.03)

        output = manager.get_output(task_id)
        return jsonify(output)

    @flask_app.route("/api/task/stdout/<task_id>", methods=["GET"])
    def flask_stdout_task(task_id):
        return jsonify(manager.get_output(task_id))

    @flask_app.route("/api/task/input/<task_id>", methods=["POST"])
    def flask_input_task(task_id):
        data = request.json or {}
        return jsonify(manager.send_input(task_id, data.get("input_string", "")))

    @flask_app.route("/api/task/kill/<task_id>", methods=["POST"])
    def flask_kill_task(task_id):
        return jsonify(manager.kill_task(task_id))


# ---------------------------------------------------------------------------
# Entry Point & CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Windows Task Server for MultiSearch AI")
    parser.add_argument("--port", type=int, default=int(os.environ.get("TASK_SERVER_PORT", 5000)),
                        help="Port to listen on (default: 5000)")
    parser.add_argument("--host", type=str, default="127.0.0.1",
                        help="Host interface (default: 127.0.0.1)")
    parser.add_argument("--shell", type=str, choices=["cmd", "powershell", "pwsh"],
                        default=os.environ.get("TASK_SERVER_SHELL", "cmd"),
                        help="Default shell to execute commands (default: cmd)")
    parser.add_argument("--server", type=str, choices=["auto", "builtin", "flask"],
                        default="auto",
                        help="HTTP server implementation (default: auto)")
    args = parser.parse_args()

    manager.default_shell = args.shell

    use_flask = False
    if args.server == "flask":
        if not HAS_FLASK:
            print("[ERROR] Flask requested but not installed. Install with 'pip install flask' or use '--server builtin'.")
            sys.exit(1)
        use_flask = True
    elif args.server == "auto":
        use_flask = HAS_FLASK
    else:
        use_flask = False

    server_type = "Flask" if use_flask else "Built-in ThreadingHTTPServer"
    print("=" * 60)
    print(f" Windows Task Server Running")
    print(f" Platform     : {sys.platform} (Python {sys.version.split()[0]})")
    print(f" URL          : http://{args.host}:{args.port}")
    print(f" HTTP Backend : {server_type}")
    print(f" Default Shell: {manager.default_shell}")
    print("=" * 60)
    sys.stdout.flush()

    if use_flask:
        flask_app.run(host=args.host, port=args.port)
    else:
        server = ThreadingHTTPServer((args.host, args.port), WindowsTaskHTTPHandler)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n[PROCESS] Shutting down Windows Task Server...")
            server.server_close()


if __name__ == "__main__":
    main()
