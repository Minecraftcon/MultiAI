from flask import Flask, request, jsonify
import subprocess
import threading
import queue
import uuid
import time
import os
import signal

app = Flask(__name__)

class TaskManager:
    def __init__(self):
        self.tasks = {}

    def _enqueue_output(self, out, queue_obj, stream_name):
        try:
            for chunk in iter(lambda: out.read(1024), b''):
                queue_obj.put((stream_name, chunk.decode('utf-8', errors='replace')))
        except (ValueError, OSError):
            pass 
        finally:
            try:
                out.close()
            except Exception:
                pass

    def run_task(self, command: str, scratch_dir: str = None) -> str:
        task_id = str(uuid.uuid4())[:8]
        
        env = os.environ.copy()
        env['PYTHONUNBUFFERED'] = '1'
        env['TERM'] = 'xterm-256color'
        if scratch_dir:
            env['SCRATCH'] = scratch_dir
            env['SCRATCH_DIR'] = scratch_dir

        process = subprocess.Popen(
            command,
            shell=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
            env=env,
            preexec_fn=os.setsid if hasattr(os, 'setsid') else None
        )
        
        output_queue = queue.Queue()
        
        stdout_thread = threading.Thread(target=self._enqueue_output, args=(process.stdout, output_queue, 'stdout'))
        stderr_thread = threading.Thread(target=self._enqueue_output, args=(process.stderr, output_queue, 'stderr'))
        
        stdout_thread.daemon = True
        stderr_thread.daemon = True
        
        stdout_thread.start()
        stderr_thread.start()
        
        self.tasks[task_id] = {
            'process': process,
            'queue': output_queue,
            'command': command
        }
        
        return task_id

    def get_output(self, task_id: str) -> dict:
        if task_id not in self.tasks:
            return {"error": f"Task {task_id} not found."}
            
        task = self.tasks[task_id]
        process = task['process']
        q = task['queue']
        
        stdout_lines, stderr_lines = [], []
        
        while True:
            try:
                stream, line = q.get_nowait()
                if stream == 'stdout':
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

    def send_input(self, task_id: str, input_string: str = "", input_type: str = "text", combination: str = "", press_enter: bool = True) -> dict:
        if task_id not in self.tasks:
            return {"error": f"Task {task_id} not found."}
            
        process = self.tasks[task_id]['process']
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
            byte_seq, is_sigint, is_sigtstp, is_sigquit = self._resolve_combination(combo_str)
            details = []

            # 1. Process group signal dispatch (for POSIX)
            if hasattr(os, 'killpg') and hasattr(os, 'getpgid'):
                try:
                    pgid = os.getpgid(process.pid)
                    if is_sigint and hasattr(signal, 'SIGINT'):
                        os.killpg(pgid, signal.SIGINT)
                        details.append("SIGINT sent to process group")
                    elif is_sigtstp and hasattr(signal, 'SIGTSTP'):
                        os.killpg(pgid, signal.SIGTSTP)
                        details.append("SIGTSTP sent to process group")
                    elif is_sigquit and hasattr(signal, 'SIGQUIT'):
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
                if press_enter and not val.endswith('\n'):
                    val += '\n'
                process.stdin.write(val.encode('utf-8'))
                process.stdin.flush()
            except Exception as e:
                return {"error": f"Failed to send input: {str(e)}"}

        # Collect execution status and immediate output after sending input
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
        if task_id not in self.tasks:
            return {"error": f"Task {task_id} not found."}
            
        process = self.tasks[task_id]['process']
        if process.poll() is None:
            if hasattr(os, 'killpg') and hasattr(os, 'getpgid'):
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

manager = TaskManager()

@app.route('/api/task/run', methods=['POST'])
def run_task_endpoint():
    data = request.json or {}
    command = data.get('command')
    timeout_secs = data.get('timeout', 1)
    
    if not command:
        return jsonify({"error": "No command provided"}), 400
        
    scratch_dir = data.get('scratch_dir')
    task_id = manager.run_task(command, scratch_dir=scratch_dir)
    
    # Wait until process finishes with an exit code OR timeout expires
    cooldown = max(0.05, float(timeout_secs))
    end_time = time.time() + cooldown
    process = manager.tasks[task_id]['process']

    while time.time() < end_time:
        if process.poll() is not None:
            # Process exited with a returncode before timeout!
            # Brief yield to let output queue threads flush
            time.sleep(0.02)
            break
        time.sleep(0.03)

    output = manager.get_output(task_id)
    return jsonify(output)

@app.route('/api/task/stdout/<task_id>', methods=['GET'])
def stdout_task_endpoint(task_id):
    return jsonify(manager.get_output(task_id))

@app.route('/api/task/input/<task_id>', methods=['POST'])
def input_task_endpoint(task_id):
    data = request.json or {}
    input_type = data.get('type') or ('keycode' if 'combination' in data else 'text')
    combination = data.get('combination', '')
    input_string = data.get('field') if data.get('field') is not None else data.get('input_string', '')
    press_enter = data.get('press_enter', True)
    return jsonify(manager.send_input(task_id, input_string=input_string, input_type=input_type, combination=combination, press_enter=press_enter))

@app.route('/api/task/kill/<task_id>', methods=['POST'])
def kill_task_endpoint(task_id):
    return jsonify(manager.kill_task(task_id))

@app.route('/api/task/idle', methods=['POST'])
def idle_endpoint():
    data = request.json or {}
    seconds = max(0.1, min(300.0, float(data.get('seconds', 5))))
    task_id = data.get('task_id')
    wake_on = data.get('wake_on', 'exit')
    reason = data.get('reason', '')

    start_time = time.time()
    end_time = start_time + seconds

    if task_id and task_id in manager.tasks:
        process = manager.tasks[task_id]['process']
        q = manager.tasks[task_id]['queue']

        while time.time() < end_time:
            if wake_on in ('exit', 'any') and process.poll() is not None:
                time.sleep(0.02)
                output = manager.get_output(task_id)
                output['status'] = 'task_completed'
                output['elapsed_seconds'] = round(time.time() - start_time, 2)
                output['reason'] = reason
                return jsonify(output)

            if wake_on in ('output', 'any') and not q.empty():
                time.sleep(0.02)
                output = manager.get_output(task_id)
                output['status'] = 'task_output'
                output['elapsed_seconds'] = round(time.time() - start_time, 2)
                output['reason'] = reason
                return jsonify(output)

            time.sleep(0.04)

        output = manager.get_output(task_id)
        output['status'] = 'timer_expired'
        output['elapsed_seconds'] = round(time.time() - start_time, 2)
        output['reason'] = reason
        return jsonify(output)
    else:
        # Standalone timer cooldown
        time.sleep(seconds)
        return jsonify({
            'status': 'timer_expired',
            'elapsed_seconds': round(time.time() - start_time, 2),
            'reason': reason
        })

if __name__ == '__main__':
    # Run the Python backend silently on port 5000
    app.run(port=5000)
