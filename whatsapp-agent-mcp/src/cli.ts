#!/usr/bin/env node

import { resolve } from "node:path";

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { WhatsAppAgentClient } from "whatsapp-agent-sdk";

import { startHttpServer } from "./http.js";
import { createWhatsAppAgentMcpServer } from "./server.js";

function boolEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function csv(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main(): Promise<void> {
  const transport = (process.env.WHATSAPP_AGENT_MCP_TRANSPORT ?? "stdio").toLowerCase();
  const whatsappToken = requiredEnv("WHATSAPP_AGENT_TOKEN");
  const allowFileIO = boolEnv(process.env.WHATSAPP_AGENT_MCP_ALLOW_FILE_IO);
  const fileRoot = process.env.WHATSAPP_AGENT_MCP_FILE_ROOT?.trim();

  if (allowFileIO && !fileRoot) {
    throw new Error("WHATSAPP_AGENT_MCP_FILE_ROOT is required when file I/O is enabled.");
  }

  if (transport === "stdio") {
    const client = new WhatsAppAgentClient({ token: whatsappToken });
    const handle = serveStdio(() =>
      createWhatsAppAgentMcpServer({
        client,
        allowFileIO,
        ...(fileRoot ? { fileRoot: resolve(fileRoot) } : {}),
      }),
    );

    const shutdown = async () => {
      await handle.close();
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
    return;
  }

  if (transport === "http") {
    const authToken = requiredEnv("MCP_AUTH_TOKEN");
    const host = process.env.HOST?.trim() || "127.0.0.1";
    const portRaw = process.env.PORT?.trim() || "3000";
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid PORT: ${portRaw}`);
    }

    const allowedHosts = csv(process.env.MCP_ALLOWED_HOSTS);
    const allowedOrigins = csv(process.env.MCP_ALLOWED_ORIGINS);
    const http = await startHttpServer({
      whatsappToken,
      authToken,
      host,
      port,
      ...(allowedHosts ? { allowedHosts } : {}),
      ...(allowedOrigins ? { allowedOrigins } : {}),
      allowFileIO,
      ...(fileRoot ? { fileRoot: resolve(fileRoot) } : {}),
    });

    console.error(`[whatsapp-agent-mcp] Streamable HTTP listening on http://${http.host}:${http.port}/mcp`);

    const shutdown = async () => {
      await http.close();
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
    return;
  }

  throw new Error(
    `Unsupported WHATSAPP_AGENT_MCP_TRANSPORT=${JSON.stringify(transport)}. Use "stdio" or "http".`,
  );
}

main().catch((error) => {
  console.error(`[whatsapp-agent-mcp] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
