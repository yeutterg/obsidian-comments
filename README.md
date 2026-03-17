# Commonplace

Commonplace is a web interface for Markdown vaults with collaborative comments and editing. Compatible with the core Obsidian Markdown format.

It reads one or more local Markdown vaults from disk, renders notes on the web, stores collaborative state in SQLite, and leaves the source of truth in plain files.

## Current Functionality

- Public directory for published notes
- Admin directory for all notes, including drafts
- Direct admin editing of note Markdown in the browser
- Selection-based editing and anchored comments on note content
- Threaded replies and moderation flows
- Password-protected notes with cookie-backed access
- Obsidian-style `[[wiki links]]`, `![[embeds]]`, and backlinks
- Local asset serving for images, PDFs, audio, video, and file links
- Dataview `TABLE`, `LIST`, and `TASK` query rendering
- Obsidian Bases YAML table rendering
- Tasks plugin fenced-block rendering
- Frontmatter metadata display with clickable URLs and wiki-link references
- Stable internal note IDs even when files move or rename
- Multiple local vaults mounted into one combined directory when configured with `VAULT_DIRS`

## Current Limitations

- No realtime collaborative editing
- No full-text search
- No direct integration with the Obsidian desktop app process
- `/admin` is currently a trusted-operator interface, not a separately authenticated admin surface
- Public comments and replies require approval; admin submissions are auto-approved
- `users` visibility exists in the admin UI as a mock state, but backend persistence and enforcement currently support only `public` and `password`
- The connect-folder screen stores deployment metadata in SQLite, but it does not hot-swap `VAULT_DIR` or `VAULT_DIRS` at runtime

## Frontmatter Contract

Only a small set of frontmatter keys changes application behavior.

### Control Fields

- `publish`
  - Default: `false`
  - Behavior: only literal `true` puts the note in the public directory. Notes without `publish: true` still appear in `/admin`.

- `visibility`
  - Default: `public`
  - Supported runtime values: `public`, `password`
  - UI-only state: `users`
  - Behavior: `password` requires authentication before the note body and comments are available. Any other value currently behaves as `public` in the backend indexer. The admin UI can show `users`, but that state is not yet persisted or enforced by the backend.

- `comments`
  - Default: `true`
  - Behavior: only literal `false` disables comments and comment API access for that note.

- `password`
  - Default: unset
  - Behavior: used only when `visibility: password`. If you set it in frontmatter manually, it should be a SHA-256 hash string. The admin settings UI hashes plaintext before saving.

- `editing`
  - Default: `false`
  - Behavior: stored as note metadata and exposed in the admin settings UI. Today it is not a hard enforcement gate, because admin-mode editing is available regardless of this flag.

### Presentation Fields

- `subtitle`
  Special-cased and shown under the note title when present.

- Any other scalar or array frontmatter key
  Rendered in the note metadata block.

Rendering rules for presentation fields:

- strings render as text unless they match a URL or wiki-link form
- numbers and booleans render as text
- arrays render as tag pills
- `Date` objects and the `date` key render with date formatting
- string values that are `http(s)` or `mailto:` links render as clickable external links
- string values written as `[[Wiki Links]]` render as internal note links when the target resolves
- empty values and `null` are omitted

### Derived, Not Configurable

These are derived from the filesystem and not supported as frontmatter overrides:

- `title`: filename without `.md`
- `slug`: relative vault path without `.md`, lowercased, with spaces converted to `-`
- stable note ID: managed internally through the note registry

Frontmatter keys like `title`, `slug`, and `noteId` are not honored as control overrides.

### Example

```md
---
publish: true
visibility: public
comments: true
editing: false
subtitle: Quarterly review
owner: "[[People/Alice]]"
website: https://example.com
tags:
  - ops
  - q1
date: 2026-03-15
---
```

## Obsidian Compatibility

Commonplace works with an Obsidian-compatible vault because it reads Markdown files and related assets directly from disk.

Supported today:

- wiki links
- note embeds
- local attachment embeds
- backlinks
- frontmatter metadata rendering
- Dataview `TABLE`, `LIST`, and `TASK`
- Obsidian Bases YAML table views
- Tasks plugin fenced blocks

Most Obsidian community plugins are not supported. Commonplace only renders a small set of plugin-driven syntaxes that have explicit implementation in the backend renderer.

Notes with invalid YAML frontmatter are skipped and surfaced as warnings in the API/directory UI.

## Storage Model

Filesystem vault:

- Markdown note bodies
- frontmatter
- folder structure
- local attachments and embed targets

SQLite:

- stable note ID registry
- comments
- replies
- approval status
- session state
- vault connection metadata

## Security Model

- Public note access is controlled per note with `publish` and `visibility`
- Password-protected notes use a signed cookie session after successful password auth
- Public comments and replies are created as unapproved and require admin approval
- Admin endpoints are not currently protected by a separate login system

If you expose Commonplace beyond a trusted environment, protect `/admin` at the network or reverse-proxy layer.

## Repo Layout

```text
apps/
  api/        Express API, vault indexing, auth, SQLite state
  web/        Next.js frontend
packages/
  shared/     Shared TypeScript contracts
infra/
  docker/     Dockerfiles
```

## Running Locally

Install dependencies:

```bash
npm install
```

Start the API:

```bash
npm run dev:api
```

Start the web app:

```bash
npm run dev:web
```

Run checks:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Default local URLs:

- web: `http://localhost:3000`
- api: `http://localhost:4000`

If neither `VAULT_DIRS` nor `VAULT_DIR` is set, the API defaults to the demo content in `apps/web/content`.

## Environment Variables

Frontend:

- `API_BASE_URL`: server-side API base URL used by Next.js
- `NEXT_PUBLIC_API_BASE_URL`: browser-visible API base URL

Backend:

- `PORT`: API port
- `VAULT_DIRS`: optional semicolon-separated list of local vault paths to index together
- `VAULT_DIR`: fallback single local vault path to index
- `STATE_DIR`: persistent directory for SQLite and runtime state
- `PUBLIC_API_BASE_URL`: optional absolute API URL used when rendering asset links
- `CORS_ORIGIN`: allowed frontend origin
- `SESSION_SECRET`: cookie signing secret
- `SESSION_MAX_AGE_DAYS`: session lifetime
- `COOKIE_DOMAIN`: optional cookie domain
- `COOKIE_SAME_SITE`: `lax`, `strict`, or `none`

Example files:

- `apps/api/.env.example`
- `apps/web/.env.example`

## Deployment Notes

The current architecture is a split app:

- `apps/web` can run on Vercel or any Next.js host
- `apps/api` must run somewhere with filesystem access to the vault and persistent `STATE_DIR`

For Docker-style deployment, the important rule is simple:

- mount the real vault into the API runtime
- persist the SQLite/data directory

Example host layout:

```text
/srv/commonplace/
  docker-compose.yml
  .env

/srv/markdown-vault/
  Notes/
  Projects/
  ...
```

Typical mounts:

- `/srv/markdown-vault:/vault`
- Docker volume or host path for `/data`

If you use Obsidian Sync, Syncthing, Dropbox, Git, or another file-sync tool, Commonplace does not talk to that sync layer directly. It only reads the files that exist locally on the machine running the API.

## Connect Folder Screen

The `/connect` flow stores:

- vault name
- local folder path
- site URL prefix

That data is useful for the UI and deployment metadata, but it does not currently reconfigure the live backend indexer. The actual indexed vault set still comes from `VAULT_DIRS` or `VAULT_DIR`.
