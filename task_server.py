from flask import Flask, request, jsonify
import subprocess
import threading
import queue
import uuid
import time

app = Flask(__name__)

class TaskManager:
    def __init__(self):
        self.tasks = {}

    def _enqueue_output(self, out, queue_obj, stream_name):
        try:
            for line in iter(out.readline, b''):
                queue_obj.put((stream_name, line.decode('utf-8', errors='replace')))
        except ValueError:
            pass 
        finally:
            out.close()

    def run_task(self, command: str) -> str:
        task_id = str(uuid.uuid4())[:8]
        
        process = subprocess.Popen(
            command,
            shell=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0 
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

    def send_input(self, task_id: str, input_string: str) -> dict:
        if task_id not in self.tasks:
            return {"error": f"Task {task_id} not found."}
            
        process = self.tasks[task_id]['process']
        if process.poll() is not None:
            return {"error": f"Task {task_id} is no longer running."}
            
        try:
            if not input_string.endswith('\n'):
                input_string += '\n'
            process.stdin.write(input_string.encode('utf-8'))
            process.stdin.flush()
            return {"status": "Input sent successfully."}
        except Exception as e:
            return {"error": f"Failed to send input: {str(e)}"}

    def kill_task(self, task_id: str) -> dict:
        if task_id not in self.tasks:
            return {"error": f"Task {task_id} not found."}
            
        process = self.tasks[task_id]['process']
        if process.poll() is None:
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
        
    task_id = manager.run_task(command)
    
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
    return jsonify(manager.send_input(task_id, data.get('input_string', '')))

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
