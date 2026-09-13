#!/usr/bin/env python3
"""
MultiAI Universal Starter & Supervisor
=====================================
Automatic setup detection, dependency installation, and clean auto-kill on stop.

Features:
- Detects and verifies Node.js, npm, and Python prerequisites.
- Auto-installs missing npm packages (`npm install`) and Python packages (`flask`).
- Automatically resolves port conflicts on 8080 and 5000 before launch.
- Starts MultiSearch AI and opens it in your default browser.
- Auto-kills everything cleanly on exit (Ctrl+C / SIGINT / SIGTERM / atexit),
  leaving zero zombie background processes on ports 8080 or 5000.
"""

import sys
import os
import subprocess
import signal
import time
import socket
import threading
import webbrowser
import atexit
import argparse

# Enable unbuffered / line-buffered stdout so logs stream immediately
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

# ANSI Color Codes
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

# Disable ANSI colors if output is not a terminal or running on older Windows cmd without VT100
if not sys.stdout.isatty() or (sys.platform == "win32" and "WT_SESSION" not in os.environ and "TERM" not in os.environ):
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
    except Exception:
        CYAN = GREEN = YELLOW = RED = BOLD = DIM = RESET = ""

def log_info(msg):
    print(f"{CYAN}[MultiAI]{RESET} {msg}", flush=True)

def log_success(msg):
    print(f"{GREEN}[MultiAI]{RESET} {msg}", flush=True)

def log_warn(msg):
    print(f"{YELLOW}[MultiAI]{RESET} {msg}", flush=True)

def log_error(msg):
    print(f"{RED}[MultiAI ERROR]{RESET} {msg}", flush=True)

def is_port_in_use(port, host="127.0.0.1"):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex((host, port)) == 0

