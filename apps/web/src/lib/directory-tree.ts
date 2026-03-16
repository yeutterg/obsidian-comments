import type { NoteSummary } from "@obsidian-comments/shared";

export interface DirectoryFolderNode {
  id: string;
  name: string;
  type: "folder";
  children: DirectoryNode[];
}

export interface DirectoryNoteNode {
  id: string;
  name: string;
  type: "note";
  note: NoteSummary;
}

export type DirectoryNode = DirectoryFolderNode | DirectoryNoteNode;

function normalizeSegments(note: NoteSummary): string[] {
  const fromPath = note.path
    .split(/[\\/]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (fromPath.length > 0) {
    return fromPath;
  }

  return note.slug
    .split("/")
    .map((s) => decodeURIComponent(s).trim())
    .filter(Boolean);
}

function folderId(parts: string[]) {
  return `folder:${parts.join("/")}`;
}

export function getNoteHref(slug: string) {
  const encoded = slug
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `/${encoded}`;
}

export function buildDirectoryTree(notes: NoteSummary[]): DirectoryNode[] {
  const root: DirectoryFolderNode = {
    id: "folder:/",
    name: "root",
    type: "folder",
    children: [],
  };

  const folders = new Map<string, DirectoryFolderNode>();
  folders.set(root.id, root);

  for (const note of notes) {
    const segments = normalizeSegments(note);
    const fileName = segments[segments.length - 1] ?? note.title;
    const folderParts = segments.slice(0, -1);

    let current = root;
    const walked: string[] = [];

    for (const folderName of folderParts) {
      walked.push(folderName);
      const id = folderId(walked);
      let folder = folders.get(id);

      if (!folder) {
        folder = {
          id,
          name: folderName,
          type: "folder",
          children: [],
        };
        folders.set(id, folder);
        current.children.push(folder);
      }

      current = folder;
    }

    current.children.push({
      id: `note:${note.id}`,
      name: fileName,
      type: "note",
      note,
    });
  }

  const sortNodes = (nodes: DirectoryNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    for (const node of nodes) {
      if (node.type === "folder") {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(root.children);
  return root.children;
}

export function collectFolderIds(nodes: DirectoryNode[]): string[] {
  const ids: string[] = [];

  const walk = (list: DirectoryNode[]) => {
    for (const node of list) {
      if (node.type === "folder") {
        ids.push(node.id);
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return ids;
}

export function folderNoteCount(node: DirectoryFolderNode): number {
  let count = 0;

  for (const child of node.children) {
    if (child.type === "note") {
      count += 1;
    } else {
      count += folderNoteCount(child);
    }
  }

  return count;
}

export function filterDirectory(nodes: DirectoryNode[], query: string): DirectoryNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return nodes;
  }

  const filtered: DirectoryNode[] = [];

  for (const node of nodes) {
    if (node.type === "note") {
      const haystack = `${node.name} ${node.note.title} ${node.note.path}`.toLowerCase();
      if (haystack.includes(needle)) {
        filtered.push(node);
      }
      continue;
    }

    const nextChildren = filterDirectory(node.children, query);
    const nameMatch = node.name.toLowerCase().includes(needle);

    if (nameMatch || nextChildren.length > 0) {
      filtered.push({ ...node, children: nextChildren });
    }
  }

  return filtered;
}
