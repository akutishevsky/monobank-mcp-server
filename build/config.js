let config = null;
export function initializeConfig() {
    if (!process.env.MONOBANK_API_TOKEN) {
        throw new Error("Failed to get the MONOBANK_API_TOKEN. Probably it wasn't added during the server configuration.");
    }
    config = {
        monobankApiToken: process.env.MONOBANK_API_TOKEN,
        baseUrl: "https://api.monobank.ua",
    };
    return config;
}
export function getConfig() {
    if (!config) {
        throw new Error("Configuration not initialized. Call initializeConfig() first.");
    }
    return config;
}
