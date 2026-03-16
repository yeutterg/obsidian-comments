"use client";

import { useState } from "react";
import { getClientApiBaseUrl } from "@/lib/api-base";
import { LockIcon, MailIcon } from "./Icons";

export default function LoginForm({ slug, onSuccess }: { slug: string; onSuccess: () => void | Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${getClientApiBaseUrl()}/api/auth`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, email, password }),
      });

      if (res.ok) {
        await onSuccess();
      } else {
        const data = await res.json();
        setError(data.error || "Authentication failed");
      }
    } catch {
      setError("Unable to reach the backend");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="protected-note-shell">
      <div className={`protected-note-card ${error ? "error" : ""}`}>
        <div className="protected-note-lock">
          <LockIcon width={22} height={22} />
        </div>
        <h1>Protected Note</h1>
        <form className="protected-note-form" onSubmit={handleSubmit}>
          <label className="protected-note-field">
            <span>Email</span>
            <div className="field-shell">
              <MailIcon width={14} height={14} />
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="field-input"
              />
            </div>
          </label>
          <label className="protected-note-field">
            <span>Password</span>
            <div className="field-shell">
              <LockIcon width={14} height={14} />
              <input
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                className="field-input"
              />
            </div>
          </label>

          {error ? <div className="protected-note-error">{error}</div> : null}

          <button type="submit" className="primary-button protected-note-submit" disabled={loading}>
            {loading ? "Retrying..." : error ? "Retry" : "Unlock"}
          </button>
        </form>
        <p className="protected-note-help">Email is used only for comment attribution.</p>
      </div>
    </div>
  );
}
