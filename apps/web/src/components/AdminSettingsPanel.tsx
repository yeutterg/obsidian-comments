"use client";

import { useEffect, useState } from "react";
import type { NoteDetailResponse } from "@commonplace/shared";
import { LockIcon, XIcon } from "./Icons";

const INTERNAL_USER_DIRECTORY = [
  "Greg Foster",
  "Mia Chen",
  "Marcus Flynn",
  "Alicia Lee",
  "Daniel Ortiz",
  "Priya Shah",
];

interface Props {
  detail: NoteDetailResponse;
  open: boolean;
  mode?: "settings" | "sharing";
  onClose: () => void;
  onSave: (input: {
    visibility: "public" | "password" | "users" | "private";
    comments: boolean;
    editing: boolean;
    password?: string;
    internalUsers: string[];
    externalEmails: string[];
  }) => Promise<void>;
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="settings-row">
      <span className="settings-row-label">
        <span>{label}</span>
        {description ? <span className="settings-row-desc">{description}</span> : null}
      </span>
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
  mode = "settings",
  onClose,
  onSave,
}: Props) {
  const [visibility, setVisibility] = useState<"public" | "password" | "users" | "private">(detail.note.visibility);
  const [comments, setComments] = useState(detail.note.commentsEnabled);
  const [editing, setEditing] = useState(detail.note.editingEnabled);
  const [password, setPassword] = useState("");
  const [internalUsers, setInternalUsers] = useState<string[]>([]);
  const [externalEmails, setExternalEmails] = useState<string[]>([]);
  const [accessInput, setAccessInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setVisibility(detail.note.visibility);
    setComments(detail.note.commentsEnabled);
    setEditing(detail.note.editingEnabled);
    setPassword("");
    setInternalUsers(detail.accessControl?.internalUsers.length ? detail.accessControl.internalUsers : ["Greg Foster", "Mia Chen"]);
    setExternalEmails(detail.accessControl?.externalEmails.length ? detail.accessControl.externalEmails : ["partner@client.com"]);
    setAccessInput("");
  }, [detail]);

  const compact = mode === "sharing";
  const title = compact ? "Sharing" : "Note Settings";
  const closeLabel = compact ? "Close sharing settings" : "Close note settings";

  function addInternalUser(value: string) {
    const nextValue = value.trim();
    if (!nextValue || internalUsers.includes(nextValue)) {
      return;
    }
    setInternalUsers((current) => [...current, nextValue]);
    setAccessInput("");
  }

  function addExternalEmail(value: string) {
    const nextValue = value.trim().toLowerCase();
    if (!nextValue || externalEmails.includes(nextValue)) {
      return;
    }
    setExternalEmails((current) => [...current, nextValue]);
    setAccessInput("");
  }

  function addAccessEntry() {
    const value = accessInput.trim();
    if (!value || internalUsers.includes(value)) {
      if (!value) {
        return;
      }
    }

    if (INTERNAL_USER_DIRECTORY.includes(value)) {
      addInternalUser(value);
      return;
    }

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      addExternalEmail(value);
      return;
    }
  }

  const selectedPeople = [
    ...internalUsers.map((value) => ({ value, type: "internal" as const })),
    ...externalEmails.map((value) => ({ value, type: "external" as const })),
  ];

  const accessSuggestions = INTERNAL_USER_DIRECTORY.filter((user) => {
    const query = accessInput.trim().toLowerCase();
    if (!query) {
      return false;
    }
    return user.toLowerCase().includes(query) && !internalUsers.includes(user);
  }).slice(0, 4);

  return (
    <aside className={`admin-panel ${compact ? "compact" : ""} ${open ? "open" : ""}`}>
      <div className="admin-panel-header">
        <p className="admin-panel-title">{title}</p>
        <button type="button" className="icon-button" onClick={onClose} aria-label={closeLabel}>
          <XIcon width={16} height={16} />
        </button>
      </div>

      <div className="admin-panel-body">
        <div className="settings-row settings-row-stack">
          <span>Visibility</span>
          <div className="segmented-tabs">
            <button type="button" className={`segmented-tab ${visibility === "private" ? "active" : ""}`} onClick={() => setVisibility("private")}>Private</button>
            <button type="button" className={`segmented-tab ${visibility === "public" ? "active" : ""}`} onClick={() => setVisibility("public")}>Public</button>
            <button type="button" className={`segmented-tab ${visibility === "password" ? "active" : ""}`} onClick={() => setVisibility("password")}>Password</button>
            <button type="button" className={`segmented-tab ${visibility === "users" ? "active" : ""}`} onClick={() => setVisibility("users")}>Users</button>
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
          {visibility === "users" ? (
            <div className="settings-users-shell">
              <p className="settings-visibility-helper">
                Search internal users or enter any external email address to grant access.
              </p>
              <div className="settings-access-group">
                <div className="settings-access-copy">
                  <span className="settings-access-label">Allowed People</span>
                  <span className="settings-access-caption">Internal teammates and invited guest emails live together here.</span>
                </div>
                <div className="settings-token-list">
                  {selectedPeople.map((person) => (
                    <span
                      key={person.value}
                      className={`settings-token ${person.type === "external" ? "settings-token-email" : ""}`}
                    >
                      {person.value}
                      <button
                        type="button"
                        className="settings-token-remove"
                        onClick={() => {
                          if (person.type === "internal") {
                            setInternalUsers((current) => current.filter((entry) => entry !== person.value));
                          } else {
                            setExternalEmails((current) => current.filter((entry) => entry !== person.value));
                          }
                        }}
                        aria-label={`Remove ${person.value}`}
                      >
                        <XIcon width={12} height={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="settings-omnibox">
                  <div className="field-shell settings-omnibox-field">
                    <input
                      type="text"
                      className="field-input"
                      placeholder="Search teammates or type an external email"
                      value={accessInput}
                      onChange={(event) => setAccessInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addAccessEntry();
                        }
                      }}
                    />
                  </div>
                  <button type="button" className="ghost-button settings-add-button" onClick={addAccessEntry}>
                    Add
                  </button>
                </div>
                {accessSuggestions.length > 0 ? (
                  <div className="settings-suggestions">
                    {accessSuggestions.map((user) => (
                      <button
                        key={user}
                        type="button"
                        className="settings-suggestion"
                        onClick={() => addInternalUser(user)}
                      >
                        <span className="settings-suggestion-name">{user}</span>
                        <span className="settings-suggestion-meta">Internal user</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <ToggleRow label="Allow Comments" description="Readers can leave comments" checked={comments} onChange={setComments} />
        <ToggleRow label="Allow Editing" description="Readers can suggest edits" checked={editing} onChange={setEditing} />
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
                visibility,
                comments,
                editing,
                password: password.trim() || undefined,
                internalUsers,
                externalEmails,
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
