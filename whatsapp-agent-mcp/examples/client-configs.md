# MCP client configuration examples

These examples keep `WHATSAPP_AGENT_TOKEN` on the machine that runs the MCP server.

## Generic stdio

```json
{
  "mcpServers": {
    "whatsapp-agent": {
      "command": "npx",
      "args": ["-y", "whatsapp-agent-mcp"],
      "env": {
        "WHATSAPP_AGENT_TOKEN": "${WHATSAPP_AGENT_TOKEN}"
      }
    }
  }
}
```

## Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "whatsapp-agent": {
      "command": "npx",
      "args": ["-y", "whatsapp-agent-mcp"],
      "env": {
        "WHATSAPP_AGENT_TOKEN": "${env:WHATSAPP_AGENT_TOKEN}"
      }
    }
  }
}
```

## VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "whatsapp-agent": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "whatsapp-agent-mcp"],
      "env": {
        "WHATSAPP_AGENT_TOKEN": "${env:WHATSAPP_AGENT_TOKEN}"
      }
    }
  }
}
```

## Remote / hosted

The MCP URL is:

```text
https://mcp.example.com/mcp
```

Send the separate MCP access token as:

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

Example shape used by MCP hosts that support URL + headers:

```json
{
  "mcpServers": {
    "whatsapp-agent": {
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_AUTH_TOKEN}"
      }
    }
  }
}
```

For a public multi-user service, prefer standards-based OAuth at your gateway instead of distributing one shared bearer token.

