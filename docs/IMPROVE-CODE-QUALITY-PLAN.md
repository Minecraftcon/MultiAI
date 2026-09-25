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
| 1 — Build the safety net | working-with-legacy-code | done | TESTING.md + TECH-DEBT.md (GATE) | 2026-09-25 |
| 2 — Make the code readable | clean-code | done | TECH-DEBT.md | 2026-09-26 |
| 3 — Apply named refactorings | refactoring-patterns | done | TECH-DEBT.md | 2026-09-26 |
| 4 — Reduce complexity | software-design-philosophy | done | TECH-DEBT.md | 2026-09-26 |
| 5 — Draw the architecture boundary | clean-architecture | pending | ARCHITECTURE.md | |
| 6 — Lock in the habits | pragmatic-programmer | in-progress | TECH-DEBT.md | |
| 7 — Make it survive production | release-it | done | RELIABILITY.md | 2026-09-26 |
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
| 2026-09-26 | Phase 1, 3 & 4 | Created characterization tests (`tests/test_conversations_manager.js`) and extracted `jsonl_session_store.js` and `build_projects_manager.js` | Separated JSONL append/safe write storage primitives and Build Mode project lifecycle out of `conversations_manager.js`. Shrunk from 982 to 539 lines (~45% reduction). |
| 2026-09-26 | Phase 1, 3 & 4 | Created safety net tests (`tests/test_model_service.js`) and decomposed `side-panel.js` into `models.js`, `build-projects-panel.js`, and `chat-history-list.js` | Separated Model Service, Build Mode project management, and chat history list rendering from the panel shell coordinator. Shrunk `side-panel.js` from 1,558 to 436 lines (~72% reduction). Maintained 100% re-export compatibility. |
| 2026-09-26 | Phase 7 | Outbound Request Timeouts & Stream Lifecycle Protection in LLM Providers | Extended timeout coverage in `base.js` across full body read (`res.text()`) and across entire chunk consumption loops in `local.js` & `opencode.js` to eliminate socket hanging vulnerabilities. |
| 2026-09-26 | Phase 1, 3 & 4 | Created safety net tests (`tests/test_composer_attachments.js`) and extracted `composer-attachments.js` and `chat-scroll.js` | Extracted attachment staging and downscaling from `composer.js` (shrunk from 585 to 305 lines). Decoupled `chat-scroll.js` and unified image lightbox modal from `chat-ui.js` (shrunk to 688 lines). 100% test pass. |
| 2026-09-26 | Phase 1 & 7 | Deep merge in `config_manager.js`, debounce update batching in `settings-view.js`, and top-level error boundary in `router.js` | Fixed bug where partial section updates silently erased existing custom keys in `config.ini`. Created `tests/test_config_manager.js` to prevent regressions. Added top-level error boundary to routeRequest. |

## Next Actions
- [x] Pin `src/providers/llm/base.js` with characterization tests and extract `tool_extractor.js`.
- [x] Establish characterization test/safety net for `client/src/components/chat-ui.js` badge rendering logic.
- [x] Extract `chat-tool-badges.js` out of `chat-ui.js` to shrink it by ~680 lines.
- [x] Tackle `src/core/conversations_manager.js` (created `jsonl_session_store.js` and `build_projects_manager.js`).
- [x] Tackle next monolith: `client/src/components/side-panel.js` (1,558 lines; decomposed into `models.js`, `build-projects-panel.js`, and `chat-history-list.js`).
- [x] Fix Outbound Request Timeouts across all 18+ LLM providers (`base.js`, `local.js`, `opencode.js`).
- [x] Phase 2 Clean Code Audit: Review and refactor `client/src/components/composer.js` (extracted `composer-attachments.js`).
- [x] Decouple `client/src/components/chat-scroll.js` and unify image lightbox modal in `chat-ui.js`.
- [x] Review `client/src/components/settings-view.js`, fix partial config overwrite bug, and add router error handling boundary.


