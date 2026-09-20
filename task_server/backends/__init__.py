"""
Task Server Backends Factory
============================
Automatically exports the platform-optimized TaskManager for Linux, macOS, or Windows.
"""
import sys

if sys.platform == "win32":
    from .windows import WindowsTaskManager as TaskManager
else:
    from .posix import PosixTaskManager as TaskManager

__all__ = ["TaskManager"]
