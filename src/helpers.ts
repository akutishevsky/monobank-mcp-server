import { z } from "zod";
import { Account, ClientInfo, StatementItem } from "./interfaces.js";

export interface ToolResponse {
    [key: string]: unknown;
    content: Array<{
        type: "text";
        text: string;
    }>;
}

export function createErrorResponse(message: string): ToolResponse {
    return {
        content: [
            {
                type: "text",
                text: message,
            },
        ],
    };
}

export function createSuccessResponse(data: unknown): ToolResponse {
    return {
        content: [
            {
                type: "text",
                text:
                    typeof data === "string"
                        ? data
                        : JSON.stringify(data, null, 2),
            },
        ],
    };
}

/**
 * `ZodError.issues` is the canonical accessor: it exists in zod 3 and is the
 * only one that survived into zod 4, where the `.errors` alias was removed.
 * Every error path in this server funnels through here, so reading `.errors`
 * would turn a future major bump into `Cannot read properties of undefined`
 * and mask the real failure.
 */
export function formatZodError(error: z.ZodError): string {
    return error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ");
}

export async function fetchWithErrorHandling(
    url: string,
    options?: RequestInit,
): Promise<Response> {
    const response = await fetch(url, options);

    if (!response.ok) {
        const errorText = await response
            .text()
            .catch(() => response.statusText);
        throw new Error(`HTTP ${response.status} - ${errorText}`);
    }

    return response;
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
    try {
        return await response.json();
    } catch (error) {
        throw new Error(
            `Failed to parse response as JSON: ${
                error instanceof Error ? error.message : "Unknown JSON error"
            }`,
        );
    }
}

export function formatErrorAsToolResponse(
    error: unknown,
    context: string,
): ToolResponse {
    if (error instanceof z.ZodError) {
        return createErrorResponse(
            `Invalid ${context} format: ${formatZodError(error)}`,
        );
    }

    if (error instanceof Error) {
        return createErrorResponse(
            error.message.startsWith("HTTP")
                ? `Failed to ${context}: ${error.message}`
                : `Error ${context}: ${error.message}`,
        );
    }

    return createErrorResponse(`Error ${context}: Unknown error`);
}

/* -------------------------------------------------------------------------- */
/*                              Response caching                              */
/* -------------------------------------------------------------------------- */

interface CacheEntry {
    value: unknown;
    expiresAt: number;
}

const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();

/**
 * Monobank rate-limits each endpoint (60s for the authenticated ones, 5 min for
 * currency rates) and answers an early repeat with HTTP 429. Models retry on
 * failure, which makes that trivially easy to trigger, so results are memoised
 * per request URL for `ttlMs`.
 *
 * Only fulfilled values are stored: a rejection propagates to every caller
 * waiting on it and leaves no cache entry and no in-flight entry behind, so the
 * next call retries for real. Concurrent calls for the same key share a single
 * upstream request.
 */
export async function withCache<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
): Promise<T> {
    const cached = responseCache.get(key);

    if (cached) {
        if (cached.expiresAt > Date.now()) {
            return cached.value as T;
        }
        responseCache.delete(key);
    }

    const pending = inFlightRequests.get(key);
    if (pending) {
        return pending as Promise<T>;
    }

    const request = (async () => {
        try {
            const value = await fn();
            responseCache.set(key, {
                value,
                expiresAt: Date.now() + ttlMs,
            });
            return value;
        } finally {
            inFlightRequests.delete(key);
        }
    })();

    inFlightRequests.set(key, request);

    return request;
}

/** Drops every memoised response. Intended for tests and manual refreshes. */
export function clearCache(): void {
    responseCache.clear();
}

/* -------------------------------------------------------------------------- */
/*                               Date handling                                */
/* -------------------------------------------------------------------------- */

interface DateValidationResult {
    fromInSeconds: number;
    toInSeconds: number;
}

/** Max range accepted by Monobank: 31 days + 1 hour, in seconds. */
const MAX_RANGE_IN_SECONDS = 2682000;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `new Date("2024-10-01")` is UTC midnight while `new Date("2024-10-01T00:00")`
 * is *local* midnight, so the two spellings of the same instant used to shift
 * the range by the host's TZ offset. Date-only input is therefore anchored
 * explicitly in UTC — and the `to` bound to the end of its day, since a
 * statement "to 2024-10-31" plainly means Oct 31 is included. A full datetime
 * is honoured exactly as the caller wrote it.
 */
