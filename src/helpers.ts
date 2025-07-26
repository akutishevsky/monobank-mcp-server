import { z } from "zod";

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

export function createSuccessResponse(data: any): ToolResponse {
    return {
        content: [
            {
                type: "text",
                text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
            },
        ],
    };
}

export function formatZodError(error: z.ZodError): string {
    return error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
}

export async function fetchWithErrorHandling(
    url: string,
    options?: RequestInit
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
            }`
        );
    }
}

export function formatErrorAsToolResponse(error: unknown, context: string): ToolResponse {
    if (error instanceof z.ZodError) {
        return createErrorResponse(
            `Invalid ${context} format: ${formatZodError(error)}`
        );
    }
    
    if (error instanceof Error) {
        return createErrorResponse(
            error.message.startsWith("HTTP") 
                ? `Failed to ${context}: ${error.message}`
                : `Error ${context}: ${error.message}`
        );
    }
    
    return createErrorResponse(`Error ${context}: Unknown error`);
}

interface DateValidationResult {
    fromInSeconds: number;
    toInSeconds: number;
    error?: string;
}

export function validateStatementDates(
    from: string,
    to?: string
): DateValidationResult | ToolResponse {
    const fromDate = new Date(from);
    const toDate = to ? new Date(to) : new Date();

    if (isNaN(fromDate.getTime())) {
        return createErrorResponse(`Invalid 'from' date format: ${from}`);
    }

    if (to && isNaN(toDate.getTime())) {
        return createErrorResponse(`Invalid 'to' date format: ${to}`);
    }

    const fromInSeconds = Math.floor(fromDate.getTime() / 1000);
    const toInSeconds = Math.floor(toDate.getTime() / 1000);

    // Validate time range (max 31 days + 1 hour = 2682000 seconds)
    if (toInSeconds - fromInSeconds > 2682000) {
        return createErrorResponse(
            "Time range exceeds maximum allowed (31 days + 1 hour). Please use a smaller date range."
        );
    }

    return { fromInSeconds, toInSeconds };
}

export function formatStatementItems(items: any[]): any[] {
    return items.map((item) => ({
        ...item,
        amount: item.amount / 100,
        operationAmount: item.operationAmount / 100,
        cashbackAmount: item.cashbackAmount / 100,
        balance: item.balance / 100,
    }));
}