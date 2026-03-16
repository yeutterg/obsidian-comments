# Obsidian Comments

Obsidian Comments publishes Markdown notes from an Obsidian-compatible vault and adds a lightweight web comment layer on top.

The current system is intentionally simple:

- note content lives in your vault as normal Markdown files
- published notes are selected with frontmatter
- comments live in SQLite, not in the vault
- the frontend is a Next.js app
- the backend is an Express API that reads the vault from disk

This repo is designed for a split deployment:

- `apps/web`: frontend, suitable for Vercel
- `apps/api`: backend, suitable for Docker on a VPS, homelab, or any machine that can access the vault

## What It Does

- lists published notes from a vault directory
- renders note content in the browser
- supports password-protected notes
- lets readers create anchored comments on note content
- lets authorized viewers resolve, reopen, and delete comments
- keeps stable internal note IDs even if note paths change

## What It Does Not Do

- realtime collaborative editing
- full-text search
- direct Obsidian CLI integration
- direct integration with the Obsidian app process

This app works with an Obsidian vault because it reads the vault format from disk. Obsidian itself is just one editor for that vault.

## How Notes Are Selected

Any Markdown file in the configured vault directory can be published by adding frontmatter like this:

```md
---
publish: true
visibility: public
comments: true
---
```

Supported frontmatter fields:

- `publish`: if `true`, include the note in the published list
- `visibility`: `public` or `password`
- `comments`: if `false`, disables comments for that note
- `password`: SHA-256 hash used for protected notes
- `editing`: if `true`, marks the note as editable; defaults to `false`

Derived automatically from the file system:

- `title`: the filename without `.md`
- `slug`: the relative vault path without `.md`, lowercased, with spaces converted to `-`

## Storage Model

Vault filesystem:

- note content
- frontmatter
- folder structure

SQLite:

- comment records
- internal note ID registry

This is deliberate. It keeps note content transparent and editable in Obsidian while putting comment state in a store that handles updates more safely.

## Repo Layout

```text
apps/
  api/        Express API, vault indexing, auth, SQLite comments
  web/        Next.js frontend
packages/
  shared/     Shared TypeScript contracts
infra/
  docker/     Dockerfiles
```

## Running Locally Without Docker

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

Default URLs:

- web: `http://localhost:3000`
- api: `http://localhost:4000`

## Environment Variables

Frontend:

- `API_BASE_URL`: server-side API URL used by Next.js
- `NEXT_PUBLIC_API_BASE_URL`: browser-visible API URL

Backend:

- `PORT`: API port
- `VAULT_DIR`: path to the vault or published-notes directory
- `STATE_DIR`: persistent directory for SQLite and app state
- `CORS_ORIGIN`: allowed frontend origin
- `SESSION_SECRET`: cookie signing secret
- `SESSION_MAX_AGE_DAYS`: session lifetime
- `COOKIE_DOMAIN`: optional cookie domain
- `COOKIE_SAME_SITE`: `lax`, `strict`, or `none`

Example files:

- `apps/api/.env.example`
- `apps/web/.env.example`

## Docker Setup

The recommended production path is to run `apps/api` in Docker on a machine that has access to the vault directory.

### Quick Start With Compose

From the repo root:

```bash
docker compose up --build
```

This starts:

- API on port `4000`
- web app on port `3000`

The current compose file mounts the example content folder:

```yaml
- ./apps/web/content:/vault
```

That is only for local demo use.

### Point Docker At A Real Vault

Replace the example bind mount in `docker-compose.yml` with a real path on the host machine:

```yaml
services:
  api:
    volumes:
      - /absolute/path/to/your/ObsidianVault:/vault
      - api-data:/data
```

The important rule is:

- the vault must exist on the Docker host
- the API container must be able to read it
- if you want comments/auth state to persist, `/data` must also be persistent

### Recommended Docker Host Layout

Example:

```text
/srv/obsidian-comments/
  docker-compose.yml
  .env

/srv/obsidian-vault/
  Notes/
  Projects/
  ...
```

Then mount:

- `/srv/obsidian-vault:/vault`
- Docker volume or host path for `/data`

