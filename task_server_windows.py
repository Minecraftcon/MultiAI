#!/usr/bin/env python3
"""
MultiAI Windows Task Server (Compatibility Launcher)
===================================================
Delegates to the modular task_server package which automatically selects WindowsTaskManager.
"""
from task_server.server import main

if __name__ == "__main__":
    main()
