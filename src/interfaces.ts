export interface CurrencyRate {
    currencyCodeA: number;
    currencyCodeB: number;
    date: number;
    rateBuy?: number;
    rateSell?: number;
    rateCross?: number;
}