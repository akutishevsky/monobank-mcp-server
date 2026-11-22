# Monobank MCP Server

MCP (Model Context Protocol) server for integrating with Monobank API.

## Quick Install

Download the latest `.mcpb` bundle from the [Releases](https://github.com/akutishevsky/monobank-mcp-server/releases) page and open it — Claude Desktop or Claude Code will handle the rest. You'll be prompted to enter your Monobank API token during installation.

## Prerequisites

- Node.js 18.0.0 or higher
- A Monobank API token. You can obtain it at: https://api.monobank.ua/

**Note:** Your API token is only used locally and is never tracked or transmitted anywhere except to Monobank's API.

## Available Tools

The server provides three tools:

1. **get_currency_rates** - Get currency exchange rates. Public endpoint; works without an API token.
2. **get_client_info** - Get client information, accounts and jars. Requires a token.
3. **get_statement** - Get the statement for an account or jar over a date range. Requires a token. Maximum range is 31 days + 1 hour.

### Behaviour worth knowing

- **Amounts are returned in currency units, not cents.** A balance of 100,000.00 UAH is reported as `100000`, not `10000000`. This applies to every monetary field in both `get_client_info` and `get_statement`, including `commissionRate`, which Monobank returns as an absolute amount despite its name.
- **Responses are cached in memory** so that Monobank's rate limits are not exceeded: 5 minutes for currency rates, 60 seconds for client info and for each distinct statement query. A repeated call inside that window returns the cached result instead of failing with `HTTP 429`.
- **Statement dates** are ISO 8601 `YYYY-MM-DD`, interpreted as UTC. The `to` date is **inclusive** — a statement from `2024-10-01` to `2024-10-31` covers all of October 31. Omit `to` to mean "up to now".
- **The statement `account` parameter defaults to `0`**, the client's default account. Account and jar identifiers returned by `get_client_info` are also accepted.
- **`MONOBANK_API_TOKEN` is only needed for `get_client_info` and `get_statement`.** The server starts without it and `get_currency_rates` keeps working; the two authenticated tools return an error explaining that the variable is unset.

## MCP Configuration

### stdio (default)

To use this server with an MCP client, add it to your configuration:

```json
{
  "mcpServers": {
    "monobank": {
      "command": "npx",
      "args": ["monobank-mcp-server"],
      "env": {
        "MONOBANK_API_TOKEN": "your_token_here"
      }
    }
  }
}
```

### Docker (HTTP transport)

The server can run as a Docker container exposing an HTTP endpoint with the MCP Streamable HTTP transport.

The HTTP endpoint serves your bank data, so it always requires a bearer token. Generate one first:

```bash
export MCP_AUTH_TOKEN=$(openssl rand -hex 32)
```

**Using Docker directly:**

```bash
docker run -d \
  -p 127.0.0.1:3000:3000 \
  -e MONOBANK_API_TOKEN=your_token_here \
  -e MCP_AUTH_TOKEN \
  ghcr.io/akutishevsky/monobank-mcp-server:latest
```

If you publish on a host port other than 3000 (for example `-p 127.0.0.1:8080:3000`), also pass `-e ALLOWED_HOSTS=localhost:8080`. Otherwise the server rejects requests whose `Host` header doesn't match. Docker Compose sets this for you from `PORT`.

**Using Docker Compose:**

```bash
MONOBANK_API_TOKEN=your_token_here docker compose up -d
```

The MCP endpoint is available at `http://localhost:3000/mcp`.

To connect an MCP client to the HTTP server, use the `url` configuration instead of `command`, and send the token in the `Authorization` header:

```json
{
  "mcpServers": {
    "monobank": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer your_mcp_auth_token"
      }
    }
  }
}
```

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `MONOBANK_API_TOKEN` | — | Monobank API token (required for authenticated tools) |
| `MCP_AUTH_TOKEN` | — | Bearer token clients must send. Required when `TRANSPORT=http`; the server refuses to start without it |
| `HOST` | `127.0.0.1` | Interface to listen on. The Docker image sets `0.0.0.0` |
| `PORT` | `3000` | HTTP server port |
| `ALLOWED_HOSTS` | — | Extra comma-separated `host:port` values accepted in the `Host` header, e.g. when publishing on a different port or reaching the server by LAN hostname. `localhost` and `127.0.0.1` on `PORT` are always allowed |
| `SESSION_IDLE_TIMEOUT_MS` | `600000` | Idle MCP sessions are closed after this many milliseconds |

## Example Prompts

### English
- "Show me the current USD to UAH exchange rate"
- "Get my account balance and recent transactions"
- "Show me all transactions from the last week"
- "What did I spend money on yesterday?"
- "Show my statement for October 2024"
- "Get all my credit card transactions from the last 3 days"

### Українською
- "Покажи поточний курс долара"
- "Скільки грошей на моїх рахунках?"
- "Покажи виписку за вчора"
- "На що я витратив гроші цього тижня?"
- "Покажи всі транзакції за жовтень"
- "Скільки я витратив на їжу за останній місяць?"

## MCPB (One-Click Installation)

This server is available as an MCPB bundle for one-click installation in Claude Desktop and Claude Code.

To build the `.mcpb` bundle locally:

```bash
npm run pack:mcpb
```

This produces `monobank-mcp-server.mcpb` which can be installed directly in any MCPB-compatible client. During installation, you'll be prompted to enter your Monobank API token securely.

## License

MIT
