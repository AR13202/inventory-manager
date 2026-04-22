/**
 * scripts/set-webhook.ts
 *
 * Run once to register your webhook with Telegram:
 *   npx ts-node scripts/set-webhook.ts
 *   — or —
 *   npx tsx scripts/set-webhook.ts
 */

import { config } from "dotenv";
config({ path: ".env" });

const BOT_TOKEN = process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.NEXT_PUBLIC_APP_URL; // e.g. https://your-app.vercel.app
const WEBHOOK_SECRET = process.env.NEXT_PUBLIC_TELEGRAM_WEBHOOK_SECRET; // optional

if (!BOT_TOKEN || !WEBHOOK_URL) {
  console.log("BOT_TOKEN:", BOT_TOKEN);
  console.log("WEBHOOK_URL:", WEBHOOK_URL);
  console.log("WEBHOOK_SECRET:", WEBHOOK_SECRET);
  console.error("Missing TELEGRAM_BOT_TOKEN or NEXT_PUBLIC_APP_URL env vars");
  process.exit(1);
}

const webhookEndpoint = `${WEBHOOK_URL}/api/telegram`;

async function setWebhook() {
  const body: Record<string, string> = {
    url: webhookEndpoint,
    allowed_updates: JSON.stringify(["message", "callback_query", "edited_message"]),
    drop_pending_updates: "true",
  };

  if (WEBHOOK_SECRET) {
    body.secret_token = WEBHOOK_SECRET;
  }

  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const data = await res.json();
  console.log("setWebhook response:", JSON.stringify(data, null, 2));
}

async function getWebhookInfo() {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`
  );
  const data = await res.json();
  console.log("getWebhookInfo:", JSON.stringify(data, null, 2));
}

async function deleteWebhook() {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`,
    { method: "POST" }
  );
  const data = await res.json();
  console.log("deleteWebhook:", JSON.stringify(data, null, 2));
}

const command = process.argv[2];

switch (command) {
  case "delete":
    deleteWebhook();
    break;
  case "info":
    getWebhookInfo();
    break;
  default:
    setWebhook().then(() => getWebhookInfo());
}