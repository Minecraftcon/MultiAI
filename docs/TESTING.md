# Testing

## Test Strategy
- **Layer 1: Unit & Characterization Tests** (Node.js built-in `node:assert`, zero heavy dependencies required).
- **Layer 2: Provider Contract Tests** (ensuring all registered LLM providers adhere to `BaseProvider` interface and delegate parsing properly).
- **Layer 3: UI & Tool Integration Tests** (Headless browser automation via Puppeteer / Termux / screenshot validation).
- **Gate Policy**: All characterization suites must pass 100% green before any refactoring commit is accepted.

## Safety Net Map
| Module | Pinned Behaviors | Test Files | Gaps |
|---|---|---|---|
| `src/providers/llm/base.js` & `tool_extractor.js` | Argument parsing (JSON, delimited, quotes), Token extraction (GLM-4, Hermes, template tokens, XML, code blocks, function calls), Leaked XML repairs, Prompt sanitization, Image extraction from tool output | `tests/test_tool_extractor.js` | Provider network streaming timeouts |
| `client/src/components/chat-tool-badges.js` | Tool badge configuration resolution (`getToolBadgeConfig`), icon/label mapping, task command formatting, multiline truncation, artifact detection | `tests/test_chat_tool_badges.js` | Browser DOM event listeners |
| `src/core/conversations_manager.js` | Session loading, append message, JSONL compaction, session deletion | (Pending Phase 1 Core safety net) | Multi-process file lock concurrency |

## Characterization Backlog
- [x] `src/providers/llm/base.js` tool parsing & normalization (Criticality: High, Priority: P0)
- [x] `client/src/components/chat-tool-badges.js` badge generation & icon mapping (Criticality: High, Priority: P0)
- [ ] `src/core/conversations_manager.js` message streaming & file persistence (Criticality: Medium, Priority: P1)

## CI Gates
- `node tests/test_tool_extractor.js`
- `node tests/test_chat_tool_badges.js`
