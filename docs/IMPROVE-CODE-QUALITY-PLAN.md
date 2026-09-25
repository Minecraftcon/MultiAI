# Improve Code Quality Plan

## Context
- **App**: MultiAI — Local & multi-provider LLM workspace and agent system with tools, real-time streaming, and session persistence.
- **Critical Risk**: Tool call corruption breaking agent workflows; memory leaks or monolithic state lockup in chat UI.
- **Stack**: Node.js (backend, native http / SSE / WS, JSONL conversation storage), Vanilla JS / Web Components (frontend).
- **Load Profile**: Local-first & self-hosted (single user / small team, 1-10 concurrent sessions).
- **Primary Outbound Dependencies**: 18+ LLM Provider APIs (OpenAI, Anthropic, Google, Groq, Cohere, etc.), web search APIs, and local sub-processes.
- **Scope Focus**: Phases 1–4 (Safety Net, Clean Code, Refactoring Patterns, Deep Modules) prioritizing monolithic components with high churn or core domain impact. Phases 8–9 deferred (not currently running at high distributed concurrency).

## Phase Status
| Phase | Skill | Status | Artifact | Date |
|---|---|---|---|---|
| 1 — Build the safety net | working-with-legacy-code | in-progress | TESTING.md + TECH-DEBT.md (GATE) | 2026-09-25 |
| 2 — Make the code readable | clean-code | pending | TECH-DEBT.md | |
| 3 — Apply named refactorings | refactoring-patterns | pending | TECH-DEBT.md | |
| 4 — Reduce complexity | software-design-philosophy | pending | TECH-DEBT.md | |
| 5 — Draw the architecture boundary | clean-architecture | pending | ARCHITECTURE.md | |
| 6 — Lock in the habits | pragmatic-programmer | pending | TECH-DEBT.md | |
| 7 — Make it survive production | release-it | pending | RELIABILITY.md | |
| 8 — Size for real load | system-design | deferred: local-first/low-load | ARCHITECTURE.md + RELIABILITY.md | |
| 9 — Get the data layer right | ddia-systems | deferred: file-based JSONL storage | ARCHITECTURE.md | |
| Optional — Domain language | domain-driven-design | pending | ARCHITECTURE.md | |

## Key Decisions
| Date | Phase | Decision | Rationale |
|---|---|---|---|
| 2026-09-25 | Phase 1 | Safety net test suite created (`tests/test_tool_extractor.js`) before refactoring `base.js` | Zero regressions allowed across all 18 inheriting LLM providers. |
| 2026-09-25 | Phase 3 & 4 | Extracted tool call parsing heuristics from `BaseProvider` into `tool_extractor.js` | Deep module design: hides regex/XML/token dialects behind a simple clean interface; shrunk `base.js` by ~420 lines. |
| 2026-09-25 | Operating | Prioritize high-churn frontend monolith `client/src/components/chat-ui.js` next | 38 commits churn, 1,553 lines with mixed concerns (badges, streaming, auto-scroll, message lifecycle). |
| 2026-09-25 | Phase 1, 3 & 4 | Created characterization tests (`tests/test_chat_tool_badges.js`) and extracted `client/src/components/chat-tool-badges.js` | Extracted ~700 lines of badge/modal logic out of `chat-ui.js`. Shrunk `chat-ui.js` from 1,553 lines to 870 lines. Maintained 100% re-export compatibility. |

## Next Actions
- [x] Pin `src/providers/llm/base.js` with characterization tests and extract `tool_extractor.js`.
- [x] Establish characterization test/safety net for `client/src/components/chat-ui.js` badge rendering logic.
- [x] Extract `chat-tool-badges.js` out of `chat-ui.js` to shrink it by ~680 lines.
- [ ] Tackle next critical monolith: `src/core/conversations_manager.js` (982 lines; separate JSONL stream storage from workspace resolution).