## Using This With Obsidian Sync

Obsidian Sync is not something this app talks to directly. The correct mental model is:

1. Obsidian Sync keeps a vault directory in sync across your devices.
2. This app reads that same vault directory from disk.

That means the clean setup is:

- pick one machine to run the API
- make sure that machine has a local copy of the vault
- let Obsidian Sync keep that local vault updated
- mount that local vault into the API container

### First-Time Setup If You Are Starting From Docker

If you are setting this up from scratch, you may need to create the local synced vault on the machine before Docker can mount it.

Typical first-time flow:

1. Install Obsidian on the machine that will run the API.
2. Sign in to your Obsidian account in the Obsidian app.
3. Create or open the vault you want to use.
4. Enable Obsidian Sync for that vault.
5. Wait for the vault contents to finish downloading to the local filesystem.
6. Identify the actual local path of that vault on disk.
7. Use that local path as the bind mount source in `docker-compose.yml`.

Until that vault exists locally on disk, Docker has nothing real to mount into the API container.

### Practical Obsidian Sync Setup

If you already use Obsidian Sync:

1. Install Obsidian on the machine that will host the API.
2. Open the synced vault in Obsidian on that machine.
3. Wait until the vault is fully synced locally.
4. Mount that local vault path into the API container as `/vault`.

In other words, Obsidian Sync runs outside the app. The app just reads the synced files that now exist on disk.

### Important Operational Note

Do not assume the API can access a vault that only exists on your laptop if the API is running somewhere else.

If the backend is on a VPS, then one of these must be true:

- the vault is also present on that VPS
- the vault is mirrored to that VPS
- you mount network storage there

The API always needs filesystem access to the vault it is reading.

## Vercel Setup

The frontend is suitable for Vercel. The backend is not, because it needs:

- filesystem access to the vault
- persistent SQLite state
- a stable runtime for cookies and stateful app behavior

### Recommended Deployment Split

- deploy `apps/web` to Vercel
- deploy `apps/api` to Docker on a VPS, homelab server, or similar

### Vercel Project Setup

In Vercel:

1. Create a new project from this repo.
2. Set the root directory to `apps/web`.
3. Leave the framework as Next.js.
4. Set these environment variables:

```bash
API_BASE_URL=https://your-api-domain.example.com
NEXT_PUBLIC_API_BASE_URL=https://your-api-domain.example.com
```

`API_BASE_URL` is used by server-side Next.js fetches.

`NEXT_PUBLIC_API_BASE_URL` is used by browser-side requests from the UI.

### Backend Requirements For Vercel Frontend

Your API deployment must:

- be reachable over HTTPS
- allow the Vercel frontend origin in `CORS_ORIGIN`
- use a strong `SESSION_SECRET`
- have persistent `/data`
- have access to the vault directory

### Cookie / Domain Notes

If the frontend and backend are on different domains, default cookie behavior may be good enough for development but needs care in production.

Typical options:

- frontend: `https://notes.example.com`
- backend: `https://api.example.com`

Then consider:

- `CORS_ORIGIN=https://notes.example.com`
- `COOKIE_DOMAIN=.example.com` if you want broader cookie sharing
- `COOKIE_SAME_SITE=none` if your browser/cookie setup requires cross-site cookies

Be aware that `SameSite=None` also requires secure cookies over HTTPS.

If you keep frontend and backend under the same parent domain, auth tends to be simpler.

## Production Advice

If you want the simplest dependable setup:

- run the API in Docker on a machine that also has the vault on disk
- use Obsidian Sync or another mechanism to keep that vault current on that machine
- put the frontend on Vercel

That gives you:

- a fast stateless frontend
- a stateful backend with vault access
- a clean separation between note content and comment state

## Current Capabilities

- published note listing
- note rendering from Markdown
- password-protected notes
- anchored comments
- comment resolve / reopen / delete
- stable note IDs across path changes

## Future Extensions

The current code leaves room for future additions such as:

- richer auth and permissions
- activity feeds and moderation
- background vault sync/indexing
- export/import helpers
- search
- collaborative editing

But today the repo is specifically a vault-backed note publishing and commenting system, not a full remote editor.
