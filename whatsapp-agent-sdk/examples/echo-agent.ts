import { WhatsAppAgentClient } from "../src/index.js";

const token = process.env.WHATSAPP_AGENT_TOKEN;
if (!token) throw new Error("Set WHATSAPP_AGENT_TOKEN first.");

const client = new WhatsAppAgentClient({ token });

// offset=0 replays the retained buffer. In a real app, load a persisted cursor
// instead and save update.nextOffset only after processing succeeds.
for await (const update of client.pollUpdates({ offset: 0 })) {
  for (const message of update.messages) {
    if (message.type !== "text" || !message.text) continue;

    await client.sendTyping(message.id);
    await client.reply(message, `You said: ${message.text}`);
  }

  if (update.nextOffset) {
    console.log("Persist this cursor after successful processing:", update.nextOffset);
  }
}
