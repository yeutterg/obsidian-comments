import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { CommentRecord, CommentReplyRecord } from "@obsidian-comments/shared";

interface CommentRow {
  id: string;
  status: "open" | "resolved";
  approved: number;
  authorEmail: string;
  body: string;
  anchorText: string;
  anchorStart: number;
  anchorEnd: number;
  createdAt: string;
  updatedAt: string;
}

interface ReplyRow {
  id: string;
  parentCommentId: string;
  approved: number;
  authorEmail: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

function toReply(row: ReplyRow): CommentReplyRecord {
  return {
    id: row.id,
    parentCommentId: row.parentCommentId,
    approved: row.approved === 1,
    authorEmail: row.authorEmail,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toComment(row: CommentRow, replies: CommentReplyRecord[]): CommentRecord {
  return {
    id: row.id,
    status: row.status,
    approved: row.approved === 1,
    authorEmail: row.authorEmail,
    body: row.body,
    anchorText: row.anchorText,
    anchorStart: row.anchorStart,
    anchorEnd: row.anchorEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    replies,
  };
}

export class CommentsStore {
  private readonly db: Database.Database;

  constructor(sqlitePath: string) {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    this.db = new Database(sqlitePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS comments (
        note_id TEXT NOT NULL,
        id TEXT NOT NULL,
        status TEXT NOT NULL,
        author_email TEXT NOT NULL,
        body TEXT NOT NULL,
        anchor_text TEXT NOT NULL,
        anchor_start INTEGER NOT NULL,
        anchor_end INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (note_id, id)
      );
      CREATE INDEX IF NOT EXISTS comments_note_id_idx ON comments (note_id);
    `);
    this.ensureColumn("comments", "approved", "INTEGER NOT NULL DEFAULT 1");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS comment_replies (
        note_id TEXT NOT NULL,
        id TEXT NOT NULL,
        parent_comment_id TEXT NOT NULL,
        approved INTEGER NOT NULL DEFAULT 0,
        author_email TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (note_id, id)
      );
      CREATE INDEX IF NOT EXISTS comment_replies_note_id_idx ON comment_replies (note_id);
      CREATE INDEX IF NOT EXISTS comment_replies_parent_idx ON comment_replies (note_id, parent_comment_id);
    `);
  }

  list(noteId: string, includePending = false): CommentRecord[] {
    const commentRows = this.db
      .prepare(`
        SELECT
          id,
          status,
          approved,
          author_email as authorEmail,
          body,
          anchor_text as anchorText,
          anchor_start as anchorStart,
          anchor_end as anchorEnd,
          created_at as createdAt,
          updated_at as updatedAt
        FROM comments
        WHERE note_id = ?
          AND (? = 1 OR approved = 1)
        ORDER BY anchor_start ASC, created_at ASC
      `)
      .all(noteId, includePending ? 1 : 0) as CommentRow[];

    const replyRows = this.db
      .prepare(`
        SELECT
          id,
          parent_comment_id as parentCommentId,
          approved,
          author_email as authorEmail,
          body,
          created_at as createdAt,
          updated_at as updatedAt
        FROM comment_replies
        WHERE note_id = ?
          AND (? = 1 OR approved = 1)
        ORDER BY created_at ASC
      `)
      .all(noteId, includePending ? 1 : 0) as ReplyRow[];

    const repliesByParent = new Map<string, CommentReplyRecord[]>();
    for (const row of replyRows) {
      const list = repliesByParent.get(row.parentCommentId) ?? [];
      list.push(toReply(row));
      repliesByParent.set(row.parentCommentId, list);
    }

    return commentRows.map((row) => toComment(row, repliesByParent.get(row.id) ?? []));
  }

  count(noteId: string, includePending = false): number {
    const commentCount = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM comments
        WHERE note_id = ?
          AND (? = 1 OR approved = 1)
      `)
      .get(noteId, includePending ? 1 : 0) as { count?: number } | undefined;
    const replyCount = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM comment_replies
        WHERE note_id = ?
          AND (? = 1 OR approved = 1)
      `)
      .get(noteId, includePending ? 1 : 0) as { count?: number } | undefined;

    return (commentCount?.count ?? 0) + (replyCount?.count ?? 0);
  }

  add(
    noteId: string,
    input: Omit<CommentRecord, "id" | "status" | "createdAt" | "updatedAt" | "approved" | "replies">,
    approved = false,
  ): CommentRecord {
    const now = new Date().toISOString();
    const id = this.nextId(noteId, now, "CMT");
    this.db
      .prepare(`
        INSERT INTO comments (
          note_id, id, status, approved, author_email, body, anchor_text, anchor_start, anchor_end, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        noteId,
        id,
        "open",
        approved ? 1 : 0,
        input.authorEmail,
        input.body,
        input.anchorText,
        input.anchorStart,
        input.anchorEnd,
        now,
        now,
      );

    return this.find(noteId, id, true) as CommentRecord;
  }

  addReply(
    noteId: string,
    parentCommentId: string,
    input: Omit<CommentReplyRecord, "id" | "parentCommentId" | "createdAt" | "updatedAt" | "approved">,
    approved = false,
  ): CommentReplyRecord | null {
    const existing = this.find(noteId, parentCommentId, true);
    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const id = this.nextId(noteId, now, "RPL");
    this.db
      .prepare(`
        INSERT INTO comment_replies (
          note_id, id, parent_comment_id, approved, author_email, body, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        noteId,
        id,
        parentCommentId,
        approved ? 1 : 0,
        input.authorEmail,
        input.body,
        now,
        now,
      );

    return this.findReply(noteId, id);
  }

  approveComment(noteId: string, id: string): CommentRecord | null {
    const existing = this.find(noteId, id, true);
    if (!existing) {
      return null;
    }

    this.db
      .prepare("UPDATE comments SET approved = 1, updated_at = ? WHERE note_id = ? AND id = ?")
      .run(new Date().toISOString(), noteId, id);

    return this.find(noteId, id, true);
  }

  approveReply(noteId: string, id: string): CommentReplyRecord | null {
    const existing = this.findReply(noteId, id);
    if (!existing) {
      return null;
    }

    this.db
      .prepare("UPDATE comment_replies SET approved = 1, updated_at = ? WHERE note_id = ? AND id = ?")
      .run(new Date().toISOString(), noteId, id);

    return this.findReply(noteId, id);
  }

  updateStatus(noteId: string, id: string, status: "open" | "resolved"): CommentRecord | null {
    const existing = this.find(noteId, id, true);
    if (!existing) {
      return null;
    }

    const updatedAt = new Date().toISOString();
    this.db
      .prepare("UPDATE comments SET status = ?, updated_at = ? WHERE note_id = ? AND id = ?")
      .run(status, updatedAt, noteId, id);

    return this.find(noteId, id, true);
  }

  delete(noteId: string, id: string): boolean {
    this.db
      .prepare("DELETE FROM comment_replies WHERE note_id = ? AND parent_comment_id = ?")
      .run(noteId, id);
    const result = this.db
      .prepare("DELETE FROM comments WHERE note_id = ? AND id = ?")
      .run(noteId, id);
    return result.changes > 0;
  }

  deleteReply(noteId: string, id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM comment_replies WHERE note_id = ? AND id = ?")
      .run(noteId, id);
    return result.changes > 0;
  }

  private find(noteId: string, id: string, includePending: boolean): CommentRecord | null {
    const row = this.db
      .prepare(`
        SELECT
          id,
          status,
          approved,
          author_email as authorEmail,
          body,
          anchor_text as anchorText,
          anchor_start as anchorStart,
          anchor_end as anchorEnd,
          created_at as createdAt,
          updated_at as updatedAt
        FROM comments
        WHERE note_id = ? AND id = ?
      `)
      .get(noteId, id) as CommentRow | undefined;

    if (!row) {
      return null;
    }

    const replies = this.list(noteId, includePending)
      .find((comment) => comment.id === id)?.replies;

    return toComment(row, replies ?? []);
  }

  private findReply(noteId: string, id: string): CommentReplyRecord | null {
    const row = this.db
      .prepare(`
        SELECT
          id,
          parent_comment_id as parentCommentId,
          approved,
          author_email as authorEmail,
          body,
          created_at as createdAt,
          updated_at as updatedAt
        FROM comment_replies
        WHERE note_id = ? AND id = ?
      `)
      .get(noteId, id) as ReplyRow | undefined;

    return row ? toReply(row) : null;
  }

  private nextId(noteId: string, isoDate: string, prefix: "CMT" | "RPL") {
    const date = isoDate.slice(0, 10);
    const pattern = `${prefix}-${date}-%`;
    const row = this.db
      .prepare(`
        SELECT id FROM comments WHERE note_id = ? AND id LIKE ?
        UNION ALL
        SELECT id FROM comment_replies WHERE note_id = ? AND id LIKE ?
        ORDER BY id DESC
        LIMIT 1
      `)
      .get(noteId, pattern, noteId, pattern) as { id?: string } | undefined;
    const nextIndex = row?.id ? Number.parseInt(row.id.slice(-3), 10) + 1 : 1;
    return `${prefix}-${date}-${String(nextIndex).padStart(3, "0")}`;
  }

  private ensureColumn(table: string, name: string, definition: string) {
    const columns = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as { name?: string }[];
    if (columns.some((column) => column.name === name)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}
