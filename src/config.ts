export interface Config {
    monobankApiToken?: string;
    mcpAuthToken?: string;
    baseUrl: string;
    host: string;
    port: number;
    /** Extra `host[:port]` values accepted in the Host header, from ALLOWED_HOSTS. */
    extraAllowedHosts: string[];
    sessionIdleTimeoutMs: number;
}

let config: Config | null = null;

export function initializeConfig(): Config {
    config = {
        monobankApiToken: process.env.MONOBANK_API_TOKEN,
        mcpAuthToken: process.env.MCP_AUTH_TOKEN,
        baseUrl: "https://api.monobank.ua",
        host: process.env.HOST ?? "127.0.0.1",
        port: parseInt(process.env.PORT ?? "3000", 10),
        extraAllowedHosts: (process.env.ALLOWED_HOSTS ?? "")
            .split(",")
            .map((h) => h.trim())
            .filter((h) => h.length > 0),
        sessionIdleTimeoutMs: parseInt(
            process.env.SESSION_IDLE_TIMEOUT_MS ?? "600000",
            10,
        ),
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
