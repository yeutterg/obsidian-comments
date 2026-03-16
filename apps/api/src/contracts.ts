import type {
  CommentRecord,
  CommentReplyRecord,
  NoteDetailResponse,
  NoteDisplayField,
  NoteSummary,
} from "@obsidian-comments/shared";

export interface PublishedNote extends NoteSummary {
  passwordHash?: string;
  content: string;
  subtitle: string | null;
  frontmatterFields: NoteDisplayField[];
  backlinks: string[];
  breadcrumbs: string[];
}

export interface NotesRepository {
  listPublishedNotes(): Promise<NoteSummary[]>;
  listAllNotes(): Promise<NoteSummary[]>;
  getPublishedNoteBySlug(slug: string): Promise<PublishedNote | null>;
  getAnyNoteBySlug(slug: string): Promise<PublishedNote | null>;
  getNoteDetail(slug: string, authorized: boolean, includeUnpublished?: boolean): Promise<NoteDetailResponse | null>;
  updateNoteSettings(input: {
    slug: string;
    publish: boolean;
    visibility: "public" | "password";
    comments: boolean;
    editing: boolean;
    passwordHash?: string;
  }): Promise<PublishedNote | null>;
  replaceNoteSelection(input: {
    slug: string;
    anchorText: string;
    anchorStart: number;
    anchorEnd: number;
    replacementText: string;
  }): Promise<PublishedNote | null>;
}

export interface CommentsRepository {
  list(noteId: string, includePending?: boolean): CommentRecord[];
  count(noteId: string, includePending?: boolean): number;
  add(
    noteId: string,
    input: Omit<CommentRecord, "id" | "status" | "createdAt" | "updatedAt" | "approved" | "replies">,
    approved?: boolean,
  ): CommentRecord;
  addReply(
    noteId: string,
    parentCommentId: string,
    input: Omit<CommentReplyRecord, "id" | "parentCommentId" | "createdAt" | "updatedAt" | "approved">,
    approved?: boolean,
  ): CommentReplyRecord | null;
  approveComment(noteId: string, id: string): CommentRecord | null;
  approveReply(noteId: string, id: string): CommentReplyRecord | null;
  updateStatus(noteId: string, id: string, status: "open" | "resolved"): CommentRecord | null;
  delete(noteId: string, id: string): boolean;
  deleteReply(noteId: string, id: string): boolean;
}

export interface NotesIndexStatus {
  vaultDir: string;
  noteCount: number;
  warnings: string[];
  lastError: string | null;
}
