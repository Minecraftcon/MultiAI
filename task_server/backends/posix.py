"""
POSIX TaskManager (Linux / macOS / Termux)
===========================================
Subprocess execution with process-group signal routing and non-blocking stream capture.
"""
import os
import signal
import subprocess
import threading
import queue
import uuid
import time
from typing import Optional
from .base import BaseTaskManager


class PosixTaskManager(BaseTaskManager):
    def __init__(self):
        super().__init__()

    def _enqueue_output(self, out, queue_obj: queue.Queue, stream_name: str):
        try:
            for chunk in iter(lambda: out.read(1024), b""):
                queue_obj.put((stream_name, chunk.decode("utf-8", errors="replace")))
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
        artifacts_dir: Optional[str] = None,
    ) -> str:
        task_id = str(uuid.uuid4())[:8]

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["TERM"] = "xterm-256color"
        if scratch_dir:
            env["SCRATCH"] = scratch_dir
            env["SCRATCH_DIR"] = scratch_dir
        if artifacts_dir:
            env["ARTIFACTS"] = artifacts_dir
            env["ARTIFACTS_DIR"] = artifacts_dir

        process = subprocess.Popen(
            command,
            shell=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
            env=env,
            preexec_fn=os.setsid if hasattr(os, "setsid") else None,
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
            byte_seq, is_sigint, is_sigtstp, is_sigquit = self._resolve_combination(
                combo_str
            )
            details = []

            # 1. Process group signal dispatch (POSIX)
            if hasattr(os, "killpg") and hasattr(os, "getpgid"):
                try:
                    pgid = os.getpgid(process.pid)
                    if is_sigint and hasattr(signal, "SIGINT"):
                        os.killpg(pgid, signal.SIGINT)
                        details.append("SIGINT sent to process group")
                    elif is_sigtstp and hasattr(signal, "SIGTSTP"):
                        os.killpg(pgid, signal.SIGTSTP)
                        details.append("SIGTSTP sent to process group")
                    elif is_sigquit and hasattr(signal, "SIGQUIT"):
                        os.killpg(pgid, signal.SIGQUIT)
                        details.append("SIGQUIT sent to process group")
                except Exception:
                    pass

            # 2. Write keycode bytes into stdin
            if byte_seq and process.stdin and not process.stdin.closed:
                try:
                    process.stdin.write(byte_seq)
                    process.stdin.flush()
                    details.append(f"Keycode bytes written: {repr(byte_seq)}")
                except Exception:
                    pass
        else:
            # Text mode
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
            if hasattr(os, "killpg") and hasattr(os, "getpgid"):
                try:
                    os.killpg(os.getpgid(process.pid), signal.SIGKILL)
                    return {"status": f"Task {task_id} terminated."}
                except Exception:
                    pass
            process.terminate()
            time.sleep(0.1)
            if process.poll() is None:
                process.kill()
            return {"status": f"Task {task_id} terminated."}
        return {"status": f"Task {task_id} was already finished."}
