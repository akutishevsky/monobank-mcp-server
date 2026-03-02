# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that bridges Claude AI with the Monobank banking API. Published to npm as `monobank-mcp-server`. Runs as a CLI tool via `npx monobank-mcp-server`.

## Build

```bash
npm run build        # tsc && chmod +x build/index.js
```

TypeScript compiles from `src/` to `build/`. The output entry point (`build/index.js`) has a shebang and is chmod'd executable. No test or lint scripts exist.

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

## Formatting

Prettier with 4-space indentation (see `src/.prettierrc`). No ESLint configured.
