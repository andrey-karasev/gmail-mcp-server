import { ImapFlow } from "imapflow";
import "dotenv/config";

async function testGmailFolders() {
  const client = new ImapFlow({
    host: process.env.GMAIL_HOST_IMAP || "imap.gmail.com",
    port: parseInt(process.env.GMAIL_PORT_IMAP || "993"),
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    },
    logger: false
  });

  try {
    await client.connect();
    console.log("Connected to Gmail IMAP\n");
    
    const folders = await client.list();
    console.log(`Total folders returned: ${folders.length}\n`);
    
    console.log("All folders (with flags):");
    for (const folder of folders) {
      const flags = Array.from(folder.flags).join(", ");
      console.log(`  "${folder.path}" [${flags}]`);
    }
    
    console.log("\nSelectable folders (without \\Noselect flag):");
    const selectable = folders.filter(f => !f.flags.has("\\Noselect"));
    for (const folder of selectable) {
      console.log(`  "${folder.path}"`);
    }
    
    console.log(`\nTotal selectable: ${selectable.length}`);
    
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await client.logout();
  }
}

testGmailFolders();
