import { describe, expect, it, vi } from "vitest";

import {
  PollReplacedError,
  ValidationError,
  WhatsAppAgentClient,
} from "../src/index.js";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function updateEnvelope(options: {
  nextOffset?: string;
  messages?: unknown[];
  statuses?: unknown[];
  contacts?: unknown[];
}) {
  const nextOffset = options.nextOffset ?? "3";
  return `{"object":"whatsapp_agent_platform","entry":[{"id":"1234567890123456","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","contacts":${JSON.stringify(options.contacts ?? [])},"messages":${JSON.stringify(options.messages ?? [])},"statuses":${JSON.stringify(options.statuses ?? [])}}}]}],"next_offset":${nextOffset}}`;
}

describe("WhatsAppAgentClient", () => {
  it("parses updates and preserves a 64-bit next_offset exactly", async () => {
    const body = updateEnvelope({
      nextOffset: "9223372036854775807",
      contacts: [{ wa_id: "user:123", profile: { name: "Test User" } }],
      messages: [{
        from: "user:123",
        id: "wamid.inbound",
        timestamp: "1791184559",
        type: "text",
        text: { body: "Hello" },
      }],
    });

    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const client = new WhatsAppAgentClient({ token: "test", fetch: fetchMock, rateLimit: false });

    const update = await client.getUpdates({ offset: 0, timeout: 0 });

    expect(update?.agentId).toBe("1234567890123456");
    expect(update?.nextOffset).toBe("9223372036854775807");
    expect(update?.messages[0]?.text).toBe("Hello");
    expect(update?.messages[0]?.profileName).toBe("Test User");
    expect(client.recipient).toBe("user:123");
  });

  it("returns null for a 204 poll without inventing a cursor", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new WhatsAppAgentClient({ token: "test", fetch: fetchMock, rateLimit: false });
    await expect(client.getUpdates({ offset: "17", timeout: 0 })).resolves.toBeNull();
  });

  it("rejects unsafe numeric offsets instead of silently rounding them", async () => {
    const fetchMock = vi.fn();
    const client = new WhatsAppAgentClient({ token: "test", fetch: fetchMock as typeof fetch, rateLimit: false });

    await expect(client.getUpdates({ offset: Number.MAX_SAFE_INTEGER + 1, timeout: 0 }))
      .rejects.toThrow(/decimal string or bigint/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("auto-discovers the creator and sends text", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(updateEnvelope({ contacts: [{ wa_id: "user:123" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        contacts: [{ input: "user:123", wa_id: "user:123" }],
        messages: [{ id: "wamid.outbound" }],
      }));

    const client = new WhatsAppAgentClient({ token: "test", fetch: fetchMock, rateLimit: false });
    const result = await client.sendText("Hello from the agent");

    expect(result.messageId).toBe("wamid.outbound");
    expect(result.waId).toBe("user:123");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondRequest = fetchMock.mock.calls[1];
    const init = secondRequest?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      messaging_product: "whatsapp",
      to: "user:123",
      type: "text",
      text: { body: "Hello from the agent" },
    });
  });

  it("sends a quoted reply using context.message_id", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      contacts: [{ input: "user:123", wa_id: "user:123" }],
      messages: [{ id: "wamid.reply" }],
    }));
    const client = new WhatsAppAgentClient({ token: "test", fetch: fetchMock, rateLimit: false });

    await client.sendText("user:123", "Quoted", { replyTo: "wamid.inbound" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      context: { message_id: "wamid.inbound" },
    });
  });

  it("maps duplicate long polling to PollReplacedError", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      error: {
        message: "Duplicate request",
        type: "OAuthException",
        code: 1752041,
      },
    }, 409));

    const client = new WhatsAppAgentClient({ token: "test", fetch: fetchMock, rateLimit: false, maxRetries: 0 });
    await expect(client.getUpdates({ timeout: 0 })).rejects.toBeInstanceOf(PollReplacedError);
  });

  it("marks an inbound message read and can request typing", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ success: true }));
    const client = new WhatsAppAgentClient({ token: "test", fetch: fetchMock, rateLimit: false });

    await expect(client.markRead("wamid.inbound", { typing: true })).resolves.toBe(true);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.inbound",
      typing_indicator: { type: "text" },
    });
  });

  it("rejects ordinary phone numbers because the Agent Platform uses user:<id>", async () => {
    const fetchMock = vi.fn();
    const client = new WhatsAppAgentClient({ token: "test", fetch: fetchMock as typeof fetch, rateLimit: false });

    await expect(client.sendText("+15551234567", "Hello")).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates text length before making a request", async () => {
    const fetchMock = vi.fn();
    const client = new WhatsAppAgentClient({ token: "test", fetch: fetchMock as typeof fetch, rateLimit: false });

    await expect(client.sendText("user:123", "x".repeat(4097))).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads in-memory media as multipart form data", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("messaging_product")).toBe("whatsapp");
      expect(form.get("type")).toBe("image/png");
      expect(form.get("file")).toBeInstanceOf(Blob);
      return jsonResponse({ id: "media:123" });
    });

    const client = new WhatsAppAgentClient({ token: "test", fetch: fetchMock, rateLimit: false });
    const id = await client.uploadMedia(new Uint8Array([1, 2, 3]), {
      mimeType: "image/png",
      filename: "tiny.png",
    });

    expect(id).toBe("media:123");
  });

  it("gets and downloads media without following authenticated redirects", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        id: "media:123",
        url: "https://lookaside.fbsbx.com/test-media",
        mime_type: "image/png",
        sha256: "abc",
        file_size: 3,
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 8, 9]), { status: 200 }));

    const client = new WhatsAppAgentClient({ token: "test", fetch: fetchMock, rateLimit: false });
    const bytes = await client.downloadMedia("media:123");

    expect([...bytes]).toEqual([7, 8, 9]);
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(secondInit.redirect).toBe("error");
    expect(new Headers(secondInit.headers).get("Authorization")).toBe("Bearer test");
  });

  it("deletes media through the media endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toContain("/media/media%3A123");
      expect(init?.method).toBe("DELETE");
      return jsonResponse({ success: true });
    });
    const client = new WhatsAppAgentClient({ token: "test", fetch: fetchMock, rateLimit: false });
    await expect(client.deleteMedia("media:123")).resolves.toBe(true);
  });
});
