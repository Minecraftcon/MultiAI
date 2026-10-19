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
import shutil
import platform
import urllib.request
import urllib.error

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

def find_executable(name):
    """Resolve executable path across platforms (handling .exe, .cmd, .bat on Windows)."""
    found = shutil.which(name)
    if found:
        return found
    if sys.platform == "win32":
        for ext in [".cmd", ".bat", ".exe"]:
            found = shutil.which(name + ext)
            if found:
                return found
    return None

def get_platform_daemon_info():
    """
    Returns (binary_name, goos, goarch, goarm) for the current host architecture.
    """
    machine = platform.machine().lower()
    if sys.platform == "win32":
        goos = "windows"
        goarch = "arm64" if ("arm" in machine or "aarch64" in machine) else "amd64"
        return "task_daemon.exe", goos, goarch, None
    elif sys.platform == "darwin":
        goos = "darwin"
        goarch = "arm64" if ("arm" in machine or "aarch64" in machine) else "amd64"
        return f"task_daemon_darwin_{goarch}", goos, goarch, None
    else:  # Linux / Unix / Android
        goos = "linux"
        if machine in ("aarch64", "arm64", "armv8l", "armv8b", "armv8"):
            return "task_daemon_arm64", goos, "arm64", None
        elif machine.startswith("arm") or machine in ("armv7l", "armv7", "armhf", "armel"):
            return "task_daemon_armv7l", goos, "arm", "7"
        elif machine in ("x86_64", "amd64"):
            return "task_daemon", goos, "amd64", None
        elif machine in ("i386", "i686", "x86"):
            return "task_daemon_386", goos, "386", None
        else:
            return "task_daemon", goos, "amd64", None

def format_bytes(n_bytes):
    if n_bytes >= 1024 * 1024 * 1024:
        return f"{n_bytes / (1024 * 1024 * 1024):.2f} GB"
    elif n_bytes >= 1024 * 1024:
        return f"{n_bytes / (1024 * 1024):.2f} MB"
    elif n_bytes >= 1024:
        return f"{n_bytes / 1024:.1f} KB"
    return f"{int(n_bytes)} B"

def download_task_daemon(bin_name, target_path):
    """
    Attempt to download task daemon binary from GitHub Releases or configured mirror
    with an interactive progress bar.
    """
    base_url = os.environ.get(
        "MULTIAI_RELEASE_BASE_URL",
        "https://github.com/Minecraftcon/MultiAI/releases/latest/download"
    ).rstrip("/")
    download_url = f"{base_url}/{bin_name}"

    log_info(f"Downloading task daemon binary '{bin_name}'...")
    tmp_path = target_path + ".tmp"
    req = urllib.request.Request(
        download_url,
        headers={"User-Agent": "MultiAI-Starter/1.0"}
    )
    is_tty = sys.stdout.isatty()
    use_unicode = True
    try:
        enc = (sys.stdout.encoding or "").lower()
        if enc and enc not in ("utf-8", "utf8"):
            use_unicode = False
    except Exception:
        use_unicode = False

    fill_char = "█" if use_unicode else "="
    empty_char = "░" if use_unicode else " "

    try:
        with urllib.request.urlopen(req, timeout=30) as resp, open(tmp_path, "wb") as f:
            total_header = resp.headers.get("Content-Length")
            total_size = int(total_header) if total_header and total_header.isdigit() else 0
            downloaded = 0
            start_time = time.time()
            last_render_time = 0
            last_non_tty_pct = -1
            bar_width = 28
            chunk_size = 65536  # 64 KB chunks

            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                now = time.time()

                if is_tty:
                    # Throttle render updates to ~12 FPS (every 80ms) to prevent console flicker
                    if now - last_render_time >= 0.08 or (total_size and downloaded >= total_size):
                        last_render_time = now
                        elapsed = max(0.001, now - start_time)
                        speed = downloaded / elapsed
                        speed_str = f"{format_bytes(speed)}/s"
                        if total_size > 0:
                            pct = min(100.0, (downloaded / total_size) * 100)
                            filled = int(bar_width * (downloaded / total_size))
                            filled = min(bar_width, max(0, filled))
                            bar = fill_char * filled + empty_char * (bar_width - filled)
                            down_str = format_bytes(downloaded)
                            tot_str = format_bytes(total_size)
                            sys.stdout.write(
                                f"\r{CYAN}[MultiAI]{RESET} [{GREEN}{bar}{RESET}] {BOLD}{pct:5.1f}%{RESET} ({down_str}/{tot_str}, {speed_str})   "
                            )
                        else:
                            down_str = format_bytes(downloaded)
                            sys.stdout.write(
                                f"\r{CYAN}[MultiAI]{RESET} Downloading {bin_name}: {BOLD}{down_str}{RESET} ({speed_str})   "
                            )
                        sys.stdout.flush()
                else:
                    if total_size > 0:
                        pct = int((downloaded / total_size) * 100)
                        if pct // 20 > last_non_tty_pct:
                            last_non_tty_pct = pct // 20
                            log_info(f"Downloading {bin_name}: {pct}% ({format_bytes(downloaded)}/{format_bytes(total_size)})")

            if is_tty:
                sys.stdout.write("\n")
                sys.stdout.flush()

        if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 1024:
            if sys.platform != "win32":
                os.chmod(tmp_path, 0o755)
            os.replace(tmp_path, target_path)
            file_size_str = format_bytes(os.path.getsize(target_path))
            log_success(f"Task daemon binary downloaded successfully: {bin_name} ({file_size_str})")
            return True
        else:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            return False
    except urllib.error.HTTPError as e:
        if is_tty:
            sys.stdout.write("\n")
            sys.stdout.flush()
        log_warn(f"Download failed (HTTP {e.code} {e.reason}).")
    except Exception as e:
        if is_tty:
            sys.stdout.write("\n")
            sys.stdout.flush()
        log_warn(f"Download failed: {e}")
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
    return False

