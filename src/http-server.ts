import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const MCP_PATH = "/mcp";

interface Session {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
}

const sessions = new Map<string, Session>();

/**
 * Reads the full request body as a string. Returns an empty string for
 * methods that carry no body (GET, DELETE).
 */
function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString()));
        req.on("error", reject);
    });
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
): Promise<void> {
    const httpServer = createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

        if (url.pathname !== MCP_PATH) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return;
        }

        try {
            await handleMcpRequest(req, res, createServer_);
        } catch (error) {
            console.error("Unhandled error in MCP request:", error);
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Internal server error" }));
            }
        }
    });

    httpServer.listen(port, "0.0.0.0", () => {
        console.error(
            `Monobank MCP Server running on http://0.0.0.0:${port}${MCP_PATH}`,
        );
    });
}

async function handleMcpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    createServer_: () => McpServer,
): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "POST") {
        const body = await readBody(req);
        const parsed = JSON.parse(body);

        if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!;
            await session.transport.handleRequest(req, res, parsed);
            return;
        }

        // New session — create transport + server pair.
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string) => {
                sessions.set(id, { transport, server: mcpServer });
            },
        });

        transport.onclose = () => {
            const id = transport.sessionId;
            if (id) sessions.delete(id);
        };

        const mcpServer = createServer_();
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, parsed);
    } else if (req.method === "GET" || req.method === "DELETE") {
        if (!sessionId || !sessions.has(sessionId)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing or invalid session ID" }));
            return;
        }

        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
    } else {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
    }
}
