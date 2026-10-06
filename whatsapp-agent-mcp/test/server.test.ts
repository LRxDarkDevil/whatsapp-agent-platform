import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppAgentClient } from "whatsapp-agent-sdk";

import { createWhatsAppAgentMcpServer } from "../src/server.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function retainedUpdate(): string {
  return JSON.stringify({
    object: "whatsapp_agent_platform",
    entry: [
      {
        id: "1234567890123456",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              contacts: [{ wa_id: "user:123", profile: { name: "Test User" } }],
              messages: [
                {
                  from: "user:123",
                  id: "wamid.inbound",
                  timestamp: "1791184559",
                  type: "text",
                  text: { body: "Hello MCP" },
                },
              ],
              statuses: [],
            },
          },
        ],
      },
    ],
    next_offset: 7,
  });
}

async function connect(fetchMock: typeof fetch) {
  const whatsapp = new WhatsAppAgentClient({
    token: "test-token",
    fetch: fetchMock,
    rateLimit: false,
    maxRetries: 0,
  });
  const server = createWhatsAppAgentMcpServer({ client: whatsapp });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

describe("WhatsApp Agent MCP server", () => {
  it("works through the current MCP serveStdio entrypoint", async () => {
    const whatsapp = new WhatsAppAgentClient({
      token: "test-token",
      fetch: vi.fn<typeof fetch>(),
      rateLimit: false,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const handle = serveStdio(
      () => createWhatsAppAgentMcpServer({ client: whatsapp }),
      { transport: serverTransport },
    );
    const client = new Client({ name: "stdio-test", version: "1.0.0" });

    try {
      await client.connect(clientTransport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toContain("whatsapp_get_updates");
    } finally {
      await client.close().catch(() => undefined);
      await handle.close().catch(() => undefined);
    }
  });

  it("advertises a focused set of WhatsApp Agent tools", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const connected = await connect(fetchMock);
    cleanups.push(() => connected.client.close(), () => connected.server.close());

    const listed = await connected.client.listTools();
    const names = listed.tools.map((tool) => tool.name);

    expect(names).toEqual(expect.arrayContaining([
      "whatsapp_agent_status",
      "whatsapp_get_updates",
      "whatsapp_send_text",
      "whatsapp_mark_read",
      "whatsapp_send_media",
      "whatsapp_get_media",
    ]));
    expect(names).not.toContain("whatsapp_upload_media_file");
    expect(names).not.toContain("whatsapp_download_media_file");
  });

  it("reads retained updates without marking them read", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(retainedUpdate(), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const connected = await connect(fetchMock);
    cleanups.push(() => connected.client.close(), () => connected.server.close());

    const response = await connected.client.callTool({
      name: "whatsapp_get_updates",
      arguments: { offset: "0", limit: 100, timeoutSeconds: 0 },
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      agentId: "1234567890123456",
      nextOffset: "7",
      messages: [{ id: "wamid.inbound", text: "Hello MCP" }],
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("GET");
  });

  it("sends text to the discovered creator", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(retainedUpdate(), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        contacts: [{ input: "user:123", wa_id: "user:123" }],
        messages: [{ id: "wamid.outbound" }],
      }));
    const connected = await connect(fetchMock);
    cleanups.push(() => connected.client.close(), () => connected.server.close());

    const response = await connected.client.callTool({
      name: "whatsapp_send_text",
      arguments: { text: "Hello from MCP", previewUrl: false },
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      sent: true,
      messageId: "wamid.outbound",
      recipient: "user:123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sendInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(sendInit.body))).toMatchObject({
      messaging_product: "whatsapp",
      to: "user:123",
      type: "text",
      text: { body: "Hello from MCP" },
    });
  });

  it("marks read only when the explicit write tool is called", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ success: true }));
    const connected = await connect(fetchMock);
    cleanups.push(() => connected.client.close(), () => connected.server.close());

    const response = await connected.client.callTool({
      name: "whatsapp_mark_read",
      arguments: { messageId: "wamid.inbound", typing: true },
    });

    expect(response.structuredContent).toMatchObject({ success: true, typing: true });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      status: "read",
      message_id: "wamid.inbound",
      typing_indicator: { type: "text" },
    });
  });

  it("keeps filesystem tools disabled by default", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const connected = await connect(fetchMock);
    cleanups.push(() => connected.client.close(), () => connected.server.close());

    await expect(connected.client.callTool({
      name: "whatsapp_upload_media_file",
      arguments: { path: "secret.txt" },
    })).rejects.toThrow(/not found/i);
  });
});