def ensure_task_daemon_binary(root_dir):
    """
    Verify the Go task daemon binary exists for the current platform/architecture.
    If missing, attempt auto-download from releases, or auto-compile if Go is installed.
    """
    bin_name, goos, goarch, goarm = get_platform_daemon_info()
    bin_dir = os.path.join(root_dir, "bin")
    os.makedirs(bin_dir, exist_ok=True)
    target_path = os.path.join(bin_dir, bin_name)

    # 1. Check if already present and non-empty
    if os.path.exists(target_path) and os.path.getsize(target_path) > 0:
        if sys.platform != "win32":
            try:
                st = os.stat(target_path)
                if not (st.st_mode & 0o111):
                    os.chmod(target_path, st.st_mode | 0o755)
            except Exception:
                pass
        log_success(f"Task server daemon binary verified ({bin_name}).")
        return True

    # 2. Check Android/Termux fallback if on ARM64
    if bin_name == "task_daemon_arm64":
        alt_path = os.path.join(bin_dir, "task_daemon_android_arm64")
        if os.path.exists(alt_path) and os.path.getsize(alt_path) > 0:
            log_success("Task server daemon binary verified (task_daemon_android_arm64).")
            return True

    log_warn(f"Task daemon binary '{bin_name}' not found in bin/.")

    # 3. Attempt auto-download from releases
    if download_task_daemon(bin_name, target_path):
        return True

    # 4. If download fails or is unavailable, check if Go compiler is available locally
    go_bin = find_executable("go")
    task_go_dir = os.path.join(root_dir, "task_server_go")
    if go_bin and os.path.isdir(task_go_dir):
        log_info(f"Found local Go compiler ({go_bin}). Compiling '{bin_name}' locally...")
        build_env = os.environ.copy()
        build_env["CGO_ENABLED"] = "0"
        build_env["GOOS"] = goos
        build_env["GOARCH"] = goarch
        if goarm:
            build_env["GOARM"] = goarm
        cmd = [go_bin, "build", "-ldflags=-s -w", "-o", target_path, "."]
        try:
            res = subprocess.run(cmd, cwd=task_go_dir, env=build_env, capture_output=True, text=True)
            if res.returncode == 0 and os.path.exists(target_path) and os.path.getsize(target_path) > 0:
                if sys.platform != "win32":
                    os.chmod(target_path, 0o755)
                log_success(f"Task daemon binary compiled locally: {bin_name}")
                return True
            else:
                err_msg = res.stderr.strip() if res.stderr else "Compilation failed"
                log_warn(f"Local Go build failed: {err_msg}")
        except Exception as e:
            log_warn(f"Failed to run Go compiler: {e}")

    log_warn(f"Task daemon binary '{bin_name}' is currently unavailable.")
    log_info("MultiAI will seamlessly use the Python Flask task server fallback.")
    return False

