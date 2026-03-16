import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import type { Server } from "node:http";
import { apiConfig } from "./config.js";
import { CommentsStore } from "./comments-store.js";
import { NoteRegistry } from "./note-registry.js";
import { FilesystemNotesIndex } from "./notes-index.js";
import { readSession, writeSession } from "./session.js";
import type { NoteDetailResponse, NotesListResponse, NoteSummary, SystemCapabilities } from "@obsidian-comments/shared";
import {
  adminNoteContentSchema,
  adminNoteSettingsSchema,
  authRequestSchema,
  createCommentSchema,
  createReplySchema,
  updateCommentSchema,
  vaultConnectionSchema,
} from "./schemas.js";
import { VaultConnectionStore } from "./vault-connection-store.js";

const app = express();
const noteRegistry = new NoteRegistry(apiConfig.sqlitePath);
const notesRepository = new FilesystemNotesIndex(apiConfig.vaultDir, noteRegistry, apiConfig.publicApiBaseUrl);
const commentsStore = new CommentsStore(apiConfig.sqlitePath);
const vaultConnectionStore = new VaultConnectionStore(apiConfig.sqlitePath);
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function notesStatus() {
  return notesRepository.getStatus();
}

function sendNotesRepositoryError(res: express.Response, fallbackMessage: string) {
  const status = notesStatus();
  res.status(503).json({
    error: status.lastError || fallbackMessage,
    warnings: status.warnings,
  });
}

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  entry.count += 1;
  return entry.count <= 20;
}

function noteAccess(slug: string, req: express.Request) {
  const session = readSession(req);
  return session.authenticatedSlugs.includes(slug);
}

function getSlugFromQuery(req: express.Request) {
  const value = req.query.slug;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getAssetReferenceFromQuery(req: express.Request) {
  const value = req.query.ref;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function withCommentCount(note: NoteSummary, includePending = false): NoteSummary {
  return {
    ...note,
    commentCount: commentsStore.count(note.id, includePending),
  };
}

function withCommentCounts(notes: NoteSummary[], includePending = false) {
  return notes.map((note) => withCommentCount(note, includePending));
}

function withDetailCommentCounts(detail: NoteDetailResponse, includePending = false): NoteDetailResponse {
  return {
    ...detail,
    note: withCommentCount(detail.note, includePending),
  };
}

async function loadNoteForComments(slug: string, req: express.Request, adminMode = false) {
  return notesRepository.getNoteDetail(slug, adminMode ? true : noteAccess(slug, req), adminMode);
}

app.use(cors({
  origin: apiConfig.corsOrigin,
  credentials: true
}));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/system/capabilities", (_req, res) => {
  const capabilities: SystemCapabilities = {
    mode: "filesystem-vault",
    realtime: false,
    sync: {
      source: "vault",
      writable: true
    }
  };
  res.json(capabilities);
});

app.get("/api/notes", async (_req, res) => {
  try {
    const response: NotesListResponse = {
      notes: withCommentCounts(await notesRepository.listPublishedNotes()),
      error: notesStatus().lastError,
      warnings: notesStatus().warnings,
    };
    if (response.error) {
      res.status(503).json(response);
      return;
    }
    res.json(response);
  } catch {
    sendNotesRepositoryError(res, "Unable to list notes");
  }
});

app.get("/api/admin/notes", async (_req, res) => {
  try {
    const response: NotesListResponse = {
      notes: withCommentCounts(await notesRepository.listAllNotes(), true),
      error: notesStatus().lastError,
      warnings: notesStatus().warnings,
    };
    if (response.error) {
      res.status(503).json(response);
      return;
    }
    res.json(response);
  } catch {
    sendNotesRepositoryError(res, "Unable to list notes");
  }
});

app.get("/api/note", async (req, res) => {
  const slug = getSlugFromQuery(req);
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  let detail;
  try {
    detail = await notesRepository.getNoteDetail(slug, noteAccess(slug, req), false);
  } catch {
    sendNotesRepositoryError(res, "Unable to load note");
    return;
  }
  if (!detail) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json(withDetailCommentCounts(detail));
});

