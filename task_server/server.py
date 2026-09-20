"""
Unified Task Server HTTP Application
====================================
Cross-platform REST API for process supervision, grep searching, and Python execution.
Supports Flask with an automatic zero-dependency ThreadingHTTPServer fallback.
"""
import sys
import os
import json
import time
import argparse
import urllib.parse
from http.server import HTTPServer, ThreadingHTTPServer, BaseHTTPRequestHandler

from .backends import TaskManager
from .tools import execute_code_grep, execute_python_code
from .config import DEFAULT_PORT, DEFAULT_HOST

# Global manager instance
manager = TaskManager()

# Check if Flask is installed
try:
    from flask import Flask, request, jsonify
    HAS_FLASK = True
except ImportError:
    HAS_FLASK = False


# =====================================================================
# Flask Implementation (Preferred when flask is installed)
# =====================================================================
if HAS_FLASK:
    app = Flask(__name__)

    @app.route("/api/task/run", methods=["POST"])
    def run_task_endpoint():
        data = request.json or {}
        command = data.get("command")
        timeout_secs = float(data.get("timeout") if data.get("timeout") is not None else (float(data.get("wait_ms", 1000)) / 1000.0 if "wait_ms" in data else 1.0))
        if not command:
            return jsonify({"error": "No command provided"}), 400

        scratch_dir = data.get("scratch_dir")
        artifacts_dir = data.get("artifacts_dir")
        shell_override = data.get("shell")
        task_id = manager.run_task(command, shell_override=shell_override, scratch_dir=scratch_dir, artifacts_dir=artifacts_dir)

        output = manager.wait_for_task(task_id, timeout_secs)
        return jsonify(output)

    @app.route("/api/task/idle", methods=["POST"])
    def idle_endpoint():
        data = request.json or {}
        seconds = data.get("seconds", 5)
        task_id = data.get("task_id")
        wake_on = data.get("wake_on", "exit")
        reason = data.get("reason", "")
        return jsonify(manager.idle(seconds=seconds, task_id=task_id, wake_on=wake_on, reason=reason))

    @app.route("/api/task/stdout/<task_id>", methods=["GET"])
    def get_output_endpoint(task_id):
        output = manager.get_output(task_id)
        if "error" in output:
            return jsonify(output), 404
        return jsonify(output)

    @app.route("/api/task/input/<task_id>", methods=["POST"])
    def send_input_endpoint(task_id):
        data = request.json or {}
        input_string = data.get("field") if data.get("field") is not None else (data.get("input_string") if data.get("input_string") is not None else data.get("input", ""))
        input_type = data.get("type") or ("keycode" if ("combination" in data and data.get("combination")) else "text")
        combination = data.get("combination", "")
        press_enter = data.get("press_enter", True)

        res = manager.send_input(
            task_id,
            input_string=input_string,
            input_type=input_type,
            combination=combination,
            press_enter=press_enter
        )
        if "error" in res and not res.get("status"):
            return jsonify(res), 404
        return jsonify(res)

    @app.route("/api/task/kill/<task_id>", methods=["POST"])
    def kill_task_endpoint(task_id):
        res = manager.kill_task(task_id)
        if "error" in res:
            return jsonify(res), 404
        return jsonify(res)

    @app.route("/api/task/list", methods=["GET"])
    def list_tasks_endpoint():
        return jsonify(manager.list_tasks())

    @app.route("/api/task/clean", methods=["POST"])
    def clean_tasks_endpoint():
        count = manager.clean_finished()
        return jsonify({"cleaned": count})

    @app.route("/api/code/grep", methods=["POST"])
    def code_grep_endpoint():
        data = request.json or {}
        query = data.get("query", "")
        search_path = data.get("path", ".")
        is_regex = bool(data.get("is_regex", False))
        case_sensitive = bool(data.get("case_sensitive", False))
        include_glob = data.get("include") or data.get("glob")
        files_only = bool(data.get("files_only", False))
        max_results = int(data.get("max_results", 50))

        try:
            res = execute_code_grep(
                query=query,
                search_path=search_path,
                is_regex=is_regex,
                case_sensitive=case_sensitive,
                include_glob=include_glob,
                files_only=files_only,
                max_results=max_results
            )
            return jsonify(res)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except FileNotFoundError as e:
            return jsonify({"error": str(e)}), 404
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/python/run", methods=["POST"])
    def python_run_endpoint():
        data = request.json or {}
        code = data.get("code", "")
        timeout = int(data.get("timeout", 30))
        scratch_dir = data.get("scratch_dir")
        artifacts_dir = data.get("artifacts_dir")
        cwd = data.get("cwd")

        res = execute_python_code(code=code, timeout=timeout, cwd=cwd, scratch_dir=scratch_dir, artifacts_dir=artifacts_dir)
        return jsonify(res)


