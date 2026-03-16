"use client";

import { useEffect, useMemo, useState } from "react";
import type { CommentRecord } from "@obsidian-comments/shared";
import { MailIcon, MessageSquareIcon, XIcon } from "./Icons";

export type CommentData = CommentRecord;

function formatCommentDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

interface Props {
  comments: CommentData[];
  activeCommentId: string | null;
  onCommentClick: (id: string) => void;
  onResolve: (id: string) => void;
  onReopen: (id: string) => void;
  onDelete: (id: string) => void;
  onApprove: (id: string) => void;
  onReplySubmit: (commentId: string, payload: { authorEmail: string; body: string }) => Promise<{ pendingApproval: boolean }>;
  onApproveReply: (replyId: string) => void;
  onDeleteReply: (replyId: string) => void;
  showResolved: boolean;
  onToggleResolved: () => void;
  open: boolean;
  mobile: boolean;
  onClose?: () => void;
  adminMode: boolean;
  replyTargetId: string | null;
  onReplyTargetChange: (commentId: string | null) => void;
}

export default function CommentSidebar({
  comments,
  activeCommentId,
  onCommentClick,
  onResolve,
  onReopen,
  onDelete,
  onApprove,
  onReplySubmit,
  onApproveReply,
  onDeleteReply,
  showResolved,
  onToggleResolved,
  open,
  mobile,
  onClose,
  adminMode,
  replyTargetId,
  onReplyTargetChange,
}: Props) {
  const [sortMode, setSortMode] = useState<"document" | "time">("document");
  const [replyEmail, setReplyEmail] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState("");
  const [replyNotice, setReplyNotice] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);

  useEffect(() => {
    setReplyEmail(localStorage.getItem("commenter-email") || "");
  }, []);

  useEffect(() => {
    setReplyBody("");
    setReplyError("");
    setReplyNotice("");
  }, [replyTargetId]);

  const openCount = comments.filter((comment) => comment.status === "open").length;
  const resolvedCount = comments.filter((comment) => comment.status === "resolved").length;
  const pendingCount = comments.reduce((count, comment) => {
    const replyPending = comment.replies.filter((reply) => !reply.approved).length;
    return count + (comment.approved ? 0 : 1) + replyPending;
  }, 0);

  const sorted = useMemo(() => {
    const filtered = showResolved ? comments : comments.filter((comment) => comment.status === "open");
    return [...filtered].sort((a, b) => {
      if (sortMode === "document") {
        return a.anchorStart - b.anchorStart;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [comments, showResolved, sortMode]);

  const content = (
    <>
      <div className="comments-panel-header">
        <div>
          <p className="comments-title">Comments</p>
          <p className="comments-meta">
            {openCount} open · {resolvedCount} resolved
            {adminMode && pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
          </p>
        </div>
        {mobile ? (
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close comments">
            <XIcon width={16} height={16} />
          </button>
        ) : null}
      </div>

      <div className="comments-controls">
        <div className="segmented-tabs">
          <button
            type="button"
            className={`segmented-tab ${sortMode === "document" ? "active" : ""}`}
            onClick={() => setSortMode("document")}
          >
            Doc order
          </button>
          <button
            type="button"
            className={`segmented-tab ${sortMode === "time" ? "active" : ""}`}
            onClick={() => setSortMode("time")}
          >
            Time
          </button>
        </div>
        <button
          type="button"
          className={`filter-pill ${showResolved ? "active" : ""}`}
          onClick={onToggleResolved}
        >
          Resolved
        </button>
      </div>

      <div className="comments-scroll">
        {sorted.length === 0 ? (
          <div className="comments-empty">
            <MessageSquareIcon width={18} height={18} />
            <p>No comments yet. Select text to add one.</p>
          </div>
        ) : (
          sorted.map((comment) => (
            <article
              key={comment.id}
              className={`comment-card ${activeCommentId === comment.id ? "active" : ""} ${comment.status === "resolved" ? "resolved" : ""}`}
              onClick={() => onCommentClick(comment.id)}
            >
              <div className="comment-card-header">
                <p className="comment-anchor">&ldquo;{comment.anchorText}&rdquo;</p>
                {!comment.approved ? <span className="pending-badge">Pending</span> : null}
              </div>
              <p className="comment-body">{comment.body}</p>
              <p className="comment-card-meta">
                {comment.authorEmail.split("@")[0]} · {formatCommentDate(comment.createdAt)}
              </p>

              {comment.replies.length > 0 ? (
                <div className="reply-thread">
                  {comment.replies.map((reply) => (
                    <div key={reply.id} className="reply-card">
                      <div className="comment-card-header">
                        <p className="reply-body">{reply.body}</p>
                        {!reply.approved ? <span className="pending-badge">Pending</span> : null}
                      </div>
                      <p className="comment-card-meta">
                        {reply.authorEmail.split("@")[0]} · {formatCommentDate(reply.createdAt)}
                      </p>
                      {adminMode ? (
                        <div className="comment-card-actions">
                          {!reply.approved ? (
                            <button
                              type="button"
                              className="mini-action mini-action-warning"
                              onClick={(event) => {
                                event.stopPropagation();
                                onApproveReply(reply.id);
                              }}
                            >
                              Approve
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="mini-action mini-action-danger"
                            onClick={(event) => {
                              event.stopPropagation();
                              onDeleteReply(reply.id);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="comment-card-actions">
                {!comment.approved && adminMode ? (
                  <button
                    type="button"
                    className="mini-action mini-action-warning"
                    onClick={(event) => {
                      event.stopPropagation();
                      onApprove(comment.id);
                    }}
                  >
                    Approve
                  </button>
                ) : null}
                {adminMode ? (
                  comment.status === "open" ? (
                    <button
                      type="button"
                      className="mini-action mini-action-success"
                      onClick={(event) => {
                        event.stopPropagation();
                        onResolve(comment.id);
                      }}
                    >
                      Resolve
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mini-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        onReopen(comment.id);
                      }}
                    >
                      Reopen
                    </button>
                  )
                ) : null}
                <button
                  type="button"
                  className="mini-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    onReplyTargetChange(replyTargetId === comment.id ? null : comment.id);
                  }}
                >
                  Reply
                </button>
                {adminMode ? (
                  <button
                    type="button"
                    className="mini-action mini-action-danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(comment.id);
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </div>

              {replyTargetId === comment.id ? (
                <form
                  className="reply-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!replyEmail.trim() || !replyBody.trim()) {
                      return;
                    }
                    setReplyLoading(true);
                    setReplyError("");
                    setReplyNotice("");
                    try {
                      const result = await onReplySubmit(comment.id, {
                        authorEmail: replyEmail,
                        body: replyBody,
                      });
                      localStorage.setItem("commenter-email", replyEmail);
                      setReplyBody("");
                      setReplyNotice(result.pendingApproval ? "Reply submitted for approval." : "Reply added.");
                      if (!result.pendingApproval) {
                        onReplyTargetChange(null);
                      }
                    } catch (error) {
                      setReplyError(error instanceof Error ? error.message : "Unable to submit reply");
                    } finally {
                      setReplyLoading(false);
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <label className="comment-form-field">
                    <span className="comment-form-label">Email</span>
                    <span className="field-shell">
                      <MailIcon width={14} height={14} />
                      <input
                        type="email"
                        className="field-input"
                        value={replyEmail}
                        onChange={(event) => setReplyEmail(event.target.value)}
                        placeholder="you@example.com"
                        required
                      />
                    </span>
                  </label>
                  <label className="comment-form-field">
                    <span className="comment-form-label">Reply</span>
                    <textarea
                      className="comment-textarea reply-textarea"
                      rows={3}
                      value={replyBody}
                      onChange={(event) => setReplyBody(event.target.value)}
                      placeholder="Add a reply..."
                      required
                    />
                  </label>
                  {replyError ? <p className="comment-form-error">{replyError}</p> : null}
                  {replyNotice ? <p className="reply-notice">{replyNotice}</p> : null}
                  <div className="comment-form-actions">
                    <button type="button" className="ghost-button" onClick={() => onReplyTargetChange(null)}>
                      Cancel
                    </button>
                    <button type="submit" className="primary-button" disabled={replyLoading}>
                      {replyLoading ? "Sending..." : "Post reply"}
                    </button>
                  </div>
                </form>
              ) : null}
            </article>
          ))
        )}
      </div>
    </>
  );

  if (mobile) {
    return (
      <div className={`mobile-comments-drawer ${open ? "open" : ""}`}>
        <div className="mobile-comments-backdrop" onClick={onClose} />
        <aside className="comments-panel comments-panel-mobile">{content}</aside>
      </div>
    );
  }

  return <aside className={`comments-panel ${open ? "open" : ""}`}>{content}</aside>;
}
