"""
Task Server Configuration Constants
"""
import os

DEFAULT_PORT = int(os.environ.get("TASK_SERVER_PORT", 5000))
DEFAULT_HOST = os.environ.get("TASK_SERVER_HOST", "127.0.0.1")
BUFFER_CHUNK_SIZE = 1024
DEFAULT_SHELL = os.environ.get("TASK_SERVER_SHELL", "cmd" if os.name == "nt" else "bash").lower()
