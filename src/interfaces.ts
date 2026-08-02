import { z } from "zod";
import {
    AccountSchema,
    ClientInfoSchema,
    CurrencyRateSchema,
    JarSchema,
    ManagedClientSchema,
    StatementItemSchema,
} from "./schemas.js";

/**
 * Types are derived from the Zod schemas so that the two can never drift.
 * Because the Monobank spec declares no required properties, every property
 * here is optional — consumers must guard accordingly.
 */

export type CurrencyRate = z.infer<typeof CurrencyRateSchema>;

export type Account = z.infer<typeof AccountSchema>;

export type Jar = z.infer<typeof JarSchema>;

export type ManagedClient = z.infer<typeof ManagedClientSchema>;

export type ClientInfo = z.infer<typeof ClientInfoSchema>;

export type StatementItem = z.infer<typeof StatementItemSchema>;
