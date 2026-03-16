import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NoteRegistry } from "./note-registry.js";
import { FilesystemNotesIndex } from "./notes-index.js";

test("renders inline dataview expressions, dataview tables, base embeds, and asset embeds", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-render-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-render-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");

  fs.mkdirSync(path.join(tempDir, "Companies"), { recursive: true });
  fs.mkdirSync(path.join(tempDir, "Contacts"), { recursive: true });
  fs.mkdirSync(path.join(tempDir, "Meetings"), { recursive: true });

  fs.writeFileSync(
    path.join(tempDir, "Companies", "Acme.md"),
    `---
publish: true
ae: "[[Contacts/Alice]]"
website: https://example.com
---

**AE:** \`= this.ae\`
**Website:** [Company](\`= this.website\`)

## Contacts

\`\`\`dataview
TABLE WITHOUT ID file.link AS Contact, role AS Role
FROM "Contacts"
WHERE company = this.file.link
SORT file.name ASC
\`\`\`

## Meetings

\`\`\`dataview
TABLE WITHOUT ID file.link AS Meeting, date AS Date
WHERE filter(attendees, (a) => a.company = this.file.link)
SORT date DESC
\`\`\`

![[contacts.base]]

- Inline image ![[chart.png]]

![[deck.pdf]]
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Contacts", "Alice.md"),
    `---
publish: true
company: "[[Companies/Acme]]"
role: Engineer
---
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Contacts", "Bob.md"),
    `---
publish: true
company: "[[Companies/Elsewhere]]"
role: Advisor
---
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Meetings", "Kickoff.md"),
    `---
publish: true
date: 2026-03-10
attendees:
  - "[[Contacts/Alice]]"
---
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "contacts.base"),
    `---
type: dataview
query: |
  TABLE WITHOUT ID file.link AS Contact, role AS Role
  FROM "Contacts"
  WHERE company = this.file.link
---
`,
  );

  fs.writeFileSync(path.join(tempDir, "chart.png"), "png");
  fs.writeFileSync(path.join(tempDir, "deck.pdf"), "pdf");

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(tempDir, registry, "http://localhost:4000");
  const detail = await index.getNoteDetail("companies/acme", true, true);

  assert.ok(detail?.html);
  assert.deepEqual(
    detail?.frontmatterFields.find((field) => field.key === "ae"),
    {
      key: "ae",
      label: "Ae",
      kind: "text",
      value: "Alice",
      href: "/admin/contacts/alice",
    },
  );
  assert.match(detail?.html ?? "", /obsidian-inline-query/);
  assert.match(detail?.html ?? "", /href="\/admin\/contacts\/alice"[^>]*>Alice<\/a>/);
  assert.match(detail?.html ?? "", /href="https:\/\/example\.com"[^>]*>Company<\/a>/);
  assert.match(detail?.html ?? "", /obsidian-dataview-table/);
  assert.match(detail?.html ?? "", /Engineer/);
  assert.match(detail?.html ?? "", /Kickoff/);
  assert.match(detail?.html ?? "", /Inline image/);
  assert.match(detail?.html ?? "", /api\/asset\?slug=companies%2Facme&ref=chart\.png&admin=1/);
  assert.match(detail?.html ?? "", /obsidian-pdf-embed/);
});

