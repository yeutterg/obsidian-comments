"use client";

import { useEffect, useState } from "react";
import type { NoteDetailResponse } from "@obsidian-comments/shared";
import { LockIcon, SettingsIcon, ShareIcon, XIcon } from "./Icons";

interface Props {
  detail: NoteDetailResponse;
  open: boolean;
  compact?: boolean;
  onClose: () => void;
  onSave: (input: {
    publish: boolean;
    visibility: "public" | "password";
    comments: boolean;
    editing: boolean;
    password?: string;
  }) => Promise<void>;
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <button
        type="button"
        className={`toggle-switch ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
      >
        <span />
      </button>
    </label>
  );
}

export default function AdminSettingsPanel({
  detail,
  open,
  compact = false,
  onClose,
  onSave,
}: Props) {
  const [publish, setPublish] = useState(detail.note.published);
  const [visibility, setVisibility] = useState<"public" | "password">(detail.note.visibility);
  const [comments, setComments] = useState(detail.note.commentsEnabled);
  const [editing, setEditing] = useState(detail.note.editingEnabled);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPublish(detail.note.published);
    setVisibility(detail.note.visibility);
    setComments(detail.note.commentsEnabled);
    setEditing(detail.note.editingEnabled);
    setPassword("");
  }, [detail]);

  return (
    <aside className={`admin-panel ${compact ? "compact" : ""} ${open ? "open" : ""}`}>
      <div className="admin-panel-header">
        <div className="admin-panel-title">
          {compact ? <ShareIcon width={16} height={16} /> : <SettingsIcon width={16} height={16} />}
          <span>{compact ? "Sharing" : "Note Settings"}</span>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={compact ? "Close sharing settings" : "Close note settings"}>
          <XIcon width={16} height={16} />
        </button>
      </div>

      <div className="admin-panel-body">
        <ToggleRow label="Publish" checked={publish} onChange={setPublish} />

        <div className="settings-row settings-row-stack">
          <span>Visibility</span>
          <div className="segmented-tabs">
            <button
              type="button"
              className={`segmented-tab ${visibility === "public" ? "active" : ""}`}
              onClick={() => setVisibility("public")}
            >
              Public
            </button>
            <button
              type="button"
              className={`segmented-tab ${visibility === "password" ? "active" : ""}`}
              onClick={() => setVisibility("password")}
            >
              Password
            </button>
          </div>
          {visibility === "password" ? (
            <label className="settings-password-field">
              <span>Note Password</span>
              <div className="field-shell">
                <LockIcon width={14} height={14} />
                <input
                  type="password"
                  className="field-input"
                  placeholder="Leave blank to keep current password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </label>
          ) : null}
        </div>

        <ToggleRow label="Allow Comments" checked={comments} onChange={setComments} />
        <ToggleRow label="Allow Editing" checked={editing} onChange={setEditing} />
      </div>

      <div className="admin-panel-footer">
        <button
          type="button"
          className="primary-button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({
                publish,
                visibility,
                comments,
                editing,
                password: password.trim() || undefined,
              });
              onClose();
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </aside>
  );
}
