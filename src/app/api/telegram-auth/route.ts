import { NextRequest, NextResponse } from "next/server";

// ─── Config ───────────────────────────────────────────────────────────────────

const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_apiKey!;
const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_projectId!;
const TELEGRAM_BOT_TOKEN = process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN!;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

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

// ─── Firestore ────────────────────────────────────────────────────────────────

async function saveChatIdToFirestore(
  chatId: string,
  uid: string,
  email: string,
  name: string,
  idToken: string
) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/telegram_users/${chatId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      fields: {
        chatId: { stringValue: chatId },
        uid: { stringValue: uid },
        email: { stringValue: email },
        name: { stringValue: name },
        linkedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });
  return res.ok;
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function sendMainMenuToUser(chatId: string, name: string) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `✅ <b>Welcome, ${name}!</b>\n\nYou're now logged in. What would you like to do?`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🧾 Add a Bill", callback_data: "add_bill" },
            { text: "📒 View Ledger", callback_data: "view_ledger" },
          ],
        ],
      },
    }),
  });
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; chatId?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }

  const { email, password, chatId } = body;

  // Validate inputs
  if (!email || !password || !chatId) {
    return NextResponse.json(
      { success: false, error: "Missing email, password or chatId" },
      { status: 400 }
    );
  }

  // Step 1: Verify with Firebase Auth
  const authResult = await firebaseSignIn(email, password);

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: "Invalid email or password" },
      { status: 401 }
    );
  }

  // Step 2: Save chatId to Firestore
  const saved = await saveChatIdToFirestore(
    chatId,
    authResult.uid,
    authResult.email,
    authResult.displayName,
    authResult.idToken
  );

  if (!saved) {
    return NextResponse.json(
      { success: false, error: "Failed to save session. Please try again." },
      { status: 500 }
    );
  }

  // Step 3: Send main menu to user in Telegram
  await sendMainMenuToUser(chatId, authResult.displayName);

  return NextResponse.json({ success: true });
}