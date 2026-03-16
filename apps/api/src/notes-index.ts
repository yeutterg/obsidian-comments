import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import type {
  BacklinkSummary,
  NoteDetailResponse,
  NoteDisplayField,
  NoteFrontmatter,
  NoteSummary,
} from "@obsidian-comments/shared";
import type { NotesIndexStatus, NotesRepository, PublishedNote } from "./contracts.js";
import { renderMarkdown } from "./markdown.js";
import { NoteRegistry } from "./note-registry.js";
import { replaceSelectionInMarkdown } from "./text-selection.js";

interface CachedNote extends PublishedNote {
  frontmatter: Record<string, unknown>;
  references: string[];
  tasks: ParsedTask[];
  absolutePath: string;
  mtimeMs: number;
}

interface CachedAsset {
  path: string;
  absolutePath: string;
  mtimeMs: number;
}

interface ParsedTask {
  text: string;
  completed: boolean;
}

interface QueryLinkValue {
  kind: "note-link";
  slug: string;
  label: string;
}

type QueryValue =
  | string
  | number
  | boolean
  | null
  | Date
  | QueryLinkValue
  | QueryValue[]
  | { [key: string]: QueryValue };

interface QueryContext {
  adminMode: boolean;
  sourceNote: CachedNote;
  rowNote?: CachedNote;
  scope?: Record<string, QueryValue>;
  notesByBasename: Map<string, CachedNote[]>;
}

interface DataviewColumn {
  expression: string;
  label: string;
}

interface ParsedDataviewQuery {
  kind: "table" | "task" | "list";
  columns: DataviewColumn[];
  listExpression: string | null;
  from: string | null;
  where: string | null;
  sort: {
    expression: string;
    direction: "asc" | "desc";
  } | null;
  limit: number | null;
}

const CONTROL_FRONTMATTER_KEYS = new Set([
  "publish",
  "visibility",
  "comments",
  "password",
  "editing",
]);

function isFilesystemAccessError(error: unknown) {
  return error instanceof Error
    && "code" in error
    && (error.code === "EACCES" || error.code === "EPERM");
}

class VaultAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultAccessError";
  }
}

function walkVaultFiles(
  rootDir: string,
  currentDir: string,
  warnings: string[],
): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch (error) {
    const relativeDir = currentDir === rootDir ? "." : path.relative(rootDir, currentDir);
    if (currentDir === rootDir) {
      const message = isFilesystemAccessError(error)
        ? `Vault directory is not readable: ${rootDir}. Grant terminal/full-disk access or choose a different local vault path.`
        : `Unable to read vault directory: ${rootDir}`;
      throw new VaultAccessError(message);
    }

    warnings.push(
      `Skipped unreadable folder: ${relativeDir}${isFilesystemAccessError(error) ? " (permission denied)" : ""}`,
    );
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkVaultFiles(rootDir, fullPath, warnings));
      continue;
    }

    if (entry.isFile() && !entry.name.endsWith(".comments.md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizeSlug(relativePath: string) {
  return relativePath
    .replace(/\.md$/i, "")
    .split(path.sep)
    .map((part) => part.toLowerCase().replace(/\s+/g, "-"))
    .join("/");
}

function hashContent(content: string) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizeVisibility(value: NoteFrontmatter["visibility"]) {
  return value === "password" ? "password" : "public";
}

function normalizePassword(value: NoteFrontmatter["password"]) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function formatFieldLabel(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (value) => value.toUpperCase());
}

function canExposeNote(note: CachedNote, adminMode: boolean) {
  return adminMode || (note.published && note.visibility === "public");
}

function normalizeFieldValue(
  key: string,
  value: unknown,
  options?: {
    adminMode?: boolean;
    sourceNote?: CachedNote;
    notesBySlug?: Map<string, CachedNote>;
    notesByBasename?: Map<string, CachedNote[]>;
  },
): NoteDisplayField | null {
  if (CONTROL_FRONTMATTER_KEYS.has(key) || key === "subtitle" || value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    const tags = value
      .map((item) => typeof item === "string" ? item.trim() : String(item))
      .filter(Boolean);
    if (tags.length === 0) {
      return null;
    }
    return {
      key,
      label: formatFieldLabel(key),
      kind: "tags",
      value: tags,
    };
  }

  if (value instanceof Date) {
    return {
      key,
      label: formatFieldLabel(key),
      kind: "date",
      value: value.toISOString().slice(0, 10),
    };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsedWikiLink = trimmed.startsWith("[[") && trimmed.endsWith("]]")
      ? parseWikiLink(trimmed.slice(2, -2))
      : null;
    if (parsedWikiLink) {
      const targetSlug = options?.sourceNote && options?.notesBySlug && options?.notesByBasename
        ? normalizeWikiLinkTarget(
            parsedWikiLink.targetPath,
            options.sourceNote.path,
            options.notesBySlug,
            options.notesByBasename,
          )
        : null;
      const targetNote = targetSlug && options?.notesBySlug
        ? options.notesBySlug.get(targetSlug) ?? null
        : null;

      return {
        key,
        label: formatFieldLabel(key),
        kind: "text",
        value: parsedWikiLink.displayText,
        href: targetNote && canExposeNote(targetNote, options?.adminMode === true)
          ? buildNoteHref(targetNote.slug, options?.adminMode === true)
          : undefined,
      };
    }

    const kind = key.toLowerCase() === "date" ? "date" : "text";
    return {
      key,
      label: formatFieldLabel(key),
      kind,
      value: trimmed,
      href: /^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)
        ? trimmed
        : undefined,
    };
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return {
      key,
      label: formatFieldLabel(key),
      kind: "text",
      value: String(value),
    };
  }

  return null;
}

function extractPresentation(
  frontmatter: NoteFrontmatter,
  options?: Parameters<typeof normalizeFieldValue>[2],
) {
  const subtitle = typeof frontmatter.subtitle === "string" && frontmatter.subtitle.trim()
    ? frontmatter.subtitle.trim()
    : null;
  const fields = Object.entries(frontmatter)
    .map(([key, value]) => normalizeFieldValue(key, value, options))
    .filter((field): field is NoteDisplayField => field !== null)
    .sort((a, b) => {
      const order = ["tags", "author", "date", "status"];
      const aIndex = order.indexOf(a.key);
      const bIndex = order.indexOf(b.key);
      const normalizedAIndex = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
      const normalizedBIndex = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
      return normalizedAIndex - normalizedBIndex || a.label.localeCompare(b.label);
    });
  return { subtitle, fields };
}

function toBreadcrumbs(relativePath: string) {
  return relativePath
    .replace(/\.md$/i, "")
    .split(path.sep)
    .filter(Boolean);
}

function buildNoteHref(slug: string, adminMode: boolean) {
  const encoded = slug
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${adminMode ? "/admin" : ""}/${encoded}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toPosixRelativePath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

interface ParsedWikiLink {
  targetPath: string;
  alias: string | null;
  fragment: string | null;
  displayText: string;
}

function parseWikiLink(input: string): ParsedWikiLink | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const pipeIndex = trimmed.indexOf("|");
  const targetWithFragment = pipeIndex >= 0 ? trimmed.slice(0, pipeIndex).trim() : trimmed;
  const alias = pipeIndex >= 0 ? trimmed.slice(pipeIndex + 1).trim() || null : null;
  const hashIndex = targetWithFragment.indexOf("#");
  const targetPath = (hashIndex >= 0 ? targetWithFragment.slice(0, hashIndex) : targetWithFragment).trim();
  const fragment = hashIndex >= 0 ? targetWithFragment.slice(hashIndex + 1).trim() || null : null;

  if (!targetPath) {
    return null;
  }

  const normalizedTargetPath = targetPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const extension = path.posix.extname(normalizedTargetPath);
  const baseName = path.posix.basename(normalizedTargetPath, extension);

  return {
    targetPath: normalizedTargetPath,
    alias,
    fragment,
    displayText: alias ?? baseName,
  };
}

function buildNotesByBasename(notesBySlug: Map<string, CachedNote>) {
  const notesByBasename = new Map<string, CachedNote[]>();
  for (const note of notesBySlug.values()) {
    const basename = path.basename(note.path, ".md").toLowerCase();
    const existing = notesByBasename.get(basename);
    if (existing) {
      existing.push(note);
    } else {
      notesByBasename.set(basename, [note]);
    }
  }
  return notesByBasename;
}

function buildAssetsByBasename(assetsByPath: Map<string, CachedAsset>) {
  const assetsByBasename = new Map<string, CachedAsset[]>();
  for (const asset of assetsByPath.values()) {
    const basename = path.posix.basename(asset.path).toLowerCase();
    const existing = assetsByBasename.get(basename);
    if (existing) {
      existing.push(asset);
    } else {
      assetsByBasename.set(basename, [asset]);
    }
  }
  return assetsByBasename;
}

function normalizeVaultRelativePath(sourcePath: string, targetPath: string) {
  const normalizedTarget = targetPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedTarget) {
    return null;
  }

  if (!targetPath.startsWith("/")) {
    const sourceDir = path.posix.dirname(toPosixRelativePath(sourcePath));
    const joined = path.posix.normalize(path.posix.join(sourceDir === "." ? "" : sourceDir, normalizedTarget));
    if (!joined.startsWith("../") && joined !== "..") {
      return joined;
    }
  }

  const normalized = path.posix.normalize(normalizedTarget);
  if (normalized.startsWith("../") || normalized === "..") {
    return null;
  }

  return normalized;
}

