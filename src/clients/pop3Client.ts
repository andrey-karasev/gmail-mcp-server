import fs from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";

import { simpleParser } from "mailparser";

import type { GmailConfig } from "../config.js";
import type { EmailDetail, EmailSummary } from "../types/email.js";
import type { EmailClient } from "./client.js";

interface Pop3MessageRef {
  id: string;
  msgNumber: number;
  size: number;
}

interface Pop3Reply {
  line: string;
  lines: string[];
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

class Pop3Socket {
  private readonly socket: tls.TLSSocket;
  private buffer = "";
  private pending: Array<(line: string) => void> = [];

  constructor(host: string, port: number, timeoutMs = 15000) {
    this.socket = tls.connect({ host, port, servername: host }, () => undefined);
    this.socket.setTimeout(timeoutMs);
    this.socket.setEncoding("utf8");

    this.socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.flushLines();
    });

    this.socket.on("timeout", () => {
      this.socket.destroy(new Error("POP3 connection timed out"));
    });
  }

  private flushLines(): void {
    while (this.pending.length > 0) {
      const idx = this.buffer.indexOf("\r\n");
      if (idx < 0) {
        return;
      }

      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const next = this.pending.shift();
      if (next) {
        next(line);
      }
    }
  }

  async readLine(): Promise<string> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };

      const cleanup = (): void => {
        this.socket.off("error", onError);
      };

      this.socket.on("error", onError);
      this.pending.push((line) => {
        cleanup();
        resolve(line);
      });
      this.flushLines();
    });
  }

  async send(command: string, multiline = false): Promise<Pop3Reply> {
    this.socket.write(`${command}\r\n`);
    const first = await this.readLine();

    if (!first.startsWith("+OK")) {
      throw new Error(`POP3 error for '${command}': ${first}`);
    }

    if (!multiline) {
      return { line: first, lines: [] };
    }

    const lines: string[] = [];
    while (true) {
      const line = await this.readLine();
      if (line === ".") {
        break;
      }
      lines.push(line.startsWith("..") ? line.slice(1) : line);
    }

    return { line: first, lines };
  }

  async close(): Promise<void> {
    if (!this.socket.destroyed) {
      this.socket.end();
      this.socket.destroy();
    }
  }
}

export class Pop3EmailClient implements EmailClient {
  constructor(private readonly config: GmailConfig) {}

  private async readMarks(): Promise<Set<string>> {
    try {
      const raw = await fs.readFile(this.config.pop3MarksFile, "utf8");
      const parsed = JSON.parse(raw) as string[];
      return new Set(parsed);
    } catch {
      return new Set<string>();
    }
  }

  private async writeMarks(marks: Set<string>): Promise<void> {
    await fs.mkdir(path.dirname(this.config.pop3MarksFile), { recursive: true });
    await fs.writeFile(this.config.pop3MarksFile, JSON.stringify(Array.from(marks), null, 2), "utf8");
  }

  private async withConnection<T>(fn: (conn: Pop3Socket) => Promise<T>): Promise<T> {
    const conn = new Pop3Socket(this.config.pop3.host, this.config.pop3.port);
    try {
      const greeting = await conn.readLine();
      if (!greeting.startsWith("+OK")) {
        throw new Error(`POP3 greeting failed: ${greeting}`);
      }

      await conn.send(`USER ${this.config.user}`);
      await conn.send(`PASS ${this.config.password}`);
      return await fn(conn);
    } finally {
      try {
        await conn.send("QUIT");
      } catch {
        // Ignore cleanup errors from half-closed sockets.
      }
      await conn.close();
    }
  }

  private async listRefs(conn: Pop3Socket): Promise<Pop3MessageRef[]> {
    const listReply = await conn.send("LIST", true);
    const uidlReply = await conn.send("UIDL", true);

    const sizeMap = new Map<number, number>();
    for (const line of listReply.lines) {
      const [numRaw, sizeRaw] = line.trim().split(/\s+/);
      const num = Number(numRaw);
      const size = Number(sizeRaw);
      if (Number.isInteger(num) && Number.isInteger(size)) {
        sizeMap.set(num, size);
      }
    }

    const refs: Pop3MessageRef[] = [];
    for (const line of uidlReply.lines) {
      const [numRaw, uidl] = line.trim().split(/\s+/);
      const num = Number(numRaw);
      if (!Number.isInteger(num) || !uidl) {
        continue;
      }

      refs.push({
        id: uidl,
        msgNumber: num,
        size: sizeMap.get(num) || 0
      });
    }

    refs.sort((a, b) => b.msgNumber - a.msgNumber);
    return refs;
  }

  private async getRefById(conn: Pop3Socket, id: string): Promise<Pop3MessageRef> {
    const refs = await this.listRefs(conn);
    const match = refs.find((ref) => ref.id === id);
    if (!match) {
      throw new Error(`POP3 message not found for id: ${id}`);
    }
    return match;
  }

  async listEmails(limit: number): Promise<EmailSummary[]> {
    return this.withConnection(async (conn) => {
      const refs = (await this.listRefs(conn)).slice(0, limit);
      const marks = await this.readMarks();
      const result: EmailSummary[] = [];

      for (const ref of refs) {
        const raw = await conn.send(`RETR ${ref.msgNumber}`, true);
        const parsed = await simpleParser(raw.lines.join("\r\n"));
        result.push({
          id: ref.id,
          protocol: "pop3",
          subject: parsed.subject || "(no subject)",
          from: parsed.from?.text || "",
          date: parsed.date?.toISOString() || null,
          seen: marks.has(ref.id),
          snippet: toSnippet(parsed.text || parsed.subject || "")
        });
      }

      return result;
    });
  }

  async getEmail(id: string, markAsRead: boolean): Promise<EmailDetail> {
    return this.withConnection(async (conn) => {
      const ref = await this.getRefById(conn, id);
      const raw = await conn.send(`RETR ${ref.msgNumber}`, true);
      const parsed = await simpleParser(raw.lines.join("\r\n"));

      const marks = await this.readMarks();
      let seen = marks.has(id);
      if (markAsRead && !seen) {
        marks.add(id);
        await this.writeMarks(marks);
        seen = true;
      }

      return {
        id,
        protocol: "pop3",
        subject: parsed.subject || "(no subject)",
        from: parsed.from?.text || "",
        to: addressText(parsed.to) || "",
        cc: addressText(parsed.cc),
        bcc: addressText(parsed.bcc),
        date: parsed.date?.toISOString() || null,
        seen,
        snippet: toSnippet(parsed.text || parsed.subject || ""),
        text: parsed.text || "",
        html: typeof parsed.html === "string" ? parsed.html : undefined
      };
    });
  }

  async deleteEmail(id: string): Promise<void> {
    await this.withConnection(async (conn) => {
      const ref = await this.getRefById(conn, id);
      await conn.send(`DELE ${ref.msgNumber}`);

      const marks = await this.readMarks();
      if (marks.delete(id)) {
        await this.writeMarks(marks);
      }
    });
  }

  async markEmail(id: string, seen: boolean): Promise<void> {
    const marks = await this.readMarks();
    if (seen) {
      marks.add(id);
    } else {
      marks.delete(id);
    }
    await this.writeMarks(marks);
  }

  listFolders(): Promise<string[]> {
    return Promise.resolve([]);
  }

  moveEmail(_id: string, _destinationFolder: string): Promise<void> {
    return Promise.reject(new Error("POP3 does not support folders or moving emails"));
  }
}