app.get("/api/admin/note", async (req, res) => {
  const slug = getSlugFromQuery(req);
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  try {
    const detail = await notesRepository.getNoteDetail(slug, true, true);
    if (!detail) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(withDetailCommentCounts(detail, true));
  } catch {
    sendNotesRepositoryError(res, "Unable to load admin note");
  }
});

app.get("/api/asset", async (req, res) => {
  const slug = getSlugFromQuery(req);
  const reference = getAssetReferenceFromQuery(req);
  const adminMode = req.query.admin === "1";
  if (!slug || !reference) {
    res.status(400).json({ error: "Missing asset reference" });
    return;
  }

  try {
    const detail = await notesRepository.getNoteDetail(slug, adminMode ? true : noteAccess(slug, req), adminMode);
    if (!detail) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    if (!detail.authorized) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const asset = notesRepository.resolveAssetReference(slug, reference, adminMode);
    if (!asset) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    res.sendFile(asset.absolutePath);
  } catch {
    sendNotesRepositoryError(res, "Unable to load asset");
  }
});

app.patch("/api/admin/note/settings", async (req, res) => {
  const parsed = adminNoteSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid settings payload" });
    return;
  }

  try {
    const updated = await notesRepository.updateNoteSettings({
      slug: parsed.data.slug,
      publish: parsed.data.publish,
      visibility: parsed.data.visibility,
      comments: parsed.data.comments,
      editing: parsed.data.editing,
      passwordHash: parsed.data.visibility === "password" && parsed.data.password
        ? hashPassword(parsed.data.password)
        : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const detail = await notesRepository.getNoteDetail(parsed.data.slug, true, true);
    res.json(detail ? withDetailCommentCounts(detail, true) : null);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to update note settings" });
  }
});

app.patch("/api/admin/note/content", async (req, res) => {
  const parsed = adminNoteContentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid content payload" });
    return;
  }

  try {
    const updated = await notesRepository.replaceNoteSelection(parsed.data);
    if (!updated) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const detail = await notesRepository.getNoteDetail(parsed.data.slug, true, true);
    res.json(detail ? withDetailCommentCounts(detail, true) : null);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Unable to update note content",
    });
  }
});

app.get("/api/auth", (req, res) => {
  const session = readSession(req);
  res.json(session);
});

app.post("/api/auth", async (req, res) => {
  const parsed = authRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid authentication request" });
    return;
  }
  const { slug, password, email } = parsed.data;

  let note;
  try {
    note = await notesRepository.getPublishedNoteBySlug(slug);
  } catch {
    sendNotesRepositoryError(res, "Unable to load note");
    return;
  }
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  if (note.visibility !== "password") {
    res.status(400).json({ error: "Page is not password protected" });
    return;
  }

  if (!note.passwordHash || hashPassword(password) !== note.passwordHash) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  const session = readSession(req);
  writeSession(res, {
    email,
    authenticatedSlugs: Array.from(new Set([...session.authenticatedSlugs, slug]))
  });

  res.json({ success: true });
});

app.get("/api/comments", async (req, res) => {
  const slug = getSlugFromQuery(req);
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  let detail;
  try {
    detail = await loadNoteForComments(slug, req, false);
  } catch {
    sendNotesRepositoryError(res, "Unable to load note");
    return;
  }
  if (!detail) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  if (!detail.note.commentsEnabled) {
    res.status(403).json({ error: "Comments are disabled" });
    return;
  }

  if (!detail.authorized) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.json({ comments: commentsStore.list(detail.note.id, false) });
});

app.get("/api/admin/comments", async (req, res) => {
  const slug = getSlugFromQuery(req);
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  try {
    const detail = await loadNoteForComments(slug, req, true);
    if (!detail) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    res.json({ comments: commentsStore.list(detail.note.id, true) });
  } catch {
    sendNotesRepositoryError(res, "Unable to load comments");
  }
});

