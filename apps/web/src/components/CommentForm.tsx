"use client";

import { useEffect, useState } from "react";
import { getClientApiBaseUrl } from "@/lib/api-base";
import { MailIcon, MessageSquareIcon, XIcon } from "./Icons";

interface Props {
  slug: string;
  anchorText: string;
  anchorStart: number;
  anchorEnd: number;
  position: { top: number; left: number };
  onSubmit: (result: { pendingApproval: boolean }) => void;
  onCancel: () => void;
  mobile: boolean;
  adminMode: boolean;
}

export default function CommentForm({
  slug,
  anchorText,
  anchorStart,
  anchorEnd,
  position,
  onSubmit,
  onCancel,
  mobile,
  adminMode,
}: Props) {
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setEmail(localStorage.getItem("commenter-email") || "");
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim() || !email.trim()) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${getClientApiBaseUrl()}${adminMode ? "/api/admin/comments" : "/api/comments"}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          authorEmail: email,
          body,
          anchorText,
          anchorStart,
          anchorEnd,
          honeypot,
        }),
      });

      const data = await res.json().catch(() => null) as { error?: string; pendingApproval?: boolean } | null;
      if (!res.ok) {
        setError(data?.error || "Failed to submit comment");
        return;
      }

      localStorage.setItem("commenter-email", email);
      setBody("");
      onSubmit({ pendingApproval: Boolean(data?.pendingApproval) });
    } catch {
      setError("Unable to reach the backend");
    } finally {
      setLoading(false);
    }
  }

  const content = (
    <form className="comment-form" onSubmit={handleSubmit}>
      <div className="comment-form-header">
        <div>
          <p className="comment-form-title">Comment</p>
          <p className="comment-form-anchor">&ldquo;{anchorText}&rdquo;</p>
        </div>
        {mobile ? (
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Close comment form">
            <XIcon width={16} height={16} />
          </button>
        ) : null}
      </div>

      <input
        type="text"
        value={honeypot}
        onChange={(event) => setHoneypot(event.target.value)}
        className="honeypot-field"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      <label className="comment-form-field">
        <span className="field-shell">
          <MailIcon width={14} height={14} />
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="field-input"
          />
        </span>
      </label>

      <label className="comment-form-field">
        <textarea
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={mobile ? 4 : 3}
          placeholder="Add a comment..."
          className="comment-textarea"
        />
      </label>

      {error ? <p className="comment-form-error">{error}</p> : null}

      <div className="comment-form-actions">
        {!mobile ? (
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="primary-button" disabled={loading}>
          <MessageSquareIcon width={14} height={14} />
          {loading ? "Sending..." : "Comment"}
        </button>
      </div>
    </form>
  );

  if (mobile) {
    return (
      <div className="mobile-sheet open">
        <div className="mobile-sheet-backdrop" onClick={onCancel} />
        <div className="mobile-sheet-panel">
          <div className="mobile-sheet-handle" />
          {content}
        </div>
      </div>
    );
  }

  return (
    <div
      className="floating-comment-panel"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {content}
    </div>
  );
}