def get_user_home():
    if os.environ.get("MULTIAI_HOME") and os.path.isdir(os.environ["MULTIAI_HOME"]):
        return os.environ["MULTIAI_HOME"]
    termux_home = "/data/data/com.termux/files/home"
    if os.environ.get("TERMUX_VERSION") or (sys.platform == "linux" and os.path.isdir(termux_home)):
        home_env = os.environ.get("HOME", "")
        if home_env and home_env.endswith("/files/home") and os.path.isdir(home_env):
            return home_env
        if os.path.isdir(termux_home):
            return termux_home
        alt_termux_home = "/data/user/0/com.termux/files/home"
        if os.path.isdir(alt_termux_home):
            return alt_termux_home
        if os.environ.get("TERMUX_VERSION"):
            return termux_home
    home_env = os.environ.get("HOME", "")
    if home_env and home_env not in ("/", "/data", "/data/user/0/com.termux") and os.path.isdir(home_env):
        return home_env
    try:
        from pathlib import Path
        h = str(Path.home())
        if h and h not in ("/", "/data", "/data/user/0/com.termux") and os.path.isdir(h):
            return h
    except Exception:
        pass
    expanded = os.path.expanduser("~")
    if expanded and expanded not in ("/", "/data", "/data/user/0/com.termux") and os.path.isdir(expanded):
        return expanded
    if os.path.isdir(termux_home):
        return termux_home
    return home_env or "/tmp"

def get_user_storage_dir():
    home = get_user_home()
    user_dir = os.path.join(home, ".MultiAI")
    try:
        os.makedirs(user_dir, exist_ok=True)
    except Exception as e:
        log_warn(f"Could not create user configuration directory {user_dir}: {e}")
    return user_dir

def ensure_user_configuration(root_dir):
    """
    Ensure ~/.MultiAI exists and install config.ini and models.yaml if missing.
    """
    user_dir = get_user_storage_dir()

    # 1. Ensure config.ini in ~/.MultiAI
    user_config = os.path.join(user_dir, "config.ini")
    if not os.path.exists(user_config) or os.path.getsize(user_config) == 0:
        root_config = os.path.join(root_dir, "config.ini")
        example_config = os.path.join(root_dir, "config.example.ini")
        core_config = os.path.join(root_dir, "src", "core", "config.ini")
        src_path = None
        for candidate in [root_config, example_config, core_config]:
            if os.path.exists(candidate) and os.path.getsize(candidate) > 0:
                src_path = candidate
                break
        if src_path:
            try:
                shutil.copyfile(src_path, user_config)
                log_success(f"Installed default config.ini to {user_config}")
            except Exception as e:
                log_warn(f"Failed to copy config.ini to {user_config}: {e}")
    else:
        log_success(f"config.ini found ({user_config}).")

    # 2. Ensure models.yaml in ~/.MultiAI
    user_models = os.path.join(user_dir, "models.yaml")
    if not os.path.exists(user_models) or os.path.getsize(user_models) == 0:
        root_models = os.path.join(root_dir, "models.yaml")
        if os.path.exists(root_models) and os.path.getsize(root_models) > 0:
            try:
                shutil.copyfile(root_models, user_models)
                log_success(f"Installed default models.yaml to {user_models}")
            except Exception as e:
                log_warn(f"Failed to copy models.yaml to {user_models}: {e}")
    else:
        log_success(f"models.yaml found ({user_models}).")

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
    node_bin = find_executable("node")
    if not node_bin:
        log_error("Node.js is not installed or not in PATH.")
        log_info("Please install Node.js (https://nodejs.org) to run MultiSearch AI.")
        sys.exit(1)
    try:
        node_ver = subprocess.check_output([node_bin, "-v"], text=True, stderr=subprocess.STDOUT, shell=(sys.platform == "win32")).strip()
        log_success(f"Node.js found: {node_ver}")
    except (FileNotFoundError, subprocess.CalledProcessError):
        log_error("Node.js is not installed or not in PATH.")
        log_info("Please install Node.js (https://nodejs.org) to run MultiSearch AI.")
        sys.exit(1)

    # 3. Check npm
    npm_bin = find_executable("npm")
    if not npm_bin:
        log_error("npm is not installed or not in PATH.")
        sys.exit(1)
    try:
        npm_ver = subprocess.check_output([npm_bin, "-v"], text=True, stderr=subprocess.STDOUT, shell=(sys.platform == "win32")).strip()
        log_success(f"npm found: v{npm_ver}")
    except (FileNotFoundError, subprocess.CalledProcessError):
        log_error("npm is not installed or not in PATH.")
        sys.exit(1)

    # 4. Check Node dependencies (yaml, @langchain/langgraph, @langchain/core, @modelcontextprotocol/sdk)
    root_dir = os.path.dirname(os.path.abspath(__file__))
    node_modules_dir = os.path.join(root_dir, "node_modules")

    required_node_pkgs = [
        ("yaml", os.path.join(node_modules_dir, "yaml")),
        ("@langchain/langgraph", os.path.join(node_modules_dir, "@langchain", "langgraph")),
        ("@langchain/core", os.path.join(node_modules_dir, "@langchain", "core")),
        ("@modelcontextprotocol/sdk", os.path.join(node_modules_dir, "@modelcontextprotocol", "sdk"))
    ]

    missing_pkgs = [name for name, path in required_node_pkgs if not os.path.exists(path)]

    if missing_pkgs:
        log_warn(f"Node dependencies missing ({', '.join(missing_pkgs)}). Running 'npm install'...")
        res = subprocess.run([npm_bin, "install"], cwd=root_dir, shell=(sys.platform == "win32"))
        if res.returncode != 0:
            log_error("Failed to install npm dependencies.")
            sys.exit(1)
        log_success("Node dependencies installed successfully.")
    else:
        log_success("Node dependencies verified (yaml, @langchain/langgraph, @langchain/core, @modelcontextprotocol/sdk present).")

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

    # 6. Check & Initialize User Configuration (~/.MultiAI/config.ini & models.yaml)
    ensure_user_configuration(root_dir)

    # 7. Check Task Server Daemon Binary
    ensure_task_daemon_binary(root_dir)

    print(f"\n{GREEN}All dependencies and setup checks passed!{RESET}\n", flush=True)

