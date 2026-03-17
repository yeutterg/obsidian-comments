"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CommentRecord, NoteDetailResponse, NoteDisplayField } from "@commonplace/shared";
import CommentSidebar, { CommentData } from "./CommentSidebar";
import CommentForm from "./CommentForm";
import { getClientApiBaseUrl } from "@/lib/api-base";
import { CopyIcon, MessageSquareIcon, PencilIcon } from "./Icons";
import { getNoteHref } from "@/lib/directory-tree";

interface Props {
  detail: NoteDetailResponse;
  adminMode: boolean;
  commentsOpen: boolean;
  fontScale: number;
  directEditMode?: boolean;
  onDirectEditModeChange?: (open: boolean) => void;
  onCommentsOpenChange: (open: boolean) => void;
  onCommentCountChange: (count: number) => void;
  onSaveMarkdown?: (markdown: string) => Promise<void>;
  onEditSelection?: (input: {
    anchorText: string;
    anchorStart: number;
    anchorEnd: number;
    replacementText: string;
  }) => Promise<void>;
}

interface HighlightSelection {
  text: string;
  start: number;
  end: number;
  rect: DOMRect;
}

interface HoverHighlight {
  commentId: string;
  text: string;
  start: number;
  end: number;
  rect: DOMRect;
}

function formatFieldValue(field: NoteDisplayField) {
  if (field.kind === "date" && typeof field.value === "string") {
    const date = new Date(field.value);
    return Number.isNaN(date.getTime())
      ? field.value
      : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
  }
  return field.value;
}

function shouldOpenInNewTab(href: string) {
  return /^(?:https?:)?\/\//i.test(href) || /^mailto:/i.test(href);
}

function flattenCommentCount(comments: CommentRecord[]) {
  return comments.reduce((count, comment) => count + 1 + comment.replies.length, 0);
}

