# Gmail MCP Server (IMAP + POP3)

This project provides an MCP server for Gmail with support for:

- Read emails
- Delete emails
- Mark emails as read/unread
- Protocol selection: `imap` or `pop3`
- No send-email capability included

## Features

MCP tools exposed by this server:

- `gmail_list_emails`
- `gmail_get_email`
- `gmail_delete_email`
- `gmail_mark_email`

## Requirements

- Node.js 20+
- Gmail account with App Password enabled
  - Enable 2FA on Gmail
  - Create an App Password

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp .env.example .env
```

Fill values in `.env`.

## Build and Run

```bash
npm run build
npm start
```

For development:

```bash
npm run dev
```

## Environment Variables

- `GMAIL_USER`: Gmail address
- `GMAIL_APP_PASSWORD`: Google app password
- `GMAIL_PROTOCOL`: default protocol (`imap` or `pop3`, default: `imap`)
- `GMAIL_MAILBOX`: mailbox folder for IMAP (default: `INBOX`)
- `GMAIL_HOST_IMAP`: IMAP host (default: `imap.gmail.com`)
- `GMAIL_PORT_IMAP`: IMAP port (default: `993`)
- `GMAIL_HOST_POP3`: POP3 host (default: `pop.gmail.com`)
- `GMAIL_PORT_POP3`: POP3 port (default: `995`)
- `POP3_MARKS_FILE`: local file used to persist POP3 read/unread marks

## Protocol Notes

- IMAP supports server-side read/unread flags and deletion directly.
- POP3 does not provide standard server-side read/unread flags. This server stores POP3 marks locally in `POP3_MARKS_FILE`.
- POP3 deletions are performed on the maildrop via `DELE` and committed at `QUIT`.

## MCP Client Example

Example MCP client config entry:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "node",
      "args": ["/absolute/path/to/GMail/dist/index.js"],
      "env": {
        "GMAIL_USER": "you@gmail.com",
        "GMAIL_APP_PASSWORD": "app_password"
      }
    }
  }
}
```

## Security

- Never commit `.env` or app passwords.
- Use Google App Passwords only.
- This server intentionally does not include any send-email action.
