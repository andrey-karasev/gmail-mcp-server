export type Protocol = "imap" | "pop3";

export interface EmailSummary {
  id: string;
  uid?: number;
  protocol: Protocol;
  subject: string;
  from: string;
  date: string | null;
  seen: boolean;
  snippet: string;
}

export interface EmailDetail extends EmailSummary {
  to: string;
  cc?: string;
  bcc?: string;
  text: string;
  html?: string;
}