class ProcessSupervisor:
    def __init__(self):
        self.processes = []
        self.service_configs = {}
        self.is_shutting_down = False
        self.is_restarting = False
        self.start_time = time.time()
        self.web_port = 8080
        self.web_host = "0.0.0.0"
        self.lock = threading.Lock()

    def spawn(self, name, cmd, color=RESET, cwd=None, env=None):
        """Spawn a child process in a new process group for clean termination."""
        prefix = f"{color}[{name}]{RESET} "
        
        self.service_configs[name] = {
            "cmd": cmd,
            "color": color,
            "cwd": cwd,
            "env": env
        }

        kwargs = {
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "cwd": cwd,
            "text": True,
            "bufsize": 1
        }
        if env is not None:
            kwargs["env"] = env
        
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["preexec_fn"] = os.setsid

        proc = subprocess.Popen(cmd, **kwargs)
        with self.lock:
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

    def stop_service(self, name):
        """Stop a specific named service without stopping the whole supervisor."""
        with self.lock:
            target_procs = [(n, p) for n, p in self.processes if n == name]
            self.processes = [(n, p) for n, p in self.processes if n != name]

        for n, proc in target_procs:
            if proc.poll() is None:
                log_info(f"Stopping {n} (PID {proc.pid})...")
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

        deadline = time.time() + 1.5
        for n, proc in target_procs:
            while proc.poll() is None and time.time() < deadline:
                time.sleep(0.1)
            if proc.poll() is None:
                log_warn(f"Force-killing {n}...")
                if sys.platform != "win32":
                    try:
                        pgid = os.getpgid(proc.pid)
                        os.killpg(pgid, signal.SIGKILL)
                    except Exception:
                        proc.kill()
                else:
                    proc.kill()

    def restart_service(self, name, port=None):
        """Restart a specific named service cleanly."""
        if name not in self.service_configs:
            log_error(f"Cannot restart unknown service: {name}")
            return False

        target_port = port or self.web_port
        probe_host = "127.0.0.1" if self.web_host in ("0.0.0.0", "", "::") else self.web_host

        self.is_restarting = True
        try:
            log_info(f"Restarting {name} on port {target_port}...")
            self.stop_service(name)
            time.sleep(0.3)
            kill_process_on_port(target_port)
            kill_process_on_port(5000)
            time.sleep(0.3)

            cfg = self.service_configs[name]
            self.spawn(name, cfg["cmd"], color=cfg["color"], cwd=cfg["cwd"], env=cfg["env"])

            # Wait for service readiness
            ready = False
            for _ in range(40):
                if is_port_in_use(target_port, host=probe_host):
                    ready = True
                    break
                time.sleep(0.2)
            return ready
        finally:
            self.is_restarting = False

    def stop_all(self):
        """Gracefully and thoroughly terminate all child processes and process trees."""
        with self.lock:
            if self.is_shutting_down:
                return
            self.is_shutting_down = True

        print(f"\n{YELLOW}[MultiAI] Stopping all servers...{RESET}", flush=True)

        for name, proc in list(self.processes):
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
        for name, proc in list(self.processes):
            while proc.poll() is None and time.time() < deadline:
                time.sleep(0.1)

        # Force kill any stubborn process
        for name, proc in list(self.processes):
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

        # Clean up configured web port and 5000 to guarantee nothing lingers
        kill_process_on_port(self.web_port)
        if self.web_port != 8080:
            kill_process_on_port(8080)
        kill_process_on_port(5000)

        # Clean up Unix domain socket if present
        sock_path = os.path.expanduser("~/.MultiAI/task_server.sock")
        if os.path.exists(sock_path):
            try:
                os.unlink(sock_path)
            except Exception:
                pass

        print(f"{GREEN}[MultiAI] All servers stopped cleanly. Goodbye!{RESET}\n", flush=True)

