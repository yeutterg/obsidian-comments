export type NoteVisibility = "public" | "password" | "users" | "private";

export interface NoteAccessControl {
  internalUsers: string[];
  externalEmails: string[];
}

export interface NoteFrontmatter {
  [key: string]: unknown;
  visibility?: NoteVisibility;
  comments?: boolean;
  password?: string;
  editing?: boolean;
}

export interface NoteDisplayField {
  key: string;
  label: string;
  kind: "text" | "tags" | "date";
  value: string | string[];
  href?: string;
}

export interface BacklinkSummary {
  slug: string;
  title: string;
  path: string;
  visibility: NoteVisibility;
}

export interface NoteSummary {
  id: string;
  slug: string;
  title: string;
  path: string;
  visibility: NoteVisibility;
  commentsEnabled: boolean;
  editingEnabled: boolean;
  commentCount: number;
}

export interface NotesListResponse {
  notes: NoteSummary[];
  error?: string | null;
  warnings?: string[];
}

export interface NoteDetailResponse {
  note: NoteSummary;
  authorized: boolean;
  html: string | null;
  markdown: string | null;
  subtitle: string | null;
  frontmatterFields: NoteDisplayField[];
  backlinks: BacklinkSummary[];
  breadcrumbs: string[];
  accessControl?: NoteAccessControl;
}

export interface CommentRecord {
  id: string;
  status: "open" | "resolved";
  approved: boolean;
  authorEmail: string;
  body: string;
  anchorText: string;
  anchorStart: number;
  anchorEnd: number;
  createdAt: string;
  updatedAt: string;
  replies: CommentReplyRecord[];
}

export interface CommentReplyRecord {
  id: string;
  parentCommentId: string;
  approved: boolean;
  authorEmail: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionResponse {
  email: string | null;
  authenticatedSlugs: string[];
  expiresAt: string | null;
}

export interface VaultConnectionResponse {
  connected: boolean;
  vaultName: string;
  folderPath: string;
  siteUrlPrefix: string;
}

export interface SystemCapabilities {
  mode: "filesystem-vault";
  realtime: boolean;
  sync: {
    source: "vault";
    writable: boolean;
  };
}
