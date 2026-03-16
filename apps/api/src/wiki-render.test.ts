import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NoteRegistry } from "./note-registry.js";
import { FilesystemNotesIndex } from "./notes-index.js";

test("rendered note HTML turns wiki links into note links and standalone embeds into embedded note previews", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-wiki-render-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-wiki-render-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");

  fs.mkdirSync(path.join(tempDir, "Section"), { recursive: true });

  fs.writeFileSync(
    path.join(tempDir, "Section", "Source.md"),
    `---
publish: true
---

See [[Ledger]] and [[Section/Ledger|the ledger]].

![[Ledger]]
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Section", "Ledger.md"),
    `---
publish: true
---

## Embedded Ledger

- Row one
`,
  );

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(tempDir, registry);
  const detail = await index.getNoteDetail("section/source", true, true);

  assert.ok(detail?.html);
  assert.match(detail?.html ?? "", /href="\/admin\/section\/ledger"[^>]*>Ledger<\/a>/);
  assert.match(detail?.html ?? "", /href="\/admin\/section\/ledger"[^>]*>the ledger<\/a>/);
  assert.match(detail?.html ?? "", /class="obsidian-note-embed"/);
  assert.match(detail?.html ?? "", /href="\/admin\/section\/ledger"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>Ledger<\/a>/);
  assert.match(detail?.html ?? "", /Embedded Ledger/);
  assert.match(detail?.html ?? "", /Row one/);
});

test("wiki-link rendering skips inline code and fenced code blocks", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-wiki-render-code-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-wiki-render-code-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");

  fs.mkdirSync(path.join(tempDir, "Section"), { recursive: true });

  fs.writeFileSync(
    path.join(tempDir, "Section", "Source.md"),
    `---
publish: true
---

Inline \`[[Ledger]]\`

\`\`\`md
![[Ledger]]
\`\`\`
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Section", "Ledger.md"),
    `---
publish: true
---

Linked note.
`,
  );

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(tempDir, registry);
  const detail = await index.getNoteDetail("section/source", true, true);

  assert.ok(detail?.html);
  assert.match(detail?.html ?? "", /<code>\[\[Ledger\]\]<\/code>/);
  assert.match(detail?.html ?? "", /<pre><code class="language-md">!\[\[Ledger\]\]\n<\/code><\/pre>/);
  assert.doesNotMatch(detail?.html ?? "", /class="obsidian-note-embed"/);
});

test("public note rendering does not expose unpublished wiki-link targets or embeds", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-wiki-render-public-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-wiki-render-public-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");

  fs.mkdirSync(path.join(tempDir, "Section"), { recursive: true });

  fs.writeFileSync(
    path.join(tempDir, "Section", "Source.md"),
    `---
publish: true
---

See [[Ledger]].

![[Ledger]]
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Section", "Ledger.md"),
    `---
publish: false
---

Hidden note.
`,
  );

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(tempDir, registry);
  const detail = await index.getNoteDetail("section/source", false, false);

  assert.ok(detail?.html);
  assert.doesNotMatch(detail?.html ?? "", /href="\/section\/ledger"/);
  assert.match(detail?.html ?? "", /class="obsidian-note-embed obsidian-note-embed-unavailable"/);
  assert.match(detail?.html ?? "", /\[\[Ledger\]\]/);
  assert.match(detail?.html ?? "", /Embedded note unavailable\./);
});