def run_console(supervisor, root_dir, workspace_dir, port, host="0.0.0.0"):
    """Interactive server-side console."""
    try:
        import readline
    except ImportError:
        pass

    display_host = "localhost" if host in ("0.0.0.0", "127.0.0.1", "") else host
    probe_host = "127.0.0.1" if host in ("0.0.0.0", "", "::") else host

    def print_help():
        print(f"\n{BOLD}{CYAN}MultiAI Server Console Commands:{RESET}")
        print(f"  {BOLD}stop{RESET} | {BOLD}exit{RESET} | {BOLD}quit{RESET}     Stop all servers and exit cleanly")
        print(f"  {BOLD}restart{RESET} | {BOLD}reload{RESET}       Restart web server and task server")
        print(f"  {BOLD}pull{RESET} [args]            Run 'git pull' and auto-restart if updated")
        print(f"  {BOLD}status{RESET} | {BOLD}info{RESET}         Show server status, active ports, PID, uptime")
        print(f"  {BOLD}conf{RESET} | {BOLD}config{RESET}         Open config.ini in editor ($EDITOR or nano)")
        print(f"  {BOLD}models{RESET} | {BOLD}model{RESET}       Open models.yaml in editor ($EDITOR or nano)")
        print(f"  {BOLD}clear{RESET} | {BOLD}cls{RESET}           Clear console screen")
        print(f"  {BOLD}help{RESET} | {BOLD}?{RESET}              Show this help message\n", flush=True)

    def print_status():
        uptime_sec = int(time.time() - supervisor.start_time)
        hrs = uptime_sec // 3600
        mins = (uptime_sec % 3600) // 60
        secs = uptime_sec % 60
        uptime_str = f"{hrs}h {mins}m {secs}s" if hrs > 0 else f"{mins}m {secs}s"

        branch = "unknown"
        commit = "unknown"
        try:
            branch = subprocess.check_output(["git", "branch", "--show-current"], cwd=root_dir, text=True, stderr=subprocess.DEVNULL).strip()
            commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=root_dir, text=True, stderr=subprocess.DEVNULL).strip()
        except Exception:
            pass

        print(f"\n{BOLD}{CYAN}=== MultiAI Server Status ==={RESET}")
        print(f"  {BOLD}State:{RESET}        {GREEN}Running{RESET}")
        print(f"  {BOLD}Web URL:{RESET}      {CYAN}http://{display_host}:{port}{RESET}")
        print(f"  {BOLD}Uptime:{RESET}       {uptime_str}")
        print(f"  {BOLD}Git Branch:{RESET}   {YELLOW}{branch}{RESET} ({commit})")
        sock_exists = os.path.exists(os.path.expanduser("~/.MultiAI/task_server.sock"))
        ipc_desc = f"Unix Socket (active: {sock_exists})" if sock_exists or sys.platform != "win32" else f"TCP 5000 (active: {is_port_in_use(5000, host='127.0.0.1')})"
        print(f"  {BOLD}Ports/IPC:{RESET}    Web: {port} (active: {is_port_in_use(port, host=probe_host)}), Task IPC: {ipc_desc}")
        print(f"  {BOLD}Processes:{RESET}")
        for name, proc in list(supervisor.processes):
            p_status = "Alive" if proc.poll() is None else f"Exited ({proc.returncode})"
            print(f"    - {name}: PID {proc.pid} [{p_status}]")
        print(f"{CYAN}============================={RESET}\n", flush=True)

    def do_pull(args_str="", force_restart=False):
        log_info("Fetching latest changes from git repository...")
        try:
            cmd = ["git", "pull"]
            if args_str:
                cmd.extend(args_str.split())
            res = subprocess.run(cmd, cwd=root_dir, text=True, capture_output=True)
            if res.returncode == 0:
                out = res.stdout.strip()
                print(f"{GREEN}{out}{RESET}", flush=True)
                if "Already up to date." not in out or force_restart:
                    log_success("Updates detected! Restarting server to apply updates...")
                    if supervisor.restart_service("Server", port=port):
                        log_success(f"MultiAI updated and live at http://{display_host}:{port}")
                    else:
                        log_error("Restart failed after pull. Type 'restart' to try again.")
                else:
                    log_info("Repository is already up to date. Use 'restart' if you wish to reload.")
            else:
                err = res.stderr.strip() or res.stdout.strip()
                log_error(f"Git pull failed:\n{err}")
        except Exception as e:
            log_error(f"Failed to execute git pull: {e}")

    # Wait briefly for startup logs to finish printing
    time.sleep(0.5)

    is_interactive = sys.stdin.isatty()
    prompt = f"{BOLD}{CYAN}multiai>{RESET} " if is_interactive else ""

    while not supervisor.is_shutting_down:
        try:
            if is_interactive:
                cmd_line = input(prompt).strip()
            else:
                line = sys.stdin.readline()
                if not line:
                    time.sleep(1)
                    continue
                cmd_line = line.strip()
        except (EOFError, KeyboardInterrupt):
            print()
            supervisor.stop_all()
            os._exit(0)
            break

        if not cmd_line:
            continue

        parts = cmd_line.split(maxsplit=1)
        command = parts[0].lower()
        arg = parts[1].strip() if len(parts) > 1 else ""

        if command in ("stop", "exit", "quit", "q", "shutdown"):
            log_info("Shutting down MultiAI server...")
            supervisor.stop_all()
            os._exit(0)

        elif command in ("restart", "reload", "r"):
            log_info(f"Restarting MultiAI on port {port}...")
            if supervisor.restart_service("Server", port=port):
                log_success(f"MultiAI restarted and live at http://localhost:{port}")
            else:
                log_error("Failed to restart cleanly. Check logs above.")

        elif command in ("pull", "update"):
            force_restart = "restart" in arg.lower()
            clean_arg = arg.replace("restart", "").strip()
            do_pull(clean_arg, force_restart=force_restart)

        elif command in ("status", "info", "st"):
            print_status()

        elif command in ("clear", "cls"):
            os.system("cls" if sys.platform == "win32" else "clear")
            print(f"\n{BOLD}{CYAN}MultiAI Console Active{RESET} (type 'help' for commands)\n", flush=True)

        elif command in ("conf", "config"):
            ini_path = resolve_config_ini_path()
            open_file_in_editor(ini_path, "MultiAI configuration", exit_on_done=False)

        elif command in ("models", "model"):
            models_path = resolve_models_path()
            open_file_in_editor(models_path, "MultiAI models configuration", exit_on_done=False)

        elif command in ("help", "?", "h"):
            print_help()

        else:
            print(f"{YELLOW}Unknown command: '{command}'. Type 'help' for available commands.{RESET}", flush=True)

