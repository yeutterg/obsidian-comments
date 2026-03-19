"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { NoteSummary } from "@commonplace/shared";
import {
  buildDirectoryTree,
  collectFolderIds,
  filterDirectory,
  folderNoteCount,
  getNoteHref,
  type DirectoryNode,
  type DirectoryFolderNode,
} from "@/lib/directory-tree";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon, LockIcon, SearchIcon, ShareIcon, XIcon } from "./Icons";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/UserMenu";
import { getClientApiBaseUrl } from "@/lib/api-base";

function statusForNote(note: NoteSummary) {
  switch (note.visibility) {
    case "public":
      return { label: "Public", className: "status-pill status-pill-published" };
    case "password":
      return { label: "Password", className: "status-pill status-pill-private" };
    case "users":
      return { label: "Users", className: "status-pill status-pill-users" };
    case "private":
    default:
      return { label: "Private", className: "status-pill status-pill-draft" };
  }
}

function collectNoteSlugs(node: DirectoryNode): string[] {
  if (node.type === "note") {
    return [node.note.slug];
  }
  return node.children.flatMap(collectNoteSlugs);
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  admin,
  selected,
  onSelect,
}: {
  node: DirectoryNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  admin: boolean;
  selected: Set<string>;
  onSelect: (slugs: string[], checked: boolean) => void;
}) {
  if (node.type === "note") {
    const status = statusForNote(node.note);
    const href = admin ? `/admin${getNoteHref(node.note.slug)}` : getNoteHref(node.note.slug);
    const isSelected = selected.has(node.note.slug);

    return (
      <div className={`vault-row vault-row-note ${isSelected ? "vault-row-selected" : ""}`} style={{ paddingLeft: 20 + depth * 18 }}>
        {admin ? (
          <button
            type="button"
            className={`vault-checkbox ${isSelected ? "checked" : ""}`}
            onClick={(e) => { e.stopPropagation(); onSelect([node.note.slug], !isSelected); }}
            aria-label={isSelected ? "Deselect note" : "Select note"}
          >
            {isSelected ? <CheckIcon width={10} height={10} /> : null}
          </button>
        ) : null}
        <Link href={href} className="vault-row-link">
          <span className="vault-row-main">
            <span className="vault-row-icon"><FileIcon width={15} height={15} /></span>
            <span className="vault-row-label">{node.name.replace(/\.md$/i, "")}</span>
          </span>
          {admin ? (
            <span className="vault-row-meta">
              <span className={status.className}>{status.label}</span>
              {node.note.commentCount > 0 ? (
                <span className="vault-row-comments">
                  {node.note.commentCount} {node.note.commentCount === 1 ? "comment" : "comments"}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="vault-row-open">Open</span>
          )}
        </Link>
      </div>
    );
  }

  const isOpen = expanded.has(node.id);
  const count = folderNoteCount(node);
  const folderSlugs = collectNoteSlugs(node);
  const selectedInFolder = folderSlugs.filter((s) => selected.has(s)).length;
  const checkState: "none" | "some" | "all" =
    selectedInFolder === 0 ? "none" : selectedInFolder === folderSlugs.length ? "all" : "some";

  return (
    <div className="vault-group">
      <div className="vault-row vault-row-folder" style={{ paddingLeft: 20 + depth * 18 }}>
        {admin ? (
          <button
            type="button"
            className={`vault-checkbox ${checkState !== "none" ? "checked" : ""}`}
            onClick={(e) => { e.stopPropagation(); onSelect(folderSlugs, checkState !== "all"); }}
            aria-label={checkState === "all" ? "Deselect folder" : "Select folder"}
          >
            {checkState === "all" ? <CheckIcon width={10} height={10} /> : checkState === "some" ? <span className="vault-checkbox-dash" /> : null}
          </button>
        ) : null}
        <button
          type="button"
          className="vault-row-link vault-row-folder-btn"
          onClick={() => onToggle(node.id)}
        >
          <span className="vault-row-main">
            <span className="vault-row-icon">
              {isOpen ? <ChevronDownIcon width={14} height={14} /> : <ChevronRightIcon width={14} height={14} />}
            </span>
            <span className="vault-row-icon"><FolderIcon width={15} height={15} /></span>
            <span className="vault-row-label">{node.name}</span>
          </span>
          <span className="vault-row-count">{count}</span>
        </button>
      </div>

      {isOpen && (
        <div className="vault-children">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              admin={admin}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BulkSharingPanel({
  selectedNotes,
  onClose,
  onApply,
}: {
  selectedNotes: NoteSummary[];
  onClose: () => void;
  onApply: (settings: { visibility: "public" | "password" | "users" | "private"; comments: boolean; editing: boolean; password?: string }) => Promise<void>;
}) {
  const [visibility, setVisibility] = useState<"public" | "password" | "users" | "private">("public");
  const [comments, setComments] = useState(true);
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <aside className="bulk-sharing-panel">
      <div className="bulk-sharing-header">
        <span className="bulk-sharing-title">Bulk Sharing</span>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close sharing panel">
          <XIcon width={16} height={16} />
        </button>
      </div>
      <div className="bulk-sharing-body">
        <div className="bulk-sharing-section">
          <span className="bulk-sharing-label">Applying to</span>
          <div className="bulk-sharing-chips">
            {selectedNotes.map((note) => (
              <span key={note.slug} className="bulk-sharing-chip">{note.title}</span>
            ))}
          </div>
        </div>

        <div className="bulk-sharing-divider" />

        <div className="bulk-sharing-section">
          <span className="bulk-sharing-section-label">Visibility</span>
          <div className="segmented-tabs">
            <button type="button" className={`segmented-tab ${visibility === "private" ? "active" : ""}`} onClick={() => setVisibility("private")}>Private</button>
            <button type="button" className={`segmented-tab ${visibility === "public" ? "active" : ""}`} onClick={() => setVisibility("public")}>Public</button>
            <button type="button" className={`segmented-tab ${visibility === "password" ? "active" : ""}`} onClick={() => setVisibility("password")}>Password</button>
            <button type="button" className={`segmented-tab ${visibility === "users" ? "active" : ""}`} onClick={() => setVisibility("users")}>Users</button>
          </div>
          {visibility === "password" ? (
            <div className="bulk-sharing-password">
              <span className="bulk-sharing-label">Note Password</span>
              <div className="field-shell">
                <LockIcon width={14} height={14} />
                <input
                  type="password"
                  className="field-input"
                  placeholder="Set password for all selected"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="bulk-sharing-divider" />

        <div className="bulk-sharing-section">
          <span className="bulk-sharing-section-label">Features</span>
          <div className="settings-row">
            <span>Allow Comments</span>
            <button type="button" className={`toggle-switch ${comments ? "on" : ""}`} onClick={() => setComments(!comments)} aria-pressed={comments}><span /></button>
          </div>
          <div className="settings-row">
            <span>Allow Editing</span>
            <button type="button" className={`toggle-switch ${editing ? "on" : ""}`} onClick={() => setEditing(!editing)} aria-pressed={editing}><span /></button>
          </div>
        </div>

        <div className="bulk-sharing-divider" />

        <button
          type="button"
          className="bulk-sharing-apply"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onApply({ visibility, comments, editing, password: password.trim() || undefined });
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Applying..." : `Apply to ${selectedNotes.length} note${selectedNotes.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </aside>
  );
}

export default function DirectoryPageClient({
  notes,
  error,
  warnings,
  admin = false,
  initialQuery = "",
  vaultName = "Commonplace",
  vaultId,
  multiVault = false,
}: {
  notes: NoteSummary[];
  error: string | null;
  warnings: string[];
  admin?: boolean;
  initialQuery?: string;
  vaultName?: string;
  vaultId?: string;
  multiVault?: boolean;
}) {
  const tree = useMemo(() => buildDirectoryTree(notes), [notes]);
  const allFolderIds = useMemo(() => collectFolderIds(tree), [tree]);
  const [query, setQuery] = useState(initialQuery);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allFolderIds));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharingOpen, setSharingOpen] = useState(false);
  const [statusNotice, setStatusNotice] = useState("");

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    setExpanded((current) => {
      if (current.size > 0) {
        return current;
      }
      return new Set(allFolderIds);
    });
  }, [allFolderIds]);

  useEffect(() => {
    if (!statusNotice) return;
    const t = setTimeout(() => setStatusNotice(""), 3000);
    return () => clearTimeout(t);
  }, [statusNotice]);

  const filteredTree = useMemo(() => filterDirectory(tree, query), [tree, query]);
  const forcedExpanded = useMemo(() => new Set(collectFolderIds(filteredTree)), [filteredTree]);
  const effectiveExpanded = query.trim() ? forcedExpanded : expanded;
  const folderCount = allFolderIds.length;
  const totalNotes = notes.length;

  const selectedNotes = useMemo(
    () => notes.filter((n) => selected.has(n.slug)),
    [notes, selected],
  );

  const handleToggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelect = useCallback((slugs: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const slug of slugs) {
        if (checked) {
          next.add(slug);
        } else {
          next.delete(slug);
        }
      }
      return next;
    });
  }, []);

  const handleShare = async () => {
    const url = typeof window === "undefined" ? "" : window.location.href;
    if (!url) return;
    if (navigator.share) {
      await navigator.share({ url, title: vaultName }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url).catch(() => undefined);
  };

  const handleBulkApply = async (settings: {
    visibility: "public" | "password" | "users" | "private";
    comments: boolean;
    editing: boolean;
    password?: string;
  }) => {
    const slugs = [...selected];
    const results = await Promise.allSettled(
      slugs.map((slug) =>
        fetch(`${getClientApiBaseUrl()}/api/admin/note/settings`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug,
            visibility: settings.visibility,
            comments: settings.comments,
            editing: settings.editing,
            password: settings.password,
          }),
        })
      ),
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    setStatusNotice(`Updated ${succeeded} of ${slugs.length} notes.`);
    setSharingOpen(false);
    setSelected(new Set());
  };

  const vaultsHref = admin ? "/admin" : "/";

  return (
    <div className="vault-page">
      <div className="note-topbar">
        <div className="note-topbar-left">
          {multiVault ? (
            <div className="note-breadcrumbs">
              <Link href={vaultsHref} className="note-breadcrumb-link">vaults</Link>
              <span className="note-breadcrumb-sep">/</span>
              <span className="note-breadcrumb-current">{vaultName}</span>
            </div>
          ) : (
            <span className="vault-topbar-label">{vaultName}</span>
          )}
          {admin ? <span className="vault-admin-label">Admin</span> : null}
        </div>
        <div className="note-topbar-actions">
          {admin ? (
            <button type="button" className="icon-button" onClick={() => void handleShare()} aria-label="Share vault">
              <ShareIcon width={16} height={16} />
            </button>
          ) : null}
          <ThemeToggle variant="icon" />
          <UserMenu />
        </div>
      </div>

      {statusNotice ? <div className="note-topbar-notice">{statusNotice}</div> : null}

      <div className="vault-directory-shell">
        <div className="vault-directory-content">
          <div className="vault-directory-header">
            <h1 className="vault-directory-title">{vaultName}</h1>
            <p className="vault-subtitle">
              {totalNotes} notes across {folderCount} folders
            </p>
          </div>

          <label className="vault-search">
            <SearchIcon width={16} height={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search notes..."
              aria-label="Search directory"
            />
          </label>

          {selected.size > 0 ? (
            <div className="bulk-action-bar">
              <div className="bulk-action-left">
                <span className="bulk-action-count">{selected.size} note{selected.size === 1 ? "" : "s"} selected</span>
                <button type="button" className="bulk-action-clear" onClick={() => { setSelected(new Set()); setSharingOpen(false); }}>Clear</button>
              </div>
              <button type="button" className="bulk-action-share" onClick={() => setSharingOpen(true)}>
                <ShareIcon width={14} height={14} />
                <span>Share</span>
              </button>
            </div>
          ) : null}

          <main className="vault-tree-shell">
            {error ? (
              <div className="vault-alert vault-alert-error">
                <strong>Vault unavailable.</strong> {error}
              </div>
            ) : null}

            {filteredTree.length === 0 ? (
              <div className="vault-empty">
                {error ? "The vault could not be read." : "No matching notes."}
              </div>
            ) : (
              filteredTree.map((node) => (
                <TreeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  expanded={effectiveExpanded}
                  onToggle={handleToggle}
                  admin={admin}
                  selected={selected}
                  onSelect={handleSelect}
                />
              ))
            )}
          </main>
        </div>

        {sharingOpen && selectedNotes.length > 0 ? (
          <BulkSharingPanel
            selectedNotes={selectedNotes}
            onClose={() => setSharingOpen(false)}
            onApply={handleBulkApply}
          />
        ) : null}
      </div>
    </div>
  );
}
