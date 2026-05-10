import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import type { GmailConfig } from "../config.js";
import type { EmailDetail, EmailSummary } from "../types/email.js";
import type { EmailClient } from "./client.js";

function normalizeAddress(value: string | null | undefined): string {
  return value?.trim() || "";
}

function toSnippet(text: string | undefined): string {
  if (!text) {
    return "";
  }
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.slice(0, 180);
}

function addressText(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "object" && value !== null && "text" in value && typeof value.text === "string") {
    return value.text;
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === "object" && item !== null && "text" in item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .filter(Boolean)
      .join(", ");
    return text || undefined;
  }

  return undefined;
}

export class ImapEmailClient implements EmailClient {
  constructor(private readonly config: GmailConfig) {}

  private createImapFlow(): ImapFlow {
    return new ImapFlow({
      host: this.config.imap.host,
      port: this.config.imap.port,
      secure: true,
      auth: { user: this.config.user, pass: this.config.password },
      logger: false
    });
  }

  private async withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = this.createImapFlow();
    await client.connect();
    try {
      await client.mailboxOpen(this.config.mailbox);
      return await fn(client);
    } finally {
      await client.logout();
    }
  }

  private async withRawClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = this.createImapFlow();
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout();
    }
  }

  async listEmails(limit: number): Promise<EmailSummary[]> {
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock(this.config.mailbox);
      try {
        const mailbox = client.mailbox;
        if (!mailbox) {
          return [];
        }

        const total = mailbox.exists;
        if (total === 0) {
          return [];
        }

        const from = Math.max(1, total - limit + 1);
        const range = `${from}:${total}`;
        const result: EmailSummary[] = [];

        for await (const message of client.fetch(range, {
          uid: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
          source: { maxLength: 10240 }
        })) {
          const parsed = await simpleParser(message.source || Buffer.from(""));
          result.push({
            id: String(message.uid),
            uid: message.uid,
            protocol: "imap",
            subject: message.envelope?.subject || "(no subject)",
            from: normalizeAddress(message.envelope?.from?.[0]?.address),
            date: message.envelope?.date?.toISOString() || null,
            seen: message.flags?.has("\\Seen") || false,
            snippet: toSnippet(parsed.text || parsed.subject || "")
          });
        }

        return result.reverse();
      } finally {
        lock.release();
      }
    });
  }

  async getEmail(id: string, markAsRead: boolean): Promise<EmailDetail> {
    const uid = Number(id);
    if (!Number.isInteger(uid) || uid <= 0) {
      throw new Error(`Invalid IMAP uid: ${id}`);
    }

    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock(this.config.mailbox);
      try {
        const message = await client.fetchOne(uid.toString(), {
          uid: true,
          envelope: true,
          flags: true,
          source: true
        }, { uid: true });

        if (!message) {
          throw new Error(`IMAP message not found for uid: ${id}`);
        }

        if (markAsRead && !message.flags?.has("\\Seen")) {
          await client.messageFlagsAdd(uid.toString(), ["\\Seen"], { uid: true });
        }

        const parsed = await simpleParser(message.source || Buffer.from(""));

        return {
          id: String(message.uid),
          uid: message.uid,
          protocol: "imap",
          subject: parsed.subject || message.envelope?.subject || "(no subject)",
          from: parsed.from?.text || normalizeAddress(message.envelope?.from?.[0]?.address),
          to: addressText(parsed.to) || "",
          cc: addressText(parsed.cc),
          bcc: addressText(parsed.bcc),
          date: parsed.date?.toISOString() || message.envelope?.date?.toISOString() || null,
          seen: markAsRead ? true : message.flags?.has("\\Seen") || false,
          snippet: toSnippet(parsed.text || parsed.subject || ""),
          text: parsed.text || "",
          html: typeof parsed.html === "string" ? parsed.html : undefined
        };
      } finally {
        lock.release();
      }
    });
  }

  async deleteEmail(id: string): Promise<void> {
    const uid = Number(id);
    if (!Number.isInteger(uid) || uid <= 0) {
      throw new Error(`Invalid IMAP uid: ${id}`);
    }

    await this.withClient(async (client) => {
      const lock = await client.getMailboxLock(this.config.mailbox);
      try {
        await client.messageFlagsAdd(uid.toString(), ["\\Deleted"], { uid: true });
        await client.messageDelete(uid.toString(), { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async markEmail(id: string, seen: boolean): Promise<void> {
    const uid = Number(id);
    if (!Number.isInteger(uid) || uid <= 0) {
      throw new Error(`Invalid IMAP uid: ${id}`);
    }

    await this.withClient(async (client) => {
      const lock = await client.getMailboxLock(this.config.mailbox);
      try {
        if (seen) {
          await client.messageFlagsAdd(uid.toString(), ["\\Seen"], { uid: true });
        } else {
          await client.messageFlagsRemove(uid.toString(), ["\\Seen"], { uid: true });
        }
      } finally {
        lock.release();
      }
    });
  }

  async listFolders(): Promise<string[]> {
    return this.withRawClient(async (client) => {
      const folders = await client.list();
      return folders
        .filter((f) => !f.flags.has("\\Noselect"))
        .map((f) => f.path)
        .sort();
    });
  }

  async moveEmail(id: string, destinationFolder: string): Promise<void> {
    const uid = Number(id);
    if (!Number.isInteger(uid) || uid <= 0) {
      throw new Error(`Invalid IMAP uid: ${id}`);
    }

    await this.withRawClient(async (client) => {
      const folders = await client.list();
      const exists = folders.some((f) => f.path.toLowerCase() === destinationFolder.toLowerCase());
      if (!exists) {
        await client.mailboxCreate(destinationFolder);
      }
      const lock = await client.getMailboxLock(this.config.mailbox);
      try {
        await client.messageMove(uid.toString(), destinationFolder, { uid: true });
      } finally {
        lock.release();
      }
    });
  }
}