import configparser
import shlex

def resolve_editor():
    editor = os.environ.get("EDITOR") or os.environ.get("VISUAL")
    if editor:
        cmd = shlex.split(editor)[0]
        if shutil.which(cmd):
            return editor
    for candidate in ["nano", "vim", "vi", "code", "notepad"]:
        if shutil.which(candidate):
            return candidate
    return editor or ("notepad" if sys.platform == "win32" else "nano")

def resolve_models_path():
    if os.environ.get("MULTIAI_MODELS_PATH") and os.path.exists(os.environ["MULTIAI_MODELS_PATH"]):
        return os.environ["MULTIAI_MODELS_PATH"]
    user_dir = get_user_storage_dir()
    user_models = os.path.join(user_dir, "models.yaml")
    if os.path.exists(user_models) and os.path.getsize(user_models) > 0:
        return user_models
    root_dir = os.path.dirname(os.path.abspath(__file__))
    root_models = os.path.join(root_dir, "models.yaml")
    if os.path.exists(root_models) and os.path.getsize(root_models) > 0:
        try:
            shutil.copyfile(root_models, user_models)
            return user_models
        except Exception:
            return root_models
    return user_models

def open_file_in_editor(file_path, label="configuration", exit_on_done=True):
    editor = resolve_editor()
    print(f"{CYAN}[MultiAI]{RESET} Opening {label} in {editor}: {file_path}", flush=True)
    cmd_parts = shlex.split(editor) + [file_path]
    try:
        res = subprocess.call(cmd_parts)
        if exit_on_done:
            sys.exit(res)
    except FileNotFoundError:
        log_error(f"Editor '{editor}' not found. Please install nano or set the EDITOR environment variable (e.g. export EDITOR=vim).")
        if exit_on_done:
            sys.exit(1)

