# MultiAI Tool Porting & Capability Roadmap

This document catalogs the complete suite of advanced agent tools, their schemas, and their current implementation status in MultiAI.

---

## Tool Status Summary

| # | Tool Name | MultiAI Equivalent | Status |
|---|---|---|---|
| 1 | `run_command` | `run_task` | [x] **DONE** |
| 2 | `view_file` | `read_file` | [x] **DONE** |
| 3 | `write_to_file` | `write_file` | [x] **DONE** |
| 4 | `replace_file_content` | `replace_file_content` | [x] **DONE** |
| 5 | `multi_replace_file_content` | `multi_replace_file_content` | [x] **DONE** |
| 6 | `grep_search` | `grep_search` | [x] **DONE** |
| 7 | `list_dir` | `list_dir` | [x] **DONE** |
| 8 | `search_web` | `web_search` | [x] **DONE** |
| 9 | `read_url_content` | `web_search` (`type: "fetch"`) | [x] **DONE** |
| 10 | `browser_subagent` | `browser_subagent` | [ ] **PENDING** |
| 11 | `generate_image` | `generate_image` | [x] **DONE** |
| 12 | `manage_task` | `manage_tasks` | [x] **DONE** |
| 13 | `schedule` | `schedule` | [x] **DONE** |
| 14 | `ask_question` | `ask_question` | [ ] **PENDING** |
| 15 | `call_mcp_tool` | `call_mcp_tool` | [ ] **PENDING** |

---

## Detailed Tool Specifications & Schemas

### 1. `run_command` — [x] DONE (`run_task`)
Executes bash shell commands directly in the Linux environment.
* **MultiAI Status**: Implemented in `client/src/tools/terminal/index.js` (`run_task`). Supports execution with timer cooldown, background task promotion, execution duration tracking, stdout/stderr, and exit code.
```json
{
  "name": "run_command",
  "description": "PROPOSE a command to run on behalf of the user. Operating System: linux. Shell: bash.",
  "parameters": {
    "CommandLine": { "type": "STRING", "description": "The exact command line string to execute." },
    "Cwd": { "type": "STRING", "description": "The current working directory for the command." },
    "WaitMsBeforeAsync": { "type": "INTEGER", "description": "Milliseconds to wait synchronously before sending to background (max 10000)." },
    "IsDaemon": { "type": "BOOLEAN", "description": "True for long-running processes (e.g. dev servers). Default false." },
    "RunPersistent": { "type": "BOOLEAN", "description": "True to run in a persistent terminal preserving shell variables." },
    "RequestedTerminalID": { "type": "STRING", "description": "Terminal ID returned from a previous persistent command." },
    "toolAction": { "type": "STRING", "description": "Brief 2-5 word action summary." },
    "toolSummary": { "type": "STRING", "description": "Brief 2-5 word noun phrase summary." }
  },
  "required": ["CommandLine", "Cwd", "WaitMsBeforeAsync", "toolAction", "toolSummary"]
}
```

---

### 2. `view_file` — [x] DONE (`read_file`)
Inspects text or binary files (images, audio, video, PDF) on the local filesystem.
* **MultiAI Status**: Fully redesigned in `src/server/routes/files.js` and `client/src/tools/filesystem/index.js` (`read_file`). Features strict 400-line max windowing, full bidirectional slicing (`start_line` forward / `end_line` backwards / range), 45KB (46,080 bytes) hard byte cap per view, `content_offset` pagination, multimodal base64 image preview generation, 100-entry directory listing guard, and binary file protection.
```json
{
  "name": "view_file",
  "description": "View the contents of a file from the local filesystem. Supports text and binary files.",
  "parameters": {
    "AbsolutePath": { "type": "STRING", "description": "Absolute path to file." },
    "StartLine": { "type": "INTEGER", "description": "1-indexed starting line number (inclusive)." },
    "EndLine": { "type": "INTEGER", "description": "1-indexed ending line number (inclusive, max 800 lines/call)." },
    "ContentOffset": { "type": "INTEGER", "description": "Byte offset when content exceeds byte limit." },
    "IsSkillFile": { "type": "BOOLEAN", "description": "True only when reading a skill instructions file." },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["AbsolutePath", "toolAction", "toolSummary"]
}
```

---

