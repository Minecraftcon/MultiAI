"""
Windows TaskManager (win32 / Windows Subprocess Engine)
======================================================
Optimized for Windows process tree lifecycle, multi-codepage decoding, and taskkill.
"""
import os
import sys
import subprocess
import threading
import queue
import uuid
import time
from typing import Optional
from .base import BaseTaskManager


class WindowsTaskManager(BaseTaskManager):
    def __init__(self, default_shell: str = "cmd"):
        super().__init__()
        env_shell = os.environ.get("TASK_SERVER_SHELL", default_shell).lower()
        self.default_shell = (
            env_shell if env_shell in ("cmd", "powershell", "pwsh") else "cmd"
        )

    def _safe_decode(self, b: bytes) -> str:
        """Decode output bytes using common Windows code pages gracefully."""
        for enc in ("utf-8", "cp1252", "cp437", "oem"):
            try:
                return b.decode(enc)
            except (UnicodeDecodeError, LookupError):
                continue
        return b.decode("latin-1", errors="replace")

    def _enqueue_output(self, out, queue_obj: queue.Queue, stream_name: str):
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

    def run_task(
        self,
        command: str,
        shell_override: Optional[str] = None,
        scratch_dir: Optional[str] = None,
    ) -> str:
        task_id = str(uuid.uuid4())[:8]
        selected_shell = (shell_override or self.default_shell).lower()

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        if scratch_dir:
            env["SCRATCH"] = scratch_dir
            env["SCRATCH_DIR"] = scratch_dir

        creationflags = 0
        if sys.platform == "win32":
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP

        if selected_shell in ("powershell", "pwsh"):
            ps_bin = "pwsh" if selected_shell == "pwsh" else "powershell"
            cmd_args = [
                ps_bin,
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                command,
            ]
            process = subprocess.Popen(
                cmd_args,
                shell=False,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
                creationflags=creationflags,
                env=env,
            )
        else:
            process = subprocess.Popen(
                command,
                shell=True,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
                creationflags=creationflags,
                env=env,
            )

        output_queue = queue.Queue()

        stdout_thread = threading.Thread(
            target=self._enqueue_output,
            args=(process.stdout, output_queue, "stdout"),
            daemon=True,
        )
        stderr_thread = threading.Thread(
            target=self._enqueue_output,
            args=(process.stderr, output_queue, "stderr"),
            daemon=True,
        )

        stdout_thread.start()
        stderr_thread.start()

        self.tasks[task_id] = {
            "process": process,
            "queue": output_queue,
            "command": command,
            "shell": selected_shell,
            "start_time": time.time(),
        }

        return task_id

    def send_input(
        self,
        task_id: str,
        input_string: str = "",
        input_type: str = "text",
        combination: str = "",
        press_enter: bool = True,
    ) -> dict:
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
                "output": msg,
            }

        input_type = (input_type or "text").lower().strip()

        if input_type == "keycode" or combination:
            combo_str = combination or input_string or ""
            byte_seq, _, _, _ = self._resolve_combination(combo_str)
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
        status_text = (
            "running" if is_running else f"exited (code: {out.get('exit_code')})"
        )

        input_desc = (
            combo_str
            if (input_type == "keycode" or combination)
            else input_string
        )
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
            "type": (
                "keycode" if (input_type == "keycode" or combination) else "text"
            ),
            "stderr": std_err,
            "stdout": std_out,
            "output": formatted_output,
        }

    def kill_task(self, task_id: str) -> dict:
        if task_id not in self.tasks:
            return {"error": f"Task {task_id} not found."}

        process = self.tasks[task_id]["process"]
        if process.poll() is None:
            if sys.platform == "win32":
                try:
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        check=False,
                    )
                except Exception:
                    pass

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