function isInsideGeneratedBlock(node: Node | null) {
  let current: Node | null = node;
  while (current) {
    if (current instanceof Element && current.hasAttribute("data-obsidian-generated")) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function removeGeneratedContent(root: ParentNode) {
  root.querySelectorAll("[data-obsidian-generated]").forEach((element) => element.remove());
}

function visibleTextLength(range: Range) {
  const fragment = range.cloneContents();
  removeGeneratedContent(fragment);
  return fragment.textContent?.length ?? 0;
}

function rangeTouchesGeneratedContent(range: Range) {
  if (isInsideGeneratedBlock(range.startContainer) || isInsideGeneratedBlock(range.endContainer)) {
    return true;
  }

  const fragment = range.cloneContents();
  return fragment.querySelector("[data-obsidian-generated]") !== null;
}

function applyCommentHighlights(
  html: string,
  comments: CommentData[],
  showResolved: boolean,
  activeCommentId: string | null,
  selection: {
    text: string;
    start: number;
    end: number;
  } | null,
) {
  if ((!comments.length && !selection) || typeof DOMParser === "undefined") {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const nodes: { node: Text; start: number; end: number }[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (isInsideGeneratedBlock(node)) {
      continue;
    }
    const length = node.textContent?.length ?? 0;
    nodes.push({ node, start: currentOffset, end: currentOffset + length });
    currentOffset += length;
  }

  const highlightableComments = comments
    .filter((comment) => comment.status === "open" || showResolved)
    .filter((comment) => comment.anchorEnd > comment.anchorStart)
    .map((comment) => ({
      id: comment.id,
      anchorText: comment.anchorText,
      anchorStart: comment.anchorStart,
      anchorEnd: comment.anchorEnd,
      preview: false,
    }));

  const highlights = selection
    ? [
        ...highlightableComments,
        {
          id: "__selection__",
          anchorText: selection.text,
          anchorStart: selection.start,
          anchorEnd: selection.end,
          preview: true,
        },
      ]
    : highlightableComments;

  highlights.sort((a, b) => b.anchorStart - a.anchorStart);

  for (const highlight of highlights) {
    const target = nodes.find(
      ({ start, end }) => highlight.anchorStart >= start && highlight.anchorEnd <= end,
    );
    if (!target) {
      continue;
    }

    const text = target.node.textContent ?? "";
    const localStart = highlight.anchorStart - target.start;
    const localEnd = highlight.anchorEnd - target.start;

    if (
      localStart < 0 ||
      localEnd > text.length ||
      localStart >= localEnd ||
      text.slice(localStart, localEnd) !== highlight.anchorText
    ) {
      continue;
    }

    const fragment = doc.createDocumentFragment();
    if (localStart > 0) {
      fragment.appendChild(doc.createTextNode(text.slice(0, localStart)));
    }

    const mark = doc.createElement("mark");
    if (highlight.preview) {
      mark.dataset.selectionPreview = "true";
      mark.className = "selection-preview";
    } else {
      mark.dataset.commentId = highlight.id;
      mark.className = activeCommentId === highlight.id ? "active" : "";
    }
    mark.textContent = text.slice(localStart, localEnd);
    fragment.appendChild(mark);

    if (localEnd < text.length) {
      fragment.appendChild(doc.createTextNode(text.slice(localEnd)));
    }

    target.node.parentNode?.replaceChild(fragment, target.node);
  }

  return doc.body.innerHTML;
}

async function fetchComments(slug: string, adminMode: boolean): Promise<CommentRecord[]> {
  const endpoint = adminMode ? "/api/admin/comments" : "/api/comments";
  const res = await fetch(`${getClientApiBaseUrl()}${endpoint}?slug=${encodeURIComponent(slug)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    return [];
  }
  const data = await res.json() as { comments: CommentRecord[] };
  return data.comments;
}

export default function NoteViewer({
  detail,
  adminMode,
  commentsOpen,
  fontScale,
  directEditMode = false,
  onDirectEditModeChange,
  onCommentsOpenChange,
  onCommentCountChange,
  onSaveMarkdown,
  onEditSelection,
}: Props) {
  const [comments, setComments] = useState<CommentData[]>([]);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [selection, setSelection] = useState<HighlightSelection | null>(null);
  const [hoveredHighlight, setHoveredHighlight] = useState<HoverHighlight | null>(null);
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState("");
  const [submissionNotice, setSubmissionNotice] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [markdownDraft, setMarkdownDraft] = useState(detail.markdown ?? "");
  const [markdownError, setMarkdownError] = useState("");
  const [isSavingMarkdown, setIsSavingMarkdown] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const hoverLeaveTimeoutRef = useRef<number | null>(null);
  const markdownTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 960);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!submissionNotice) {
      return;
    }
    const timeout = window.setTimeout(() => setSubmissionNotice(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [submissionNotice]);

  useEffect(() => {
    if (!directEditMode) {
      setMarkdownDraft(detail.markdown ?? "");
      setMarkdownError("");
      return;
    }

    setShowCommentForm(false);
    setShowEditForm(false);
    setEditError("");
    setSelection(null);
    setHoveredHighlight(null);
    window.getSelection()?.removeAllRanges();

    const timeout = window.setTimeout(() => markdownTextareaRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [detail.markdown, directEditMode]);

  const reloadComments = useCallback(async () => {
    if (!detail.note.commentsEnabled && !adminMode) {
      setComments([]);
      onCommentCountChange(0);
      return;
    }

    const nextComments = await fetchComments(detail.note.slug, adminMode);
    setComments(nextComments);
    onCommentCountChange(flattenCommentCount(nextComments));
  }, [adminMode, detail.note.commentsEnabled, detail.note.slug, onCommentCountChange]);

  useEffect(() => {
    void reloadComments();
  }, [reloadComments]);

  function clearSelectionState() {
    setShowCommentForm(false);
    setShowEditForm(false);
    setEditValue("");
    setEditError("");
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  function clearHoveredHighlightSoon() {
    if (hoverLeaveTimeoutRef.current) {
      window.clearTimeout(hoverLeaveTimeoutRef.current);
    }
    hoverLeaveTimeoutRef.current = window.setTimeout(() => {
      setHoveredHighlight(null);
    }, 140);
  }

  function cancelHoveredClear() {
    if (hoverLeaveTimeoutRef.current) {
      window.clearTimeout(hoverLeaveTimeoutRef.current);
      hoverLeaveTimeoutRef.current = null;
    }
  }

  useEffect(() => {
    const canSelect = !directEditMode && (detail.note.commentsEnabled || (adminMode && onEditSelection));
    if (!canSelect) {
      return;
    }

    function handleMouseUp() {
      const browserSelection = window.getSelection();
      if (!browserSelection || browserSelection.isCollapsed || !browserSelection.rangeCount) {
        return;
      }

      const range = browserSelection.getRangeAt(0);
      const container = contentRef.current;
      if (
        !container ||
        !container.contains(range.startContainer) ||
        !container.contains(range.endContainer)
      ) {
        return;
      }

      if (rangeTouchesGeneratedContent(range)) {
        return;
      }

      const text = browserSelection.toString().trim();
      if (!text || text.length < 2) {
        return;
      }

      const startRange = range.cloneRange();
      startRange.selectNodeContents(container);
      startRange.setEnd(range.startContainer, range.startOffset);

      const start = visibleTextLength(startRange);
      const end = start + text.length;
      const rect = range.getBoundingClientRect();

      setSelection({ text, start, end, rect });
      setShowCommentForm(false);
      setShowEditForm(false);
      setHoveredHighlight(null);
      setEditValue(text);
      setEditError("");
    }

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [adminMode, detail.note.commentsEnabled, directEditMode, onEditSelection]);

  useEffect(() => {
    if (!selection) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (viewerRef.current?.contains(target)) {
        return;
      }

      clearSelectionState();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        clearSelectionState();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selection]);

  useEffect(() => {
    if (directEditMode) {
      return;
    }

    const container = contentRef.current;
    if (!container) {
      return;
    }

    function handleClick(event: Event) {
      const target = event.target as HTMLElement;
      if (target.tagName === "MARK" && target.dataset.commentId) {
        setActiveCommentId(target.dataset.commentId);
        setReplyTargetId(null);
        if (isMobile) {
          onCommentsOpenChange(true);
        }
      }
    }

    function handleMouseOver(event: Event) {
      if (!adminMode || selection) {
        return;
      }
      const target = event.target as HTMLElement;
      if (target.tagName !== "MARK" || !target.dataset.commentId) {
        return;
      }

      const comment = comments.find((entry) => entry.id === target.dataset.commentId);
      if (!comment) {
        return;
      }

      cancelHoveredClear();
      setHoveredHighlight({
        commentId: comment.id,
        text: comment.anchorText,
        start: comment.anchorStart,
        end: comment.anchorEnd,
        rect: target.getBoundingClientRect(),
      });
    }

    function handleMouseOut(event: Event) {
      const target = event.target as HTMLElement;
      if (target.tagName === "MARK" && target.dataset.commentId) {
        clearHoveredHighlightSoon();
      }
    }

    container.addEventListener("click", handleClick);
    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseout", handleMouseOut);
    return () => {
      container.removeEventListener("click", handleClick);
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseout", handleMouseOut);
    };
  }, [adminMode, comments, directEditMode, isMobile, onCommentsOpenChange, selection]);

  const highlightedHtml = useMemo(
    () => applyCommentHighlights(detail.html ?? "", comments, false, activeCommentId, selection),
    [activeCommentId, comments, detail.html, selection],
  );

  async function updateComment(id: string, status: "open" | "resolved") {
    await fetch(`${getClientApiBaseUrl()}${adminMode ? "/api/admin/comments" : "/api/comments"}/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: detail.note.slug, status }),
    });
    await reloadComments();
  }

  async function handleDelete(id: string) {
    await fetch(`${getClientApiBaseUrl()}${adminMode ? "/api/admin/comments" : "/api/comments"}/${id}?slug=${encodeURIComponent(detail.note.slug)}`, {
      method: "DELETE",
      credentials: "include",
    });
    await reloadComments();
  }

  async function handleApprove(id: string) {
    await fetch(`${getClientApiBaseUrl()}/api/admin/comments/${id}/approve`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: detail.note.slug }),
    });
    await reloadComments();
  }

  async function handleApproveReply(id: string) {
    await fetch(`${getClientApiBaseUrl()}/api/admin/comment-replies/${id}/approve`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: detail.note.slug }),
    });
    await reloadComments();
  }

  async function handleDeleteReply(id: string) {
    await fetch(`${getClientApiBaseUrl()}/api/admin/comment-replies/${id}?slug=${encodeURIComponent(detail.note.slug)}`, {
      method: "DELETE",
      credentials: "include",
    });
    await reloadComments();
  }

  async function handleReplySubmit(commentId: string, payload: { authorEmail: string; body: string }) {
    const endpoint = adminMode
      ? `/api/admin/comments/${commentId}/replies`
      : `/api/comments/${commentId}/replies`;
    const response = await fetch(`${getClientApiBaseUrl()}${endpoint}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: detail.note.slug,
        authorEmail: payload.authorEmail,
        body: payload.body,
      }),
    });
    const data = await response.json().catch(() => null) as { error?: string; pendingApproval?: boolean } | null;
    if (!response.ok) {
      throw new Error(data?.error || "Unable to submit reply");
    }
    await reloadComments();
    return { pendingApproval: Boolean(data?.pendingApproval) };
  }

  async function handleSaveEdit() {
    if (!selection || !onEditSelection) {
      return;
    }

    setIsSavingEdit(true);
    setEditError("");
    try {
      await onEditSelection({
        anchorText: selection.text,
        anchorStart: selection.start,
        anchorEnd: selection.end,
        replacementText: editValue,
      });
      setSubmissionNotice("Selection updated.");
      clearSelectionState();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Unable to update note");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleCopySelection() {
    if (!selection) {
      return;
    }
    try {
      await navigator.clipboard.writeText(selection.text);
      setSubmissionNotice("Copied selection.");
    } catch {
      setSubmissionNotice("Unable to copy selection.");
    }
    clearSelectionState();
  }

  const handleSaveMarkdown = useCallback(async () => {
    if (!onSaveMarkdown) {
      return;
    }

    setIsSavingMarkdown(true);
    setMarkdownError("");
    try {
      await onSaveMarkdown(markdownDraft);
      setSubmissionNotice("Note updated.");
      onDirectEditModeChange?.(false);
    } catch (error) {
      setMarkdownError(error instanceof Error ? error.message : "Unable to update note");
    } finally {
      setIsSavingMarkdown(false);
    }
  }, [markdownDraft, onDirectEditModeChange, onSaveMarkdown]);

  useEffect(() => {
    if (!directEditMode) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSaveMarkdown();
        return;
      }

      if (event.key === "Escape" && !isSavingMarkdown) {
        event.preventDefault();
        setMarkdownDraft(detail.markdown ?? "");
        setMarkdownError("");
        onDirectEditModeChange?.(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [detail.markdown, directEditMode, handleSaveMarkdown, isSavingMarkdown, onDirectEditModeChange]);

  return (
    <div ref={viewerRef} className="note-viewer-shell">
      <div className="note-reader">
        <div className="note-reader-inner" style={{ fontSize: `${fontScale}rem` }}>
          <article className="note-article">
            <header className="note-article-header">
              <h1>{detail.note.title}</h1>
              {detail.frontmatterFields.length > 0 ? (
                <div className="frontmatter-block">
                  {detail.frontmatterFields.map((field) => (
                    <div key={field.key} className="frontmatter-row">
                      <span className="frontmatter-label">{field.label}</span>
                      {Array.isArray(field.value) ? (
                        <span className="frontmatter-tags">
                          {field.value.map((tag) => <span key={tag} className="tag-pill">{tag}</span>)}
                        </span>
                      ) : field.href ? (
                        <a
                          className="frontmatter-value frontmatter-link"
                          href={field.href}
                          target={shouldOpenInNewTab(field.href) ? "_blank" : undefined}
                          rel={shouldOpenInNewTab(field.href) ? "noopener noreferrer" : undefined}
                        >
                          {formatFieldValue(field)}
                        </a>
                      ) : (
                        <span className="frontmatter-value">{formatFieldValue(field)}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
              {detail.subtitle ? <p className="note-subtitle">{detail.subtitle}</p> : null}
              <div className="note-divider" />
            </header>

            {submissionNotice ? <div className="inline-notice">{submissionNotice}</div> : null}

            {directEditMode ? (
              <section className="note-editor-card">
                <div className="note-editor-header">
                  <div className="note-editor-copy">
                    <p className="note-editor-eyebrow">Admin Editor</p>
                    <p className="note-editor-description">Editing the markdown body directly. Frontmatter stays under note settings.</p>
                  </div>
                  <div className="note-editor-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setMarkdownDraft(detail.markdown ?? "");
                        setMarkdownError("");
                        onDirectEditModeChange?.(false);
                      }}
                      disabled={isSavingMarkdown}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void handleSaveMarkdown()}
                      disabled={isSavingMarkdown}
                    >
                      {isSavingMarkdown ? "Saving..." : "Save note"}
                    </button>
                  </div>
                </div>
                <label className="note-editor-field">
                  <span className="note-editor-label">Markdown</span>
                  <textarea
                    ref={markdownTextareaRef}
                    className="note-editor-textarea"
                    value={markdownDraft}
                    onChange={(event) => setMarkdownDraft(event.target.value)}
                    spellCheck={false}
                  />
                </label>
                {markdownError ? <p className="comment-form-error">{markdownError}</p> : null}
              </section>
            ) : (
              <div
                ref={contentRef}
                className="note-prose"
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            )}

            {!directEditMode && detail.backlinks.length > 0 ? (
              <section className="backlinks-section">
                <div className="note-divider" />
                <p className="backlinks-label">Backlinks</p>
                <div className="backlinks-list">
                  {detail.backlinks.map((backlink) => (
                    <Link key={backlink.slug} href={adminMode ? `/admin${getNoteHref(backlink.slug)}` : getNoteHref(backlink.slug)} className="backlink-link">
                      {backlink.title}
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </article>
        </div>

        {selection && !showCommentForm && !showEditForm ? (
          <div
            className="selection-toolbar"
            style={{
              top: selection.rect.bottom + 10,
              left: selection.rect.left + Math.max(selection.rect.width / 2 - (adminMode && onEditSelection ? 78 : 56), 0),
            }}
          >
            {adminMode && onEditSelection ? (
              <button
                type="button"
                className="selection-action ghost-button icon-only"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setShowEditForm(true);
                  setEditValue(selection.text);
                }}
                aria-label="Edit selection"
              >
                <PencilIcon width={14} height={14} />
              </button>
            ) : null}
            {detail.note.commentsEnabled ? (
              <button
                type="button"
                className="selection-action primary-button icon-only"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setShowCommentForm(true);
                }}
                aria-label="Comment on selection"
              >
                <MessageSquareIcon width={14} height={14} />
              </button>
            ) : null}
            <button
              type="button"
              className="selection-action ghost-button icon-only"
              onMouseDown={(event) => {
                event.preventDefault();
                void handleCopySelection();
              }}
              aria-label="Copy selection"
            >
              <CopyIcon width={14} height={14} />
            </button>
          </div>
        ) : null}

        {adminMode && hoveredHighlight && !selection ? (
          <div
            className="highlight-hover-toolbar"
            style={{
              top: hoveredHighlight.rect.bottom + 8,
              left: hoveredHighlight.rect.left + Math.max(hoveredHighlight.rect.width / 2 - 58, 0),
            }}
            onMouseEnter={cancelHoveredClear}
            onMouseLeave={clearHoveredHighlightSoon}
          >
            {onEditSelection ? (
              <button
                type="button"
                className="selection-action ghost-button icon-only"
                onClick={() => {
                  cancelHoveredClear();
                  setSelection({
                    text: hoveredHighlight.text,
                    start: hoveredHighlight.start,
                    end: hoveredHighlight.end,
                    rect: hoveredHighlight.rect,
                  });
                  setEditValue(hoveredHighlight.text);
                  setShowEditForm(true);
                  setShowCommentForm(false);
                  setHoveredHighlight(null);
                }}
                aria-label="Edit suggested change"
              >
                <PencilIcon width={14} height={14} />
              </button>
            ) : null}
            {detail.note.commentsEnabled ? (
              <button
                type="button"
                className="selection-action primary-button icon-only"
                onClick={() => {
                  setActiveCommentId(hoveredHighlight.commentId);
                  setReplyTargetId(hoveredHighlight.commentId);
                  onCommentsOpenChange(true);
                  setHoveredHighlight(null);
                }}
                aria-label="Open comment thread"
              >
                <MessageSquareIcon width={14} height={14} />
              </button>
            ) : null}
          </div>
        ) : null}

        {selection && showCommentForm ? (
          <CommentForm
            slug={detail.note.slug}
            anchorText={selection.text}
            anchorStart={selection.start}
            anchorEnd={selection.end}
            position={{
              top: selection.rect.bottom + 12,
              left: Math.min(selection.rect.left, window.innerWidth - 360),
            }}
            onSubmit={(result) => {
              clearSelectionState();
              setSubmissionNotice(result.pendingApproval ? "Comment submitted for approval." : "Comment added.");
              void reloadComments();
              onCommentsOpenChange(true);
            }}
            onCancel={clearSelectionState}
            mobile={isMobile}
            adminMode={adminMode}
          />
        ) : null}

        {selection && showEditForm ? (
          <div
            className={isMobile ? "mobile-sheet open" : "floating-comment-panel"}
            style={isMobile ? undefined : {
              top: selection.rect.bottom + 12,
              left: Math.min(selection.rect.left, window.innerWidth - 360),
            }}
          >
            {isMobile ? <div className="mobile-sheet-backdrop" onClick={clearSelectionState} /> : null}
            <div className={isMobile ? "mobile-sheet-panel" : ""}>
              {isMobile ? <div className="mobile-sheet-handle" /> : null}
              <div className="comment-form">
                <div className="comment-form-header">
                  <div>
                    <p className="comment-form-title">Edit selection</p>
                    <p className="comment-form-anchor">&ldquo;{selection.text}&rdquo;</p>
                  </div>
                </div>
                <label className="comment-form-field">
                  <span className="comment-form-label">Replacement</span>
                  <textarea
                    rows={4}
                    className="comment-textarea"
                    value={editValue}
                    onChange={(event) => setEditValue(event.target.value)}
                  />
                </label>
                {editError ? <p className="comment-form-error">{editError}</p> : null}
                <div className="comment-form-actions">
                  <button type="button" className="ghost-button" onClick={clearSelectionState}>
                    Cancel
                  </button>
                  <button type="button" className="primary-button" disabled={isSavingEdit} onClick={() => void handleSaveEdit()}>
                    {isSavingEdit ? "Saving..." : "Save edit"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {(detail.note.commentsEnabled || adminMode) ? (
        <CommentSidebar
          comments={comments}
          activeCommentId={activeCommentId}
          onCommentClick={(id) => {
            setActiveCommentId(id);
            onCommentsOpenChange(true);
          }}
          onResolve={(id) => void updateComment(id, "resolved")}
          onReopen={(id) => void updateComment(id, "open")}
          onDelete={(id) => void handleDelete(id)}
          onApprove={(id) => void handleApprove(id)}
          onReplySubmit={handleReplySubmit}
          onApproveReply={(id) => void handleApproveReply(id)}
          onDeleteReply={(id) => void handleDeleteReply(id)}
          open={commentsOpen}
          mobile={isMobile}
          onClose={() => onCommentsOpenChange(false)}
          adminMode={adminMode}
          replyTargetId={replyTargetId}
          onReplyTargetChange={(id) => {
            setReplyTargetId(id);
            if (id) {
              onCommentsOpenChange(true);
            }
          }}
        />
      ) : null}
    </div>
  );
}
