import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { MultiVaultNotesIndex } from "./notes-index.js";
import { NoteRegistry } from "./note-registry.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("MultiVaultNotesIndex mounts multiple vaults without cross-linking duplicate note names", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commonplace-multi-vault-"));
  tempDirs.push(tempRoot);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "commonplace-multi-vault-state-"));
  tempDirs.push(stateDir);

  const primaryVault = path.join(tempRoot, "Team Vault");
  const secondaryVault = path.join(tempRoot, "Project Vault");
  fs.mkdirSync(primaryVault, { recursive: true });
  fs.mkdirSync(secondaryVault, { recursive: true });

  fs.writeFileSync(path.join(primaryVault, "Shared.md"), "---\npublish: true\n---\nPrimary shared note\n", "utf8");
  fs.writeFileSync(path.join(secondaryVault, "Shared.md"), "---\npublish: true\n---\nSecondary shared note\n", "utf8");
  fs.writeFileSync(path.join(secondaryVault, "Overview.md"), "---\npublish: true\n---\nLink to [[Shared]]\n", "utf8");

  const registry = new NoteRegistry(path.join(stateDir, "registry.sqlite"));
  const index = new MultiVaultNotesIndex([
    { id: "team-vault", name: "Team Vault", dir: primaryVault },
    { id: "project-vault", name: "Project Vault", dir: secondaryVault },
  ], registry, "http://localhost:4000");

  const notes = await index.listAllNotes();
  assert.deepEqual(
    notes.map((note) => note.path),
    [
      "Project Vault/Overview.md",
      "Project Vault/Shared.md",
      "Team Vault/Shared.md",
    ],
  );

  const overview = await index.getNoteDetail("project-vault/overview", true, true);
  assert.ok(overview?.html?.includes('href="/admin/project-vault/shared"'));

  const projectVaultShared = await index.getNoteDetail("project-vault/shared", true, true);
  assert.deepEqual(projectVaultShared?.backlinks.map((backlink) => backlink.slug), ["project-vault/overview"]);

  const primaryShared = await index.getNoteDetail("team-vault/shared", true, true);
  assert.deepEqual(primaryShared?.backlinks, []);
});
