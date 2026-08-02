export interface Config {
    monobankApiToken?: string;
    baseUrl: string;
}

let config: Config | null = null;

export function initializeConfig(): Config {
    config = {
        monobankApiToken: process.env.MONOBANK_API_TOKEN,
        baseUrl: "https://api.monobank.ua",
    };

    return config;
}

export function getConfig(): Config {
    if (!config) {
        throw new Error(
            "Configuration not initialized. Call initializeConfig() first.",
        );
    }
    return config;
}

/**
 * Returns the Monobank API token, throwing an actionable error when it is
 * absent. Only the authenticated tools need it — the public currency rates
 * endpoint works without any token, so the server itself must still start.
 */
export function requireToken(): string {
    const { monobankApiToken } = getConfig();

    if (!monobankApiToken) {
        throw new Error(
            "The MONOBANK_API_TOKEN environment variable is not set. This tool requires an authenticated Monobank API token. Get one at https://api.monobank.ua/ and set MONOBANK_API_TOKEN in the MCP server configuration, then restart the server. The get_currency_rates tool works without a token.",
        );
    }

    return monobankApiToken;
}