def kill_process_on_port(port):
    """Find and terminate any stale process holding a port."""
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(f"netstat -ano | findstr :{port}", shell=True, text=True)
            for line in out.strip().splitlines():
                parts = line.split()
                if len(parts) >= 5 and "LISTENING" in parts:
                    pid = parts[-1]
                    log_warn(f"Releasing port {port} (killing PID {pid})...")
                    subprocess.run(f"taskkill /F /T /PID {pid}", shell=True, capture_output=True)
        except Exception:
            pass
    else:
        try:
            out = subprocess.check_output(["lsof", "-ti", f":{port}"], text=True, stderr=subprocess.DEVNULL)
            for pid in out.strip().splitlines():
                if pid.isdigit() and int(pid) != os.getpid():
                    log_warn(f"Releasing port {port} (killing PID {pid})...")
                    try:
                        os.kill(int(pid), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
        except Exception:
            try:
                subprocess.run(f"fuser -k -n tcp {port}", shell=True, capture_output=True)
            except Exception:
                pass

def check_setup():
    """Verify prerequisites and auto-install missing packages."""
    print(f"\n{BOLD}{CYAN}=== MultiSearch AI Setup & Pre-Flight Check ==={RESET}\n", flush=True)

    # 1. Check Python version
    py_ver = sys.version_info
    if py_ver < (3, 8):
        log_error(f"Python 3.8+ is required. Detected Python {py_ver.major}.{py_ver.minor}.")
        sys.exit(1)
    log_success(f"Python version: {py_ver.major}.{py_ver.minor}.{py_ver.micro}")

    # 2. Check Node.js
    try:
        node_ver = subprocess.check_output(["node", "-v"], text=True, stderr=subprocess.STDOUT).strip()
        log_success(f"Node.js found: {node_ver}")
    except (FileNotFoundError, subprocess.CalledProcessError):
        log_error("Node.js is not installed or not in PATH.")
        log_info("Please install Node.js (https://nodejs.org) to run MultiSearch AI.")
        sys.exit(1)

    # 3. Check npm
    try:
        npm_ver = subprocess.check_output(["npm", "-v"], text=True, stderr=subprocess.STDOUT).strip()
        log_success(f"npm found: v{npm_ver}")
    except (FileNotFoundError, subprocess.CalledProcessError):
        log_error("npm is not installed or not in PATH.")
        sys.exit(1)

    # 4. Check Node dependencies (yaml)
    root_dir = os.path.dirname(os.path.abspath(__file__))
    node_modules_dir = os.path.join(root_dir, "node_modules")
    yaml_pkg_dir = os.path.join(node_modules_dir, "yaml")

    if not os.path.exists(yaml_pkg_dir):
        log_warn("Node dependencies not detected. Running 'npm install'...")
        res = subprocess.run(["npm", "install"], cwd=root_dir)
        if res.returncode != 0:
            log_error("Failed to install npm dependencies.")
            sys.exit(1)
        log_success("Node dependencies installed successfully.")
    else:
        log_success("Node dependencies verified (node_modules/yaml present).")

    # 5. Check Python dependencies (flask for task server)
    try:
        import flask
        log_success(f"Python Flask verified.")
    except ImportError:
        log_warn("Flask is not installed for Python. Auto-installing Flask...")
        res = subprocess.run([sys.executable, "-m", "pip", "install", "flask"], cwd=root_dir)
        if res.returncode != 0:
            log_warn("Pip install failed. Task server will attempt fallback if available.")
        else:
            log_success("Flask installed successfully.")

    # 6. Check models.yaml
    models_file = os.path.join(root_dir, "models.yaml")
    if not os.path.exists(models_file):
        log_warn("models.yaml not found in project root. Some models may need configuration.")
    else:
        log_success("models.yaml found.")

    print(f"\n{GREEN}All dependencies and setup checks passed!{RESET}\n", flush=True)

class ProcessSupervisor:
    def __init__(self):
        self.processes = []
        self.is_shutting_down = False
        self.lock = threading.Lock()

    def spawn(self, name, cmd, color=RESET, cwd=None):
        """Spawn a child process in a new process group for clean termination."""
        prefix = f"{color}[{name}]{RESET} "
        
        kwargs = {
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "cwd": cwd,
            "text": True,
            "bufsize": 1
        }
        
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["preexec_fn"] = os.setsid

        proc = subprocess.Popen(cmd, **kwargs)
        self.processes.append((name, proc))

        # Stream output in background thread
        def stream_output():
            try:
                for line in iter(proc.stdout.readline, ''):
                    if line:
                        print(prefix + line.rstrip(), flush=True)
            except Exception:
                pass
            finally:
                if proc.stdout:
                    proc.stdout.close()

        t = threading.Thread(target=stream_output, daemon=True)
        t.start()
        return proc

    def stop_all(self):
        """Gracefully and thoroughly terminate all child processes and process trees."""
        with self.lock:
            if self.is_shutting_down:
                return
            self.is_shutting_down = True

        print(f"\n{YELLOW}[MultiAI] Stopping all servers...{RESET}", flush=True)

        for name, proc in self.processes:
            if proc.poll() is None:
                log_info(f"Stopping {name} (PID {proc.pid})...")
                if sys.platform == "win32":
                    try:
                        subprocess.run(f"taskkill /F /T /PID {proc.pid}", shell=True, capture_output=True)
                    except Exception:
                        proc.terminate()
                else:
                    try:
                        pgid = os.getpgid(proc.pid)
                        os.killpg(pgid, signal.SIGTERM)
                    except Exception:
                        proc.terminate()

        # Allow brief grace period
        deadline = time.time() + 1.5
        for name, proc in self.processes:
            while proc.poll() is None and time.time() < deadline:
                time.sleep(0.1)

        # Force kill any stubborn process
        for name, proc in self.processes:
            if proc.poll() is None:
                log_warn(f"Force-killing {name}...")
                if sys.platform != "win32":
                    try:
                        pgid = os.getpgid(proc.pid)
                        os.killpg(pgid, signal.SIGKILL)
                    except Exception:
                        proc.kill()
                else:
                    proc.kill()

        # Clean up ports 8080 and 5000 to guarantee nothing lingers
        kill_process_on_port(8080)
        kill_process_on_port(5000)

        print(f"{GREEN}[MultiAI] All servers stopped cleanly. Goodbye!{RESET}\n", flush=True)

import configparser

def get_config_port(default_port=8080):
    try:
        cfg = configparser.ConfigParser()
        ini_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.ini")
        if os.path.exists(ini_path):
            cfg.read(ini_path)
            if "General" in cfg and "Port" in cfg["General"]:
                return int(cfg["General"]["Port"])
    except Exception:
        pass
    return default_port

def main():
    configured_port = get_config_port(8080)
    parser = argparse.ArgumentParser(description="MultiAI Universal Starter & Supervisor")
    parser.add_argument("--check-only", action="store_true", help="Run setup check and exit without starting servers")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser automatically")
    parser.add_argument("--port", type=int, default=configured_port, help=f"Web server port (default: {configured_port})")
    args = parser.parse_args()

    root_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root_dir)

    # 1. Run Pre-Flight Setup Check
    check_setup()

    if args.check_only:
        sys.exit(0)

    # 2. Check for port conflicts and clean up stale instances
    for p in (args.port, 5000):
        if is_port_in_use(p):
            log_warn(f"Port {p} is in use by a stale process. Releasing port...")
            kill_process_on_port(p)
            time.sleep(0.4)

    supervisor = ProcessSupervisor()

    # Register exit handlers for auto-kill on stop
    def handle_signal(sig, frame):
        supervisor.stop_all()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, handle_signal)
    atexit.register(supervisor.stop_all)

    # 3. Start Node.js Web Server (which also supervises the Python task server on port 5000)
    log_info(f"Starting MultiAI on port {args.port} (node server.js)...")
    supervisor.spawn("Server", ["node", "server.js"], color=GREEN, cwd=root_dir)

    # 4. Wait for server to become ready
    ready = False
    for _ in range(40):
        if is_port_in_use(args.port):
            ready = True
            break
        time.sleep(0.2)

    url = f"http://localhost:{args.port}"

    if ready:
        time.sleep(0.4)
        print("\n" + "=" * 62, flush=True)
        print(f"  {BOLD}{GREEN}✓ MultiSearch AI is live and ready!{RESET}", flush=True)
        print(f"  {BOLD}Local URL:{RESET} {CYAN}{url}{RESET}", flush=True)
        print(f"  {DIM}Auto-kill active: Press Ctrl+C at any time to shut down.{RESET}", flush=True)
        print("=" * 62 + "\n", flush=True)

        if not args.no_browser:
            try:
                webbrowser.open(url)
            except Exception:
                pass
    else:
        log_warn("Server startup is taking longer than expected. Check logs above.")

    # Main monitoring loop
    try:
        while True:
            for name, proc in supervisor.processes:
                if proc.poll() is not None and not supervisor.is_shutting_down:
                    log_warn(f"{name} exited with code {proc.returncode}.")
                    supervisor.stop_all()
                    sys.exit(proc.returncode or 1)
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        supervisor.stop_all()

if __name__ == "__main__":
    main()
