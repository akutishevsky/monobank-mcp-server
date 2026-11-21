#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
    ClientInfoSchema,
    CurrencyRatesResponseSchema,
    StatementResponseSchema,
} from "./schemas.js";
import {
    createSuccessResponse,
    fetchWithErrorHandling,
    parseJsonResponse,
    formatErrorAsToolResponse,
    validateStatementDates,
    formatStatementItems,
    formatClientInfo,
    withCache,
    logToolRequest,
} from "./helpers.js";
import { initializeConfig, getConfig, requireToken } from "./config.js";
import { startHttpServer } from "./http-server.js";

/** Monobank allows the public currency endpoint once per 5 minutes. */
const CURRENCY_CACHE_TTL_MS = 300_000;

/** Monobank allows each personal endpoint once per 60 seconds. */
const PERSONAL_CACHE_TTL_MS = 60_000;

const SERVER_NAME = "monobank-mcp-server";

/**
 * Creates an McpServer instance with all Monobank tools registered.
 * Called once for stdio, or per-session for HTTP transport.
 */
export function createConfiguredServer(): McpServer {
    const server = new McpServer({
        name: SERVER_NAME,
        version: "1.3.1",
    });

    server.tool(
        "get_currency_rates",
        "Get the list of currency exchange rates from Monobank. This is a public endpoint and does not require an API token. Monobank permits only one request per 5 minutes, so the response is cached in memory for 5 minutes: calls made within that window return the cached rates instead of failing with a rate-limit error.",
        {},
        async () => {
            logToolRequest("get_currency_rates", {});
            try {
                const { baseUrl } = getConfig();
                const url = `${baseUrl}/bank/currency`;

                const currencyRates = await withCache(
                    url,
                    CURRENCY_CACHE_TTL_MS,
                    async () => {
                        const response = await fetchWithErrorHandling(url);
                        const result =
                            await parseJsonResponse<unknown>(response);
                        return CurrencyRatesResponseSchema.parse(result);
                    },
                );

                return createSuccessResponse(currencyRates);
            } catch (error) {
                return formatErrorAsToolResponse(error, "get currency rates");
            }
        },
    );

    server.tool(
        "get_client_info",
        "Get information about the client together with the list of their accounts and jars. Requires the MONOBANK_API_TOKEN environment variable. Monobank permits only one request per 60 seconds, so the response is cached in memory for 60 seconds: calls made within that window return the cached data instead of failing with a rate-limit error. All monetary amounts are returned in currency units, not in cents. The account and jar identifiers returned by this tool can be passed to get_statement.",
        {},
        async () => {
            logToolRequest("get_client_info", {});
            try {
                const { baseUrl } = getConfig();
                const monobankApiToken = requireToken();
                const url = `${baseUrl}/personal/client-info`;

                const clientInfo = await withCache(
                    url,
                    PERSONAL_CACHE_TTL_MS,
                    async () => {
                        const response = await fetchWithErrorHandling(url, {
                            headers: {
                                "X-Token": monobankApiToken,
                            },
                        });
                        const result =
                            await parseJsonResponse<unknown>(response);
                        return formatClientInfo(ClientInfoSchema.parse(result));
                    },
                );

                return createSuccessResponse(clientInfo);
            } catch (error) {
                return formatErrorAsToolResponse(error, "get client info");
            }
        },
    );

    server.tool(
        "get_statement",
        "Get the Monobank statement for an account or jar between the {from} and {to} dates. Requires the MONOBANK_API_TOKEN environment variable. The maximum period for which a statement can be obtained is 31 days + 1 hour (2682000 seconds). Monobank permits only one request per 60 seconds, so every distinct account/date-range request is cached in memory for 60 seconds: repeating the same request within that window returns the cached statement instead of failing with a rate-limit error. All monetary amounts are returned in currency units, not in cents.",
        {
            account: z
                .string()
                .nonempty()
                .default("0")
                .describe(
                    "A unique identifier of the Monobank account or jar to build the statement for. Defaults to '0', which means the client's default account. Account and jar identifiers can be obtained from the get_client_info tool.",
                ),
            from: z
                .string()
                .nonempty()
                .describe(
                    "The start date of the statement period, in ISO 8601 YYYY-MM-DD format (UTC).",
                ),
            to: z
                .string()
                .optional()
                .describe(
                    "The end date of the statement period, in ISO 8601 YYYY-MM-DD format (UTC). The whole day is included. Defaults to the current moment when omitted.",
                ),
        },
        async ({ account, from, to }) => {
            logToolRequest("get_statement", { account, from, to });
            try {
                const dateValidation = validateStatementDates(from, to);
                if ("content" in dateValidation) {
                    return dateValidation;
                }

                const { fromInSeconds, toInSeconds } = dateValidation;
                const { baseUrl } = getConfig();
                const monobankApiToken = requireToken();
                const url = `${baseUrl}/personal/statement/${account}/${fromInSeconds}/${toInSeconds}`;

                const formattedStatement = await withCache(
                    url,
                    PERSONAL_CACHE_TTL_MS,
                    async () => {
                        const response = await fetchWithErrorHandling(url, {
                            headers: {
                                "X-Token": monobankApiToken,
                            },
                        });
                        const data = await parseJsonResponse<unknown>(response);
                        const statement = StatementResponseSchema.parse(data);
                        return formatStatementItems(statement);
                    },
                );

                return createSuccessResponse(formattedStatement);
            } catch (error) {
                return formatErrorAsToolResponse(error, "fetch statement");
            }
        },
    );

    return server;
}

async function main() {
    initializeConfig();

    const transport = process.env.TRANSPORT?.toLowerCase() ?? "stdio";

    if (transport === "http") {
        const { host, port } = getConfig();
        const httpServer = await startHttpServer(
            createConfiguredServer,
            port,
            host,
        );

        const shutdown = () => {
            console.error("Shutting down…");
            httpServer.close(() => process.exit(0));
        };
        process.on("SIGTERM", shutdown);
        process.on("SIGINT", shutdown);
    } else {
        const server = createConfiguredServer();
        const stdioTransport = new StdioServerTransport();
        await server.connect(stdioTransport);
        console.error("Monobank MCP Server running on stdio");
    }
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
