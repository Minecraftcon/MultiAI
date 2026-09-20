"""
Base TaskManager Abstraction
============================
Defines the shared task execution interface, output queuing, and keycode mappings.
"""
import queue
import time
from typing import Dict, Any, Optional

KEY_MAP = {
    "ctrl+c": (b"\x03", True, False, False),
    "ctrl-c": (b"\x03", True, False, False),
    "ctrl+d": (b"\x04", False, False, False),
    "ctrl-d": (b"\x04", False, False, False),
    "ctrl+z": (b"\x1a", False, True, False),
    "ctrl-z": (b"\x1a", False, True, False),
    "ctrl+\\": (b"\x1c", False, False, True),
    "ctrl-\\": (b"\x1c", False, False, True),
    "enter": (b"\n", False, False, False),
    "return": (b"\n", False, False, False),
    "\n": (b"\n", False, False, False),
    "tab": (b"\t", False, False, False),
    "\t": (b"\t", False, False, False),
    "space": (b" ", False, False, False),
    "esc": (b"\x1b", False, False, False),
    "escape": (b"\x1b", False, False, False),
    "backspace": (b"\x7f", False, False, False),
    "bs": (b"\x7f", False, False, False),
    "delete": (b"\x1b[3~", False, False, False),
    "del": (b"\x1b[3~", False, False, False),
    "up": (b"\x1b[A", False, False, False),
    "arrowup": (b"\x1b[A", False, False, False),
    "down": (b"\x1b[B", False, False, False),
    "arrowdown": (b"\x1b[B", False, False, False),
    "right": (b"\x1b[C", False, False, False),
    "arrowright": (b"\x1b[C", False, False, False),
    "left": (b"\x1b[D", False, False, False),
    "arrowleft": (b"\x1b[D", False, False, False),
    "home": (b"\x1b[H", False, False, False),
    "end": (b"\x1b[F", False, False, False),
    "pageup": (b"\x1b[5~", False, False, False),
    "pgup": (b"\x1b[5~", False, False, False),
    "pagedown": (b"\x1b[6~", False, False, False),
    "pgdn": (b"\x1b[6~", False, False, False),
}


class BaseTaskManager:
    def __init__(self):
        self.tasks: Dict[str, Dict[str, Any]] = {}

    def _resolve_combination(self, combo: str):
        """Map key combinations to byte sequences and signal flags."""
        c = (combo or "").strip().lower().replace("control", "ctrl").replace(" ", "")
        if c in KEY_MAP:
            return KEY_MAP[c]

        # Dynamic Ctrl+<letter> (ctrl+a through ctrl+z)
        if (c.startswith("ctrl+") or c.startswith("ctrl-")) and len(c) == 6:
            ch = c[5]
            if "a" <= ch <= "z":
                code = bytes([ord(ch) - ord("a") + 1])
                return (code, ch == "c", ch == "z", False)

        # Dynamic Alt+<letter>
        if (c.startswith("alt+") or c.startswith("alt-")) and len(c) == 5:
            ch = c[4]
            return (b"\x1b" + ch.encode("utf-8"), False, False, False)

        return (combo.encode("utf-8"), False, False, False)

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
            "stderr": "".join(stderr_lines),
        }

    def list_tasks(self) -> dict:
        """Return status summary of all tracked tasks."""
        result = {}
        for tid, task in list(self.tasks.items()):
            p = task.get("process")
            is_running = p.poll() is None if p else False
            result[tid] = {
                "running": is_running,
                "exit_code": p.returncode if (p and not is_running) else None,
                "command": task.get("command", ""),
                "start_time": task.get("start_time", 0),
            }
        return result

    def clean_finished(self) -> int:
        """Remove finished tasks from internal tracking."""
        finished = [
            tid
            for tid, t in self.tasks.items()
            if t.get("process") and t["process"].poll() is not None
        ]
        for tid in finished:
            del self.tasks[tid]
        return len(finished)

    def run_task(
        self,
        command: str,
        shell_override: Optional[str] = None,
        scratch_dir: Optional[str] = None,
    ) -> str:
        raise NotImplementedError

    def send_input(
        self,
        task_id: str,
        input_string: str = "",
        input_type: str = "text",
        combination: str = "",
        press_enter: bool = True,
    ) -> dict:
        raise NotImplementedError

    def kill_task(self, task_id: str) -> dict:
        raise NotImplementedError

    def wait_for_task(self, task_id: str, timeout_secs: float = 1.0) -> dict:
        """Wait for task process to exit up to timeout_secs with early return."""
        if task_id not in self.tasks:
            return {"error": f"Task {task_id} not found."}

        cooldown = max(0.05, float(timeout_secs))
        end_time = time.time() + cooldown
        process = self.tasks[task_id]["process"]

        while time.time() < end_time:
            if process.poll() is not None:
                time.sleep(0.02)
                break
            time.sleep(0.03)

        return self.get_output(task_id)

    def idle(
        self,
        seconds: float = 5.0,
        task_id: Optional[str] = None,
        wake_on: str = "exit",
        reason: str = "",
    ) -> dict:
        """Pause or monitor a background task for early exit/output."""
        seconds = max(0.1, min(300.0, float(seconds)))
        start_time = time.time()
        end_time = start_time + seconds

        if task_id and task_id in self.tasks:
            task = self.tasks[task_id]
            process = task["process"]
            q = task["queue"]

            while time.time() < end_time:
                if wake_on in ("exit", "any") and process.poll() is not None:
                    time.sleep(0.02)
                    output = self.get_output(task_id)
                    output["status"] = "task_completed"
                    output["elapsed_seconds"] = round(time.time() - start_time, 2)
                    output["reason"] = reason
                    return output

                if wake_on in ("output", "any") and not q.empty():
                    time.sleep(0.02)
                    output = self.get_output(task_id)
                    output["status"] = "task_output"
                    output["elapsed_seconds"] = round(time.time() - start_time, 2)
                    output["reason"] = reason
                    return output

                time.sleep(0.04)

            output = self.get_output(task_id)
            output["status"] = "timer_expired"
            output["elapsed_seconds"] = round(time.time() - start_time, 2)
            output["reason"] = reason
            return output
        else:
            time.sleep(seconds)
            return {
                "status": "timer_expired",
                "elapsed_seconds": round(time.time() - start_time, 2),
                "reason": reason,
            }