function normalizeAssetLookupKey(relativePath: string) {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

function resolveAssetTarget(
  targetPath: string,
  sourcePath: string,
  assetsByPath: Map<string, CachedAsset>,
  assetsByBasename: Map<string, CachedAsset[]>,
) {
  if (!targetPath) {
    return null;
  }

  const normalizedTarget = targetPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const directPath = normalizeAssetLookupKey(normalizedTarget);
  if (assetsByPath.has(directPath)) {
    return assetsByPath.get(directPath) ?? null;
  }

  const relativeCandidate = normalizeVaultRelativePath(sourcePath, targetPath);
  if (relativeCandidate) {
    const relativeKey = normalizeAssetLookupKey(relativeCandidate);
    if (assetsByPath.has(relativeKey)) {
      return assetsByPath.get(relativeKey) ?? null;
    }
  }

  if (normalizedTarget.includes("/")) {
    const suffixMatches = [...assetsByPath.values()].filter((asset) => asset.path.toLowerCase().endsWith(`/${directPath}`) || asset.path.toLowerCase() === directPath);
    if (suffixMatches.length === 1) {
      return suffixMatches[0] ?? null;
    }
  }

  const basename = path.posix.basename(normalizedTarget).toLowerCase();
  const basenameCandidates = assetsByBasename.get(basename) ?? [];
  if (basenameCandidates.length === 0) {
    return null;
  }
  if (basenameCandidates.length === 1) {
    return basenameCandidates[0] ?? null;
  }

  const sourceDir = path.posix.dirname(toPosixRelativePath(sourcePath));
  const sourceDirNormalized = sourceDir === "." ? "" : sourceDir;
  const sameDirectoryCandidate = basenameCandidates.find((candidate) => {
    const candidateDir = path.posix.dirname(candidate.path);
    return (candidateDir === "." ? "" : candidateDir) === sourceDirNormalized;
  });
  if (sameDirectoryCandidate) {
    return sameDirectoryCandidate;
  }

  const ranked = basenameCandidates
    .map((candidate) => {
      const candidateDir = path.posix.dirname(candidate.path);
      const normalizedCandidateDir = candidateDir === "." ? "" : candidateDir;
      return {
        asset: candidate,
        commonPrefix: commonPathPrefixLength(sourceDirNormalized, normalizedCandidateDir),
        directoryDepthDelta: Math.abs(
          normalizedCandidateDir.split("/").filter(Boolean).length - sourceDirNormalized.split("/").filter(Boolean).length,
        ),
        pathLength: candidate.path.length,
      };
    })
    .sort((left, right) =>
      right.commonPrefix - left.commonPrefix
      || left.directoryDepthDelta - right.directoryDepthDelta
      || left.pathLength - right.pathLength
      || left.asset.path.localeCompare(right.asset.path)
    );

  const [best, second] = ranked;
  if (!best) {
    return null;
  }
  if (!second || best.commonPrefix > second.commonPrefix) {
    return best.asset;
  }

  return null;
}

function buildAssetHref(publicApiBaseUrl: string, slug: string, reference: string, adminMode: boolean) {
  const params = new URLSearchParams({
    slug,
    ref: reference,
  });
  if (adminMode) {
    params.set("admin", "1");
  }

  return `${publicApiBaseUrl.replace(/\/$/, "")}/api/asset?${params.toString()}`;
}

function detectAssetKind(assetPath: string) {
  const extension = path.extname(assetPath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"].includes(extension)) {
    return "image";
  }
  if ([".mp4", ".mov", ".webm", ".m4v"].includes(extension)) {
    return "video";
  }
  if ([".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac"].includes(extension)) {
    return "audio";
  }
  if (extension === ".pdf") {
    return "pdf";
  }
  if (extension === ".base") {
    return "base";
  }
  return "file";
}

function parseTasks(content: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (!match) {
      continue;
    }

    const text = match[2]?.trim();
    if (!text) {
      continue;
    }

    tasks.push({
      text,
      completed: match[1]?.toLowerCase() === "x",
    });
  }
  return tasks;
}

function isQueryLink(value: QueryValue): value is QueryLinkValue {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && "kind" in value
    && value.kind === "note-link"
    && "slug" in value
    && typeof value.slug === "string",
  );
}

function isPlainQueryObject(value: QueryValue): value is { [key: string]: QueryValue } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && !isQueryLink(value) && !(value instanceof Date));
}

function stripOuterParentheses(input: string) {
  let value = input.trim();
  while (value.startsWith("(") && value.endsWith(")")) {
    let depth = 0;
    let balanced = true;
    let inQuote: string | null = null;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (inQuote) {
        if (char === inQuote && value[index - 1] !== "\\") {
          inQuote = null;
        }
        continue;
      }

      if (char === "'" || char === "\"") {
        inQuote = char;
        continue;
      }
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0 && index < value.length - 1) {
          balanced = false;
          break;
        }
      }
    }

    if (!balanced || depth !== 0) {
      break;
    }

    value = value.slice(1, -1).trim();
  }

  return value;
}

function splitTopLevel(input: string, separator: string) {
  const parts: string[] = [];
  let depth = 0;
  let inQuote: string | null = null;
  let start = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inQuote) {
      if (char === inQuote && input[index - 1] !== "\\") {
        inQuote = null;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      inQuote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      continue;
    }

    if (depth === 0 && input.startsWith(separator, index)) {
      parts.push(input.slice(start, index).trim());
      start = index + separator.length;
      index += separator.length - 1;
    }
  }

  parts.push(input.slice(start).trim());
  return parts.filter(Boolean);
}

