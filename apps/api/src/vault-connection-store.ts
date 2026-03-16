import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { VaultConnectionResponse } from "@obsidian-comments/shared";

const DEFAULT_CONNECTION: VaultConnectionResponse = {
  connected: false,
  vaultName: "",
  folderPath: "",
  siteUrlPrefix: "",
};

export class VaultConnectionStore {
  private readonly db: Database.Database;

  constructor(sqlitePath: string) {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    this.db = new Database(sqlitePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vault_connection (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        connected INTEGER NOT NULL,
        repository_name TEXT NOT NULL,
        branch TEXT NOT NULL,
        vault_root TEXT NOT NULL,
        site_url_prefix TEXT NOT NULL
      )
    `);
    this.db
      .prepare(`
        INSERT INTO vault_connection (id, connected, repository_name, branch, vault_root, site_url_prefix)
        VALUES (1, 0, '', 'main', '', '')
        ON CONFLICT(id) DO NOTHING
      `)
      .run();
  }

  get(): VaultConnectionResponse {
    const row = this.db
      .prepare(`
        SELECT
          connected,
          repository_name as vaultName,
          vault_root as folderPath,
          site_url_prefix as siteUrlPrefix
        FROM vault_connection
        WHERE id = 1
      `)
      .get() as {
        connected?: number;
        vaultName?: string;
        folderPath?: string;
        siteUrlPrefix?: string;
      } | undefined;

    if (!row) {
      return DEFAULT_CONNECTION;
    }

    return {
      connected: row.connected === 1,
      vaultName: row.vaultName ?? "",
      folderPath: row.folderPath ?? "",
      siteUrlPrefix: row.siteUrlPrefix ?? "",
    };
  }

  save(input: {
    connected: boolean;
    vaultName: string;
    folderPath: string;
    siteUrlPrefix: string;
  }) {
    this.db
      .prepare(`
        UPDATE vault_connection
        SET
          connected = ?,
          repository_name = ?,
          branch = ?,
          vault_root = ?,
          site_url_prefix = ?
        WHERE id = 1
      `)
      .run(
        input.connected ? 1 : 0,
        input.vaultName,
        "local",
        input.folderPath,
        input.siteUrlPrefix,
      );
    return this.get();
  }

  disconnect() {
    return this.save(DEFAULT_CONNECTION);
  }
}
