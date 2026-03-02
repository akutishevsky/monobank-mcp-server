export interface CurrencyRate {
    currencyCodeA: number;
    currencyCodeB: number;
    date: number;
    rateBuy?: number;
    rateSell?: number;
    rateCross?: number;
}

export interface Account {
    id: string;
    sendId: string;
    balance: number;
    creditLimit?: number;
    type: "black" | "white" | "platinum" | "iron" | "fop" | "yellow" | "eAid";
    currencyCode: number;
    cashbackType: "None" | "UAH" | "Miles";
    maskedPan: string[];
    iban: string;
}

export interface Jar {
    id: string;
    sendId: string;
    title: string;
    description: string;
    currencyCode: number;
    balance: number;
    goal?: number;
}

export interface ClientInfo {
    clientId: string;
    name: string;
    webHookUrl?: string;
    permissions: string;
    accounts: Account[];
    jars: Jar[];
}

export interface StatementItem {
    id: string;
    time: number;
    description: string;
    mcc: number;
    originalMcc: number;
    hold: boolean;
    amount: number;
    operationAmount: number;
    currencyCode: number;
    commissionRate: number;
    cashbackAmount: number;
    balance: number;
    comment?: string;
    receiptId?: string;
    invoiceId?: string;
    counterEdrpou?: string;
    counterIban?: string;
    counterName?: string;
}
