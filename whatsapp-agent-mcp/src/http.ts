import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { createMcpHandler } from "@modelcontextprotocol/server";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { WhatsAppAgentClient } from "whatsapp-agent-sdk";

import { createWhatsAppAgentMcpServer } from "./server.js";

export interface HttpServerOptions {
  whatsappToken: string;
  authToken: string;
  host?: string;
  port?: number;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  allowFileIO?: boolean;
  fileRoot?: string;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorized(req: IncomingMessage, expectedToken: string): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  return constantTimeEqual(header.slice(7), expectedToken);
}

export async function startHttpServer(options: HttpServerOptions) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;

  if (options.authToken.length < 24) {
    throw new Error("MCP_AUTH_TOKEN must be at least 24 characters for HTTP mode.");
  }

  let allowedHosts = options.allowedHosts?.filter(Boolean) ?? [];
  if (allowedHosts.length === 0) {
    if (!isLoopback(host)) {
      throw new Error(
        "MCP_ALLOWED_HOSTS is required when HTTP mode binds to a non-loopback host such as 0.0.0.0.",
      );
    }
    allowedHosts = ["localhost", "127.0.0.1", "[::1]"];
  }

  const allowedOrigins = options.allowedOrigins?.filter(Boolean) ?? allowedHosts;
  const validateHost = hostHeaderValidation(allowedHosts);
  const validateOrigin = originValidation(allowedOrigins);
  const whatsapp = new WhatsAppAgentClient({ token: options.whatsappToken });

  const handler = createMcpHandler(
    () =>
      createWhatsAppAgentMcpServer({
        client: whatsapp,
        ...(options.allowFileIO !== undefined ? { allowFileIO: options.allowFileIO } : {}),
        ...(options.fileRoot ? { fileRoot: options.fileRoot } : {}),
      }),
    {
      responseMode: "auto",
      onerror: (error) => console.error("[whatsapp-agent-mcp] MCP handler error:", error),
    },
  );
  const handleMcp = toNodeHandler(handler, {
    onerror: (error) => console.error("[whatsapp-agent-mcp] HTTP adapter error:", error),
  });

  const httpServer = createServer(async (req, res) => {
    // Parse the request target without trusting Host. Host validation happens
    // separately below for the MCP endpoint.
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    if (pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, { ok: true, service: "whatsapp-agent-mcp" });
      return;
    }

    if (pathname !== "/mcp") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    if (!validateHost(req, res)) return;
    if (!validateOrigin(req, res)) return;

    if (!authorized(req, options.authToken)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="whatsapp-agent-mcp"');
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    await handleMcp(
      req as unknown as Parameters<typeof handleMcp>[0],
      res as unknown as Parameters<typeof handleMcp>[1],
    );
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  const address = httpServer.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    host,
    port: actualPort,
    close: async () => {
      await handler.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