### 3. `write_to_file` — [x] DONE (`write_file`)
Creates new files or overwrites existing ones (including creating parent directories).
* **MultiAI Status**: Implemented in `client/src/tools/filesystem/index.js` (`write_file`). Supports recursive directory creation and byte/line count reporting.
```json
{
  "name": "write_to_file",
  "description": "Create new files or overwrite existing files.",
  "parameters": {
    "TargetFile": { "type": "STRING", "description": "Absolute path to the target file." },
    "CodeContent": { "type": "STRING", "description": "Complete code contents to write." },
    "Overwrite": { "type": "BOOLEAN", "description": "Set to true to replace entire file contents." },
    "Description": { "type": "STRING", "description": "Brief user-facing explanation of this change." },
    "ArtifactMetadata": {
      "type": "OBJECT",
      "properties": {
        "Summary": { "type": "STRING" },
        "UserFacing": { "type": "BOOLEAN" },
        "RequestFeedback": { "type": "BOOLEAN" }
      }
    },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["TargetFile", "CodeContent", "Overwrite", "Description", "toolAction", "toolSummary"]
}
```

---

### 4. `replace_file_content` — [x] DONE
Performs a single contiguous block replacement in an existing file.
* **MultiAI Status**: Implemented in `src/tools/filesystem/code_tools.js` and `client/src/tools/filesystem/index.js`. Supports exact character matching, line window scoping (`start_line`/`end_line`), `allow_multiple` guard, newline preservation (`\r\n` vs `\n`), unified diff generation, and chat badge integration.
```json
{
  "name": "replace_file_content",
  "description": "Edits an existing file by replacing a single contiguous block of text.",
  "parameters": {
    "TargetFile": { "type": "STRING", "description": "Absolute path to the file to modify." },
    "Instruction": { "type": "STRING", "description": "Description of the edit." },
    "Description": { "type": "STRING", "description": "Brief user-facing explanation." },
    "StartLine": { "type": "INTEGER", "description": "1-indexed line start of search range." },
    "EndLine": { "type": "INTEGER", "description": "1-indexed line end of search range." },
    "TargetContent": { "type": "STRING", "description": "Exact character sequence to be replaced." },
    "ReplacementContent": { "type": "STRING", "description": "Replacement content." },
    "AllowMultiple": { "type": "BOOLEAN", "description": "Allow multiple replacements if matched." },
    "TargetLintErrorIds": { "type": "ARRAY", "items": { "type": "STRING" } },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["TargetFile", "Instruction", "Description", "StartLine", "EndLine", "TargetContent", "ReplacementContent", "AllowMultiple", "toolAction", "toolSummary"]
}
```

---

### 5. `multi_replace_file_content` — [x] DONE
Performs multiple non-contiguous block edits across the same file in a single atomic operation.
* **MultiAI Status**: Implemented in `src/tools/filesystem/code_tools.js` and `client/src/tools/filesystem/index.js`. Validates all chunks prior to mutation, sorts and executes bottom-up by line number/position, generates aggregate unified diff, and writes atomically.
```json
{
  "name": "multi_replace_file_content",
  "description": "Edits multiple non-contiguous blocks of text within a single file.",
  "parameters": {
    "TargetFile": { "type": "STRING" },
    "Instruction": { "type": "STRING" },
    "Description": { "type": "STRING" },
    "ReplacementChunks": {
      "type": "ARRAY",
      "items": {
        "StartLine": { "type": "INTEGER" },
        "EndLine": { "type": "INTEGER" },
        "TargetContent": { "type": "STRING" },
        "ReplacementContent": { "type": "STRING" },
        "AllowMultiple": { "type": "BOOLEAN" }
      }
    },
    "ArtifactMetadata": { "type": "OBJECT" },
    "TargetLintErrorIds": { "type": "ARRAY", "items": { "type": "STRING" } },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["TargetFile", "Instruction", "Description", "ReplacementChunks", "toolAction", "toolSummary"]
}
```

---

