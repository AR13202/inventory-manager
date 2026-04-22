import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// ─── Config ───────────────────────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN!;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const WEBHOOK_SECRET = process.env.NEXT_PUBLIC_TELEGRAM_WEBHOOK_SECRET;

// Firebase
const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_apiKey!;
const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_projectId!;

// Upstash Redis
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL!;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string; username?: string };
  chat: { id: number; type: string; first_name?: string };
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: { id: number; first_name: string };
  message?: TelegramMessage;
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface ConversationState {
  step: "waiting_email" | "waiting_password";
  email?: string;
}

// ─── Upstash Redis ────────────────────────────────────────────────────────────

async function redisGet(key: string): Promise<string | null> {
  const res = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
  });
  const data = await res.json();
  return data.result ?? null;
}

async function redisSet(key: string, value: string, exSeconds?: number) {
  const encodedValue = encodeURIComponent(value);
  const url = exSeconds
    ? `${UPSTASH_REDIS_REST_URL}/set/${key}/${encodedValue}/ex/${exSeconds}`
    : `${UPSTASH_REDIS_REST_URL}/set/${key}/${encodedValue}`;
  await fetch(url, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
  });
}

async function redisDel(key: string) {
  await fetch(`${UPSTASH_REDIS_REST_URL}/del/${key}`, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
  });
}

async function getConversationState(chatId: number): Promise<ConversationState | null> {
  const raw = await redisGet(`state:${chatId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConversationState;
  } catch {
    return null;
  }
}

async function setConversationState(chatId: number, state: ConversationState) {
  // 5 minute TTL — auto-clears if user abandons login
  await redisSet(`state:${chatId}`, JSON.stringify(state), 300);
}

async function clearConversationState(chatId: number) {
  await redisDel(`state:${chatId}`);
}

// ─── Firestore ────────────────────────────────────────────────────────────────

async function getFirestoreDoc(collection: string, docId: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.error) return null;
  return data;
}

async function isChatIdRegistered(chatId: number): Promise<boolean> {
  const doc = await getFirestoreDoc("telegram_users", String(chatId));
  return doc !== null;
}

async function getUserByChatId(chatId: number) {
  const doc = await getFirestoreDoc("telegram_users", String(chatId));
  if (!doc?.fields) return null;
  return {
    name: doc.fields.name?.stringValue ?? "User",
    email: doc.fields.email?.stringValue ?? "",
    uid: doc.fields.uid?.stringValue ?? "",
  };
}

async function saveChatIdToFirestore(
  chatId: number,
  uid: string,
  email: string,
  name: string,
  idToken: string
) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/telegram_users/${chatId}`;
  await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      fields: {
        chatId: { integerValue: chatId },
        uid: { stringValue: uid },
        email: { stringValue: email },
        name: { stringValue: name },
        linkedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });
}

// ─── Firebase Auth ────────────────────────────────────────────────────────────

async function firebaseSignIn(email: string, password: string) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok || data.error) {
    return { success: false as const, error: data.error?.message ?? "INVALID_CREDENTIALS" };
  }
  return {
    success: true as const,
    uid: data.localId as string,
    email: data.email as string,
    displayName: (data.displayName ?? email.split("@")[0]) as string,
    idToken: data.idToken as string,
  };
}

// ─── Telegram Helpers ─────────────────────────────────────────────────────────

async function sendMessage(chatId: number, text: string, options: Record<string, unknown> = {}) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...options }),
  });
}

async function answerCallbackQuery(id: string, text?: string) {
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, text }),
  });
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

const MAIN_MENU_KEYBOARD = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "🧾 Add a Bill", callback_data: "add_bill" },
        { text: "📒 View Ledger", callback_data: "view_ledger" },
      ],
    ],
  },
};

