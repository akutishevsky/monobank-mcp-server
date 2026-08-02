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