### 6. `grep_search` — [x] DONE
Fast pattern and regex searching across files using ripgrep with pure Node.js fallback.
* **MultiAI Status**: Fully implemented in `src/tools/filesystem/code_tools.js` and `client/src/tools/filesystem/index.js`. Features a high-performance dual engine: detects native ripgrep (`/bin/rg`) for sub-millisecond JSON streaming searches, and automatically falls back to an asynchronous Node.js filesystem scanner when missing. Supports `SearchPath`, `Query`, `IsRegex`, `CaseInsensitive`, `MatchPerLine`, and glob `Includes`. Output matches the exact schema with capped 50 matches.
```json
{
  "name": "grep_search",
  "description": "Use ripgrep to find exact pattern matches within files or directories.",
  "parameters": {
    "SearchPath": { "type": "STRING", "description": "Absolute path to search directory or file." },
    "Query": { "type": "STRING", "description": "Search term or regex pattern." },
    "IsRegex": { "type": "BOOLEAN", "description": "Treat Query as regex if true." },
    "CaseInsensitive": { "type": "BOOLEAN", "description": "Perform case-insensitive search." },
    "MatchPerLine": { "type": "BOOLEAN", "description": "True to return snippets + line numbers; false for filenames only." },
    "Includes": { "type": "ARRAY", "items": { "type": "STRING" }, "description": "Glob filter patterns (e.g. ['*.js'])." },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["SearchPath", "Query", "toolAction", "toolSummary"]
}
```

---

### 7. `list_dir` — [x] DONE
Lists directory contents (files, child counts, sizes).
* **MultiAI Status**: Fully implemented as a standalone tool in `src/tools/filesystem/code_tools.js`, `src/server/routes/files.js`, and `client/src/tools/filesystem/index.js`. Features directory sorting, per-file byte sizes, subdirectory child counts, and human-readable summary. `read_file` strictly handles file reading and rejects directories with an explicit error guiding the model to `list_dir`.
```json
{
  "name": "list_dir",
  "description": "List the contents of a directory.",
  "parameters": {
    "DirectoryPath": { "type": "STRING", "description": "Absolute path to directory." },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["DirectoryPath", "toolAction", "toolSummary"]
}
```

---

### 8. `search_web` — [x] DONE (`web_search`)
Performs live internet search queries and returns relevant excerpts with URLs.
* **MultiAI Status**: Implemented in `client/src/tools/web/index.js` with SearXNG, DuckDuckGo, and Google fallback support.
```json
{
  "name": "search_web",
  "description": "Performs a web search for a given query.",
  "parameters": {
    "query": { "type": "STRING", "description": "Search query." },
    "domain": { "type": "STRING", "description": "Optional domain to prioritize." },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["query", "toolAction", "toolSummary"]
}
```

---

### 9. `read_url_content` — [x] DONE (via `web_search` with `type: "fetch"`)
Fetches and converts public web page content directly into clean markdown.
* **MultiAI Status**: Fully implemented in `client/src/tools/web/index.js` via `web_search`. When `type: "fetch"` is passed (or when an `http(s)://` URL is provided as the query), MultiAI automatically delegates to `activeWebProvider.fetch()` to scrape and return the full webpage content.
```json
{
  "name": "read_url_content",
  "description": "Fetch content from a URL via HTTP request (markdown conversion).",
  "parameters": {
    "Url": { "type": "STRING", "description": "URL to fetch." },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["Url", "toolAction", "toolSummary"]
}
```

---

### 10. `browser_subagent` — [ ] PENDING
Spawns an autonomous browser session to interact with web apps, click, navigate, and record sessions.
* **MultiAI Status**: Not implemented. MultiAI currently operates via HTTP APIs and headless searches without Playwright/Puppeteer browser automation.
```json
{
  "name": "browser_subagent",
  "description": "Start a browser subagent to perform actions in a browser.",
  "parameters": {
    "TaskName": { "type": "STRING", "description": "Human-readable task title." },
    "Task": { "type": "STRING", "description": "Detailed actionable task instructions." },
    "TaskSummary": { "type": "STRING", "description": "1-2 sentence high-level summary." },
    "RecordingName": { "type": "STRING", "description": "Name for the recorded WebP video session." },
    "MediaPaths": { "type": "ARRAY", "items": { "type": "STRING" } },
    "ReusedSubagentId": { "type": "STRING" },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["TaskName", "Task", "TaskSummary", "RecordingName", "toolAction", "toolSummary"]
}
```

---