function parseBoundaryDate(value: string, boundary: "from" | "to"): Date {
    if (DATE_ONLY_PATTERN.test(value)) {
        return new Date(
            boundary === "from"
                ? `${value}T00:00:00.000Z`
                : `${value}T23:59:59.999Z`,
        );
    }

    return new Date(value);
}

export function validateStatementDates(
    from: string,
    to?: string,
): DateValidationResult | ToolResponse {
    const fromDate = parseBoundaryDate(from, "from");
    const toDate = to ? parseBoundaryDate(to, "to") : new Date();

    if (isNaN(fromDate.getTime())) {
        return createErrorResponse(`Invalid 'from' date format: ${from}`);
    }

    if (to && isNaN(toDate.getTime())) {
        return createErrorResponse(`Invalid 'to' date format: ${to}`);
    }

    const fromInSeconds = Math.floor(fromDate.getTime() / 1000);
    const toInSeconds = Math.floor(toDate.getTime() / 1000);

    if (toInSeconds < fromInSeconds) {
        return createErrorResponse(
            `Invalid date range: 'to' (${to ?? "now"}) is earlier than 'from' (${from}). Please swap the dates.`,
        );
    }

    // Validate time range (max 31 days + 1 hour = 2682000 seconds)
    if (toInSeconds - fromInSeconds > MAX_RANGE_IN_SECONDS) {
        return createErrorResponse(
            "Time range exceeds maximum allowed (31 days + 1 hour). Please use a smaller date range.",
        );
    }

    return { fromInSeconds, toInSeconds };
}

/* -------------------------------------------------------------------------- */
/*                            Amount normalisation                            */
/* -------------------------------------------------------------------------- */

const CENTS_PER_UNIT = 100;

/**
 * Every property in the Monobank response types is optional, so a blind
 * `value / 100` yields `NaN` for anything the bank omitted. This returns only
 * the keys that actually held a finite number, converted to currency units, so
 * spreading it over the original record leaves absent fields absent.
 */
function centsToUnits<T extends object, K extends keyof T>(
    source: T,
    keys: readonly K[],
): Partial<Record<K, number>> {
    const converted: Partial<Record<K, number>> = {};

    for (const key of keys) {
        const value = source[key];
        if (typeof value === "number" && Number.isFinite(value)) {
            converted[key] = value / CENTS_PER_UNIT;
        }
    }

    return converted;
}

/**
 * `commissionRate` is included deliberately: despite the name the spec defines
 * it as "Розмір комісії в мінімальних одиницях валюти (копійках, центах)" — an
 * absolute amount in cents, not a percentage.
 */
const STATEMENT_AMOUNT_FIELDS = [
    "amount",
    "operationAmount",
    "cashbackAmount",
    "balance",
    "commissionRate",
] as const;

const ACCOUNT_AMOUNT_FIELDS = ["balance", "creditLimit"] as const;

const JAR_AMOUNT_FIELDS = ["balance", "goal"] as const;

export function formatStatementItems(items: StatementItem[]) {
    return items.map((item) => ({
        ...item,
        ...centsToUnits(item, STATEMENT_AMOUNT_FIELDS),
    }));
}

function formatAccount(account: Account) {
    return {
        ...account,
        ...centsToUnits(account, ACCOUNT_AMOUNT_FIELDS),
    };
}

/**
 * `get_client_info` used to return the raw payload, leaving balances in cents
 * while `get_statement` reported units — a balance of `10000000` next to a
 * transaction of `-95.0`, with nothing to signal the 100x difference. All six
 * cent-valued paths are normalised here so both tools speak the same units.
 */
export function formatClientInfo(info: ClientInfo) {
    return {
        ...info,
        ...(Array.isArray(info.accounts)
            ? { accounts: info.accounts.map(formatAccount) }
            : {}),
        ...(Array.isArray(info.jars)
            ? {
                  jars: info.jars.map((jar) => ({
                      ...jar,
                      ...centsToUnits(jar, JAR_AMOUNT_FIELDS),
                  })),
              }
            : {}),
        ...(Array.isArray(info.managedClients)
            ? {
                  managedClients: info.managedClients.map((client) => ({
                      ...client,
                      ...(Array.isArray(client.accounts)
                          ? { accounts: client.accounts.map(formatAccount) }
                          : {}),
                  })),
              }
            : {}),
    };
}
