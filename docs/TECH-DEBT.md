# Technical Debt

## Debt Ledger
| Item | Location | Type | Risk | Effort | Priority | Status |
|---|---|---|---|---|---|---|
| Monolithic Tool Call Parsing | `src/providers/llm/base.js` | Architecture / Complexity | High | Medium | P0 | Resolved (Extracted `tool_extractor.js`) |
| Monolithic Tool Badges in Chat UI | `client/src/components/chat-ui.js` | Monolith / UI Churn | High | Medium | P0 | Open |
| Chat History & Modal Coupling | `client/src/components/side-panel.js` | SRP Violation | Medium | Medium | P1 | Open |
| Dual-role Workspace & JSONL streaming | `src/core/conversations_manager.js` | SRP Violation | Medium | Medium | P1 | Open |
| Missing Outbound Request Timeouts on raw providers | `src/providers/llm/` | Reliability | Medium | Low | P2 | Open |

## Smell Inventory
| Smell | Location | Refactoring | Status |
|---|---|---|---|
| Large Class (~700 lines of regex heuristics in `BaseProvider`) | `src/providers/llm/base.js` | Extract Class / Module (`tool_extractor.js`) | done |
| Long Method / Divergent Change (500+ lines of DOM badge creation in `chat-ui.js`) | `client/src/components/chat-ui.js` | Extract Class / Component (`chat-tool-badges.js`) | pending |
| Mixed Abstraction Levels (HTML string concatenation mixed with websocket handling) | `client/src/components/chat-ui.js` | Extract Method / Component separation | pending |

## Sprout / Wrap Register
- `src/providers/llm/tool_extractor.js`: Sprouted module housing all tool parsing and normalization functions; wrapped cleanly with delegates in `BaseProvider`.

## Debt Budget & Broken-Windows Policy
- **Policy**: Fix bugs and extract monoliths along active change paths.
- **Rule**: Never leave an untracked `// TODO` without a ticket or Debt Ledger entry.
- **Commit Boundary**: Structural changes (refactorings) and behavioral modifications must never share a commit.

## Adopted Conventions
- **Deep Modules**: Modules should hide high complexity behind a simple, intuitive API surface.
- **Backwards Compatibility**: Inherited class public signatures must remain unbroken when refactoring base classes.
- **Modular Providers Rule**: Provider-specific quirks belong strictly in the provider section, never in the general WebUI.