### 11. `generate_image` — [x] DONE (`generate_image`)
Generates or edits UI mocks and image assets.
* **MultiAI Status**: Implemented in `client/src/tools/media/index.js` with ComfyUI, Stable Diffusion, and DALL-E connectors, progress polling, and image previews.
```json
{
  "name": "generate_image",
  "description": "Generate an image or edit existing images based on a text prompt.",
  "parameters": {
    "Prompt": { "type": "STRING", "description": "Text prompt or edit instructions." },
    "ImageName": { "type": "STRING", "description": "Filename for saving the generated image." },
    "AspectRatio": { "type": "STRING", "enum": ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"] },
    "ImagePaths": { "type": "ARRAY", "items": { "type": "STRING" }, "description": "Optional reference images (max 3)." },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["Prompt", "ImageName", "toolAction", "toolSummary"]
}
```

---

### 12. `manage_task` — [x] DONE (`manage_tasks`)
Inspects, interacts with, or kills background tasks.
* **MultiAI Status**: Implemented in `client/src/tools/terminal/index.js` (`manage_tasks`). Includes keycode combination support (`ctrl+c`, `ctrl+d`, `enter`, `tab`, arrow keys) and process termination.
```json
{
  "name": "manage_task",
  "description": "Manage background tasks (list, kill, status, send_input).",
  "parameters": {
    "Action": { "type": "STRING", "enum": ["list", "kill", "status", "send_input"] },
    "TaskId": { "type": "STRING", "description": "Required for kill, status, send_input." },
    "Input": { "type": "STRING", "description": "Input string to send to standard input." },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["Action", "toolAction", "toolSummary"]
}
```

---

### 13. `schedule` — [x] DONE (`schedule`)
Schedules one-shot countdown timers or recurring cron triggers.
* **MultiAI Status**: Implemented in `client/src/tools/terminal/index.js` (`schedule`). Supports sleep timers, task monitoring with `wake_on` (`exit`/`output`), and autonomous `end_response` prompting.
```json
{
  "name": "schedule",
  "description": "Schedule a one-shot timer or recurring cron job that sends notifications in background.",
  "parameters": {
    "Prompt": { "type": "STRING", "description": "Notification content sent when fired." },
    "DurationSeconds": { "type": "STRING", "description": "Seconds for one-shot timer." },
    "CronExpression": { "type": "STRING", "description": "Standard 5-field cron expression." },
    "MaxIterations": { "type": "STRING", "description": "Max triggers before stopping." },
    "TimerCondition": { "type": "STRING", "description": "'never', 'any', or specific task/agent sender ID." },
    "IsDaemon": { "type": "BOOLEAN" },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["Prompt", "toolAction", "toolSummary"]
}
```

---

### 14. `ask_question` — [ ] PENDING
Presents structured interactive modals or multiple-choice questions to the user.
* **MultiAI Status**: Not implemented. MultiAI currently relies on natural language turns rather than structured blocking interactive question dialogs with checkboxes/radio buttons.
```json
{
  "name": "ask_question",
  "description": "Ask the user interactive multiple-choice questions to clarify requirements.",
  "parameters": {
    "questions": {
      "type": "ARRAY",
      "items": {
        "question": { "type": "STRING" },
        "options": { "type": "ARRAY", "items": { "type": "STRING" } },
        "is_multi_select": { "type": "BOOLEAN" }
      }
    },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["toolAction", "toolSummary"]
}
```

---

### 15. `call_mcp_tool` / `list_resources` / `read_resource` — [ ] PENDING
Allows communicating with configured Model Context Protocol (MCP) servers.
* **MultiAI Status**: Not implemented. MultiAI does not yet have an MCP client daemon to connect to external MCP servers.
```json
{
  "name": "call_mcp_tool",
  "description": "Call a lazy-loaded MCP tool.",
  "parameters": {
    "ServerName": { "type": "STRING", "description": "Name of the MCP server (e.g. 'render')." },
    "ToolName": { "type": "STRING", "description": "Name of the tool to invoke." },
    "Arguments": { "description": "Arguments payload for the MCP tool." },
    "toolAction": { "type": "STRING" },
    "toolSummary": { "type": "STRING" }
  },
  "required": ["ServerName", "ToolName", "Arguments", "toolAction", "toolSummary"]
}
```
