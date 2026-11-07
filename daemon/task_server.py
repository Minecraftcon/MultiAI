#!/usr/bin/env python3
"""
MultiAI Universal Task Server (Root Launcher)
=============================================
Delegates to daemon/python/server.py.
"""
import os
import sys

_curr_dir = os.path.dirname(os.path.abspath(__file__))
_py_dir = os.path.join(_curr_dir, "python")
if _py_dir not in sys.path:
    sys.path.insert(0, _py_dir)

from server import main

if __name__ == "__main__":
    main()
