import { describe, expect, it, vi } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { startHttpServer } from "../src/http.js";

describe("HTTP transport", () => {
  it("requires bearer authentication for /mcp and exposes a minimal health endpoint", async () => {
    const server = await startHttpServer({
      whatsappToken: "unused-in-this-test",
      authToken: "123456789012345678901234",
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const base = `http://127.0.0.1:${server.port}`;
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toMatchObject({ ok: true });

      const unauthorized = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers.get("www-authenticate")).toContain("Bearer");
    } finally {
      await server.close();
    }
  });

  it("refuses public binding without an explicit Host allowlist", async () => {
    await expect(startHttpServer({
      whatsappToken: "unused",
      authToken: "123456789012345678901234",
      host: "0.0.0.0",
      port: 0,
    })).rejects.toThrow(/MCP_ALLOWED_HOSTS/i);
  });

  it("completes an authenticated Streamable HTTP MCP handshake", async () => {
    const authToken = "mcp-test-token-12345678901234567890";
    const server = await startHttpServer({
      whatsappToken: "unused-until-a-whatsapp-tool-is-called",
      authToken,
      host: "127.0.0.1",
      port: 0,
    });

    const client = new Client({ name: "http-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${server.port}/mcp`),
      { authProvider: { token: async () => authToken } },
    );

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("whatsapp_send_text");
      expect(client.getServerVersion()?.name).toBe("whatsapp-agent-mcp");
    } finally {
      await client.close().catch(() => undefined);
      await server.close();
    }
  });
});
