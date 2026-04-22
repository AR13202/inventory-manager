"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const searchParams = useSearchParams();
  const chatId = searchParams.get("chatId");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >(chatId ? "idle" : "error");
  const [errorMessage, setErrorMessage] = useState(
    chatId ? "" : "Invalid login link. Please request a new one from the bot.",
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!chatId) return;

    setStatus("loading");
    setErrorMessage("");

    try {
      const res = await fetch("/api/telegram-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, chatId }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMessage(
          data.error ?? "Invalid email or password. Please try again.",
        );
      }
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="telegram-login-root">
        <div className="result-card">
          <div className="result-icon success-icon">✓</div>
          <h2>You{`'`}re logged in!</h2>
          <p>Head back to Telegram — your bot is ready to use.</p>
          <p className="close-hint">You can close this window.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="telegram-login-root">
      <div className="card">
        {/* Telegram icon */}
        <div className="telegram-badge">
          <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.32 13.617l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.828.942z" />
          </svg>
        </div>

        <h1>Sign in</h1>
        <p className="subtitle">to continue to your inventory</p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={status === "loading"}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-wrapper">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={status === "loading"}
              />
              <button
                type="button"
                className="toggle-password"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    width="18"
                    height="18"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    width="18"
                    height="18"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {status === "error" && errorMessage && (
            <div className="error-banner">{errorMessage}</div>
          )}

          <button
            type="submit"
            className="submit-btn"
            disabled={status === "loading" || !chatId}
          >
            {status === "loading" ? <span className="spinner" /> : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function TelegramLoginPage() {
  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          height: 100vh;
          background: #0a0a0f;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'DM Sans', system-ui, sans-serif;
          padding: 1.5rem;
          flex-direction: column;
        }

        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Syne:wght@700&display=swap');

        .telegram-login-root {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 1.5rem;
        }
        
        .nav-bar{
            display: none;
        }

        .card {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 2.5rem 2rem;
          width: 100dvw;
        }

        .telegram-badge {
          width: 52px;
          height: 52px;
          background: #27a8ef;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          margin-bottom: 1.5rem;
        }

        h1 {
          font-family: 'Syne', sans-serif;
          font-size: 1.75rem;
          color: #f0f0f5;
          font-weight: 700;
          line-height: 1.1;
        }

        .subtitle {
          color: #6b6b80;
          font-size: 0.9rem;
          margin-top: 0.3rem;
          margin-bottom: 2rem;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
          margin-bottom: 1.2rem;
        }

        label {
          display: block;
          font-size: 0.8rem;
          font-weight: 500;
          color: #9090a8;
          margin-bottom: 0.5rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        input {
          width: 100%;
          background: #1c1c26;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          padding: 0.75rem 1rem;
          color: #f0f0f5;
          font-size: 0.95rem;
          font-family: inherit;
          transition: border-color 0.2s;
          outline: none;
        }

        input:focus {
          border-color: #27a8ef;
        }

        input::placeholder { color: #3a3a50; }
        input:disabled { opacity: 0.5; cursor: not-allowed; }

        .password-wrapper {
          position: relative;
        }

        .password-wrapper input {
          padding-right: 2.8rem;
        }

        .toggle-password {
          position: absolute;
          right: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: #6b6b80;
          cursor: pointer;
          padding: 0.2rem;
          display: flex;
          align-items: center;
          transition: color 0.2s;
        }

        .toggle-password:hover { color: #27a8ef; }

        .error-banner {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.25);
          color: #f87171;
          border-radius: 8px;
          padding: 0.7rem 1rem;
          font-size: 0.85rem;
          margin-bottom: 1.2rem;
        }

        .submit-btn {
          width: 100%;
          background: #27a8ef;
          color: white;
          border: none;
          border-radius: 10px;
          padding: 0.85rem;
          font-size: 0.95rem;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          margin-top: 0.5rem;
          transition: background 0.2s, transform 0.1s;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 48px;
        }

        .submit-btn:hover:not(:disabled) { background: #1a95d9; }
        .submit-btn:active:not(:disabled) { transform: scale(0.98); }
        .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        /* Success state */
        .result-card {
          background: #13131a;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 20px;
          padding: 3rem 2rem;
          width: 100%;
          max-width: 400px;
          text-align: center;
        }

        .result-icon {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.8rem;
          margin: 0 auto 1.5rem;
        }

        .success-icon {
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
          border: 2px solid rgba(34, 197, 94, 0.3);
        }

        .result-card h2 {
          font-family: 'Syne', sans-serif;
          font-size: 1.5rem;
          color: #f0f0f5;
          margin-bottom: 0.75rem;
        }

        .result-card p {
          color: #6b6b80;
          font-size: 0.9rem;
          line-height: 1.6;
        }

        .close-hint {
          margin-top: 0.5rem;
          font-size: 0.8rem !important;
          color: #4a4a60 !important;
        }
      `}</style>

      <Suspense fallback={<div style={{ color: "#6b6b80" }}>Loading...</div>}>
        <LoginForm />
      </Suspense>
    </>
  );
}