app.post("/api/comments", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Rate limited" });
    return;
  }

  const slug = typeof req.body?.slug === "string" && req.body.slug.length > 0 ? req.body.slug : null;
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  let detail;
  try {
    detail = await loadNoteForComments(slug, req, false);
  } catch {
    sendNotesRepositoryError(res, "Unable to load note");
    return;
  }
  if (!detail) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  if (!detail.note.commentsEnabled) {
    res.status(403).json({ error: "Comments are disabled" });
    return;
  }

  if (!detail.authorized) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid comment payload" });
    return;
  }

  if (parsed.data.honeypot) {
    res.json({ success: true, pendingApproval: true });
    return;
  }

  const comment = commentsStore.add(detail.note.id, {
    authorEmail: parsed.data.authorEmail,
    body: parsed.data.body.replace(/<[^>]*>/g, ""),
    anchorText: parsed.data.anchorText,
    anchorStart: parsed.data.anchorStart,
    anchorEnd: parsed.data.anchorEnd
  }, false);

  res.status(201).json({ comment, pendingApproval: !comment.approved });
});

app.post("/api/admin/comments", async (req, res) => {
  const slug = typeof req.body?.slug === "string" && req.body.slug.length > 0 ? req.body.slug : null;
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid comment payload" });
    return;
  }

  try {
    const detail = await loadNoteForComments(slug, req, true);
    if (!detail) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const comment = commentsStore.add(detail.note.id, {
      authorEmail: parsed.data.authorEmail,
      body: parsed.data.body.replace(/<[^>]*>/g, ""),
      anchorText: parsed.data.anchorText,
      anchorStart: parsed.data.anchorStart,
      anchorEnd: parsed.data.anchorEnd,
    }, true);

    res.status(201).json({ comment, pendingApproval: false });
  } catch {
    sendNotesRepositoryError(res, "Unable to create admin comment");
  }
});

app.post("/api/comments/:commentId/replies", async (req, res) => {
  const slug = typeof req.body?.slug === "string" && req.body.slug.length > 0 ? req.body.slug : null;
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  const parsed = createReplySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid reply payload" });
    return;
  }

  try {
    const detail = await loadNoteForComments(slug, req, false);
    if (!detail) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    if (!detail.note.commentsEnabled) {
      res.status(403).json({ error: "Comments are disabled" });
      return;
    }
    if (!detail.authorized) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (parsed.data.honeypot) {
      res.json({ success: true, pendingApproval: true });
      return;
    }

    const reply = commentsStore.addReply(detail.note.id, req.params.commentId, {
      authorEmail: parsed.data.authorEmail,
      body: parsed.data.body.replace(/<[^>]*>/g, ""),
    }, false);
    if (!reply) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    res.status(201).json({ reply, pendingApproval: !reply.approved });
  } catch {
    sendNotesRepositoryError(res, "Unable to create reply");
  }
});

app.post("/api/admin/comments/:commentId/replies", async (req, res) => {
  const slug = typeof req.body?.slug === "string" && req.body.slug.length > 0 ? req.body.slug : null;
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  const parsed = createReplySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid reply payload" });
    return;
  }

  try {
    const detail = await loadNoteForComments(slug, req, true);
    if (!detail) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const reply = commentsStore.addReply(detail.note.id, req.params.commentId, {
      authorEmail: parsed.data.authorEmail,
      body: parsed.data.body.replace(/<[^>]*>/g, ""),
    }, true);
    if (!reply) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    res.status(201).json({ reply, pendingApproval: false });
  } catch {
    sendNotesRepositoryError(res, "Unable to create admin reply");
  }
});

app.patch("/api/comments/:commentId", async (req, res) => {
  const slug = typeof req.body?.slug === "string" && req.body.slug.length > 0 ? req.body.slug : null;
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  let detail;
  try {
    detail = await loadNoteForComments(slug, req, false);
  } catch {
    sendNotesRepositoryError(res, "Unable to load note");
    return;
  }
  if (!detail) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  if (!detail.note.commentsEnabled) {
    res.status(403).json({ error: "Comments are disabled" });
    return;
  }

  if (!detail.authorized) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = updateCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const comment = commentsStore.updateStatus(detail.note.id, req.params.commentId, parsed.data.status);
  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  res.json({ comment });
});

