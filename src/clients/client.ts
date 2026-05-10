import type { EmailDetail, EmailSummary } from "../types/email.js";

export interface EmailClient {
  listEmails(limit: number): Promise<EmailSummary[]>;
  getEmail(id: string, markAsRead: boolean): Promise<EmailDetail>;
  deleteEmail(id: string): Promise<void>;
  markEmail(id: string, seen: boolean): Promise<void>;
  listFolders(): Promise<string[]>;
  moveEmail(id: string, destinationFolder: string): Promise<void>;
}
