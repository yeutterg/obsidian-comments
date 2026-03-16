import "server-only";
import { headers } from "next/headers";
import type {
  BacklinkSummary,
  CommentRecord,
  NoteDetailResponse,
  NoteDisplayField,
  NotesListResponse,
  NoteSummary,
  SessionResponse,
  VaultConnectionResponse,
} from "@obsidian-comments/shared";
import { getServerApiBaseUrl } from "./api-base";

const FETCH_TIMEOUT_MS = 8_000;

export interface NotesDirectoryData {
  notes: NoteSummary[];
  error: string | null;
  warnings: string[];
}

function withTimeoutSignal() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

function normalizeNoteSummary(input: unknown, index: number): NoteSummary | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const row = input as Record<string, unknown>;
  const slug = typeof row.slug === "string" ? row.slug : "";
  const id = typeof row.id === "string" ? row.id : `fallback-${index}`;
  const title = typeof row.title === "string" && row.title.length > 0 ? row.title : slug || "Untitled";
  const path = typeof row.path === "string" && row.path.length > 0 ? row.path : slug || title;
  const visibility = row.visibility === "password" ? "password" : "public";
  const commentsEnabled = typeof row.commentsEnabled === "boolean" ? row.commentsEnabled : true;
  const editingEnabled = typeof row.editingEnabled === "boolean" ? row.editingEnabled : false;
  const published = typeof row.published === "boolean" ? row.published : true;
  const commentCount = typeof row.commentCount === "number" ? row.commentCount : 0;

  if (!slug) {
    return null;
  }

  return {
    id,
    slug,
    title,
    path,
    visibility,
    commentsEnabled,
    editingEnabled,
    published,
    commentCount,
  };
}

function normalizeFrontmatterFields(input: unknown): NoteDisplayField[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const row = entry as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key : "";
    const label = typeof row.label === "string" ? row.label : key;
    const kind = row.kind === "tags" || row.kind === "date" ? row.kind : "text";
    const href = typeof row.href === "string" && row.href.length > 0 ? row.href : undefined;
    const value = Array.isArray(row.value)
      ? row.value.filter((item): item is string => typeof item === "string")
      : typeof row.value === "string"
        ? row.value
        : "";

    if (!key || !label || (Array.isArray(value) ? value.length === 0 : !value)) {
      return [];
    }

    return [{ key, label, kind, value, href }];
  });
}

function normalizeBacklinks(input: unknown): BacklinkSummary[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const row = entry as Record<string, unknown>;
    const slug = typeof row.slug === "string" ? row.slug : "";
    const title = typeof row.title === "string" ? row.title : slug;
    const path = typeof row.path === "string" ? row.path : slug;
    const published = typeof row.published === "boolean" ? row.published : false;
    if (!slug) {
      return [];
    }
    return [{ slug, title, path, published }];
  });
}

function normalizeNoteDetail(input: unknown): NoteDetailResponse {
  const row = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const note = normalizeNoteSummary(row.note, 0) ?? {
    id: "fallback-0",
    slug: "",
    title: "Untitled",
    path: "",
    visibility: "public",
    commentsEnabled: true,
    editingEnabled: false,
    published: true,
    commentCount: 0,
  };

  return {
    note,
    authorized: row.authorized !== false,
    html: typeof row.html === "string" ? row.html : null,
    markdown: typeof row.markdown === "string" ? row.markdown : null,
    subtitle: typeof row.subtitle === "string" ? row.subtitle : null,
    frontmatterFields: normalizeFrontmatterFields(row.frontmatterFields),
    backlinks: normalizeBacklinks(row.backlinks),
    breadcrumbs: Array.isArray(row.breadcrumbs)
      ? row.breadcrumbs.filter((part): part is string => typeof part === "string" && part.length > 0)
      : [],
  };
}

async function fetchNotesCollection(pathname: string): Promise<NotesDirectoryData> {
  const timeout = withTimeoutSignal();
  try {
    const response = await fetch(`${getServerApiBaseUrl()}${pathname}`, {
      cache: "no-store",
      signal: timeout.signal,
    });

    const raw = await response.json() as NotesListResponse;
    const rows = Array.isArray(raw?.notes)
      ? raw.notes
      : [];
    const notes = rows
      .map((row, index) => normalizeNoteSummary(row, index))
      .filter((row): row is NoteSummary => row !== null);
    const warnings = Array.isArray(raw?.warnings)
      ? raw.warnings.filter((warning): warning is string => typeof warning === "string" && warning.length > 0)
      : [];
    const error = typeof raw?.error === "string" && raw.error.length > 0
      ? raw.error
      : null;

    if (!response.ok) {
      console.error("Failed to fetch notes", { pathname, status: response.status, error, warnings });
    }

    return { notes, error, warnings };
  } catch (error) {
    console.error("Failed to fetch notes", { pathname, error });
    return {
      notes: [],
      error: error instanceof Error ? error.message : "Unable to reach the backend",
      warnings: [],
    };
  } finally {
    timeout.clear();
  }
}

async function fetchNote(pathname: string): Promise<NoteDetailResponse> {
  const incomingHeaders = await headers();
  const response = await fetch(`${getServerApiBaseUrl()}${pathname}`, {
    cache: "no-store",
    headers: {
      cookie: incomingHeaders.get("cookie") ?? "",
    },
  });

  if (response.status === 404) {
    throw new Error("NOT_FOUND");
  }

  if (!response.ok) {
    throw new Error("Failed to fetch note");
  }

  return normalizeNoteDetail(await response.json());
}

export async function fetchNotes(): Promise<NotesDirectoryData> {
  return fetchNotesCollection("/api/notes");
}

export async function fetchAdminNotes(): Promise<NotesDirectoryData> {
  return fetchNotesCollection("/api/admin/notes");
}

export async function fetchNoteDetail(slug: string): Promise<NoteDetailResponse> {
  return fetchNote(`/api/note?slug=${encodeURIComponent(slug)}`);
}

export async function fetchAdminNoteDetail(slug: string): Promise<NoteDetailResponse> {
  return fetchNote(`/api/admin/note?slug=${encodeURIComponent(slug)}`);
}

export async function fetchSession(): Promise<SessionResponse> {
  const incomingHeaders = await headers();
  const response = await fetch(`${getServerApiBaseUrl()}/api/auth`, {
    cache: "no-store",
    headers: {
      cookie: incomingHeaders.get("cookie") ?? ""
    }
  });
  return response.json() as Promise<SessionResponse>;
}

export async function fetchVaultConnection(): Promise<VaultConnectionResponse> {
  const response = await fetch(`${getServerApiBaseUrl()}/api/vault/connection`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to fetch vault connection");
  }
  return response.json() as Promise<VaultConnectionResponse>;
}

export type { NoteDetailResponse, NoteSummary, SessionResponse, CommentRecord, VaultConnectionResponse };
