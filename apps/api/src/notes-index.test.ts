import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NoteRegistry } from "./note-registry.js";
import { FilesystemNotesIndex } from "./notes-index.js";

test("FilesystemNotesIndex assigns stable ids across path renames without frontmatter overrides", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-notes-index-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-notes-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");
  const noteOne = path.join(tempDir, "first.md");

  fs.writeFileSync(
    noteOne,
    `---
publish: true
---

Hello world
`
  );

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(tempDir, registry);

  const first = await index.getPublishedNoteBySlug("first");
  assert.ok(first);

  const renamed = path.join(tempDir, "renamed.md");
  fs.renameSync(noteOne, renamed);

  const second = await index.getPublishedNoteBySlug("renamed");
  assert.ok(second);
  assert.equal(second?.id, first?.id);
  assert.equal(second?.path, "renamed.md");
});

test("FilesystemNotesIndex only honors publish, visibility, comments, password, and editing frontmatter", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-notes-index-fields-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-notes-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");
  const notePath = path.join(tempDir, "customized.md");

  fs.writeFileSync(
    notePath,
    `---
title: Ignored Title
slug: ignored-slug
noteId: ignored-note-id
publish: true
visibility: password
comments: false
password: stored-password-hash
editing: true
---

Hello world
`
  );

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(tempDir, registry);

  const note = await index.getPublishedNoteBySlug("customized");
  assert.ok(note);
  assert.equal(note?.slug, "customized");
  assert.equal(note?.title, "customized");
  assert.notEqual(note?.id, "ignored-note-id");
  assert.equal(note?.visibility, "password");
  assert.equal(note?.commentsEnabled, false);
  assert.equal(note?.editingEnabled, true);
  assert.equal(note?.passwordHash, "stored-password-hash");

  const ignoredSlug = await index.getPublishedNoteBySlug("ignored-slug");
  assert.equal(ignoredSlug, null);
});

test("FilesystemNotesIndex defaults to public visibility, comments enabled, and editing disabled", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-notes-index-defaults-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-notes-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");
  const notePath = path.join(tempDir, "plain.md");

  fs.writeFileSync(
    notePath,
    `---
publish: true
---

Hello world
`
  );

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(tempDir, registry);

  const note = await index.getPublishedNoteBySlug("plain");
  assert.ok(note);
  assert.equal(note?.visibility, "public");
  assert.equal(note?.commentsEnabled, true);
  assert.equal(note?.editingEnabled, false);
  assert.equal(note?.passwordHash, undefined);
});

test("FilesystemNotesIndex reports a missing vault without throwing", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-notes-index-missing-"));
  const missingVaultDir = path.join(tempDir, "missing-vault");
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-notes-state-"));
  const sqlitePath = path.join(stateDir, "registry.sqlite");

  const registry = new NoteRegistry(sqlitePath);
  const index = new FilesystemNotesIndex(missingVaultDir, registry);

  const notes = await index.listPublishedNotes();

  assert.deepEqual(notes, []);
  assert.match(index.getStatus().lastError ?? "", /Vault directory does not exist/);
});
