# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that bridges Claude AI with the Monobank banking API. Published to npm as `monobank-mcp-server`. Runs as a CLI tool via `npx monobank-mcp-server`.

## Build

```bash
npm run build        # tsc && chmod +x build/index.js
npm run pack:mcpb    # build + package as .mcpb bundle
```

TypeScript compiles from `src/` to `build/`. The output entry point (`build/index.js`) has a shebang and is chmod'd executable. No test or lint scripts exist.

## MCPB Support

The project includes a `manifest.json` (MCPB v0.3) for one-click installation in Claude Desktop/Claude Code. The manifest declares all three tools, wires `MONOBANK_API_TOKEN` via `user_config` (secure prompt on install), and requires Node >=18. The `pack:mcpb` script stages `build/`, `node_modules/`, `package.json`, and `manifest.json` into a ZIP archive (`monobank-mcp-server.mcpb`).

## Architecture

The server exposes three MCP tools over stdio transport:

- **get_currency_rates** — public endpoint, rate-limited to once per 5 min
- **get_client_info** — authenticated, rate-limited to once per 60s
- **get_statement** — authenticated, rate-limited to once per 60s, max 31-day range

### Source layout (`src/`)

| File | Role |
|------|------|
| `index.ts` | MCP server setup, tool definitions (all three tools registered here) |
| `config.ts` | Lazy-initialized singleton; reads `MONOBANK_API_TOKEN` env var, stores API base URL |
| `schemas.ts` | Zod schemas validating Monobank API responses (`CurrencyRateSchema`, `StatementItemSchema`) |
| `interfaces.ts` | TypeScript interfaces (`CurrencyRate`) |
| `helpers.ts` | Shared utilities: fetch wrapper, MCP response builders, date validation, amount formatting (cents → currency units) |

### Key patterns

- **ESM-only** (`"type": "module"`, target ES2022, module Node16)
- All Monobank API responses are validated at runtime with Zod before use
- Monetary amounts arrive from the API in cents and are converted to currency units in `formatStatementItems()`
- Dates are accepted as ISO 8601 strings and converted to Unix timestamps for the API
- Authenticated endpoints use the `X-Token` header
- Config throws on missing `MONOBANK_API_TOKEN` at initialization

## Formatting & Linting

Prettier with 4-space indentation (see `.prettierrc`). ESLint 9 with flat config (`eslint.config.js`), using `typescript-eslint` recommended rules and `eslint-config-prettier` to avoid conflicts.

```bash
npm run lint         # eslint src/
npm run format       # prettier --write src/
```

---

# Claude Code Operating Instructions

## Core Philosophy

Default to **parallel execution** and **web-verified information**. Sequential execution and offline assumptions are fallback modes, not defaults. When in doubt: parallelize, then search.

---

## 1. Parallelization Protocol

### Default Behavior: Parallel-First

**Before starting any multi-step task:**
1. Decompose the full task into atomic subtasks
2. Build a dependency graph — identify which subtasks have no prerequisite outputs
3. Dispatch ALL dependency-free subtasks simultaneously using parallel tool calls
4. Only after their completion, dispatch the next wave of now-unblocked subtasks
5. Repeat until task is complete

**Rule:** If two tasks do not share an input/output dependency, they MUST run in parallel. Sequential execution of independent tasks is a performance violation.

### Parallel Tool Call Patterns

Prefer batching tool calls in a single response turn rather than sequential turns:

```
# CORRECT — dispatch independent reads simultaneously
- Read file A
- Read file B
- Search web for library version
(all in one turn)

# WRONG — needless sequencing
- Read file A → wait → Read file B → wait → Search web
```

### Sub-Agent Parallelization (Task Tool)

When using the `Task` tool to spawn sub-agents:
- Spawn all independent sub-agents in a single dispatch batch
- Maximum **5 concurrent sub-agents** at any time to avoid context exhaustion
- Each sub-agent must have a clearly scoped, non-overlapping responsibility
- Define explicit output contracts for each agent before spawning
- After all agents complete, explicitly synthesize their outputs — do not present raw agent outputs as the final answer

### TodoWrite Protocol

When managing complex tasks with `TodoWrite`:
- Mark tasks as `in_progress` before starting a parallel batch
- Track each parallel thread separately
- Never mark a parent task `completed` until all parallel children resolve
- Flag dependency chains explicitly in todo descriptions

### When Sequential Execution Is Permitted

Sequential execution is only justified when:
- Task B requires Task A's output as direct input
- Tasks write to the same file or resource (race condition risk)
- A previous parallel batch returned an error that changes downstream logic
- User explicitly requests step-by-step confirmation

In all other cases: **parallelize**.

---

## 2. Web Search Mandate

### Search-First Triggers

**Always perform a web search before proceeding** when the task involves any of the following:

| Category | Examples |
|---|---|
| Library / framework versions | "What's the latest stable version of X?" |
| API behavior and signatures | Any external SDK, REST API, or CLI tool |
| Security advisories | CVEs, deprecated patterns, breaking changes |
| Best practices | Architecture patterns, language idioms updated post-2024 |
| Configuration options | Tool flags, environment variables, cloud service settings |
| Error messages | Unfamiliar stack traces, runtime errors |
| Compatibility questions | Node/Python/Rust version support, browser APIs |
| Pricing or limits | Cloud service quotas, rate limits, SLA details |

### Search Behavior Rules

1. **Search before assuming.** Do not rely on training knowledge for anything that changes over time. External information has a shelf life; always verify.

2. **Prefer official sources.** When web results conflict, prioritize: official docs > GitHub releases > well-known technical blogs > forums.

3. **Deduplicate within session.** If you have already searched for a query in this session and the result was unambiguous, do not re-search the same query. Cache the result mentally and reference it.

4. **Surface what you found.** When you use web search to inform a decision, briefly state the source and key fact. Do not silently use search results without attribution.

5. **Parallelize searches.** When multiple independent facts need to be looked up, dispatch all web searches simultaneously, not sequentially.

6. **Do not search for:** Internal project details, proprietary architecture, code that exists in the repository (read the file instead), or subjective style decisions.

### When Web Search Results Conflict with the Codebase

If web search returns guidance that contradicts patterns already established in the repo:
1. Note the conflict explicitly
2. Present both the current repo pattern and the web-sourced alternative
3. Do not silently override existing code with web-sourced patterns without user confirmation

---

## 3. Session Start Checklist

At the beginning of every new task or session, run the following in parallel:

- [ ] Read `CLAUDE.md` (this file) to confirm operating rules are loaded
- [ ] Identify the task's scope and decompose into subtasks
- [ ] Flag any subtasks that require web verification
- [ ] Check for existing relevant files in the repo before searching externally
- [ ] Dispatch first parallel batch

---

## 4. Quality and Safety Rules

- **No unverified version pinning.** Never write a dependency version (`package.json`, `pyproject.toml`, `Cargo.toml`, etc.) without confirming via web search that it is current and non-deprecated.
- **No silent failures in parallel batches.** If one parallel subtask fails, halt dependent tasks immediately and report the failure before proceeding.
- **Conflict resolution in parallel file edits.** If two parallel sub-agents are asked to modify the same file, serialize those specific edits. All other work continues in parallel.
- **Do not hallucinate tool flags or API parameters.** If unsure whether a CLI flag exists, search first.

---

## 5. Communication Standards

- When executing a parallel batch, briefly state what is running in parallel and why
- When web search informs a decision, cite source and date if available
- When sequential execution is chosen over parallel, briefly state the dependency that forced it
- Keep explanations concise — action over narration
