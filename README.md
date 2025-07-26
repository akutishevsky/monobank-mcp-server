# Monobank MCP Server

MCP (Model Context Protocol) server for integrating with Monobank API.

## Prerequisites

- Node.js 18.0.0 or higher
- A Monobank API token. You can obtain it at: https://api.monobank.ua/

**Note:** Your API token is only used locally and is never tracked or transmitted anywhere except to Monobank's API.

## Available Tools

The server provides three tools:

1. **get_currency_rates** - Get currency exchange rates (rate limited to once per 5 minutes)
2. **get_client_info** - Get client information and account details (rate limited to once per 60 seconds)
3. **get_statement** - Get account statements for a specified date range (rate limited to once per 60 seconds, max 31 days + 1 hour)

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

## License

MIT
