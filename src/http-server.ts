import {
    createServer,
    IncomingMessage,
    Server,
    ServerResponse,
} from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { getConfig } from "./config.js";

const MCP_PATH = "/mcp";
const MAX_BODY_SIZE = 1_048_576; // 1 MB

interface Session {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
    lastActivity: number;
    /** Requests or streams on this session that have not finished yet. */
    openRequests: number;
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
        const onData = (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_SIZE) {
                // Stop buffering but keep the socket open so the 413 can
                // still be written; the caller closes the connection.
                req.off("data", onData);
                req.pause();
                reject(new BodyTooLargeError());
                return;
            }
            chunks.push(chunk);
        };
        req.on("data", onData);
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

function sendJsonRpcError(
    res: ServerResponse,
    status: number,
    code: number,
    message: string,
): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
        JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    );
}

export interface HttpServerHandle {
    server: Server;
    /** Closes every MCP session and open connection, then the server. */
    shutdown(): Promise<void>;
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
): Promise<HttpServerHandle> {
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

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`PORT must be an integer between 1 and 65535.`);
    }
    if (!Number.isFinite(sessionIdleTimeoutMs) || sessionIdleTimeoutMs <= 0) {
        throw new Error(
            "SESSION_IDLE_TIMEOUT_MS must be a positive number of milliseconds.",
        );
    }

    const allowedHosts = [
        ...buildAllowedHosts(host, port),
        ...extraAllowedHosts,
    ];
    const allowedOrigins = allowedHosts.map((h) => `http://${h}`);

    const httpServer = createServer(async (req, res) => {
        try {
            // Only the path matters here; Host is validated by the
            // transport's DNS rebinding check, so don't build the URL from it.
            const url = new URL(req.url ?? "/", "http://localhost");

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
                        Connection: "close",
                    });
                    res.end(
                        JSON.stringify({ error: "Request body too large" }),
                        () => req.destroy(),
                    );
                } else {
                    req.destroy();
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

        if (
            req.method !== "POST" &&
            req.method !== "GET" &&
            req.method !== "DELETE"
        ) {
            res.writeHead(405, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
        }

        // An unknown session ID means the session expired or the server
        // restarted. The spec requires 404 here: it is the signal for the
        // client to start a new session.
        if (sessionId && !sessions.has(sessionId)) {
            sendJsonRpcError(res, 404, -32001, "Session not found");
            return;
        }

        let parsed: unknown;
        if (req.method === "POST") {
            const body = await readBody(req);
            try {
                parsed = JSON.parse(body);
            } catch {
                sendJsonRpcError(res, 400, -32700, "Parse error");
                return;
            }
        }

        if (sessionId) {
            const session = sessions.get(sessionId)!;
            await handleTracked(session, req, res, parsed);
            return;
        }

        // No session header: only an initialize request may open a session.
        // Anything else is rejected before allocating a server, so stray
        // requests can't leave unclosed transports behind.
        if (req.method !== "POST" || !isInitializeRequest(parsed)) {
            sendJsonRpcError(
                res,
                400,
                -32000,
                "Bad Request: missing Mcp-Session-Id header",
            );
            return;
        }

        // The allowedHosts / allowedOrigins / enableDnsRebindingProtection
        // options are deprecated in the SDK in favour of external middleware,
        // but still functional. Used here as a defence-in-depth measure
        // against DNS rebinding attacks targeting the local HTTP endpoint.
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string) => {
                sessions.set(id, session);
            },
            enableDnsRebindingProtection: true,
            allowedHosts,
            allowedOrigins,
        });
        const mcpServer = createServerFn();
        const session: Session = {
            transport,
            server: mcpServer,
            lastActivity: Date.now(),
            openRequests: 0,
        };

        transport.onclose = () => {
            const id = transport.sessionId;
            if (id) sessions.delete(id);
        };

        await mcpServer.connect(transport);
        await handleTracked(session, req, res, parsed);

        // Initialization failed (e.g. rejected Host header): no session was
        // registered, so release the pair now rather than leaking it.
        if (!transport.sessionId || !sessions.has(transport.sessionId)) {
            await transport.close();
        }
    }

    /**
     * Passes a request to the session's transport while counting it as open,
     * so idle cleanup never closes a session with a running tool call or a
     * live SSE stream. Activity is stamped both when it starts and when the
     * response finishes.
     */
    async function handleTracked(
        session: Session,
        req: IncomingMessage,
        res: ServerResponse,
        parsed: unknown,
    ): Promise<void> {
        session.openRequests++;
        session.lastActivity = Date.now();
        res.once("close", () => {
            session.openRequests--;
            session.lastActivity = Date.now();
        });
        await session.transport.handleRequest(req, res, parsed);
    }

    // Periodically clean up idle sessions.
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [id, session] of sessions) {
            if (
                session.openRequests === 0 &&
                now - session.lastActivity > sessionIdleTimeoutMs
            ) {
                console.error(`Closing idle session ${id}`);
                session.transport.close();
                sessions.delete(id);
            }
        }
    }, 60_000);
    cleanupInterval.unref();

    async function shutdown(): Promise<void> {
        clearInterval(cleanupInterval);
        // Open SSE streams keep connections alive, and server.close() waits
        // for every connection to end, so close the sessions first.
        await Promise.allSettled(
            [...sessions.values()].map((s) => s.transport.close()),
        );
        sessions.clear();
        await new Promise<void>((resolve) => {
            httpServer.close(() => resolve());
            httpServer.closeAllConnections();
        });
    }

    return new Promise((resolve) => {
        httpServer.listen(port, host, () => {
            console.error(
                `Monobank MCP Server running on http://${host}:${port}${MCP_PATH}`,
            );
            resolve({ server: httpServer, shutdown });
        });
    });
}