def resolve_config_ini_path():
    if os.environ.get("MULTIAI_CONFIG_PATH") and os.path.exists(os.environ["MULTIAI_CONFIG_PATH"]):
        return os.environ["MULTIAI_CONFIG_PATH"]
    user_dir = get_user_storage_dir()
    user_config = os.path.join(user_dir, "config.ini")
    if os.path.exists(user_config) and os.path.getsize(user_config) > 0:
        return user_config
    root_dir = os.path.dirname(os.path.abspath(__file__))
    root_config = os.path.join(root_dir, "config.ini")
    example_config = os.path.join(root_dir, "config.example.ini")
    core_config = os.path.join(root_dir, "src", "core", "config.ini")
    for cand in [root_config, example_config, core_config]:
        if os.path.exists(cand) and os.path.getsize(cand) > 0:
            try:
                shutil.copyfile(cand, user_config)
                return user_config
            except Exception:
                return cand
    return user_config

def get_config_general(default_port=8080, default_host="0.0.0.0"):
    port = default_port
    host = default_host
    task_daemon = None
    try:
        cfg = configparser.ConfigParser()
        ini_path = resolve_config_ini_path()
        if os.path.exists(ini_path):
            cfg.read(ini_path)
            if "General" in cfg:
                if "Port" in cfg["General"]:
                    val = str(cfg["General"]["Port"]).strip()
                    if val.isdigit():
                        port = int(val)
                if "Host" in cfg["General"]:
                    h = str(cfg["General"]["Host"]).strip().strip("\"'")
                    if h:
                        host = h
                if "TaskServer" in cfg["General"]:
                    task_daemon = str(cfg["General"]["TaskServer"]).strip().lower()
                elif "TaskDaemon" in cfg["General"]:
                    task_daemon = str(cfg["General"]["TaskDaemon"]).strip().lower()
            if "Agent" in cfg:
                if "TaskServer" in cfg["Agent"]:
                    task_daemon = str(cfg["Agent"]["TaskServer"]).strip().lower()
                elif "TaskDaemon" in cfg["Agent"]:
                    task_daemon = str(cfg["Agent"]["TaskDaemon"]).strip().lower()
    except Exception:
        pass
    if task_daemon == "golang":
        task_daemon = "go"
    return port, host, task_daemon

