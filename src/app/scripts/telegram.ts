/**
 * lib/telegram.ts
 * Reusable Telegram Bot API client — import these into your edge route.
 */

const BASE = (token: string) => `https://api.telegram.org/bot${token}`;

type ParseMode = "HTML" | "Markdown" | "MarkdownV2";

interface SendMessageOptions {
  parse_mode?: ParseMode;
  disable_web_page_preview?: boolean;
  reply_to_message_id?: number;
  reply_markup?: object;
}

interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

// ─── Core sender ──────────────────────────────────────────────────────────────

async function telegramRequest(
  token: string,
  method: string,
  body: object
): Promise<unknown> {
  const res = await fetch(`${BASE(token)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API ${method} failed: ${err}`);
  }
  return res.json();
}

// ─── Messaging ────────────────────────────────────────────────────────────────

export function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
  options: SendMessageOptions = {}
) {
  return telegramRequest(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...options,
  });
}

export function sendInlineKeyboard(
  token: string,
  chatId: number | string,
  text: string,
  buttons: InlineButton[][]
) {
  return sendMessage(token, chatId, text, {
    reply_markup: { inline_keyboard: buttons },
  });
}

export function sendPhoto(
  token: string,
  chatId: number | string,
  photo: string, // URL or file_id
  caption?: string
) {
  return telegramRequest(token, "sendPhoto", {
    chat_id: chatId,
    photo,
    caption,
    parse_mode: "HTML",
  });
}

export function sendDocument(
  token: string,
  chatId: number | string,
  document: string,
  caption?: string
) {
  return telegramRequest(token, "sendDocument", {
    chat_id: chatId,
    document,
    caption,
    parse_mode: "HTML",
  });
}

export function sendChatAction(
  token: string,
  chatId: number | string,
  action:
    | "typing"
    | "upload_photo"
    | "upload_document"
    | "upload_video"
    | "record_voice"
) {
  return telegramRequest(token, "sendChatAction", {
    chat_id: chatId,
    action,
  });
}

export function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false
) {
  return telegramRequest(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Send a message to multiple chats (e.g., broadcast to admin list) */
export async function broadcastMessage(
  token: string,
  chatIds: (number | string)[],
  text: string,
  options?: SendMessageOptions
) {
  return Promise.allSettled(
    chatIds.map((id) => sendMessage(token, id, text, options))
  );
}

/** Simple rate-limit safe delay helper */
export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}