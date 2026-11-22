import {
    createServer,
    IncomingMessage,
    Server,
    ServerResponse,
} from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getConfig } from "./config.js";

const MCP_PATH = "/mcp";
const MAX_BODY_SIZE = 1_048_576; // 1 MB

interface Session {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
    lastActivity: number;
}

const sessions = new Map<string, Session>();

class BodyTooLargeError extends Error {
    constructor() {
        super("Request body exceeds 1 MB limit");
    }
}

/**
 * Reads the full request body as a string. Returns an empty string for
 * methods that carry no body (GET, DELETE). Rejects with BodyTooLargeError
 * if the payload exceeds MAX_BODY_SIZE.
 */
function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_SIZE) {
                req.destroy();
                reject(new BodyTooLargeError());
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString()));
        req.on("error", reject);
    });
}

/**
 * Constant-time comparison for bearer tokens. Returns true if the
 * provided authorization header matches the expected token.
 */
function checkBearerToken(
    authHeader: string | undefined,
    expectedToken: string,
): boolean {
    const expected = Buffer.from(`Bearer ${expectedToken}`);
    const actual = Buffer.from(authHeader ?? "");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
}

function buildAllowedHosts(host: string, port: number): string[] {
    const hosts = [`${host}:${port}`];
    if (host === "0.0.0.0" || host === "127.0.0.1") {
        hosts.push(`localhost:${port}`);
    }
    if (host === "0.0.0.0") {
        hosts.push(`127.0.0.1:${port}`);
    }
    return hosts;
}

/**
 * Starts a Node.js HTTP server that exposes the MCP Streamable HTTP transport
 * on `POST/GET/DELETE /mcp`.
 *
 * Each client session gets its own `McpServer` + `StreamableHTTPServerTransport`
 * pair so that concurrent clients do not interfere with one another.
 */
export async function startHttpServer(
    createServer_: () => McpServer,
    port: number,
    host: string,
): Promise<Server> {
    const { mcpAuthToken, sessionIdleTimeoutMs, extraAllowedHosts } =
        getConfig();

    // The HTTP endpoint serves the owner's bank data, so it never runs
    // unauthenticated — not even on loopback, where any local process
    // could otherwise read it.
    if (!mcpAuthToken) {
        throw new Error(
            "MCP_AUTH_TOKEN must be set when TRANSPORT=http. Generate one with `openssl rand -hex 32` and send it from the client as `Authorization: Bearer <token>`.",
        );
    }

    const allowedHosts = [
        ...buildAllowedHosts(host, port),
        ...extraAllowedHosts,
    ];
    const allowedOrigins = allowedHosts.map((h) => `http://${h}`);

    const httpServer = createServer(async (req, res) => {
        try {
            const url = new URL(
                req.url ?? "/",
                `http://${req.headers.host ?? "localhost"}`,
            );

            if (url.pathname !== MCP_PATH) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Not found" }));
                return;
            }

            if (!checkBearerToken(req.headers.authorization, mcpAuthToken)) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Unauthorized" }));
                return;
            }

            await handleMcpRequest(req, res, createServer_);
        } catch (error) {
            if (error instanceof BodyTooLargeError) {
                if (!res.headersSent) {
                    res.writeHead(413, {
                        "Content-Type": "application/json",
                    });
                    res.end(
                        JSON.stringify({ error: "Request body too large" }),
                    );
                }
                return;
            }
            console.error("Unhandled error in MCP request:", error);
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Internal server error" }));
            }
        }
    });

    async function handleMcpRequest(
        req: IncomingMessage,
        res: ServerResponse,
        createServerFn: () => McpServer,
    ): Promise<void> {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (req.method === "POST") {
            const body = await readBody(req);
            let parsed: unknown;
            try {
                parsed = JSON.parse(body);
            } catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({
                        jsonrpc: "2.0",
                        error: { code: -32700, message: "Parse error" },
                        id: null,
                    }),
                );
                return;
            }

            if (sessionId && sessions.has(sessionId)) {
                const session = sessions.get(sessionId)!;
                session.lastActivity = Date.now();
                await session.transport.handleRequest(req, res, parsed);
                return;
            }

            // New session — create transport + server pair.
            // The allowedHosts / allowedOrigins / enableDnsRebindingProtection
            // options are deprecated in the SDK in favour of external middleware,
            // but still functional. Used here as a defence-in-depth measure
            // against DNS rebinding attacks targeting the local HTTP endpoint.
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (id: string) => {
                    sessions.set(id, {
                        transport,
                        server: mcpServer,
                        lastActivity: Date.now(),
                    });
                },
                enableDnsRebindingProtection: true,
                allowedHosts,
                allowedOrigins,
            });

            transport.onclose = () => {
                const id = transport.sessionId;
                if (id) sessions.delete(id);
            };

            const mcpServer = createServerFn();
            await mcpServer.connect(transport);
            await transport.handleRequest(req, res, parsed);
        } else if (req.method === "GET" || req.method === "DELETE") {
            if (!sessionId || !sessions.has(sessionId)) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({ error: "Missing or invalid session ID" }),
                );
                return;
            }

            const session = sessions.get(sessionId)!;
            session.lastActivity = Date.now();
            await session.transport.handleRequest(req, res);
        } else {
            res.writeHead(405, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Method not allowed" }));
        }
    }

    // Periodically clean up idle sessions.
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [id, session] of sessions) {
            if (now - session.lastActivity > sessionIdleTimeoutMs) {
                console.error(`Closing idle session ${id}`);
                session.transport.close();
                sessions.delete(id);
            }
        }
    }, 60_000);

    httpServer.on("close", () => clearInterval(cleanupInterval));

    return new Promise((resolve) => {
        httpServer.listen(port, host, () => {
            console.error(
                `Monobank MCP Server running on http://${host}:${port}${MCP_PATH}`,
            );
            resolve(httpServer);
        });
    });
}
