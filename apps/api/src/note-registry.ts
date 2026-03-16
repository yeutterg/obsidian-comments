import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

export class NoteRegistry {
  private readonly db: Database.Database;

  constructor(sqlitePath: string) {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    this.db = new Database(sqlitePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS note_registry (
        note_id TEXT PRIMARY KEY,
        note_path TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS note_registry_slug_idx ON note_registry (slug);
    `);
    this.ensureColumn("content_hash", "TEXT");
    this.db.exec("CREATE INDEX IF NOT EXISTS note_registry_content_hash_idx ON note_registry (content_hash);");
  }

  resolveId(input: {
    path: string;
    slug: string;
    title: string;
    contentHash: string;
    currentPaths: Set<string>;
  }): string {
    const now = new Date().toISOString();

    const byPath = this.db
      .prepare("SELECT note_id FROM note_registry WHERE note_path = ?")
      .get(input.path) as { note_id?: string } | undefined;
    if (byPath?.note_id) {
      this.update(byPath.note_id, input.path, input.slug, input.title, input.contentHash, now);
      return byPath.note_id;
    }

    const bySlug = this.db
      .prepare("SELECT note_id FROM note_registry WHERE slug = ? ORDER BY updated_at DESC LIMIT 1")
      .get(input.slug) as { note_id?: string } | undefined;
    if (bySlug?.note_id) {
      this.update(bySlug.note_id, input.path, input.slug, input.title, input.contentHash, now);
      return bySlug.note_id;
    }

    const byContentHash = this.db
      .prepare("SELECT note_id, note_path FROM note_registry WHERE content_hash = ? ORDER BY updated_at DESC")
      .all(input.contentHash) as { note_id?: string; note_path?: string }[];
    const reusableByContentHash = byContentHash.filter(
      (row) => row.note_id && row.note_path && !input.currentPaths.has(row.note_path),
    );
    if (reusableByContentHash.length === 1 && reusableByContentHash[0]?.note_id) {
      const noteId = reusableByContentHash[0].note_id;
      this.update(noteId, input.path, input.slug, input.title, input.contentHash, now);
      return noteId;
    }

    const noteId = crypto.randomUUID();
    this.insert(noteId, input.path, input.slug, input.title, input.contentHash, now);
    return noteId;
  }

  private insert(
    noteId: string,
    notePath: string,
    slug: string,
    title: string,
    contentHash: string,
    now: string,
  ) {
    this.db
      .prepare(`
        INSERT INTO note_registry (note_id, note_path, slug, title, content_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(noteId, notePath, slug, title, contentHash, now, now);
  }

  private update(
    noteId: string,
    notePath: string,
    slug: string,
    title: string,
    contentHash: string,
    now: string,
  ) {
    this.db
      .prepare(`
        INSERT INTO note_registry (note_id, note_path, slug, title, content_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(note_id) DO UPDATE SET
          note_path = excluded.note_path,
          slug = excluded.slug,
          title = excluded.title,
          content_hash = excluded.content_hash,
          updated_at = excluded.updated_at
      `)
      .run(noteId, notePath, slug, title, contentHash, now, now);
  }

  private ensureColumn(name: string, definition: string) {
    const columns = this.db
      .prepare("PRAGMA table_info(note_registry)")
      .all() as { name?: string }[];
    if (columns.some((column) => column.name === name)) {
      return;
    }

    this.db.exec(`ALTER TABLE note_registry ADD COLUMN ${name} ${definition}`);
  }
}
