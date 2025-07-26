#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CurrencyRatesResponseSchema, StatementItemSchema } from "./schemas.js";
import { createSuccessResponse, fetchWithErrorHandling, parseJsonResponse, formatErrorAsToolResponse, validateStatementDates, formatStatementItems, } from "./helpers.js";
import { initializeConfig, getConfig } from "./config.js";
const server = new McpServer({
    name: "monobank-mcp-server",
    version: "1.0.0",
    capabilities: {
        tools: {},
    },
});
server.tool("get_currency_rates", "Get a basic list of currency rates from Monobank. The information can be refreshed once per 5 minutes, otherwise an error will be thrown.", {}, async () => {
    try {
        const { baseUrl } = getConfig();
        const response = await fetchWithErrorHandling(`${baseUrl}/bank/currency`);
        const result = await parseJsonResponse(response);
        const currencyRates = CurrencyRatesResponseSchema.parse(result);
        return createSuccessResponse(currencyRates);
    }
    catch (error) {
        return formatErrorAsToolResponse(error, "get currency rates");
    }
});
server.tool("get_client_info", "Get information about a client and a list of their accounts and jars. The tool can be called not more than 1 time per 60 seconds, otherwise an error will be thrown.", {}, async () => {
    try {
        const { baseUrl, monobankApiToken } = getConfig();
        const response = await fetchWithErrorHandling(`${baseUrl}/personal/client-info`, {
            headers: {
                "X-Token": monobankApiToken,
            },
        });
        const clientInfo = await parseJsonResponse(response);
        return createSuccessResponse(clientInfo);
    }
    catch (error) {
        return formatErrorAsToolResponse(error, "get client info");
    }
});
server.tool("get_statement", "Get Monobank statement for the time from {from} to {to} time in seconds in Unix time format. The maximum time for which it is posssible to obtain a statement is 31 days + 1 hour (2682000 seconds). The statement can be retrieved not more than once per 60 seconds, otherwise an error will be thrown.", {
    input: z.object({
        account: z
            .string()
            .nonempty()
            .describe("A unique indentificator of the Monobank account or a jar from the Statement list. If not provided, then a defaukt account is used, which is equal to '0'."),
        from: z
            .string()
            .nonempty()
            .describe("A date in ISO 8601 YYYY-MM-DD format."),
        to: z
            .string()
            .optional()
            .describe("A date in ISO 8601 YYYY-MM-DD format."),
    }),
}, async ({ input }) => {
    try {
        const { account, from, to } = input;
        const dateValidation = validateStatementDates(from, to);
        if ("content" in dateValidation) {
            return dateValidation;
        }
        const { fromInSeconds, toInSeconds } = dateValidation;
        const { baseUrl, monobankApiToken } = getConfig();
        const response = await fetchWithErrorHandling(`${baseUrl}/personal/statement/${account}/${fromInSeconds}/${toInSeconds}`, {
            headers: {
                "X-Token": monobankApiToken,
            },
        });
        const data = await parseJsonResponse(response);
        const statement = z.array(StatementItemSchema).parse(data);
        const formattedStatement = formatStatementItems(statement);
        return createSuccessResponse(formattedStatement);
    }
    catch (error) {
        return formatErrorAsToolResponse(error, "fetch statement");
    }
});
async function main() {
    initializeConfig();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Monobank MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
