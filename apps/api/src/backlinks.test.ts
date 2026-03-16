import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NoteRegistry } from "./note-registry.js";
import { FilesystemNotesIndex } from "./notes-index.js";

test("wiki-link backlinks resolve to the correct file in the same folder and account subtree", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-backlinks-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-backlinks-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");

  fs.mkdirSync(path.join(tempDir, "Account", "contacts"), { recursive: true });
  fs.mkdirSync(path.join(tempDir, "People"), { recursive: true });

  fs.writeFileSync(
    path.join(tempDir, "Account", "Account.md"),
    `---
publish: true
---

![[Ledger]]
[[Alice]]
[[contacts/Bob]]
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Account", "Ledger.md"),
    `---
publish: true
---

Ledger
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Account", "contacts", "Alice.md"),
    `---
publish: true
---

Alice in account
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Account", "contacts", "Bob.md"),
    `---
publish: true
---

Bob in account
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "People", "Alice.md"),
    `---
publish: true
---

Alice globally
`,
  );

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(tempDir, registry);

  const ledgerDetail = await index.getNoteDetail("account/ledger", true, true);
  const accountAliceDetail = await index.getNoteDetail("account/contacts/alice", true, true);
  const globalAliceDetail = await index.getNoteDetail("people/alice", true, true);
  const bobDetail = await index.getNoteDetail("account/contacts/bob", true, true);

  assert.deepEqual(ledgerDetail?.backlinks.map((entry) => entry.slug), ["account/account"]);
  assert.deepEqual(accountAliceDetail?.backlinks.map((entry) => entry.slug), ["account/account"]);
  assert.deepEqual(globalAliceDetail?.backlinks.map((entry) => entry.slug), []);
  assert.deepEqual(bobDetail?.backlinks.map((entry) => entry.slug), ["account/account"]);
});
