import { z } from "zod";

/**
 * The Monobank personal-API OpenAPI spec (info.version v250818) declares no
 * `required` arrays at all — every response property is formally optional.
 * Schemas here therefore mark every field `.optional()` so that a single
 * atypical record (a jar, a ФОП item without `originalMcc`, and so on) cannot
 * fail an entire tool call, and use `.passthrough()` so that fields the bank
 * adds later survive validation instead of being silently stripped.
 */

export const CurrencyRateSchema = z
    .object({
        currencyCodeA: z.number().optional(),
        currencyCodeB: z.number().optional(),
        date: z.number().optional(),
        rateBuy: z.number().optional(),
        rateSell: z.number().optional(),
        rateCross: z.number().optional(),
    })
    .passthrough();

export const CurrencyRatesResponseSchema = z.array(CurrencyRateSchema);

export const StatementItemSchema = z
    .object({
        id: z.string().optional(),
        time: z.number().optional(),
        description: z.string().optional(),
        mcc: z.number().optional(),
        originalMcc: z.number().optional(),
        hold: z.boolean().optional(),
        amount: z
            .number()
            .optional()
            .describe(
                "Raw API value is in cents; divided by 100 into currency units before being returned.",
            ),
        operationAmount: z
            .number()
            .optional()
            .describe(
                "Raw API value is in cents; divided by 100 into currency units before being returned.",
            ),
        currencyCode: z.number().optional(),
        commissionRate: z
            .number()
            .optional()
            .describe(
                "Despite the name this is an absolute commission amount, not a percentage: " +
                    "'Розмір комісії в мінімальних одиницях валюти (копійках, центах)'. " +
                    "Divided by 100 into currency units before being returned.",
            ),
        cashbackAmount: z
            .number()
            .optional()
            .describe(
                "Raw API value is in cents; divided by 100 into currency units before being returned.",
            ),
        balance: z
            .number()
            .optional()
            .describe(
                "Raw API value is in cents; divided by 100 into currency units before being returned.",
            ),
        comment: z.string().optional(),
        receiptId: z.string().optional(),
        invoiceId: z.string().optional(),
        counterEdrpou: z.string().optional(),
        counterIban: z.string().optional(),
        counterName: z.string().optional(),
    })
    .passthrough();

export const StatementResponseSchema = z.array(StatementItemSchema);

/**
 * `type` and `cashbackType` are enumerated by the spec, but the bank ships new
 * card products without warning. Listing the known values keeps the schema
 * self-documenting, while the `.or(z.string())` fallback ensures an eighth card
 * type (or a new cashback programme) parses instead of breaking the tool.
 */
export const AccountSchema = z
    .object({
        id: z.string().optional(),
        sendId: z.string().optional(),
        balance: z
            .number()
            .optional()
            .describe(
                "Raw API value is in cents; divided by 100 into currency units before being returned.",
            ),
        creditLimit: z
            .number()
            .optional()
            .describe(
                "Raw API value is in cents; divided by 100 into currency units before being returned.",
            ),
        type: z
            .enum([
                "black",
                "white",
                "platinum",
                "iron",
                "fop",
                "yellow",
                "eAid",
            ])
            .or(z.string())
            .optional(),
        currencyCode: z.number().optional(),
        cashbackType: z
            .enum(["None", "UAH", "Miles"])
            .or(z.string())
            .optional(),
        maskedPan: z.array(z.string()).optional(),
        iban: z.string().optional(),
    })
    .passthrough();

export const JarSchema = z
    .object({
        id: z.string().optional(),
        sendId: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        currencyCode: z.number().optional(),
        balance: z
            .number()
            .optional()
            .describe(
                "Raw API value is in cents; divided by 100 into currency units before being returned.",
            ),
        goal: z
            .number()
            .optional()
            .describe(
                "Raw API value is in cents; divided by 100 into currency units before being returned.",
            ),
    })
    .passthrough();

/**
 * "Перелік клієнтів, які надали доступ до рахунків ФОП бухгалтеру."
 *
 * `tin` is declared `type: string` in the spec, but the spec's own example is
 * the JSON number `1234567890`, so both shapes are accepted.
 */
export const ManagedClientSchema = z
    .object({
        id: z.string().optional(),
        name: z.string().optional(),
        tin: z.union([z.string(), z.number()]).optional(),
        accounts: z.array(AccountSchema).optional(),
    })
    .passthrough();

export const ClientInfoSchema = z
    .object({
        clientId: z.string().optional(),
        name: z.string().optional(),
        webHookUrl: z.string().optional(),
        permissions: z.string().optional(),
        accounts: z.array(AccountSchema).optional(),
        jars: z.array(JarSchema).optional(),
        managedClients: z.array(ManagedClientSchema).optional(),
    })
    .passthrough();