# =====================================================================
# Zero-Dependency ThreadingHTTPServer Fallback (when Flask is absent)
# =====================================================================
class FallbackHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default server logs

    def _send_json(self, status: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/task/stdout/"):
            task_id = path[len("/api/task/stdout/"):]
            out = manager.get_output(task_id)
            status = 404 if "error" in out else 200
            return self._send_json(status, out)

        if path == "/api/task/list":
            return self._send_json(200, manager.list_tasks())

        self._send_json(404, {"error": "Endpoint not found"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_len = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_len) if content_len > 0 else b"{}"
        try:
            data = json.loads(post_data.decode("utf-8", errors="replace")) if post_data else {}
        except Exception:
            data = {}

        if path == "/api/task/run":
            cmd = data.get("command")
            if not cmd:
                return self._send_json(400, {"error": "No command provided"})
            timeout_sec = float(data.get("timeout") if data.get("timeout") is not None else (float(data.get("wait_ms", 1000)) / 1000.0 if "wait_ms" in data else 1.0))
            tid = manager.run_task(cmd, shell_override=data.get("shell"), scratch_dir=data.get("scratch_dir"), artifacts_dir=data.get("artifacts_dir"))
            return self._send_json(200, manager.wait_for_task(tid, timeout_sec))

        if path == "/api/task/idle":
            seconds = data.get("seconds", 5)
            task_id = data.get("task_id")
            wake_on = data.get("wake_on", "exit")
            reason = data.get("reason", "")
            return self._send_json(200, manager.idle(seconds=seconds, task_id=task_id, wake_on=wake_on, reason=reason))

        if path.startswith("/api/task/input/"):
            task_id = path[len("/api/task/input/"):]
            input_string = data.get("field") if data.get("field") is not None else (data.get("input_string") if data.get("input_string") is not None else data.get("input", ""))
            input_type = data.get("type") or ("keycode" if ("combination" in data and data.get("combination")) else "text")
            combination = data.get("combination", "")
            press_enter = data.get("press_enter", True)
            res = manager.send_input(
                task_id,
                input_string=input_string,
                input_type=input_type,
                combination=combination,
                press_enter=press_enter
            )
            status = 404 if ("error" in res and not res.get("status")) else 200
            return self._send_json(status, res)

        if path.startswith("/api/task/kill/"):
            task_id = path[len("/api/task/kill/"):]
            res = manager.kill_task(task_id)
            status = 404 if "error" in res else 200
            return self._send_json(status, res)

        if path == "/api/task/clean":
            count = manager.clean_finished()
            return self._send_json(200, {"cleaned": count})

        if path == "/api/code/grep":
            try:
                res = execute_code_grep(
                    query=data.get("query", ""),
                    search_path=data.get("path", "."),
                    is_regex=bool(data.get("is_regex", False)),
                    case_sensitive=bool(data.get("case_sensitive", False)),
                    include_glob=data.get("include") or data.get("glob"),
                    files_only=bool(data.get("files_only", False)),
                    max_results=int(data.get("max_results", 50))
                )
                return self._send_json(200, res)
            except ValueError as e:
                return self._send_json(400, {"error": str(e)})
            except FileNotFoundError as e:
                return self._send_json(404, {"error": str(e)})
            except Exception as e:
                return self._send_json(500, {"error": str(e)})

        if path == "/api/python/run":
            res = execute_python_code(
                code=data.get("code", ""),
                timeout=int(data.get("timeout", 30)),
                cwd=data.get("cwd"),
                scratch_dir=data.get("scratch_dir")
            )
            return self._send_json(200, res)

        self._send_json(404, {"error": "Endpoint not found"})


def main():
    parser = argparse.ArgumentParser(description="MultiAI Task & Execution Server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Server port (default: {DEFAULT_PORT})")
    parser.add_argument("--host", type=str, default=DEFAULT_HOST, help=f"Server host (default: {DEFAULT_HOST})")
    args = parser.parse_args()

    platform_name = "Windows" if sys.platform == "win32" else "POSIX (Linux/macOS)"
    server_mode = "Flask" if HAS_FLASK else "Built-in ThreadingHTTPServer"

    print(f"[TASK SERVER] MultiAI Task Server Engine v2.0", flush=True)
    print(f"[TASK SERVER] Platform: {platform_name} | Engine: {server_mode}", flush=True)
    print(f"[TASK SERVER] Listening on http://{args.host}:{args.port}", flush=True)

    if HAS_FLASK:
        app.run(host=args.host, port=args.port, debug=False, threaded=True)
    else:
        httpd = ThreadingHTTPServer((args.host, args.port), FallbackHandler)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            httpd.server_close()


if __name__ == "__main__":
    main()
