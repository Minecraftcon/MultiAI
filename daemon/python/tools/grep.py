"""
Fast Byte Scanner & Code Grep Engine
===================================
High-performance in-process byte scanning with directory inode pruning.
"""
import os
import re
import time
import fnmatch
from typing import Dict, Any, List, Optional


def execute_code_grep(
    query: str,
    search_path: str = ".",
    is_regex: bool = False,
    case_sensitive: bool = False,
    include_glob: Optional[str] = None,
    files_only: bool = False,
    max_results: int = 50
) -> Dict[str, Any]:
    query_str = str(query or "").strip()
    if not query_str:
        raise ValueError("Parameter 'query' is required")

    resolved_path = os.path.expanduser(search_path)
    if not os.path.exists(resolved_path):
        raise FileNotFoundError(f"Path not found: {search_path}")

    max_lim = min(100, max(1, int(max_results or 50)))

    try:
        raw_pat = query_str if is_regex else re.escape(query_str)
        flags = 0 if case_sensitive else re.IGNORECASE
        pattern = re.compile(raw_pat.encode("utf-8"), flags)
    except Exception as e:
        raise ValueError(f"Invalid regular expression: {str(e)}")

    include_patterns = [p.strip() for p in include_glob.split(",") if p.strip()] if include_glob else []
    ignore_dirs = {".git", "node_modules", "dist", ".venv", "venv", "__pycache__", ".mitm", ".idea", ".vscode"}

    matches: List[Dict[str, Any]] = []
    files_matched: List[str] = []
    total_scanned = 0
    start_time = time.perf_counter()

    def check_file(file_path: str):
        nonlocal total_scanned
        try:
            if not os.path.isfile(file_path):
                return
            if os.path.getsize(file_path) > 10 * 1024 * 1024:
                return  # Skip files larger than 10MB
            total_scanned += 1
            with open(file_path, "rb") as fh:
                header = fh.read(1024)
                if b"\x00" in header:
                    return  # Skip binary
                fh.seek(0)
                content = fh.read()

            rel_file = os.path.relpath(file_path, start="." if resolved_path == "." else resolved_path)

            if files_only:
                if pattern.search(content):
                    files_matched.append(rel_file)
                    if len(files_matched) >= max_lim:
                        return
            else:
                for m in pattern.finditer(content):
                    line_no = content.count(b"\n", 0, m.start()) + 1
                    line_start = content.rfind(b"\n", 0, m.start())
                    line_start = 0 if line_start == -1 else line_start + 1
                    line_end = content.find(b"\n", m.end())
                    if line_end == -1:
                        line_end = len(content)

                    raw_line = content[line_start:line_end].decode("utf-8", errors="replace")
                    if len(raw_line) > 500:
                        raw_line = raw_line[:500] + "…"

                    matches.append({
                        "file": rel_file,
                        "line_number": line_no,
                        "line_content": raw_line
                    })
                    if len(matches) >= max_lim:
                        return
        except Exception:
            pass

    if os.path.isfile(resolved_path):
        check_file(resolved_path)
    else:
        for root, dirs, files in os.walk(resolved_path):
            dirs[:] = [d for d in dirs if d not in ignore_dirs and not d.startswith(".")]
            for f in files:
                if (files_only and len(files_matched) >= max_lim) or (not files_only and len(matches) >= max_lim):
                    break
                if f.startswith(".") and f != ".gitignore":
                    continue
                if include_patterns:
                    if not any(fnmatch.fnmatch(f, pat) or fnmatch.fnmatch(os.path.join(root, f), pat) for pat in include_patterns):
                        continue
                file_path = os.path.join(root, f)
                check_file(file_path)
                if (files_only and len(files_matched) >= max_lim) or (not files_only and len(matches) >= max_lim):
                    break
            if (files_only and len(files_matched) >= max_lim) or (not files_only and len(matches) >= max_lim):
                break

    elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
    response_payload = {
        "engine_used": "python_fast_scan",
        "elapsed_ms": elapsed_ms,
        "files_scanned": total_scanned,
        "query": query_str,
        "is_regex": is_regex,
        "case_sensitive": case_sensitive
    }
    if files_only:
        response_payload["total_files"] = len(files_matched)
        response_payload["files"] = files_matched
    else:
        response_payload["total_matches"] = len(matches)
        response_payload["matches"] = matches

    return response_payload
