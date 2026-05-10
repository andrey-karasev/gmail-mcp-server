import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getConfig } from "./config.js";
import { GmailService } from "./service.js";

const protocolSchema = z.enum(["imap", "pop3"]).optional();

const config = getConfig();
const service = new GmailService(config);

const server = new McpServer({
  name: "gmail-mcp-server",
  version: "1.0.0"
});

server.tool(
  "gmail_list_emails",
  "List recent emails from Gmail via IMAP or POP3",
  {
    limit: z.number().int().min(1).max(100).default(20),
    protocol: protocolSchema
  },
  async ({ limit = 20, protocol }) => {
    const emails = await service.listEmails(limit, protocol);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(emails, null, 2)
      }]
    };
  }
);

server.tool(
  "gmail_get_email",
  "Read a single email by id (IMAP uid or POP3 UIDL)",
  {
    id: z.string().min(1),
    markAsRead: z.boolean().default(true),
    protocol: protocolSchema
  },
  async ({ id, markAsRead = true, protocol }) => {
    const email = await service.getEmail(id, markAsRead, protocol);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(email, null, 2)
      }]
    };
  }
);

server.tool(
  "gmail_delete_email",
  "Delete an email by id",
  {
    id: z.string().min(1),
    protocol: protocolSchema
  },
  async ({ id, protocol }) => {
    await service.deleteEmail(id, protocol);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ ok: true, action: "delete", id, protocol: protocol || config.defaultProtocol }, null, 2)
      }]
    };
  }
);

server.tool(
  "gmail_mark_email",
  "Mark or unmark an email as seen/read",
  {
    id: z.string().min(1),
    seen: z.boolean(),
    protocol: protocolSchema
  },
  async ({ id, seen, protocol }) => {
    await service.markEmail(id, seen, protocol);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ ok: true, action: "mark", id, seen, protocol: protocol || config.defaultProtocol }, null, 2)
      }]
    };
  }
);

server.tool(
  "gmail_list_folders",
  "List all IMAP mailbox folders",
  { protocol: protocolSchema },
  async ({ protocol }) => {
    const folders = await service.listFolders(protocol);
    return {
      content: [{ type: "text", text: JSON.stringify(folders, null, 2) }]
    };
  }
);

server.tool(
  "gmail_move_email",
  "Move an email to a specific IMAP folder (creates folder if it does not exist)",
  {
    id: z.string().min(1),
    destinationFolder: z.string().min(1),
    protocol: protocolSchema
  },
  async ({ id, destinationFolder, protocol }) => {
    await service.moveEmail(id, destinationFolder, protocol);
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, id, destinationFolder }, null, 2) }]
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start gmail-mcp-server", error);
  process.exit(1);
});
