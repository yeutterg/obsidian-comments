"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { NoteDetailResponse } from "@commonplace/shared";
import NoteViewer from "@/components/NoteViewer";
import LoginForm from "@/components/LoginForm";
import ThemeToggle from "@/components/ThemeToggle";
import AdminSettingsPanel from "@/components/AdminSettingsPanel";
import { getClientApiBaseUrl } from "@/lib/api-base";
import { getNoteHref } from "@/lib/directory-tree";
import {
  ArrowLeftIcon,
  MessageSquareIcon,
  MinusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SettingsIcon,
  ShareIcon,
} from "@/components/Icons";

async function fetchClientNoteDetail(slug: string, adminMode: boolean): Promise<NoteDetailResponse> {
  const response = await fetch(
    `${getClientApiBaseUrl()}${adminMode ? "/api/admin/note" : "/api/note"}?slug=${encodeURIComponent(slug)}`,
    {
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error("Failed to fetch note");
  }

  return response.json() as Promise<NoteDetailResponse>;
}

export default function NoteViewerWrapper({
  initialDetail,
  adminMode = false,
}: {
  initialDetail: NoteDetailResponse;
  adminMode?: boolean;
}) {
  const [detail, setDetail] = useState(initialDetail);
  const [error, setError] = useState<string | null>(null);
  const [hydratingContent, setHydratingContent] = useState(initialDetail.authorized && !initialDetail.html);
  const [checking, setChecking] = useState(initialDetail.note.visibility === "password" && !initialDetail.authorized);
  const [commentCount, setCommentCount] = useState(initialDetail.note.commentCount);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [adminPanelMode, setAdminPanelMode] = useState<"settings" | "sharing" | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [fontScale, setFontScale] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [directEditMode, setDirectEditMode] = useState(false);
  const initializedViewportRef = useRef(false);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  const directoryHref = adminMode ? "/admin" : "/";
  const noteHref = adminMode ? `/admin${getNoteHref(detail.note.slug)}` : getNoteHref(detail.note.slug);
  const breadcrumbLinks = useMemo(() => {
    const items = [{ label: "obsidian-vault", href: directoryHref, current: detail.breadcrumbs.length === 0 }];
    let cumulativePath = "";

    detail.breadcrumbs.forEach((part, index) => {
      cumulativePath = cumulativePath ? `${cumulativePath}/${part}` : part;
      items.push({
        label: part,
        href: index === detail.breadcrumbs.length - 1
          ? noteHref
          : `${directoryHref}?q=${encodeURIComponent(cumulativePath)}`,
        current: index === detail.breadcrumbs.length - 1,
      });
    });

    return items;
  }, [detail.breadcrumbs, directoryHref, noteHref]);

  async function reloadNote() {
    const nextDetail = await fetchClientNoteDetail(detail.note.slug, adminMode);
    setDetail(nextDetail);
    setCommentCount(nextDetail.note.commentCount);
    setError(null);
  }

  async function saveNoteSettings(input: {
    publish: boolean;
    visibility: "public" | "password" | "users";
    comments: boolean;
    editing: boolean;
    password?: string;
    internalUsers: string[];
    externalEmails: string[];
  }) {
    if (input.visibility === "users") {
      setDetail((current) => ({
        ...current,
        note: {
          ...current.note,
          published: input.publish,
          visibility: "users",
          commentsEnabled: input.comments,
          editingEnabled: input.editing,
        },
        accessControl: {
          internalUsers: input.internalUsers,
          externalEmails: input.externalEmails,
        },
      }));
      setStatusNotice("Users visibility saved in the web UI mockup. Backend enforcement is not wired yet.");
      return;
    }

    const response = await fetch(`${getClientApiBaseUrl()}/api/admin/note/settings`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: detail.note.slug,
        ...input,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || "Unable to update note settings");
    }
    setDetail(await response.json());
    setStatusNotice("Note settings saved.");
  }

  async function shareNote() {
    const publicUrl = new URL(getNoteHref(detail.note.slug), window.location.origin).toString();
    if (isMobile && navigator.share) {
      await navigator.share({ title: detail.note.title, url: publicUrl }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(publicUrl).catch(() => undefined);
    setStatusNotice(detail.note.published ? "Public link copied." : "Draft link copied. Publish the note to share it publicly.");
  }

  useEffect(() => {
    if (adminMode) {
      return;
    }
    if (initialDetail.authorized || initialDetail.note.visibility !== "password") {
      return;
    }

    let cancelled = false;
    void fetchClientNoteDetail(initialDetail.note.slug, adminMode)
      .then((nextDetail) => {
        if (!cancelled) {
          setDetail(nextDetail);
          setCommentCount(nextDetail.note.commentCount);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch note");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setChecking(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [adminMode, initialDetail]);

  useEffect(() => {
    if (!initialDetail.authorized || initialDetail.html) {
      return;
    }

    let cancelled = false;
    void fetchClientNoteDetail(initialDetail.note.slug, adminMode)
      .then((nextDetail) => {
        if (!cancelled) {
          setDetail(nextDetail);
          setCommentCount(nextDetail.note.commentCount);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch note");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHydratingContent(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [adminMode, initialDetail]);

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobile = window.innerWidth <= 960;
      setIsMobile(nextIsMobile);
      setCommentsOpen((current) => {
        if (!initializedViewportRef.current) {
          return !nextIsMobile;
        }
        return nextIsMobile ? false : current;
      });
      if (nextIsMobile) {
        setAdminPanelMode(null);
      }
      setMobileMenuOpen(false);
      initializedViewportRef.current = true;
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!statusNotice) {
      return;
    }
    const timeout = window.setTimeout(() => setStatusNotice(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [statusNotice]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (actionMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setMobileMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileMenuOpen]);

  const settingsOpen = adminPanelMode !== null;

  if (checking || hydratingContent) {
    return (
      <div className="note-loading">
        <div>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="note-loading">
        <div className="vault-alert vault-alert-error" style={{ maxWidth: 560 }}>
          <strong>Unable to load note.</strong> {error}
        </div>
      </div>
    );
  }

  if (!detail.authorized) {
    return (
      <LoginForm
        slug={detail.note.slug}
        onSuccess={async () => {
          await reloadNote();
        }}
      />
    );
  }

  return (
    <div className="note-page">
      <header className="note-topbar">
        <div className="note-topbar-left">
          {isMobile ? (
            <Link href={directoryHref} className="icon-button note-mobile-back" aria-label="Back to directory">
              <ArrowLeftIcon width={16} height={16} />
            </Link>
          ) : null}
          <div className="note-breadcrumbs">
            {breadcrumbLinks.map((item, index) => (
              <span key={`${item.label}-${item.href}`} className="note-breadcrumb-item">
                {index > 0 ? <span className="note-breadcrumb-separator" aria-hidden="true">/</span> : null}
                <Link
                  href={item.href}
                  className={`note-breadcrumb-link ${item.current ? "current" : ""}`}
                >
                  {item.label.replace(/^\/+/, "")}
                </Link>
              </span>
            ))}
          </div>
        </div>
        <div className="note-topbar-actions" ref={isMobile ? actionMenuRef : undefined}>
          {isMobile ? (
            <div className="note-mobile-type-controls" aria-label="Text size controls">
              <button
                type="button"
                className="icon-button type-scale"
                onClick={() => setFontScale((scale) => Math.max(0.9, Number((scale - 0.05).toFixed(2))))}
                aria-label="Decrease text size"
              >
                <MinusIcon width={14} height={14} />
              </button>
              <button
                type="button"
                className="icon-button type-scale"
                onClick={() => setFontScale((scale) => Math.min(1.2, Number((scale + 0.05).toFixed(2))))}
                aria-label="Increase text size"
              >
                <PlusIcon width={14} height={14} />
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="icon-button with-badge"
            aria-label="Toggle comments"
            onClick={() => {
              setCommentsOpen((open) => !open);
              setMobileMenuOpen(false);
            }}
          >
            <MessageSquareIcon width={16} height={16} />
            <span className="count-badge">{commentCount}</span>
          </button>
          {isMobile ? (
            <>
              <button
                type="button"
                className={`icon-button ${mobileMenuOpen ? "active" : ""}`}
                onClick={() => setMobileMenuOpen((open) => !open)}
                aria-label="Open note actions"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-note-actions-menu"
              >
                <MoreHorizontalIcon width={16} height={16} />
              </button>
              {mobileMenuOpen ? (
                <div className="mobile-action-menu" id="mobile-note-actions-menu">
                  {adminMode ? (
                    <button
                      type="button"
                      className="mobile-action-menu-item"
                      onClick={async () => {
                        setMobileMenuOpen(false);
                        await shareNote();
                      }}
                    >
                      <ShareIcon width={16} height={16} />
                      <span>Share note</span>
                    </button>
                  ) : null}
                  {adminMode ? (
                    <button
                      type="button"
                      className="mobile-action-menu-item"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setAdminPanelMode("settings");
                      }}
                    >
                      <SettingsIcon width={16} height={16} />
                      <span>Note settings</span>
                    </button>
                  ) : null}
                  <div className="mobile-action-menu-row">
                    <div className="mobile-action-menu-copy">
                      <span className="mobile-action-menu-label">Text size</span>
                      <span className="mobile-action-menu-value">{Math.round(fontScale * 100)}%</span>
                    </div>
                  </div>
                  <ThemeToggle variant="menu" />
                </div>
              ) : null}
            </>
          ) : (
            <>
              {adminMode ? (
                <>
                  <button
                    type="button"
                    className={`icon-button ${adminPanelMode === "sharing" ? "active" : ""}`}
                    onClick={() => setAdminPanelMode((current) => current === "sharing" ? null : "sharing")}
                    aria-label="Share note"
                    aria-pressed={adminPanelMode === "sharing"}
                  >
                    <ShareIcon width={16} height={16} />
                  </button>
                  <button
                    type="button"
                    className={`icon-button ${adminPanelMode === "settings" ? "active" : ""}`}
                    onClick={() => setAdminPanelMode((current) => current === "settings" ? null : "settings")}
                    aria-label="Open note settings"
                    aria-pressed={adminPanelMode === "settings"}
                  >
                    <SettingsIcon width={16} height={16} />
                  </button>
                </>
              ) : null}
              {!adminMode ? <ThemeToggle /> : null}
            </>
          )}
        </div>
      </header>

      {statusNotice ? <div className="note-topbar-notice">{statusNotice}</div> : null}

      <div className="note-main-shell">
        <NoteViewer
          detail={{ ...detail, note: { ...detail.note, commentCount } }}
          adminMode={adminMode}
          commentsOpen={commentsOpen}
          fontScale={fontScale}
          directEditMode={directEditMode}
          onDirectEditModeChange={setDirectEditMode}
          onCommentsOpenChange={setCommentsOpen}
          onCommentCountChange={setCommentCount}
          onSaveMarkdown={adminMode ? async (markdown) => {
            const response = await fetch(`${getClientApiBaseUrl()}/api/admin/note/content`, {
              method: "PATCH",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                slug: detail.note.slug,
                markdown,
              }),
            });
            if (!response.ok) {
              const data = await response.json().catch(() => null);
              throw new Error(data?.error || "Unable to update note");
            }
            const nextDetail = await response.json();
            setDetail(nextDetail);
            setCommentCount(nextDetail.note.commentCount);
          } : undefined}
          onEditSelection={adminMode ? async (input) => {
            const response = await fetch(`${getClientApiBaseUrl()}/api/admin/note/content`, {
              method: "PATCH",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                slug: detail.note.slug,
                ...input,
              }),
            });
            if (!response.ok) {
              const data = await response.json().catch(() => null);
              throw new Error(data?.error || "Unable to update note");
            }
            setDetail(await response.json());
          } : undefined}
        />

        {adminMode ? (
          <AdminSettingsPanel
            detail={detail}
            open={settingsOpen}
            mode={adminPanelMode ?? "settings"}
            onClose={() => setAdminPanelMode(null)}
            onSave={saveNoteSettings}
          />
        ) : null}
      </div>
    </div>
  );
}