app.patch("/api/admin/comments/:commentId", async (req, res) => {
  const slug = typeof req.body?.slug === "string" && req.body.slug.length > 0 ? req.body.slug : null;
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  const parsed = updateCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const detail = await loadNoteForComments(slug, req, true);
    if (!detail) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const comment = commentsStore.updateStatus(detail.note.id, req.params.commentId, parsed.data.status);
    if (!comment) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    res.json({ comment });
  } catch {
    sendNotesRepositoryError(res, "Unable to update comment");
  }
});

app.patch("/api/admin/comments/:commentId/approve", async (req, res) => {
  const slug = typeof req.body?.slug === "string" && req.body.slug.length > 0 ? req.body.slug : null;
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  try {
    const detail = await loadNoteForComments(slug, req, true);
    if (!detail) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const comment = commentsStore.approveComment(detail.note.id, req.params.commentId);
    if (!comment) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    res.json({ comment });
  } catch {
    sendNotesRepositoryError(res, "Unable to approve comment");
  }
});

app.patch("/api/admin/comment-replies/:replyId/approve", async (req, res) => {
  const slug = typeof req.body?.slug === "string" && req.body.slug.length > 0 ? req.body.slug : null;
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  try {
    const detail = await loadNoteForComments(slug, req, true);
    if (!detail) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const reply = commentsStore.approveReply(detail.note.id, req.params.replyId);
    if (!reply) {
      res.status(404).json({ error: "Reply not found" });
      return;
    }

    res.json({ reply });
  } catch {
    sendNotesRepositoryError(res, "Unable to approve reply");
  }
});

app.delete("/api/comments/:commentId", async (req, res) => {
  const slug = getSlugFromQuery(req);
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  let detail;
  try {
    detail = await loadNoteForComments(slug, req, false);
  } catch {
    sendNotesRepositoryError(res, "Unable to load note");
    return;
  }
  if (!detail) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  if (!detail.note.commentsEnabled) {
    res.status(403).json({ error: "Comments are disabled" });
    return;
  }

  if (!detail.authorized) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const deleted = commentsStore.delete(detail.note.id, req.params.commentId);
  if (!deleted) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  res.json({ success: true });
});

app.delete("/api/admin/comments/:commentId", async (req, res) => {
  const slug = getSlugFromQuery(req);
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  try {
    const detail = await loadNoteForComments(slug, req, true);
    if (!detail) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const deleted = commentsStore.delete(detail.note.id, req.params.commentId);
    if (!deleted) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    res.json({ success: true });
  } catch {
    sendNotesRepositoryError(res, "Unable to delete comment");
  }
});

app.delete("/api/admin/comment-replies/:replyId", async (req, res) => {
  const slug = getSlugFromQuery(req);
  if (!slug) {
    res.status(400).json({ error: "Missing slug" });
    return;
  }

  try {
    const detail = await loadNoteForComments(slug, req, true);
    if (!detail) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const deleted = commentsStore.deleteReply(detail.note.id, req.params.replyId);
    if (!deleted) {
      res.status(404).json({ error: "Reply not found" });
      return;
    }

    res.json({ success: true });
  } catch {
    sendNotesRepositoryError(res, "Unable to delete reply");
  }
});

app.get("/api/vault/connection", (_req, res) => {
  res.json(vaultConnectionStore.get());
});

app.put("/api/vault/connection", (req, res) => {
  const parsed = vaultConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid vault connection payload" });
    return;
  }

  res.json(vaultConnectionStore.save(parsed.data));
});

app.delete("/api/vault/connection", (_req, res) => {
  res.json(vaultConnectionStore.disconnect());
});

const server = app.listen(apiConfig.port, () => {
  console.log(`API listening on http://localhost:${apiConfig.port}`);
});

attachRealtimeStub(server);

function attachRealtimeStub(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({
      type: "capabilities",
      realtime: false,
      message: "Realtime editing is planned but not implemented in this initial architecture."
    }));
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled API error", error);
  res.status(500).json({
    error: error instanceof Error ? error.message : "Internal server error",
  });
});
