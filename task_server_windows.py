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
        """Read chunks from stdout/stderr pipe and push to thread-safe queue."""
        try:
            for chunk in iter(lambda: out.read(1024), b""):
                decoded = self._safe_decode(chunk)
                queue_obj.put((stream_name, decoded))
        except (ValueError, OSError):
            pass
        finally:
            try:
                out.close()
            except Exception:
                pass

    def run_task(self, command: str, shell_override: Optional[str] = None, scratch_dir: Optional[str] = None) -> str:
        """Spawn a new task subprocess with piped standard I/O."""
        task_id = str(uuid.uuid4())[:8]
        selected_shell = (shell_override or self.default_shell).lower()

        env = os.environ.copy()
        env['PYTHONUNBUFFERED'] = '1'
        if scratch_dir:
            env['SCRATCH'] = scratch_dir
            env['SCRATCH_DIR'] = scratch_dir

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
                creationflags=creationflags,
                env=env
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
                creationflags=creationflags,
                env=env
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

    def _resolve_combination(self, combo: str):
        c = (combo or "").strip().lower().replace("control", "ctrl").replace(" ", "")
        KEY_MAP = {
            "ctrl+c": b"\x03",
            "ctrl-c": b"\x03",
            "ctrl+d": b"\x04",
            "ctrl-d": b"\x04",
            "ctrl+z": b"\x1a",
            "ctrl-z": b"\x1a",
            "ctrl+\\": b"\x1c",
            "ctrl-\\": b"\x1c",
            "enter": b"\n",
            "return": b"\n",
            "\n": b"\n",
            "tab": b"\t",
            "\t": b"\t",
            "space": b" ",
            "esc": b"\x1b",
            "escape": b"\x1b",
            "backspace": b"\x7f",
            "bs": b"\x7f",
            "delete": b"\x1b[3~",
            "del": b"\x1b[3~",
            "up": b"\x1b[A",
            "arrowup": b"\x1b[A",
            "down": b"\x1b[B",
            "arrowdown": b"\x1b[B",
            "right": b"\x1b[C",
            "arrowright": b"\x1b[C",
            "left": b"\x1b[D",
            "arrowleft": b"\x1b[D",
            "home": b"\x1b[H",
            "end": b"\x1b[F",
            "pageup": b"\x1b[5~",
            "pgup": b"\x1b[5~",
            "pagedown": b"\x1b[6~",
            "pgdn": b"\x1b[6~",
        }
        if c in KEY_MAP:
            return KEY_MAP[c]

        # Dynamic Ctrl+<letter>
        if (c.startswith("ctrl+") or c.startswith("ctrl-")) and len(c) == 6:
            ch = c[5]
            if "a" <= ch <= "z":
                return bytes([ord(ch) - ord("a") + 1])

        # Dynamic Alt+<letter>
        if (c.startswith("alt+") or c.startswith("alt-")) and len(c) == 5:
            ch = c[4]
            return b"\x1b" + ch.encode("utf-8")

        return combo.encode("utf-8")

    def send_input(self, task_id: str, input_string: str = "", input_type: str = "text", combination: str = "", press_enter: bool = True) -> dict:
        """Write input text or send keycode combinations into task standard input."""
        if task_id not in self.tasks:
            return {"error": f"Task {task_id} not found."}

        process = self.tasks[task_id]["process"]
        if process.poll() is not None:
            out = self.get_output(task_id)
            code = process.returncode
            std_out = out.get("stdout", "")
            std_err = out.get("stderr", "")
            msg = f"Task {task_id} is no longer running (already exited with code {code})."
            if std_out:
                msg += f"\nstdout: {std_out.strip()}"
            if std_err:
                msg += f"\nstderr: {std_err.strip()}"
            return {
                "error": f"Task {task_id} is no longer running.",
                "status": f"exited (code: {code})",
                "running": False,
                "exit_code": code,
                "stdout": std_out,
                "stderr": std_err,
                "output": msg
            }

        input_type = (input_type or "text").lower().strip()

        if input_type == "keycode" or combination:
            combo_str = combination or input_string or ""
            byte_seq = self._resolve_combination(combo_str)
            try:
                if byte_seq and process.stdin and not process.stdin.closed:
                    process.stdin.write(byte_seq)
                    process.stdin.flush()
            except Exception as e:
                return {"error": f"Failed to send keycode: {str(e)}"}
        else:
            try:
                val = input_string if input_string is not None else ""
                if press_enter and not val.endswith("\n"):
                    val += "\n"
                process.stdin.write(val.encode("utf-8"))
                process.stdin.flush()
            except Exception as e:
                return {"error": f"Failed to send input: {str(e)}"}

        time.sleep(0.06)
        out = self.get_output(task_id)
        is_running = out.get("running", False)
        status_text = "running" if is_running else f"exited (code: {out.get('exit_code')})"
        input_desc = combo_str if (input_type == "keycode" or combination) else input_string
        std_err = out.get("stderr", "")
        std_out = out.get("stdout", "")

        formatted_output = f"input: ({input_desc}), sent successfully\nStatus: {status_text}\nstderr: {std_err}"
        if std_out:
            formatted_output += f"\nstdout: {std_out}"

        return {
            "task_id": task_id,
            "status": status_text,
            "running": is_running,
            "exit_code": out.get("exit_code"),
            "input": input_desc,
            "type": "keycode" if (input_type == "keycode" or combination) else "text",
            "stderr": std_err,
            "stdout": std_out,
            "output": formatted_output
        }

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
            input_type = data.get("type") or ("keycode" if "combination" in data else "text")
            combination = data.get("combination", "")
            input_string = data.get("field") if data.get("field") is not None else data.get("input_string", "")
            res = manager.send_input(task_id, input_string=input_string, input_type=input_type, combination=combination)
            status_code = 404 if "not found" in res.get("error", "") else 200
            return self._send_json(status_code, res)

        elif path.startswith("/api/task/kill/"):
            task_id = path[len("/api/task/kill/"):]
            res = manager.kill_task(task_id)
            status_code = 404 if "not found" in res.get("error", "") else 200
            return self._send_json(status_code, res)

        elif path == "/api/task/idle":
            seconds = max(0.1, min(300.0, float(data.get("seconds", 5))))
            task_id = data.get("task_id")
            wake_on = data.get("wake_on", "exit")
            reason = data.get("reason", "")
            start_time = time.time()
            end_time = start_time + seconds

            if task_id and task_id in manager.tasks:
                task = manager.tasks[task_id]
                process = task["process"]
                q = task["queue"]
                while time.time() < end_time:
                    if wake_on in ("exit", "any") and process.poll() is not None:
                        time.sleep(0.02)
                        output = manager.get_output(task_id)
                        output["status"] = "task_completed"
                        output["elapsed_seconds"] = round(time.time() - start_time, 2)
                        output["reason"] = reason
                        return self._send_json(200, output)
                    if wake_on in ("output", "any") and not q.empty():
                        time.sleep(0.02)
                        output = manager.get_output(task_id)
                        output["status"] = "task_output"
                        output["elapsed_seconds"] = round(time.time() - start_time, 2)
                        output["reason"] = reason
                        return self._send_json(200, output)
                    time.sleep(0.04)

                output = manager.get_output(task_id)
                output["status"] = "timer_expired"
                output["elapsed_seconds"] = round(time.time() - start_time, 2)
                output["reason"] = reason
                return self._send_json(200, output)
            else:
                time.sleep(seconds)
                return self._send_json(200, {
                    "status": "timer_expired",
                    "elapsed_seconds": round(time.time() - start_time, 2),
                    "reason": reason
                })

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
        input_type = data.get("type") or ("keycode" if "combination" in data else "text")
        combination = data.get("combination", "")
        input_string = data.get("field") if data.get("field") is not None else data.get("input_string", "")
        return jsonify(manager.send_input(task_id, input_string=input_string, input_type=input_type, combination=combination))

    @flask_app.route("/api/task/kill/<task_id>", methods=["POST"])
    def flask_kill_task(task_id):
        return jsonify(manager.kill_task(task_id))

    @flask_app.route("/api/task/idle", methods=["POST"])
    def flask_idle_task():
        data = request.json or {}
        seconds = max(0.1, min(300.0, float(data.get("seconds", 5))))
        task_id = data.get("task_id")
        wake_on = data.get("wake_on", "exit")
        reason = data.get("reason", "")
        start_time = time.time()
        end_time = start_time + seconds

        if task_id and task_id in manager.tasks:
            task = manager.tasks[task_id]
            process = task["process"]
            q = task["queue"]
            while time.time() < end_time:
                if wake_on in ("exit", "any") and process.poll() is not None:
                    time.sleep(0.02)
                    output = manager.get_output(task_id)
                    output["status"] = "task_completed"
                    output["elapsed_seconds"] = round(time.time() - start_time, 2)
                    output["reason"] = reason
                    return jsonify(output)
                if wake_on in ("output", "any") and not q.empty():
                    time.sleep(0.02)
                    output = manager.get_output(task_id)
                    output["status"] = "task_output"
                    output["elapsed_seconds"] = round(time.time() - start_time, 2)
                    output["reason"] = reason
                    return jsonify(output)
                time.sleep(0.04)

            output = manager.get_output(task_id)
            output["status"] = "timer_expired"
            output["elapsed_seconds"] = round(time.time() - start_time, 2)
            output["reason"] = reason
            return jsonify(output)
        else:
            time.sleep(seconds)
            return jsonify({
                "status": "timer_expired",
                "elapsed_seconds": round(time.time() - start_time, 2),
                "reason": reason
            })


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
