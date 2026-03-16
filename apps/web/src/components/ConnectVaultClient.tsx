"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { VaultConnectionResponse } from "@obsidian-comments/shared";
import { getClientApiBaseUrl } from "@/lib/api-base";
import { ArrowUpRightIcon, CheckIcon, FolderIcon, GlobeIcon } from "./Icons";

export default function ConnectVaultClient({ initial }: { initial: VaultConnectionResponse }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setState(initial);
  }, [initial]);

  async function save(next: VaultConnectionResponse) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${getClientApiBaseUrl()}/api/vault/connection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Unable to save vault connection");
      }
      setState(await response.json());
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save vault connection");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${getClientApiBaseUrl()}/api/vault/connection`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Unable to disconnect folder");
      }
      setState(await response.json());
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Unable to disconnect folder");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="connect-page">
      <div className="connect-card">
        <section className="connect-section">
          <p className="vault-eyebrow">CONNECT FOLDER</p>
          <h1>Connect Your Vault</h1>
          <p className="connect-copy">
            Save the local folder path and site URL prefix used for this vault-backed deployment.
          </p>
        </section>

        <section className="connect-section">
          <p className="vault-eyebrow">CONNECT FOLDER</p>
          <button
            type="button"
            className="primary-button connect-action"
            disabled={loading}
            onClick={() => void save({ ...state, connected: true, vaultName: state.vaultName || "My Obsidian Vault" })}
          >
            <FolderIcon width={16} height={16} />
            Connect Local Folder
          </button>
          <p className="connect-helper">This stores local vault path information for the current deployment.</p>
        </section>

        <section className="connect-section">
          <p className="vault-eyebrow">CONNECTED FOLDER</p>
          {state.connected ? (
            <div className="connected-repo-card">
              <div className="connected-repo-main">
                <span className="connected-repo-icon"><CheckIcon width={16} height={16} /></span>
                <div>
                  <p>{state.vaultName || "Connected vault"}</p>
                  <span>{state.folderPath || "Local folder"}</span>
                </div>
              </div>
              <button type="button" className="text-button danger" onClick={() => void disconnect()} disabled={loading}>
                Disconnect
              </button>
            </div>
          ) : (
            <p className="connect-helper">No local folder connected yet.</p>
          )}
        </section>

        <section className="connect-section">
          <p className="vault-eyebrow">VAULT SETTINGS</p>
          <label className="connect-field">
            <span>Vault Name</span>
            <div className="field-shell">
              <FolderIcon width={14} height={14} />
              <input
                className="field-input"
                value={state.vaultName}
                onChange={(event) => setState((current) => ({ ...current, vaultName: event.target.value }))}
                placeholder="My Obsidian Vault"
                disabled={loading}
              />
            </div>
          </label>
          <label className="connect-field">
            <span>Local Folder Path</span>
            <div className="field-shell">
              <FolderIcon width={14} height={14} />
              <input
                className="field-input"
                value={state.folderPath}
                onChange={(event) => setState((current) => ({ ...current, folderPath: event.target.value }))}
                placeholder="/Users/you/Documents/MyVault"
                disabled={loading}
              />
            </div>
          </label>
          <label className="connect-field">
            <span>Site URL Prefix</span>
            <div className="field-shell">
              <GlobeIcon width={14} height={14} />
              <input
                className="field-input"
                value={state.siteUrlPrefix}
                onChange={(event) => setState((current) => ({ ...current, siteUrlPrefix: event.target.value }))}
                placeholder="/notes"
                disabled={loading}
              />
            </div>
          </label>
        </section>

        {error ? <div className="vault-alert vault-alert-error">{error}</div> : null}

        <section className="connect-section">
          <button
            type="button"
            className="primary-button connect-action"
            disabled={loading}
            onClick={async () => {
              const saved = await save({ ...state, connected: true });
              if (saved) {
                router.push("/admin");
              }
            }}
          >
            <ArrowUpRightIcon width={14} height={14} />
            Continue to Note Selection
          </button>
          <button
            type="button"
            className="text-button"
            disabled={loading}
            onClick={() => {
              setError("");
              router.push("/admin");
            }}
          >
            Skip for now
          </button>
        </section>
      </div>
    </div>
  );
}