async function sendMainMenu(chatId: number, name: string) {
  await sendMessage(
    chatId,
    `✅ <b>Welcome, ${name}!</b>\n\nWhat would you like to do?`,
    MAIN_MENU_KEYBOARD
  );
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;

async function sendLoginPrompt(chatId: number) {
  await sendMessage(
    chatId,
    "👋 <b>Welcome!</b>\n\nPlease log in to access your account.",
    {
      reply_markup: {
        inline_keyboard: [[
          { text: "🔐 Login", url: `${APP_URL}/telegram-login?chatId=${chatId}` },
        ]],
      },
    }
  );
}

async function sendTryAgainPrompt(chatId: number) {
  await sendMessage(
    chatId,
    "❌ <b>User not found.</b>\n\nThe email or password you entered is incorrect.",
    {
      reply_markup: {
        inline_keyboard: [[
          { text: "🔄 Try Again", url: `${APP_URL}/telegram-login?chatId=${chatId}` },
        ]],
      },
    }
  );
}

// ─── Flow Handlers ────────────────────────────────────────────────────────────

// Step 1: /start
async function handleStart(chatId: number) {
  const registered = await isChatIdRegistered(chatId);
  if (registered) {
    const user = await getUserByChatId(chatId);
    await sendMainMenu(chatId, user?.name ?? "there");
  } else {
    await sendLoginPrompt(chatId);
  }
}

// Step 2: User presses Login button
async function handleStartLogin(chatId: number) {
  await setConversationState(chatId, { step: "waiting_email" });
  await sendMessage(chatId, "📧 Please enter your <b>email address</b>:");
}

// Step 3 & 4: Handle email then password inputs
async function handleTextInput(message: TelegramMessage) {
  const chatId = message.chat.id;
  const text = message.text?.trim() ?? "";
  const state = await getConversationState(chatId);

  // Waiting for email
  if (state?.step === "waiting_email") {
    await setConversationState(chatId, { step: "waiting_password", email: text });
    await sendMessage(chatId, "🔒 Please enter your <b>password</b>:");
    return;
  }

  // Waiting for password → authenticate
  if (state?.step === "waiting_password") {
    await sendMessage(chatId, "⏳ Verifying your credentials...");
    const result = await firebaseSignIn(state.email!, text);
    await clearConversationState(chatId);

    if (result.success) {
      await saveChatIdToFirestore(
        chatId,
        result.uid,
        result.email,
        result.displayName,
        result.idToken
      );
      await sendMainMenu(chatId, result.displayName);
    } else {
      await sendTryAgainPrompt(chatId);
    }
    return;
  }

  // No active state — check if registered
  const registered = await isChatIdRegistered(chatId);
  if (!registered) {
    await sendLoginPrompt(chatId);
    return;
  }

  // Registered user sent freetext — show menu
  await sendMessage(chatId, "👇 Use the buttons below to navigate.", MAIN_MENU_KEYBOARD);
}

// Callback button handler
async function handleCallbackQuery(callback: TelegramCallbackQuery) {
  const chatId = callback.message?.chat.id;
  if (!chatId) return;
  await answerCallbackQuery(callback.id);

  switch (callback.data) {
    case "add_bill":
      // TODO: implement add bill flow
      await sendMessage(chatId, "🧾 <b>Add a Bill</b>\n\nThis feature is coming soon.");
      break;

    case "view_ledger":
      // TODO: implement view ledger flow
      await sendMessage(chatId, "📒 <b>View Ledger</b>\n\nThis feature is coming soon.");
      break;

    default:
      await sendMessage(chatId, "Unknown action.");
  }
}

// ─── Webhook Entry Point ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (WEBHOOK_SECRET) {
    const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (secret !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    } else if (update.message) {
      if (update.message.text?.trim() === "/start") {
        await handleStart(update.message.chat.id);
      } else {
        await handleTextInput(update.message);
      }
    }
  } catch (err) {
    console.error("Handler error:", err);
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ status: "Telegram webhook endpoint is live", runtime: "edge" });
}