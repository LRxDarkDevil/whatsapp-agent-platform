import { WhatsAppAgentClient } from "../src/index.js";

const token = process.env.WHATSAPP_AGENT_TOKEN;
if (!token) throw new Error("Set WHATSAPP_AGENT_TOKEN first.");

const client = new WhatsAppAgentClient({ token });

await client.sendImage({
  file: "./photo.jpg",
  caption: "Sent through the Agent Platform",
});

await client.sendDocument({
  file: "./report.pdf",
  filename: "report.pdf",
  caption: "Latest report",
});
