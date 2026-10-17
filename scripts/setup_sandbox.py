#!/usr/bin/env python3
"""
MultiAI Termux PRoot Sandbox Provisioner
=========================================
Installs and provisions the dedicated 'debian-sandbox' container
using proot-distro for safe, isolated task server execution in Termux.
"""

import sys
import os
import shutil
import subprocess
import json
from pathlib import Path

# ANSI colors
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

if not sys.stdout.isatty():
    CYAN = GREEN = YELLOW = RED = BOLD = DIM = RESET = ""

def log(msg):
    print(f"{CYAN}[MultiAI Sandbox]{RESET} {msg}", flush=True)

def log_success(msg):
    print(f"{GREEN}[MultiAI Sandbox]{RESET} {msg}", flush=True)

def log_warn(msg):
    print(f"{YELLOW}[MultiAI Sandbox]{RESET} {msg}", flush=True)

def log_error(msg):
    print(f"{RED}[MultiAI Sandbox ERROR]{RESET} {msg}", flush=True)

def get_pd_cmd():
    if shutil.which("pd"):
        return "pd"
    if shutil.which("proot-distro"):
        return "proot-distro"
    return None

def is_container_installed(pd_cmd, name="debian-sandbox"):
    prefix = os.environ.get("PREFIX", "/data/data/com.termux/files/usr")
    rootfs_dir = Path(prefix) / "var/lib/proot-distro/installed-rootfs" / name
    if rootfs_dir.is_dir():
        return True

    res = subprocess.run([pd_cmd, "login", name, "--", "true"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return res.returncode == 0

def configure_multiai_sandbox_config():
    home = Path.home()
    config_dir = home / ".MultiAI"
    config_dir.mkdir(parents=True, exist_ok=True)
    config_file = config_dir / "vm_conf.json"

    data = {}
    if config_file.is_file():
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}

    data["enabled"] = True
    data["active_profile"] = "proot"

    if "profiles" not in data:
        data["profiles"] = {}

    data["profiles"]["proot"] = {
        "id": "proot",
        "name": "PRoot Distro",
        "badge": "Android / Termux",
        "description": "Syscall emulation sandbox for non-root containers and Termux environments.",
        "icon": "smartphone",
        "mode": "daemon",
        "startup": "pd sh debian-sandbox --bind {PROJECT_PATH}:/workspace --bind {DATA_DIR}:/data -- python3 /workspace/task_server.py --port {TASK_PORT}",
        "detect_cmd": "(command -v pd || command -v proot-distro) && (pd login debian-sandbox -- true 2>/dev/null || proot-distro login debian-sandbox -- true 2>/dev/null || [ -d \"${PREFIX:-/data/data/com.termux/files/usr}/var/lib/proot-distro/installed-rootfs/debian-sandbox\" ])"
    }

    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    log_success(f"Updated MultiAI sandbox config at {config_file} (enabled: true, profile: proot)")

def main():
    print(f"{BOLD}{CYAN}=============================================================={RESET}")
    print(f"{BOLD} MultiAI - PRoot Sandbox Setup ('debian-sandbox') {RESET}")
    print(f"{BOLD}{CYAN}=============================================================={RESET}\n")

    is_termux = (
        sys.platform == "android"
        or "TERMUX_VERSION" in os.environ
        or os.path.exists("/data/data/com.termux")
    )

    pd_cmd = get_pd_cmd()

    if not pd_cmd:
        if is_termux and shutil.which("pkg"):
            log_warn("'proot-distro' not detected. Installing via pkg...")
            res = subprocess.run(["pkg", "install", "-y", "proot-distro"])
            if res.returncode != 0:
                log_error("Failed to install proot-distro. Please run 'pkg install proot-distro' manually.")
                sys.exit(1)
            pd_cmd = get_pd_cmd()
        else:
            log_error("'proot-distro' command not found. This script requires Termux or a proot-distro environment.")
            sys.exit(1)

    log(f"Using proot-distro CLI: {BOLD}{pd_cmd}{RESET}")

    container_name = "debian-sandbox"
    already_installed = is_container_installed(pd_cmd, container_name)

    if already_installed:
        log_success(f"Container '{container_name}' is already installed!")
    else:
        log(f"Installing dedicated Debian container '{container_name}'...")
        install_cmd = [pd_cmd, "install", "debian", "--name", container_name]
        res = subprocess.run(install_cmd)
        if res.returncode != 0:
            log_warn(f"'{pd_cmd} install debian --name {container_name}' exited with {res.returncode}.")
            log("Attempting fallback install without custom name...")
            res2 = subprocess.run([pd_cmd, "install", "debian"])
            if res2.returncode != 0:
                log_error("Failed to install Debian container via proot-distro.")
                sys.exit(1)

    log("Provisioning Python 3 inside the sandbox container...")
    provision_script = "apt update && apt install -y --no-install-recommends python3 python3-pip curl procps"
    res = subprocess.run([pd_cmd, "login", container_name, "--", "sh", "-c", provision_script])
    if res.returncode != 0:
        log_warn("Package provisioning finished with warnings. Testing Python 3 directly...")

    test_res = subprocess.run([pd_cmd, "login", container_name, "--", "python3", "--version"], capture_output=True, text=True)
    if test_res.returncode == 0:
        py_ver = test_res.stdout.strip() or test_res.stderr.strip()
        log_success(f"Python 3 verified inside '{container_name}': {BOLD}{py_ver}{RESET}")
    else:
        log_warn(f"Could not verify python3 inside container: {test_res.stderr.strip()}")

    configure_multiai_sandbox_config()

    print(f"\n{BOLD}{GREEN}=============================================================={RESET}")
    print(f"{BOLD}{GREEN}  ✓ MultiAI PRoot Sandbox is configured and ready!{RESET}")
    print(f"  Container: {container_name}")
    print(f"  Status:    Enabled (active_profile: proot)")
    print(f"  Run MultiAI with: {CYAN}npm start{RESET} or {CYAN}node src/index.js{RESET}")
    print(f"{BOLD}{GREEN}=============================================================={RESET}\n")

if __name__ == "__main__":
    main()