test("renders dataview task queries from matching notes", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-render-tasks-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-render-tasks-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");

  fs.mkdirSync(path.join(tempDir, "Account"), { recursive: true });

  fs.writeFileSync(
    path.join(tempDir, "Account", "Overview.md"),
    `---
publish: true
---

\`\`\`dataview
TASK
FROM "Account"
WHERE !completed
\`\`\`
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Account", "Notes.md"),
    `---
publish: true
---

- [ ] Open follow-up
- [x] Closed item
`,
  );

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(tempDir, registry, "http://localhost:4000");
  const detail = await index.getNoteDetail("account/overview", true, true);

  assert.ok(detail?.html);
  assert.match(detail?.html ?? "", /obsidian-task-query/);
  assert.match(detail?.html ?? "", /Open follow-up/);
  assert.doesNotMatch(detail?.html ?? "", /Closed item/);
});

test("renders dataview list queries as linked note lists", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-render-list-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-render-list-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");

  fs.mkdirSync(path.join(tempDir, "Account", "contacts"), { recursive: true });
  fs.mkdirSync(path.join(tempDir, "Account", "meetings"), { recursive: true });

  fs.writeFileSync(
    path.join(tempDir, "Account", "contacts", "Alice.md"),
    `---
publish: true
---

\`\`\`dataview
LIST
FROM "Account/meetings"
WHERE contains(attendees, this.file.link)
SORT date DESC
\`\`\`
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Account", "meetings", "Kickoff.md"),
    `---
publish: true
date: 2026-03-10
attendees:
  - "[[Account/contacts/Alice]]"
---
`,
  );

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(tempDir, registry, "http://localhost:4000");
  const detail = await index.getNoteDetail("account/contacts/alice", true, true);

  assert.ok(detail?.html);
  assert.match(detail?.html ?? "", /class="obsidian-query-block obsidian-dataview-list"/);
  assert.match(detail?.html ?? "", /href="\/admin\/account\/meetings\/kickoff"[^>]*>Kickoff<\/a>/);
});

test("renders Tasks plugin blocks grouped by note path", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-render-tasks-plugin-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-render-tasks-plugin-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");

  fs.mkdirSync(path.join(tempDir, "Daily"), { recursive: true });

  fs.writeFileSync(
    path.join(tempDir, "Daily", "All Tasks.md"),
    `---
publish: true
---

\`\`\`tasks
not done
group by path
\`\`\`
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Daily", "Notes.md"),
    `---
publish: true
---

- [ ] Open follow-up
- [x] Closed item
`,
  );

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(tempDir, registry, "http://localhost:4000");
  const detail = await index.getNoteDetail("daily/all-tasks", true, true);

  assert.ok(detail?.html);
  assert.match(detail?.html ?? "", /obsidian-task-query-group/);
  assert.match(detail?.html ?? "", /Daily\/Notes/);
  assert.match(detail?.html ?? "", /Open follow-up/);
  assert.doesNotMatch(detail?.html ?? "", /Closed item/);
});

test("renders local markdown images and missing attachment placeholders", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-render-local-assets-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-render-local-assets-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");

  fs.mkdirSync(path.join(tempDir, "Guides", "attachments"), { recursive: true });

  fs.writeFileSync(
    path.join(tempDir, "Guides", "How To.md"),
    `---
publish: true
owner: "[[Guides/Reference]]"
---

![Screenshot](attachments/example.png)

![[missing.png]]
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Guides", "Reference.md"),
    `---
publish: true
---
`,
  );

  fs.writeFileSync(path.join(tempDir, "Guides", "attachments", "example.png"), "png");

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(tempDir, registry, "http://localhost:4000");
  const detail = await index.getNoteDetail("guides/how-to", true, true);

  assert.ok(detail?.html);
  assert.match(detail?.html ?? "", /src="http:\/\/localhost:4000\/api\/asset\?slug=guides%2Fhow-to(?:&|&#x26;)ref=attachments%2Fexample\.png(?:&|&#x26;)admin=1"/);
  assert.match(detail?.html ?? "", /obsidian-missing-embed/);
  assert.match(detail?.html ?? "", /Missing attachment/);
  assert.deepEqual(
    detail?.frontmatterFields.find((field) => field.key === "owner"),
    {
      key: "owner",
      label: "Owner",
      kind: "text",
      value: "Reference",
      href: "/admin/guides/reference",
    },
  );
});

test("renders Obsidian Bases YAML table views with filters and formulas", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-render-bases-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-render-bases-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");

  fs.mkdirSync(path.join(tempDir, "Account", "contacts"), { recursive: true });
  fs.mkdirSync(path.join(tempDir, "Account", "meetings"), { recursive: true });

  fs.writeFileSync(
    path.join(tempDir, "Account", "Acme.md"),
    `---
publish: true
---

![[contacts.base]]
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Account", "contacts", "Alice.md"),
    `---
publish: true
role: Engineer
---
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Account", "meetings", "Kickoff.md"),
    `---
publish: true
attendees:
  - "[[Account/contacts/Alice]]"
---
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "Account", "contacts.base"),
    `properties:
  file.name:
    displayName: Contact
    link: true
  role:
    displayName: Role
  _meetingCount:
    displayName: Mtgs
    formula: 'length(filter(pages(replace(file.folder, "contacts", "meetings")), (p) => contains(p.attendees, file.link)))'
views:
  - type: table
    name: Contacts
    order:
      - file.name
      - role
      - _meetingCount
    filters:
      and:
        - file.inFolder(this.file.folder + "/contacts")
`,
  );

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(tempDir, registry, "http://localhost:4000");
  const detail = await index.getNoteDetail("account/acme", true, true);

  assert.ok(detail?.html);
  assert.match(detail?.html ?? "", /obsidian-base-table/);
  assert.match(detail?.html ?? "", />Alice<\/a>/);
  assert.match(detail?.html ?? "", /Engineer/);
  assert.match(detail?.html ?? "", />1<\/td>/);
});