function parseStringLiteral(input: string) {
  const trimmed = input.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\(["'])/g, "$1");
  }

  return null;
}

function splitTopLevelArgs(input: string) {
  return splitTopLevel(input, ",");
}

function queryValueEquals(left: QueryValue, right: QueryValue): boolean {
  if (isQueryLink(left) && isQueryLink(right)) {
    return left.slug === right.slug;
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((entry, index) => queryValueEquals(entry, right[index] ?? null));
  }
  return left === right;
}

function queryValueTruthy(value: QueryValue): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value instanceof Date) {
    return true;
  }
  if (isQueryLink(value)) {
    return true;
  }
  if (isPlainQueryObject(value)) {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

function replaceOutsideInlineCode(line: string, replaceSegment: (segment: string) => string) {
  let result = "";
  let index = 0;
  let activeDelimiter: string | null = null;

  while (index < line.length) {
    const backtickIndex = line.indexOf("`", index);
    if (backtickIndex === -1) {
      const remainder = line.slice(index);
      result += activeDelimiter ? remainder : replaceSegment(remainder);
      break;
    }

    const segment = line.slice(index, backtickIndex);
    result += activeDelimiter ? segment : replaceSegment(segment);

    let delimiterEnd = backtickIndex;
    while (delimiterEnd < line.length && line[delimiterEnd] === "`") {
      delimiterEnd += 1;
    }

    const delimiter = line.slice(backtickIndex, delimiterEnd);
    result += delimiter;
    index = delimiterEnd;

    if (!activeDelimiter) {
      activeDelimiter = delimiter;
    } else if (delimiter === activeDelimiter) {
      activeDelimiter = null;
    }
  }

  return result;
}

function canCloseFence(line: string, activeFence: string) {
  const match = line.match(/^\s*(`{3,}|~{3,})/);
  if (!match?.[1]) {
    return false;
  }

  return match[1][0] === activeFence[0] && match[1].length >= activeFence.length;
}

function commonPathPrefixLength(left: string, right: string) {
  const leftSegments = left.split("/").filter(Boolean);
  const rightSegments = right.split("/").filter(Boolean);
  let length = 0;

  while (length < leftSegments.length && length < rightSegments.length && leftSegments[length] === rightSegments[length]) {
    length += 1;
  }

  return length;
}

function normalizeWikiLinkTarget(
  targetPath: string,
  sourcePath: string,
  notesBySlug: Map<string, CachedNote>,
  notesByBasename: Map<string, CachedNote[]>,
) {
  if (!targetPath) {
    return null;
  }

  const normalizedTarget = targetPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const withExtension = normalizedTarget.endsWith(".md") ? normalizedTarget : `${normalizedTarget}.md`;
  const directSlug = normalizeSlug(withExtension);

  if (notesBySlug.has(directSlug)) {
    return directSlug;
  }

  const sourceDir = path.posix.dirname(toPosixRelativePath(sourcePath));
  const relativeCandidate = normalizeSlug(path.posix.normalize(path.posix.join(sourceDir === "." ? "" : sourceDir, withExtension)));
  if (notesBySlug.has(relativeCandidate)) {
    return relativeCandidate;
  }

  if (normalizedTarget.includes("/")) {
    const suffixMatches = [...notesBySlug.keys()].filter((slug) => slug === directSlug || slug.endsWith(`/${directSlug}`));
    if (suffixMatches.length === 1) {
      return suffixMatches[0];
    }
  }

  const basename = path.posix.basename(normalizedTarget, ".md").toLowerCase();
  const basenameCandidates = notesByBasename.get(basename) ?? [];
  if (basenameCandidates.length === 0) {
    return null;
  }
  if (basenameCandidates.length === 1) {
    return basenameCandidates[0]?.slug ?? null;
  }

  const sourceDirNormalized = sourceDir === "." ? "" : sourceDir;
  const sameDirectoryCandidate = basenameCandidates.find((candidate) => {
    const candidateDir = path.posix.dirname(toPosixRelativePath(candidate.path).replace(/\.md$/i, ""));
    return (candidateDir === "." ? "" : candidateDir) === sourceDirNormalized;
  });
  if (sameDirectoryCandidate) {
    return sameDirectoryCandidate.slug;
  }

  const ranked = basenameCandidates
    .map((candidate) => {
      const candidatePath = toPosixRelativePath(candidate.path).replace(/\.md$/i, "");
      const candidateDir = path.posix.dirname(candidatePath);
      const normalizedCandidateDir = candidateDir === "." ? "" : candidateDir;
      return {
        slug: candidate.slug,
        commonPrefix: commonPathPrefixLength(sourceDirNormalized, normalizedCandidateDir),
        directoryDepthDelta: Math.abs(
          normalizedCandidateDir.split("/").filter(Boolean).length - sourceDirNormalized.split("/").filter(Boolean).length,
        ),
        pathLength: candidatePath.length,
      };
    })
    .sort((left, right) =>
      right.commonPrefix - left.commonPrefix
      || left.directoryDepthDelta - right.directoryDepthDelta
      || left.pathLength - right.pathLength
      || left.slug.localeCompare(right.slug)
    );

  const [best, second] = ranked;
  if (!best) {
    return null;
  }
  if (!second || best.commonPrefix > second.commonPrefix) {
    return best.slug;
  }

  return null;
}

function extractMarkdownDestination(rawTarget: string) {
  const trimmed = rawTarget.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }

  const withTitleMatch = trimmed.match(/^([^\s]+)\s+(?:"[^"]*"|'[^']*')$/);
  return withTitleMatch?.[1] ?? trimmed;
}

function normalizeMarkdownLinkTarget(target: string, sourcePath: string) {
  const cleaned = extractMarkdownDestination(target)?.split("#")[0]?.split("?")[0]?.trim();
  if (!cleaned || /^https?:\/\//i.test(cleaned) || cleaned.startsWith("mailto:")) {
    return null;
  }

  if (cleaned.startsWith("/")) {
    return normalizeSlug(cleaned.slice(1).endsWith(".md") ? cleaned.slice(1) : `${cleaned.slice(1)}.md`);
  }

  const sourceDir = path.posix.dirname(sourcePath.split(path.sep).join("/"));
  const resolved = path.posix.normalize(path.posix.join(sourceDir, cleaned));
  return normalizeSlug(resolved.endsWith(".md") ? resolved : `${resolved}.md`);
}

function extractReferences(
  note: CachedNote,
  notesBySlug: Map<string, CachedNote>,
  notesByBasename: Map<string, CachedNote[]>,
) {
  const references = new Set<string>();

  for (const match of note.content.matchAll(/\[\[([^[\]]+)\]\]/g)) {
    const parsed = parseWikiLink(match[1] ?? "");
    const normalized = parsed
      ? normalizeWikiLinkTarget(parsed.targetPath, note.path, notesBySlug, notesByBasename)
      : null;
    if (normalized) {
      references.add(normalized);
    }
  }

  for (const match of note.content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const normalized = normalizeMarkdownLinkTarget(match[1] ?? "", note.path);
    if (normalized) {
      references.add(normalized);
    }
  }

  return [...references];
}

function toSummary(note: PublishedNote, commentCount = 0): NoteSummary {
  return {
    id: note.id,
    slug: note.slug,
    title: note.title,
    path: note.path,
    visibility: note.visibility,
    commentsEnabled: note.commentsEnabled,
    editingEnabled: note.editingEnabled,
    published: note.published,
    commentCount,
  };
}

function toBacklinkSummary(note: PublishedNote): BacklinkSummary {
  return {
    slug: note.slug,
    title: note.title,
    path: note.path,
    published: note.published,
  };
}

export class FilesystemNotesIndex implements NotesRepository {
  private cache = new Map<string, CachedNote>();
  private assetsByPath = new Map<string, CachedAsset>();
  private assetsByBasename = new Map<string, CachedAsset[]>();
  private indexSignature = "";
  private warnings: string[] = [];
  private lastError: string | null = null;

  constructor(
    private readonly vaultDir: string,
    private readonly noteRegistry: NoteRegistry,
    private readonly publicApiBaseUrl = "http://localhost:4000",
  ) {}

  async listPublishedNotes(): Promise<NoteSummary[]> {
    this.refreshIfStale();
    return [...this.cache.values()]
      .filter((note) => note.published)
      .map((note) => toSummary(note))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async listAllNotes(): Promise<NoteSummary[]> {
    this.refreshIfStale();
    return [...this.cache.values()]
      .map((note) => toSummary(note))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async getPublishedNoteBySlug(slug: string): Promise<PublishedNote | null> {
    this.refreshIfStale();
    const note = this.cache.get(slug);
    return note?.published ? note : null;
  }

  async getAnyNoteBySlug(slug: string): Promise<PublishedNote | null> {
    this.refreshIfStale();
    return this.cache.get(slug) ?? null;
  }

  async getNoteDetail(
    slug: string,
    authorized: boolean,
    includeUnpublished = false,
  ): Promise<NoteDetailResponse | null> {
    this.refreshIfStale();
    const note = this.cache.get(slug);
    if (!note || (!includeUnpublished && !note.published)) {
      return null;
    }

    const canRead = includeUnpublished || note.visibility === "public" || authorized;
    const backlinks = note.backlinks
      .map((backlinkSlug) => this.cache.get(backlinkSlug))
      .filter((candidate): candidate is CachedNote => candidate !== undefined)
      .filter((candidate) => includeUnpublished || candidate.published)
      .map(toBacklinkSummary);
    const notesByBasename = buildNotesByBasename(this.cache);
    const presentation = extractPresentation(note.frontmatter as NoteFrontmatter, {
      adminMode: includeUnpublished,
      sourceNote: note,
      notesBySlug: this.cache,
      notesByBasename,
    });

    return {
      note: toSummary(note),
      authorized: canRead,
      html: canRead ? await this.renderNoteHtml(note, {
        adminMode: includeUnpublished,
        notesByBasename,
        visited: new Set([note.slug]),
      }) : null,
      markdown: canRead ? note.content : null,
      subtitle: presentation.subtitle,
      frontmatterFields: presentation.fields,
      backlinks,
      breadcrumbs: note.breadcrumbs,
    };
  }

  async updateNoteSettings(input: {
    slug: string;
    publish: boolean;
    visibility: "public" | "password";
    comments: boolean;
    editing: boolean;
    passwordHash?: string;
  }) {
    this.refreshIfStale();
    const note = this.cache.get(input.slug);
    if (!note) {
      return null;
    }

    const raw = fs.readFileSync(note.absolutePath, "utf8");
    const parsed = matter(raw);
    const nextData = { ...(parsed.data as Record<string, unknown>) };
    nextData.publish = input.publish;
    nextData.visibility = input.visibility;
    nextData.comments = input.comments;
    nextData.editing = input.editing;

    if (input.visibility === "password") {
      if (input.passwordHash) {
        nextData.password = input.passwordHash;
      }
    } else {
      delete nextData.password;
    }

    fs.writeFileSync(note.absolutePath, matter.stringify(parsed.content, nextData), "utf8");
    this.indexSignature = "";
    this.refreshIfStale();
    return this.cache.get(input.slug) ?? null;
  }

  async replaceNoteSelection(input: {
    slug: string;
    anchorText: string;
    anchorStart: number;
    anchorEnd: number;
    replacementText: string;
  }) {
    this.refreshIfStale();
    const note = this.cache.get(input.slug);
    if (!note) {
      return null;
    }

    const raw = fs.readFileSync(note.absolutePath, "utf8");
    const parsed = matter(raw);
    const nextContent = replaceSelectionInMarkdown(parsed.content, {
      anchorText: input.anchorText,
      anchorStart: input.anchorStart,
      anchorEnd: input.anchorEnd,
      replacementText: input.replacementText,
    });
    if (nextContent == null) {
      throw new Error("Selected text could not be mapped back to editable markdown.");
    }

    fs.writeFileSync(note.absolutePath, matter.stringify(nextContent, parsed.data), "utf8");
    this.indexSignature = "";
    this.refreshIfStale();
    return this.cache.get(input.slug) ?? null;
  }

  getStatus(): NotesIndexStatus {
    return {
      vaultDir: this.vaultDir,
      noteCount: this.cache.size,
      warnings: [...this.warnings],
      lastError: this.lastError,
    };
  }

  resolveAssetReference(sourceSlug: string, reference: string, includeUnpublished = false) {
    this.refreshIfStale();
    const note = this.cache.get(sourceSlug);
    if (!note || (!includeUnpublished && !note.published)) {
      return null;
    }

    const asset = resolveAssetTarget(reference, note.path, this.assetsByPath, this.assetsByBasename);
    if (!asset) {
      return null;
    }

    return {
      absolutePath: asset.absolutePath,
      path: asset.path,
      kind: detectAssetKind(asset.path),
    };
  }

  private createQueryLinkValue(note: CachedNote): QueryLinkValue {
    return {
      kind: "note-link",
      slug: note.slug,
      label: note.title,
    };
  }

  private normalizeQueryableValue(value: unknown, sourceNote: CachedNote, notesByBasename: Map<string, CachedNote[]>): QueryValue {
    if (value == null) {
      return null;
    }

    if (value instanceof Date) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.normalizeQueryableValue(entry, sourceNote, notesByBasename));
    }

    if (typeof value === "object") {
      const result: Record<string, QueryValue> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.normalizeQueryableValue(entry, sourceNote, notesByBasename);
      }
      return result;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      const parsed = trimmed.startsWith("[[") && trimmed.endsWith("]]")
        ? parseWikiLink(trimmed.slice(2, -2))
        : null;
      const targetSlug = parsed
        ? normalizeWikiLinkTarget(parsed.targetPath, sourceNote.path, this.cache, notesByBasename)
        : null;
      if (targetSlug) {
        const linkedNote = this.cache.get(targetSlug);
        if (linkedNote) {
          return this.createQueryLinkValue(linkedNote);
        }
      }
      return trimmed;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    return String(value);
  }

  private buildQueryNoteObject(note: CachedNote, notesByBasename: Map<string, CachedNote[]>): Record<string, QueryValue> {
    const metadata: Record<string, QueryValue> = {};
    for (const [key, value] of Object.entries(note.frontmatter)) {
      metadata[key] = this.normalizeQueryableValue(value, note, notesByBasename);
    }

    metadata.file = {
      name: note.title,
      folder: path.posix.dirname(toPosixRelativePath(note.path).replace(/\.md$/i, "")).replace(/^\.$/, ""),
      path: toPosixRelativePath(note.path).replace(/\.md$/i, ""),
      ext: "md",
      link: this.createQueryLinkValue(note),
    };
    metadata.completed = false;
    return metadata;
  }

  private getQueryProperty(value: QueryValue, segment: string, context: QueryContext): QueryValue {
    if (value == null) {
      return null;
    }

    if (isQueryLink(value)) {
      const linkedNote = this.cache.get(value.slug);
      if (!linkedNote) {
        return segment === "link" ? value : null;
      }

      if (segment === "link") {
        return value;
      }

      const linkedObject = this.buildQueryNoteObject(linkedNote, context.notesByBasename);
      return linkedObject[segment] ?? null;
    }

    if (Array.isArray(value)) {
      return null;
    }

    if (value instanceof Date) {
      switch (segment) {
        case "year":
          return value.getUTCFullYear();
        case "month":
          return value.getUTCMonth() + 1;
        case "day":
          return value.getUTCDate();
        default:
          return null;
      }
    }

    if (isPlainQueryObject(value)) {
      return value[segment] ?? null;
    }

    return null;
  }

  private resolveQueryIdentifier(identifier: string, context: QueryContext): QueryValue {
    const trimmed = stripOuterParentheses(identifier.trim());
    if (!trimmed) {
      return null;
    }

    const pathSegments = trimmed.split(".").map((segment) => segment.trim()).filter(Boolean);
    if (pathSegments.length === 0) {
      return null;
    }

    const [root, ...rest] = pathSegments;
    let current: QueryValue;
    if (root === "this") {
      current = this.buildQueryNoteObject(context.sourceNote, context.notesByBasename);
    } else if (root === "file" && context.rowNote) {
      current = this.buildQueryNoteObject(context.rowNote, context.notesByBasename).file ?? null;
    } else if (context.scope && root in context.scope) {
      current = context.scope[root] ?? null;
    } else if (context.rowNote) {
      current = this.buildQueryNoteObject(context.rowNote, context.notesByBasename)[root] ?? null;
    } else {
      current = this.buildQueryNoteObject(context.sourceNote, context.notesByBasename)[root] ?? null;
    }

    for (const segment of rest) {
      current = this.getQueryProperty(current, segment, context);
    }

    return current;
  }

  private evaluateQueryFunction(name: string, rawArgs: string[], context: QueryContext): QueryValue {
    const normalizedName = name.toLowerCase();
    if (normalizedName === "length" && rawArgs.length === 1) {
      const value = this.evaluateQueryExpression(rawArgs[0] ?? "", context);
      if (Array.isArray(value) || typeof value === "string") {
        return value.length;
      }
      return 0;
    }

    if (normalizedName === "replace" && rawArgs.length === 3) {
      const value = this.evaluateQueryExpression(rawArgs[0] ?? "", context);
      const search = this.evaluateQueryExpression(rawArgs[1] ?? "", context);
      const replacement = this.evaluateQueryExpression(rawArgs[2] ?? "", context);
      if (typeof value === "string" && typeof search === "string" && typeof replacement === "string") {
        return value.replaceAll(search, replacement);
      }
      return value;
    }

    if (normalizedName === "pages" && rawArgs.length === 1) {
      const source = this.evaluateQueryExpression(rawArgs[0] ?? "", context);
      if (typeof source !== "string") {
        return [];
      }
      return this.getDataviewCandidateNotes(source, context.adminMode)
        .map((note) => this.createQueryLinkValue(note));
    }

    if (normalizedName === "contains" && rawArgs.length === 2) {
      const collection = this.evaluateQueryExpression(rawArgs[0] ?? "", context);
      const candidate = this.evaluateQueryExpression(rawArgs[1] ?? "", context);
      if (Array.isArray(collection)) {
        return collection.some((entry) => queryValueEquals(entry, candidate));
      }
      if (typeof collection === "string") {
        return typeof candidate === "string" && collection.includes(candidate);
      }
      return false;
    }

    if (normalizedName === "filter" && rawArgs.length === 2) {
      const collection = this.evaluateQueryExpression(rawArgs[0] ?? "", context);
      const lambda = rawArgs[1]?.trim() ?? "";
      const lambdaMatch = lambda.match(/^\((\w+)\)\s*=>\s*(.+)$/);
      if (!Array.isArray(collection) || !lambdaMatch) {
        return [];
      }

      const [, variableName, expression] = lambdaMatch;
      return collection.filter((entry) => queryValueTruthy(this.evaluateQueryExpression(expression, {
        ...context,
        scope: {
          ...(context.scope ?? {}),
          [variableName]: entry,
        },
      })));
    }

    return null;
  }

  private evaluateQueryMethod(target: QueryValue, name: string, rawArgs: string[], context: QueryContext): QueryValue {
    const normalizedName = name.toLowerCase();
    if (normalizedName === "infolder" && rawArgs.length === 1 && isPlainQueryObject(target)) {
      const folder = this.evaluateQueryExpression(rawArgs[0] ?? "", context);
      const targetPath = target.path;
      if (typeof folder !== "string" || typeof targetPath !== "string") {
        return false;
      }
      return targetPath === folder || targetPath.startsWith(`${folder}/`);
    }

    return null;
  }

  private evaluateQueryExpression(expression: string, context: QueryContext): QueryValue {
    const trimmed = stripOuterParentheses(expression.trim());
    if (!trimmed) {
      return null;
    }

    const andParts = splitTopLevel(trimmed, " AND ");
    if (andParts.length > 1) {
      return andParts.every((part) => queryValueTruthy(this.evaluateQueryExpression(part, context)));
    }

    if (trimmed.startsWith("!")) {
      return !queryValueTruthy(this.evaluateQueryExpression(trimmed.slice(1), context));
    }

    const additionParts = splitTopLevel(trimmed, " + ");
    if (additionParts.length > 1) {
      const values = additionParts.map((part) => this.evaluateQueryExpression(part, context));
      if (values.every((value) => typeof value === "number")) {
        return values.reduce((sum, value) => sum + Number(value), 0);
      }
      return values.map((value) => {
        if (isQueryLink(value)) {
          return value.label;
        }
        if (value == null) {
          return "";
        }
        if (value instanceof Date) {
          return value.toISOString().slice(0, 10);
        }
        return String(value);
      }).join("");
    }

    for (const operator of ["!=", ">=", "<=", "=", ">", "<"]) {
      const parts = splitTopLevel(trimmed, ` ${operator} `);
      if (parts.length === 2) {
        const left = this.evaluateQueryExpression(parts[0] ?? "", context);
        const right = this.evaluateQueryExpression(parts[1] ?? "", context);
        switch (operator) {
          case "=":
            return queryValueEquals(left, right);
          case "!=":
            return !queryValueEquals(left, right);
          case ">":
            return String(left ?? "") > String(right ?? "");
          case "<":
            return String(left ?? "") < String(right ?? "");
          case ">=":
            return String(left ?? "") >= String(right ?? "");
          case "<=":
            return String(left ?? "") <= String(right ?? "");
        }
      }
    }

    const stringLiteral = parseStringLiteral(trimmed);
    if (stringLiteral != null) {
      return stringLiteral;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
    if (trimmed === "null") {
      return null;
    }

    const methodMatch = trimmed.match(/^(.+)\.([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/);
    if (methodMatch) {
      const target = this.evaluateQueryExpression(methodMatch[1] ?? "", context);
      return this.evaluateQueryMethod(target, methodMatch[2] ?? "", splitTopLevelArgs(methodMatch[3] ?? ""), context);
    }

    const functionMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/);
    if (functionMatch) {
      return this.evaluateQueryFunction(functionMatch[1] ?? "", splitTopLevelArgs(functionMatch[2] ?? ""), context);
    }

    return this.resolveQueryIdentifier(trimmed, context);
  }

  private renderQueryValueHtml(value: QueryValue, adminMode: boolean): string {
    if (value == null) {
      return "";
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.renderQueryValueHtml(entry, adminMode)).filter(Boolean).join(", ");
    }

    if (isQueryLink(value)) {
      const href = buildNoteHref(value.slug, adminMode);
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(value.label)}</a>`;
    }

    if (value instanceof Date) {
      return escapeHtml(value.toISOString().slice(0, 10));
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
        return `<a href="${escapeHtml(trimmed)}" target="_blank" rel="noopener noreferrer">${escapeHtml(trimmed)}</a>`;
      }
      return escapeHtml(trimmed);
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return escapeHtml(String(value));
    }

    if (isPlainQueryObject(value)) {
      return escapeHtml(JSON.stringify(value));
    }

    return escapeHtml(String(value));
  }

  private parseDataviewQuery(query: string): ParsedDataviewQuery | null {
    const lines = query
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return null;
    }

    const header = lines[0] ?? "";
    const tableMatch = header.match(/^TABLE(?:\s+WITHOUT\s+ID)?\s+(.+)$/i);
    const listMatch = header.match(/^LIST(?:\s+(.+))?$/i);
    const taskMatch = header.match(/^TASK\b/i);
    if (!tableMatch && !taskMatch && !listMatch) {
      return null;
    }

    const columns = tableMatch
      ? splitTopLevel(tableMatch[1] ?? "", ",").map((entry) => {
          const aliasMatch = entry.match(/^(.*?)\s+AS\s+(.+)$/i);
          const expression = (aliasMatch?.[1] ?? entry).trim();
          const rawLabel = (aliasMatch?.[2] ?? expression).trim();
          const label = parseStringLiteral(rawLabel) ?? rawLabel;
          return {
            expression,
            label,
          };
        })
      : [];
    const listExpression = listMatch?.[1]?.trim() ? listMatch[1].trim() : "file.link";

    let from: string | null = null;
    let where: string | null = null;
    let sort: ParsedDataviewQuery["sort"] = null;
    let limit: number | null = null;

    for (const line of lines.slice(1)) {
      if (/^FROM\s+/i.test(line)) {
        const raw = line.replace(/^FROM\s+/i, "").trim();
        from = parseStringLiteral(raw) ?? raw;
      } else if (/^WHERE\s+/i.test(line)) {
        where = line.replace(/^WHERE\s+/i, "").trim();
      } else if (/^SORT\s+/i.test(line)) {
        const match = line.match(/^SORT\s+(.+?)(?:\s+(ASC|DESC))?$/i);
        if (match?.[1]) {
          sort = {
            expression: match[1].trim(),
            direction: (match[2]?.toLowerCase() === "desc" ? "desc" : "asc"),
          };
        }
      } else if (/^LIMIT\s+/i.test(line)) {
        const raw = Number(line.replace(/^LIMIT\s+/i, "").trim());
        limit = Number.isFinite(raw) ? raw : null;
      }
    }

    return {
      kind: taskMatch ? "task" : listMatch ? "list" : "table",
      columns,
      listExpression,
      from,
      where,
      sort,
      limit,
    };
  }

  private getDataviewCandidateNotes(from: string | null, adminMode: boolean) {
    const allNotes = [...this.cache.values()].filter((note) => adminMode || (note.published && note.visibility === "public"));
    if (!from) {
      return allNotes;
    }

    const normalizedFrom = from.replace(/^\/+/, "").replace(/\\/g, "/").replace(/\.md$/i, "");
    return allNotes.filter((note) => {
      const notePath = toPosixRelativePath(note.path).replace(/\.md$/i, "");
      return notePath === normalizedFrom || notePath.startsWith(`${normalizedFrom}/`);
    });
  }

  private renderDataviewQueryHtml(
    sourceNote: CachedNote,
    query: string,
    adminMode: boolean,
    notesByBasename: Map<string, CachedNote[]>,
  ) {
    const parsed = this.parseDataviewQuery(query);
    if (!parsed) {
      return null;
    }

    if (parsed.kind === "task") {
      let tasks = this.getDataviewCandidateNotes(parsed.from, adminMode).flatMap((note) => note.tasks.map((task) => ({ note, task })));
      if (parsed.where) {
        tasks = tasks.filter(({ note, task }) => queryValueTruthy(this.evaluateQueryExpression(parsed.where ?? "", {
          adminMode,
          sourceNote,
          rowNote: note,
          notesByBasename,
          scope: {
            completed: task.completed,
            text: task.text,
          },
        })));
      }
      if (parsed.limit != null) {
        tasks = tasks.slice(0, parsed.limit);
      }

      if (tasks.length === 0) {
        return `<section class="obsidian-query-block obsidian-task-query" data-obsidian-generated="true"><p>No tasks found.</p></section>`;
      }

      const items = tasks
        .map(({ note, task }) => {
          const noteHref = buildNoteHref(note.slug, adminMode);
          return [
            `<li class="obsidian-task-query-item">`,
            `<label class="obsidian-task-query-checkbox">`,
            `<input type="checkbox" disabled ${task.completed ? "checked" : ""}>`,
            `<span>${escapeHtml(task.text)}</span>`,
            `</label>`,
            `<a class="obsidian-task-query-source" href="${noteHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(note.title)}</a>`,
            `</li>`,
          ].join("");
        })
        .join("");

      return `<section class="obsidian-query-block obsidian-task-query" data-obsidian-generated="true"><ul class="obsidian-task-query-list">${items}</ul></section>`;
    }

    let rows = this.getDataviewCandidateNotes(parsed.from, adminMode);
    if (parsed.where) {
      rows = rows.filter((rowNote) => queryValueTruthy(this.evaluateQueryExpression(parsed.where ?? "", {
        adminMode,
        sourceNote,
        rowNote,
        notesByBasename,
      })));
    }
    if (parsed.sort) {
      rows.sort((left, right) => {
        const leftValue = this.evaluateQueryExpression(parsed.sort?.expression ?? "", {
          adminMode,
          sourceNote,
          rowNote: left,
          notesByBasename,
        });
        const rightValue = this.evaluateQueryExpression(parsed.sort?.expression ?? "", {
          adminMode,
          sourceNote,
          rowNote: right,
          notesByBasename,
        });
        const leftText = typeof leftValue === "string" ? leftValue : this.renderQueryValueHtml(leftValue, adminMode).replace(/<[^>]+>/g, "");
        const rightText = typeof rightValue === "string" ? rightValue : this.renderQueryValueHtml(rightValue, adminMode).replace(/<[^>]+>/g, "");
        return parsed.sort?.direction === "desc"
          ? rightText.localeCompare(leftText)
          : leftText.localeCompare(rightText);
      });
    }
    if (parsed.limit != null) {
      rows = rows.slice(0, parsed.limit);
    }

    if (parsed.kind === "list") {
      if (rows.length === 0) {
        return `<section class="obsidian-query-block obsidian-dataview-list" data-obsidian-generated="true"><p>No results.</p></section>`;
      }

      const expression = parsed.listExpression ?? "file.link";
      const items = rows
        .map((rowNote) => {
          const value = this.evaluateQueryExpression(expression, {
            adminMode,
            sourceNote,
            rowNote,
            notesByBasename,
          });
          return `<li>${this.renderQueryValueHtml(value, adminMode)}</li>`;
        })
        .join("");

      return `<section class="obsidian-query-block obsidian-dataview-list" data-obsidian-generated="true"><ul>${items}</ul></section>`;
    }

    const columns = parsed.columns.length > 0 ? parsed.columns : [{ expression: "file.link", label: "Note" }];
    const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
    const body = rows.length > 0
      ? rows.map((rowNote) => {
          const cells = columns.map((column) => {
            const value = this.evaluateQueryExpression(column.expression, {
              adminMode,
              sourceNote,
              rowNote,
              notesByBasename,
            });
            return `<td>${this.renderQueryValueHtml(value, adminMode)}</td>`;
          }).join("");
          return `<tr>${cells}</tr>`;
        }).join("")
      : `<tr><td colspan="${columns.length}">No results.</td></tr>`;

    return [
      `<section class="obsidian-query-block obsidian-dataview-table" data-obsidian-generated="true">`,
      `<table>`,
      `<thead><tr>${header}</tr></thead>`,
      `<tbody>${body}</tbody>`,
      `</table>`,
      `</section>`,
    ].join("");
  }

  private renderTasksQueryHtml(adminMode: boolean, query: string) {
    const lines = query
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);

    let includeCompleted: boolean | null = null;
    let groupByPath = false;
    let limit: number | null = null;

    for (const line of lines) {
      if (line === "not done") {
        includeCompleted = false;
      } else if (line === "done") {
        includeCompleted = true;
      } else if (line === "group by path") {
        groupByPath = true;
      } else if (/^limit\s+\d+$/i.test(line)) {
        limit = Number(line.replace(/^limit\s+/i, ""));
      }
    }

    let tasks = [...this.cache.values()]
      .filter((note) => adminMode || (note.published && note.visibility === "public"))
      .sort((left, right) => left.path.localeCompare(right.path))
      .flatMap((note) => note.tasks.map((task) => ({ note, task })));

    if (includeCompleted != null) {
      tasks = tasks.filter(({ task }) => task.completed === includeCompleted);
    }
    if (limit != null) {
      tasks = tasks.slice(0, limit);
    }

    if (tasks.length === 0) {
      return `<section class="obsidian-query-block obsidian-task-query" data-obsidian-generated="true"><p>No tasks found.</p></section>`;
    }

    if (!groupByPath) {
      const items = tasks
        .map(({ note, task }) => {
          const noteHref = buildNoteHref(note.slug, adminMode);
          return [
            `<li class="obsidian-task-query-item">`,
            `<label class="obsidian-task-query-checkbox">`,
            `<input type="checkbox" disabled ${task.completed ? "checked" : ""}>`,
            `<span>${escapeHtml(task.text)}</span>`,
            `</label>`,
            `<a class="obsidian-task-query-source" href="${noteHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(note.title)}</a>`,
            `</li>`,
          ].join("");
        })
        .join("");

      return `<section class="obsidian-query-block obsidian-task-query" data-obsidian-generated="true"><ul class="obsidian-task-query-list">${items}</ul></section>`;
    }

    const groups = new Map<string, Array<{ note: CachedNote; task: ParsedTask }>>();
    for (const entry of tasks) {
      const existing = groups.get(entry.note.slug);
      if (existing) {
        existing.push(entry);
      } else {
        groups.set(entry.note.slug, [entry]);
      }
    }

    const groupedHtml = [...groups.entries()]
      .map(([slug, entries]) => {
        const note = this.cache.get(slug);
        if (!note) {
          return "";
        }

        const noteHref = buildNoteHref(note.slug, adminMode);
        const items = entries
          .map(({ task }) => [
            `<li class="obsidian-task-query-item">`,
            `<label class="obsidian-task-query-checkbox">`,
            `<input type="checkbox" disabled ${task.completed ? "checked" : ""}>`,
            `<span>${escapeHtml(task.text)}</span>`,
            `</label>`,
            `</li>`,
          ].join(""))
          .join("");

        return [
          `<section class="obsidian-task-query-group">`,
          `<div class="obsidian-task-query-group-title"><a href="${noteHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(note.path.replace(/\.md$/i, ""))}</a></div>`,
          `<ul class="obsidian-task-query-list">${items}</ul>`,
          `</section>`,
        ].join("");
      })
      .filter(Boolean)
      .join("");

    return `<section class="obsidian-query-block obsidian-task-query" data-obsidian-generated="true">${groupedHtml}</section>`;
  }

  private evaluateBaseFilters(filters: unknown, context: QueryContext): boolean {
    if (!filters) {
      return true;
    }
    if (typeof filters === "string") {
      return queryValueTruthy(this.evaluateQueryExpression(filters, context));
    }
    if (Array.isArray(filters)) {
      return filters.every((entry) => this.evaluateBaseFilters(entry, context));
    }
    if (typeof filters === "object") {
      const record = filters as Record<string, unknown>;
      if (Array.isArray(record.and)) {
        return record.and.every((entry) => this.evaluateBaseFilters(entry, context));
      }
      if (Array.isArray(record.or)) {
        return record.or.some((entry) => this.evaluateBaseFilters(entry, context));
      }
      if (record.not != null) {
        return !this.evaluateBaseFilters(record.not, context);
      }
    }
    return true;
  }

  private renderBaseQueryHtml(
    sourceNote: CachedNote,
    rawConfig: string,
    adminMode: boolean,
    notesByBasename: Map<string, CachedNote[]>,
    viewName?: string | null,
  ) {
    let data: Record<string, unknown>;
    try {
      data = matter(`---\n${rawConfig}\n---`).data as Record<string, unknown>;
    } catch {
      return null;
    }

    const properties = (data.properties && typeof data.properties === "object")
      ? data.properties as Record<string, Record<string, unknown>>
      : {};
    const views = Array.isArray(data.views) ? data.views as Array<Record<string, unknown>> : [];
    const selectedView = views.find((entry) => {
      if ((entry.type ?? "table") !== "table") {
        return false;
      }
      if (!viewName) {
        return true;
      }
      return typeof entry.name === "string" && entry.name === viewName;
    });
    if (!selectedView) {
      return null;
    }

    const order = Array.isArray(selectedView.order)
      ? selectedView.order.map((entry) => String(entry))
      : Object.keys(properties);
    const columns = order.length > 0 ? order : ["file.name"];

    let rows = [...this.cache.values()].filter((note) => adminMode || (note.published && note.visibility === "public"));
    rows = rows.filter((rowNote) => this.evaluateBaseFilters(selectedView.filters, {
      adminMode,
      sourceNote,
      rowNote,
      notesByBasename,
    }));

    const sortRules = Array.isArray(selectedView.sort) ? selectedView.sort as Array<Record<string, unknown>> : [];
    if (sortRules.length > 0) {
      rows.sort((left, right) => {
        for (const rule of sortRules) {
          const expression = typeof rule.property === "string" ? rule.property : "file.name";
          const direction = String(rule.direction ?? "asc").toLowerCase() === "desc" ? "desc" : "asc";
          const leftValue = this.evaluateQueryExpression(expression, {
            adminMode,
            sourceNote,
            rowNote: left,
            notesByBasename,
          });
          const rightValue = this.evaluateQueryExpression(expression, {
            adminMode,
            sourceNote,
            rowNote: right,
            notesByBasename,
          });
          const leftText = typeof leftValue === "string" ? leftValue : this.renderQueryValueHtml(leftValue, adminMode).replace(/<[^>]+>/g, "");
          const rightText = typeof rightValue === "string" ? rightValue : this.renderQueryValueHtml(rightValue, adminMode).replace(/<[^>]+>/g, "");
          const comparison = leftText.localeCompare(rightText);
          if (comparison !== 0) {
            return direction === "desc" ? -comparison : comparison;
          }
        }
        return 0;
      });
    }

    const header = columns.map((column) => {
      const propertyConfig = properties[column] ?? {};
      const label = typeof propertyConfig.displayName === "string" ? propertyConfig.displayName : column;
      return `<th>${escapeHtml(label)}</th>`;
    }).join("");

    const body = rows.length > 0
      ? rows.map((rowNote) => {
          const cells = columns.map((column) => {
            const propertyConfig = properties[column] ?? {};
            let value = typeof propertyConfig.formula === "string"
              ? this.evaluateQueryExpression(propertyConfig.formula, {
                  adminMode,
                  sourceNote,
                  rowNote,
                  notesByBasename,
                })
              : this.evaluateQueryExpression(column, {
                  adminMode,
                  sourceNote,
                  rowNote,
                  notesByBasename,
                });

            if (propertyConfig.link === true && column === "file.name") {
              value = this.createQueryLinkValue(rowNote);
            }

            return `<td>${this.renderQueryValueHtml(value, adminMode)}</td>`;
          }).join("");
          return `<tr>${cells}</tr>`;
        }).join("")
      : `<tr><td colspan="${columns.length}">No results.</td></tr>`;

    return [
      `<section class="obsidian-query-block obsidian-base-table" data-obsidian-generated="true">`,
      `<table>`,
      `<thead><tr>${header}</tr></thead>`,
      `<tbody>${body}</tbody>`,
      `</table>`,
      `</section>`,
    ].join("");
  }

  private replaceInlineDataviewExpressions(
    line: string,
    sourceNote: CachedNote,
    adminMode: boolean,
    notesByBasename: Map<string, CachedNote[]>,
    tokens: Map<string, string>,
    tokenPrefix: string,
  ) {
    let tokenIndex = tokens.size;
    let nextLine = line.replace(/\[([^\]]+)\]\(`=\s*([^`]+)`\)/g, (match, label, expression) => {
      const value = this.evaluateQueryExpression(expression, {
        adminMode,
        sourceNote,
        rowNote: sourceNote,
        notesByBasename,
      });
      if (typeof value !== "string" || !value.trim()) {
        return label;
      }
      return `[${label}](${value.trim()})`;
    });

    nextLine = nextLine.replace(/`=\s*([^`]+)`/g, (match, expression) => {
      const value = this.evaluateQueryExpression(expression, {
        adminMode,
        sourceNote,
        rowNote: sourceNote,
        notesByBasename,
      });
      const html = `<span class="obsidian-inline-query" data-obsidian-generated="true">${this.renderQueryValueHtml(value, adminMode)}</span>`;
      const token = `${tokenPrefix}_${tokenIndex++}_TOKEN`;
      tokens.set(token, html);
      return token;
    });

    return nextLine;
  }

  private renderMissingInlineAssetHtml(label: string) {
    return `<span class="obsidian-inline-asset obsidian-missing-inline-asset" data-obsidian-generated="true">Missing attachment: ${escapeHtml(label)}</span>`;
  }

  private renderMissingAssetEmbedHtml(label: string) {
    return [
      `<section class="obsidian-asset-embed obsidian-missing-embed" data-obsidian-generated="true">`,
      `<div class="obsidian-asset-embed-header">Missing attachment</div>`,
      `<p>${escapeHtml(label)}</p>`,
      `</section>`,
    ].join("");
  }

  private renderUnavailableNoteEmbedHtml() {
    return [
      `<section class="obsidian-note-embed obsidian-note-embed-unavailable" data-obsidian-generated="true">`,
      `<div class="obsidian-note-embed-header">Embedded note</div>`,
      `<div class="obsidian-note-embed-content"><p>Embedded note unavailable.</p></div>`,
      `</section>`,
    ].join("");
  }

  private renderImageHtml(
    sourceNote: CachedNote,
    parsed: ParsedWikiLink,
    adminMode: boolean,
    inline = false,
  ) {
    const href = buildAssetHref(this.publicApiBaseUrl, sourceNote.slug, parsed.targetPath, adminMode);
    const sizeMatch = parsed.alias?.match(/^(\d+)(?:x(\d+))?$/);
    const alt = sizeMatch ? path.posix.basename(parsed.targetPath) : (parsed.alias || path.posix.basename(parsed.targetPath));
    const width = sizeMatch?.[1] ? ` width="${sizeMatch[1]}"` : "";
    const height = sizeMatch?.[2] ? ` height="${sizeMatch[2]}"` : "";
    const image = `<img src="${href}" alt="${escapeHtml(alt)}"${width}${height}>`;
    if (inline) {
      return `<span class="obsidian-inline-asset" data-obsidian-generated="true">${image}</span>`;
    }
    return `<figure class="obsidian-asset-embed obsidian-image-embed" data-obsidian-generated="true">${image}</figure>`;
  }

  private renderFileLinkHtml(
    sourceNote: CachedNote,
    parsed: ParsedWikiLink,
    adminMode: boolean,
  ) {
    const href = buildAssetHref(this.publicApiBaseUrl, sourceNote.slug, parsed.targetPath, adminMode);
    const label = parsed.alias || path.posix.basename(parsed.targetPath);
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }

  private async renderAssetEmbedHtml(
    sourceNote: CachedNote,
    parsed: ParsedWikiLink,
    adminMode: boolean,
    notesByBasename: Map<string, CachedNote[]>,
    inline = false,
  ) {
    const asset = resolveAssetTarget(parsed.targetPath, sourceNote.path, this.assetsByPath, this.assetsByBasename);
    if (!asset) {
      return null;
    }

    const href = buildAssetHref(this.publicApiBaseUrl, sourceNote.slug, parsed.targetPath, adminMode);
    const assetKind = detectAssetKind(asset.path);
    if (assetKind === "base") {
      try {
        const raw = fs.readFileSync(asset.absolutePath, "utf8");
        const dataviewFile = matter(raw);
        if ((dataviewFile.data as Record<string, unknown>)?.type === "dataview" && typeof dataviewFile.data.query === "string") {
          return this.renderDataviewQueryHtml(sourceNote, dataviewFile.data.query, adminMode, notesByBasename);
        }
        return this.renderBaseQueryHtml(sourceNote, raw, adminMode, notesByBasename, parsed.fragment);
      } catch {
        return null;
      }
    }

    if (assetKind === "image") {
      return this.renderImageHtml(sourceNote, parsed, adminMode, inline);
    }

    if (inline) {
      return this.renderFileLinkHtml(sourceNote, parsed, adminMode);
    }

    if (assetKind === "pdf") {
      const src = `${href}${parsed.fragment ? `#${encodeURIComponent(parsed.fragment)}` : ""}`;
      return [
        `<section class="obsidian-asset-embed obsidian-pdf-embed" data-obsidian-generated="true">`,
        `<div class="obsidian-asset-embed-header"><a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(parsed.displayText)}</a></div>`,
        `<iframe src="${src}" title="${escapeHtml(parsed.displayText)}"></iframe>`,
        `</section>`,
      ].join("");
    }

    if (assetKind === "audio") {
      return [
        `<section class="obsidian-asset-embed obsidian-audio-embed" data-obsidian-generated="true">`,
        `<audio controls src="${href}"></audio>`,
        `</section>`,
      ].join("");
    }

    if (assetKind === "video") {
      return [
        `<section class="obsidian-asset-embed obsidian-video-embed" data-obsidian-generated="true">`,
        `<video controls src="${href}"></video>`,
        `</section>`,
      ].join("");
    }

    return [
      `<section class="obsidian-asset-embed obsidian-file-embed" data-obsidian-generated="true">`,
      `<div class="obsidian-asset-embed-header">${this.renderFileLinkHtml(sourceNote, parsed, adminMode)}</div>`,
      `</section>`,
    ].join("");
  }

  private replaceInlineImageEmbeds(
    line: string,
    sourceNote: CachedNote,
    adminMode: boolean,
    tokens: Map<string, string>,
    tokenPrefix: string,
  ) {
    let tokenIndex = tokens.size;
    return replaceOutsideInlineCode(line, (segment) => segment.replace(/!\[\[([^[\]]+)\]\]/g, (match, rawTarget) => {
      const parsed = parseWikiLink(rawTarget);
      if (!parsed) {
        return match;
      }

      const asset = resolveAssetTarget(parsed.targetPath, sourceNote.path, this.assetsByPath, this.assetsByBasename);
      if (!asset) {
        if (detectAssetKind(parsed.targetPath) !== "image") {
          return match;
        }

        const token = `${tokenPrefix}_${tokenIndex++}_TOKEN`;
        tokens.set(token, this.renderMissingInlineAssetHtml(parsed.displayText));
        return token;
      }

      if (detectAssetKind(asset.path) !== "image") {
        return match;
      }

      const token = `${tokenPrefix}_${tokenIndex++}_TOKEN`;
      tokens.set(token, this.renderImageHtml(sourceNote, parsed, adminMode, true));
      return token;
    }));
  }

  private replaceMarkdownLocalLinks(
    line: string,
    sourceNote: CachedNote,
    adminMode: boolean,
  ) {
    const replaceMarkdownHref = (rawTarget: string) => {
      const target = extractMarkdownDestination(rawTarget);
      if (!target || /^https?:\/\//i.test(target) || /^mailto:/i.test(target) || target.startsWith("#")) {
        return null;
      }

      const extension = path.posix.extname(target.split("#")[0] ?? "").toLowerCase();
      if (!extension || extension === ".md") {
        const targetSlug = normalizeMarkdownLinkTarget(target, sourceNote.path);
        const targetNote = targetSlug ? this.cache.get(targetSlug) ?? null : null;
        if (targetNote && this.canRenderLinkedNote(targetNote, adminMode)) {
          return buildNoteHref(targetNote.slug, adminMode);
        }
      }

      const asset = resolveAssetTarget(target, sourceNote.path, this.assetsByPath, this.assetsByBasename);
      if (asset) {
        return buildAssetHref(this.publicApiBaseUrl, sourceNote.slug, target, adminMode);
      }

      return null;
    };

    let nextLine = replaceOutsideInlineCode(line, (segment) => segment.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, rawTarget) => {
      const href = replaceMarkdownHref(rawTarget);
      if (!href) {
        return match;
      }

      const target = extractMarkdownDestination(rawTarget);
      const asset = target
        ? resolveAssetTarget(target, sourceNote.path, this.assetsByPath, this.assetsByBasename)
        : null;
      if (!asset || detectAssetKind(asset.path) !== "image") {
        return match;
      }

      return `![${alt}](${href})`;
    }));

    nextLine = replaceOutsideInlineCode(nextLine, (segment) => segment.replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, (match, label, rawTarget) => {
      const href = replaceMarkdownHref(rawTarget);
      return href ? `[${label}](${href})` : match;
    }));

    return nextLine;
  }

  private renderBaseBlockHtml(
    sourceNote: CachedNote,
    blockContent: string,
    adminMode: boolean,
    notesByBasename: Map<string, CachedNote[]>,
  ) {
    try {
      const parsed = matter(`---\n${blockContent}\n---`);
      if ((parsed.data as Record<string, unknown>)?.type === "dataview" && typeof parsed.data.query === "string") {
        return this.renderDataviewQueryHtml(sourceNote, parsed.data.query, adminMode, notesByBasename);
      }
    } catch {
      return this.renderBaseQueryHtml(sourceNote, blockContent, adminMode, notesByBasename);
    }

    return this.renderBaseQueryHtml(sourceNote, blockContent, adminMode, notesByBasename);
  }

  private async renderNoteHtml(note: CachedNote, input: {
    adminMode: boolean;
    notesByBasename: Map<string, CachedNote[]>;
    visited: Set<string>;
    depth?: number;
  }) {
    const depth = input.depth ?? 0;
    const lines = note.content.replace(/\r\n?/g, "\n").split("\n");
    const htmlTokens = new Map<string, string>();
    let tokenIndex = 0;
    const transformedLines: string[] = [];

    let index = 0;
    while (index < lines.length) {
      const line = lines[index] ?? "";
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(\w+)?\s*$/);
      if (fenceMatch) {
        const closingFence = fenceMatch[1] ?? "```";
        const language = (fenceMatch[2] ?? "").toLowerCase();
        const blockLines: string[] = [];
        let cursor = index + 1;

        while (cursor < lines.length && !canCloseFence(lines[cursor] ?? "", closingFence)) {
          blockLines.push(lines[cursor] ?? "");
          cursor += 1;
        }

        const blockContent = blockLines.join("\n");
        const renderedBlock = language === "dataview"
          ? this.renderDataviewQueryHtml(note, blockContent, input.adminMode, input.notesByBasename)
          : language === "tasks"
            ? this.renderTasksQueryHtml(input.adminMode, blockContent)
          : language === "base"
            ? this.renderBaseBlockHtml(note, blockContent, input.adminMode, input.notesByBasename)
            : null;

        if (renderedBlock) {
          const token = `OBSIDIAN_BLOCK_${tokenIndex++}_TOKEN`;
          htmlTokens.set(token, renderedBlock);
          transformedLines.push(token);
          index = cursor < lines.length ? cursor + 1 : cursor;
          continue;
        }

        transformedLines.push(line);
        transformedLines.push(...blockLines);
        if (cursor < lines.length) {
          transformedLines.push(lines[cursor] ?? "");
        }
        index = cursor < lines.length ? cursor + 1 : cursor;
        continue;
      }

      let nextLine = this.replaceInlineDataviewExpressions(
        line,
        note,
        input.adminMode,
        input.notesByBasename,
        htmlTokens,
        "OBSIDIAN_INLINE_QUERY",
      );

      const standaloneEmbed = nextLine.match(/^\s*!\[\[([^[\]]+)\]\]\s*$/);
      if (standaloneEmbed) {
        const parsed = parseWikiLink(standaloneEmbed[1] ?? "");
        if (parsed) {
          const targetSlug = normalizeWikiLinkTarget(parsed.targetPath, note.path, this.cache, input.notesByBasename);
          const targetNote = targetSlug ? this.cache.get(targetSlug) ?? null : null;
          let renderedEmbed: string | null = null;

          if (targetNote && this.canRenderLinkedNote(targetNote, input.adminMode)) {
            renderedEmbed = await this.renderNoteEmbedHtml(targetNote, {
              adminMode: input.adminMode,
              notesByBasename: input.notesByBasename,
              visited: input.visited,
              depth,
            });
          } else if (targetNote) {
            renderedEmbed = this.renderUnavailableNoteEmbedHtml();
          } else {
            renderedEmbed = await this.renderAssetEmbedHtml(note, parsed, input.adminMode, input.notesByBasename);
            if (!renderedEmbed) {
              renderedEmbed = this.renderMissingAssetEmbedHtml(parsed.displayText);
            }
          }

          if (renderedEmbed) {
            const token = `OBSIDIAN_EMBED_${tokenIndex++}_TOKEN`;
            htmlTokens.set(token, renderedEmbed);
            transformedLines.push(token);
            index += 1;
            continue;
          }
        }
      }

      nextLine = this.replaceInlineImageEmbeds(
        nextLine,
        note,
        input.adminMode,
        htmlTokens,
        "OBSIDIAN_INLINE_ASSET",
      );
      nextLine = this.replaceMarkdownLocalLinks(
        nextLine,
        note,
        input.adminMode,
      );
      nextLine = this.replaceInlineWikiLinks(nextLine, note, input.adminMode, input.notesByBasename);
      transformedLines.push(nextLine);
      index += 1;
    }

    let html = await renderMarkdown(transformedLines.join("\n"));
    for (const [token, embedHtml] of htmlTokens.entries()) {
      const paragraphToken = `<p>${token}</p>`;
      html = html.includes(paragraphToken)
        ? html.split(paragraphToken).join(embedHtml)
        : html.split(token).join(embedHtml);
    }
    return html;
  }

  private replaceInlineWikiLinks(
    line: string,
    sourceNote: CachedNote,
    adminMode: boolean,
    notesByBasename: Map<string, CachedNote[]>,
  ) {
    return replaceOutsideInlineCode(line, (segment) => segment.replace(/(?<!!)\[\[([^[\]]+)\]\]/g, (match, rawTarget) => {
      const parsed = parseWikiLink(rawTarget);
      if (!parsed) {
        return match;
      }

      const targetSlug = normalizeWikiLinkTarget(parsed.targetPath, sourceNote.path, this.cache, notesByBasename);
      const targetNote = targetSlug ? this.cache.get(targetSlug) ?? null : null;
      if (!targetNote || !this.canRenderLinkedNote(targetNote, adminMode)) {
        return match;
      }

      const label = parsed.displayText.replace(/\]/g, "\\]");
      const href = `${buildNoteHref(targetNote.slug, adminMode)}${parsed.fragment ? `#${encodeURIComponent(parsed.fragment)}` : ""}`;
      return `[${label}](${href})`;
    }));
  }

  private async renderNoteEmbedHtml(note: CachedNote, input: {
    adminMode: boolean;
    notesByBasename: Map<string, CachedNote[]>;
    visited: Set<string>;
    depth: number;
  }) {
    const href = buildNoteHref(note.slug, input.adminMode);
    const escapedTitle = escapeHtml(note.title);
    const escapedSlug = escapeHtml(note.slug);
    if (input.depth >= 4 || input.visited.has(note.slug)) {
      return [
        `<section class="obsidian-note-embed" data-obsidian-embed="note" data-embed-source-slug="${escapedSlug}" data-obsidian-generated="true">`,
        `<div class="obsidian-note-embed-header"><a href="${href}" target="_blank" rel="noopener noreferrer">${escapedTitle}</a></div>`,
        `<div class="obsidian-note-embed-content"><p>Embedded note preview unavailable.</p></div>`,
        `</section>`,
      ].join("");
    }

    const embeddedHtml = await this.renderNoteHtml(note, {
      adminMode: input.adminMode,
      notesByBasename: input.notesByBasename,
      visited: new Set([...input.visited, note.slug]),
      depth: input.depth + 1,
    });

    return [
      `<section class="obsidian-note-embed" data-obsidian-embed="note" data-embed-source-slug="${escapedSlug}" data-obsidian-generated="true">`,
      `<div class="obsidian-note-embed-header"><a href="${href}" target="_blank" rel="noopener noreferrer">${escapedTitle}</a></div>`,
      `<div class="obsidian-note-embed-content">${embeddedHtml}</div>`,
      `</section>`,
    ].join("");
  }

  private canRenderLinkedNote(note: CachedNote, adminMode: boolean) {
    return canExposeNote(note, adminMode);
  }

  private refreshIfStale() {
    if (!fs.existsSync(this.vaultDir)) {
      this.lastError = `Vault directory does not exist: ${this.vaultDir}`;
      return;
    }

    try {
      const warnings: string[] = [];
      const { markdownFiles, allFiles, signature } = this.readFilesSignature(warnings);
      const currentPaths = new Set(markdownFiles.map((file) => path.relative(this.vaultDir, file)));
      if (signature === this.indexSignature && this.cache.size > 0) {
        this.warnings = warnings;
        this.lastError = null;
        return;
      }

      const nextCache = new Map<string, CachedNote>();
      for (const absolutePath of markdownFiles) {
        let stat: fs.Stats;
        let raw: string;
        try {
          stat = fs.statSync(absolutePath);
          raw = fs.readFileSync(absolutePath, "utf8");
        } catch {
          warnings.push(`Skipped unreadable file: ${path.relative(this.vaultDir, absolutePath)}`);
          continue;
        }

        let parsedFrontmatter: NoteFrontmatter;
        let content: string;
        try {
          const parsed = matter(raw);
          parsedFrontmatter = (parsed.data ?? {}) as NoteFrontmatter;
          content = parsed.content;
        } catch (error) {
          warnings.push(`Skipped note with invalid frontmatter: ${path.relative(this.vaultDir, absolutePath)}`);
          console.warn(
            `Skipping note with invalid frontmatter: ${absolutePath}`,
            error instanceof Error ? error.message : error,
          );
          continue;
        }

        const relativePath = path.relative(this.vaultDir, absolutePath);
        const slug = normalizeSlug(relativePath);
        const title = path.basename(absolutePath, ".md");
        const id = this.noteRegistry.resolveId({
          path: relativePath,
          slug,
          title,
          contentHash: hashContent(content),
          currentPaths,
        });
        const presentation = extractPresentation(parsedFrontmatter);

        nextCache.set(slug, {
          id,
          slug,
          title,
          path: relativePath,
          visibility: normalizeVisibility(parsedFrontmatter.visibility),
          commentsEnabled: parsedFrontmatter.comments !== false,
          editingEnabled: parsedFrontmatter.editing === true,
          published: parsedFrontmatter.publish === true,
          commentCount: 0,
          passwordHash: normalizePassword(parsedFrontmatter.password),
          content,
          frontmatter: parsedFrontmatter as Record<string, unknown>,
          references: [],
          tasks: parseTasks(content),
          subtitle: presentation.subtitle,
          frontmatterFields: presentation.fields,
          backlinks: [],
          breadcrumbs: toBreadcrumbs(relativePath),
          absolutePath,
          mtimeMs: stat.mtimeMs,
        });
      }

      for (const note of nextCache.values()) {
        note.backlinks = [];
      }
      const notesByBasename = buildNotesByBasename(nextCache);
      const nextAssetsByPath = new Map<string, CachedAsset>();

      for (const absolutePath of allFiles) {
        if (absolutePath.endsWith(".md") || absolutePath.endsWith(".comments.md")) {
          continue;
        }

        const relativePath = toPosixRelativePath(path.relative(this.vaultDir, absolutePath));
        nextAssetsByPath.set(normalizeAssetLookupKey(relativePath), {
          path: relativePath,
          absolutePath,
          mtimeMs: fs.statSync(absolutePath).mtimeMs,
        });
      }

      for (const note of nextCache.values()) {
        note.references = extractReferences(note, nextCache, notesByBasename);
        for (const referencedSlug of note.references) {
          const target = nextCache.get(referencedSlug);
          if (!target) {
            continue;
          }
          if (!target.backlinks.includes(note.slug)) {
            target.backlinks.push(note.slug);
          }
        }
      }

      this.cache = nextCache;
      this.assetsByPath = nextAssetsByPath;
      this.assetsByBasename = buildAssetsByBasename(nextAssetsByPath);
      this.indexSignature = signature;
      this.warnings = warnings;
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Unable to read vault";
      if (!(error instanceof VaultAccessError)) {
        console.error("Failed to refresh notes index", error);
      }
    }
  }

  private readFilesSignature(warnings: string[]) {
    const files = walkVaultFiles(this.vaultDir, this.vaultDir, warnings).sort();
    const readableFiles = files.filter((file) => {
      try {
        fs.accessSync(file, fs.constants.R_OK);
        return true;
      } catch {
        warnings.push(`Skipped unreadable file: ${path.relative(this.vaultDir, file)}`);
        return false;
      }
    });
    const signature = readableFiles
      .map((file) => {
        const stat = fs.statSync(file);
        return `${path.relative(this.vaultDir, file)}:${stat.mtimeMs}`;
      })
      .sort()
      .join("|");
    return {
      markdownFiles: readableFiles.filter((file) => file.endsWith(".md") && !file.endsWith(".comments.md")),
      allFiles: readableFiles,
      signature,
    };
  }
}