def main():
    configured_port, configured_host, configured_task_daemon = get_config_general(8080, "0.0.0.0")
    parser = argparse.ArgumentParser(description="MultiAI Universal Starter & Supervisor")
    parser.add_argument("--check-only", action="store_true", help="Run setup check and exit without starting servers")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser automatically")
    parser.add_argument("--port", type=int, default=configured_port, help=f"Web server port (default: {configured_port})")
    parser.add_argument("--host", type=str, default=configured_host, help=f"Web server host (default: {configured_host})")
    parser.add_argument("--workspace", type=str, default=None, help="Target workspace directory (default: current directory)")
    parser.add_argument("--ipc", choices=["socket", "tcp"], default=None, help="IPC transport type between Node.js and Python task server ('socket' for Unix domain socket, 'tcp' for TCP port 5000)")
    parser.add_argument("--socket", action="store_true", help="Force Unix domain socket IPC")
    parser.add_argument("--tcp", action="store_true", help="Force TCP IPC on port 5000")
    parser.add_argument("--task-daemon", "--task-server", dest="task_daemon", choices=["python", "go"], default=configured_task_daemon, help="Task server daemon engine ('python' or 'go')")
    parser.add_argument("command", nargs="?", choices=["conf", "config", "models", "model"], help="Subcommand: 'conf' to edit config.ini, 'models' to edit models.yaml ($EDITOR or default nano)")
    args = parser.parse_args()

    if args.command in ("conf", "config"):
        ini_path = resolve_config_ini_path()
        open_file_in_editor(ini_path, "MultiAI configuration")
    elif args.command in ("models", "model"):
        models_path = resolve_models_path()
        open_file_in_editor(models_path, "MultiAI models configuration")

    probe_host = "127.0.0.1" if args.host in ("0.0.0.0", "", "::") else args.host
    display_host = "localhost" if args.host in ("0.0.0.0", "127.0.0.1", "") else args.host

    root_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_dir = os.path.abspath(args.workspace or os.environ.get("MULTIAI_WORKSPACE_DIR") or os.getcwd())
    os.makedirs(workspace_dir, exist_ok=True)
    os.chdir(root_dir)

    # Resolve IPC transport mode (CLI flag > env var > default: unix socket on POSIX, tcp on Windows)
    ipc_mode = None
    if args.ipc:
        ipc_mode = args.ipc
    elif args.socket:
        ipc_mode = "socket"
    elif args.tcp:
        ipc_mode = "tcp"
    elif os.environ.get("MULTIAI_IPC"):
        ipc_mode = os.environ.get("MULTIAI_IPC").strip().lower()

    # 1. Run Pre-Flight Setup Check
    check_setup()

    if args.check_only:
        sys.exit(0)

    # 2. Check for port conflicts and clean up stale instances
    ports_to_check = [args.port]
    if ipc_mode == "tcp" or (not ipc_mode and sys.platform == "win32"):
        ports_to_check.append(5000)

    for p in ports_to_check:
        target_probe = probe_host if p == args.port else "127.0.0.1"
        if is_port_in_use(p, host=target_probe):
            log_warn(f"Port {p} is in use by a stale process. Releasing port...")
            kill_process_on_port(p)
            time.sleep(0.4)

    supervisor = ProcessSupervisor()
    supervisor.web_port = args.port
    supervisor.web_host = args.host

    # Register exit handlers for auto-kill on stop
    def handle_signal(sig, frame):
        supervisor.stop_all()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, handle_signal)
    atexit.register(supervisor.stop_all)

    # 3. Start Node.js Web Server (which also supervises the Python task server)
    server_script = os.path.join(root_dir, "src", "index.js")
    node_env = os.environ.copy()
    node_env["PORT"] = str(args.port)
    node_env["HOST"] = str(args.host)
    node_env["MULTIAI_REPO_DIR"] = root_dir
    node_env["MULTIAI_WORKSPACE_DIR"] = workspace_dir
    node_env["MULTIAI_SUPERVISED"] = "1"
    if ipc_mode:
        node_env["MULTIAI_IPC"] = ipc_mode
    if args.task_daemon:
        node_env["MULTIAI_TASK_DAEMON"] = args.task_daemon
    node_env["MULTIAI_HOME"] = get_user_home()
    ini_path = resolve_config_ini_path()
    node_env["MULTIAI_CONFIG_PATH"] = ini_path
    models_path = resolve_models_path()
    node_env["MULTIAI_MODELS_PATH"] = models_path

    node_modules_path = os.path.join(root_dir, "node_modules")
    existing_node_path = node_env.get("NODE_PATH", "")
    node_env["NODE_PATH"] = f"{node_modules_path}:{existing_node_path}" if existing_node_path else node_modules_path
    existing_py_path = node_env.get("PYTHONPATH", "")
    node_env["PYTHONPATH"] = f"{root_dir}:{existing_py_path}" if existing_py_path else root_dir

    node_bin = find_executable("node") or "node"
    log_info(f"Starting MultiAI on {display_host}:{args.port} (workspace: {workspace_dir})...")
    supervisor.spawn("Server", [node_bin, "--watch", server_script], color=GREEN, cwd=workspace_dir, env=node_env)

    # 4. Wait for server to become ready
    ready = False
    for _ in range(40):
        if is_port_in_use(args.port, host=probe_host):
            ready = True
            break
        time.sleep(0.2)

    url = f"http://{display_host}:{args.port}"

    if ready:
        time.sleep(0.4)
        print("\n" + "=" * 62, flush=True)
        print(f"  {BOLD}{GREEN}✓ MultiSearch AI is live and ready!{RESET}", flush=True)
        print(f"  {BOLD}Local URL:{RESET} {CYAN}{url}{RESET}", flush=True)
        print(f"  {BOLD}Server Console:{RESET} Type {CYAN}help{RESET} for commands ({CYAN}stop{RESET}, {CYAN}restart{RESET}, {CYAN}pull{RESET}, {CYAN}status{RESET})", flush=True)
        print(f"  {DIM}Press Ctrl+C or type 'stop' to shut down.{RESET}", flush=True)
        print("=" * 62 + "\n", flush=True)

        if not args.no_browser:
            try:
                webbrowser.open(url)
            except Exception:
                pass
    else:
        log_warn("Server startup is taking longer than expected. Check logs above.")

    # Start Interactive Server Console Thread
    console_thread = threading.Thread(
        target=run_console,
        args=(supervisor, root_dir, workspace_dir, args.port, args.host),
        daemon=True,
        name="ServerConsole"
    )
    console_thread.start()

    # Main monitoring loop
    try:
        while not supervisor.is_shutting_down:
            if not supervisor.is_restarting:
                for name, proc in list(supervisor.processes):
                    if proc.poll() is not None and not supervisor.is_shutting_down and not supervisor.is_restarting:
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
