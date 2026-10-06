import { WhatsAppAgentClient } from "../src/index.js";

const token = process.env.WHATSAPP_AGENT_TOKEN;
if (!token) throw new Error("Set WHATSAPP_AGENT_TOKEN first.");

const client = new WhatsAppAgentClient({ token });

// The SDK can discover the creator from retained Agent Platform updates.
// If the buffer is empty, send the agent one WhatsApp message first.
const result = await client.sendText("Hello from my personal agent 👋");
console.log("Sent:", result.messageId);
