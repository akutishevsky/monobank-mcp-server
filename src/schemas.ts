import { z } from "zod";

export const CurrencyRateSchema = z.object({
    currencyCodeA: z.number(),
    currencyCodeB: z.number(),
    date: z.number(),
    rateBuy: z.number().optional(),
    rateSell: z.number().optional(),
    rateCross: z.number().optional(),
});

export const CurrencyRatesResponseSchema = z.array(CurrencyRateSchema);

export const StatementItemSchema = z.object({
    id: z.string(),
    time: z.number(),
    description: z.string(),
    mcc: z.number(),
    originalMcc: z.number(),
    hold: z.boolean(),
    amount: z.number().describe("Amount in cents, multiply by 100"),
    operationAmount: z.number().describe("Amount in cents, multiply by 100"),
    currencyCode: z.number(),
    commissionRate: z.number(),
    cashbackAmount: z.number().describe("Amount in cents, multiply by 100"),
    balance: z.number().describe("Amount in cents, multiply by 100"),
    comment: z.string().optional(),
    receiptId: z.string().optional(),
    invoiceId: z.string().optional(),
    counterEdrpou: z.string().optional(),
    counterIban: z.string().optional(),
    counterName: z.string().optional(),
});