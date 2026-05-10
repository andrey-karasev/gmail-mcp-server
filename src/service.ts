import type { GmailConfig } from "./config.js";
import type { EmailDetail, EmailSummary, Protocol } from "./types/email.js";
import type { EmailClient } from "./clients/client.js";
import { ImapEmailClient } from "./clients/imapClient.js";
import { Pop3EmailClient } from "./clients/pop3Client.js";

export class GmailService {
  private readonly imapClient: EmailClient;
  private readonly pop3Client: EmailClient;

  constructor(private readonly config: GmailConfig) {
    this.imapClient = new ImapEmailClient(config);
    this.pop3Client = new Pop3EmailClient(config);
  }

  private getClient(protocol?: Protocol): EmailClient {
    const selected = protocol || this.config.defaultProtocol;
    return selected === "pop3" ? this.pop3Client : this.imapClient;
  }

  listEmails(limit: number, protocol?: Protocol): Promise<EmailSummary[]> {
    return this.getClient(protocol).listEmails(limit);
  }

  getEmail(id: string, markAsRead: boolean, protocol?: Protocol): Promise<EmailDetail> {
    return this.getClient(protocol).getEmail(id, markAsRead);
  }

  deleteEmail(id: string, protocol?: Protocol): Promise<void> {
    return this.getClient(protocol).deleteEmail(id);
  }

  markEmail(id: string, seen: boolean, protocol?: Protocol): Promise<void> {
    return this.getClient(protocol).markEmail(id, seen);
  }

  listFolders(protocol?: Protocol): Promise<string[]> {
    return this.getClient(protocol).listFolders();
  }

  moveEmail(id: string, destinationFolder: string, protocol?: Protocol): Promise<void> {
    return this.getClient(protocol).moveEmail(id, destinationFolder);
  }
}
