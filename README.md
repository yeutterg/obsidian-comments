# Commonplace

Publish Obsidian Markdown vaults as browsable, commentable websites with access control.

Commonplace reads one or more local Markdown vaults from disk, renders notes on the web, and provides a collaboration layer: inline commenting, text selection toolbars, bulk sharing controls, and per-note access management. The source of truth stays in plain `.md` files.

## Features

### Vault Management
- Multi-vault support: connect multiple local vault directories via `VAULT_DIRS`
- Vault selector page when multiple vaults are configured
- Hierarchical folder/note directory with search and status pills

### Note Rendering
- Full Obsidian Markdown compatibility: `[[wiki links]]`, `![[embeds]]`, backlinks
- Dataview `TABLE`, `LIST`, and `TASK` query rendering
- Obsidian Bases YAML table views and Tasks plugin blocks
- Frontmatter metadata display with tag pills, date formatting, and clickable links
- Local asset serving for images, PDFs, audio, and video
- Stable note IDs across file renames and moves

### Collaboration
- Inline text selection toolbar (edit, comment, copy) with permission-aware icons
- Anchored comments with highlighted passages and threaded replies
- Comment moderation: public submissions require approval, admin submissions auto-approved
- Sort comments by document order, newest, or oldest
- Anti-spam: rate limiting (20/min per IP) and honeypot fields

### Access Control
- Google OAuth via NextAuth v5 for admin and guest authentication
- Admin role determined by `ADMIN_EMAIL` environment variable
- Per-note visibility: Public, Password-protected, or User-restricted
- Password-protected notes use bcrypt hashing with session cookies
- User allowlists stored in SQLite, enforced per note
- Bulk sharing: select multiple notes from the directory and apply settings at once

### Design
- Light and dark mode with system preference detection
- Responsive: desktop sidebar panels, mobile bottom drawers
- Newsreader serif for display/body, Inter for UI chrome
- Translucent frosted glass selection toolbar

## Architecture

```
apps/
  api/        Express API server, vault indexing, SQLite state
  web/        Next.js 16 frontend (App Router)
packages/
  shared/     Shared TypeScript types
infra/
  docker/     Dockerfiles for API and web
```

The API reads Markdown files from disk and serves them as HTML. All collaborative state (comments, replies, access control, note registry) lives in SQLite. The frontend is a Next.js app that talks to the API.

## Setup

### Prerequisites
- Node.js 20+
- A Google OAuth app ([console.cloud.google.com](https://console.cloud.google.com/apis/credentials))

### Install

```bash
npm install
```

### Configure

Copy the example env files and fill in your values:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

**API (`apps/api/.env`):**
| Variable | Required | Description |
|---|---|---|
| `VAULT_DIRS` | Yes | Comma-separated local vault paths |
| `SESSION_SECRET` | Yes | Random 32+ char hex string (`openssl rand -hex 32`) |
| `ADMIN_EMAIL` | Yes | Google account email for admin access |
| `CORS_ORIGIN` | Yes | Frontend URL (e.g. `http://localhost:3000`) |
| `STATE_DIR` | No | SQLite directory (default: `../../data`) |
| `ADMIN_API_KEY` | No | Alternative to session-based admin auth |

**Web (`apps/web/.env.local`):**
| Variable | Required | Description |
|---|---|---|
| `AUTH_SECRET` | Yes | Random 32+ char string (`openssl rand -hex 32`) |
| `AUTH_GOOGLE_ID` | Yes | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Yes | Google OAuth client secret |
| `ADMIN_EMAIL` | Yes | Must match the API's `ADMIN_EMAIL` |
| `API_BASE_URL` | No | Server-side API URL (default: `http://localhost:4000`) |

Google OAuth callback URL: `http://localhost:3000/api/auth/callback/google`

### Run

```bash
npm run dev:api   # API on :4000
npm run dev:web   # Web on :3000
```

Visit `http://localhost:3000` to see the vault selector, or `http://localhost:3000/admin` to manage notes (requires Google sign-in with the admin email).

## Frontmatter

Only a few frontmatter keys control application behavior:

| Key | Default | Behavior |
|---|---|---|
| `publish` | `false` | `true` makes the note visible in the public directory |
| `visibility` | `public` | `password` requires auth; `users` restricts to an allowlist |
| `comments` | `true` | `false` disables comments |
| `editing` | `false` | `true` enables inline edit suggestions |
| `password` | unset | bcrypt hash (set automatically via admin UI) |
| `subtitle` | unset | Shown below the note title |

All other frontmatter keys are rendered as metadata (tags as pills, dates formatted, URLs as links).

## Security

- Admin API routes require authentication (API key or session email match)
- Passwords hashed with bcrypt (10 rounds, salted)
- Session signatures use timing-safe comparison
- Rate limiting on password auth and comment submission
- Security headers via helmet
- Open redirect prevention on login callbacks
- Admin pages verify `isAdmin` server-side (not just middleware)

## Deployment

The API needs filesystem access to the vault and a persistent directory for SQLite. The web frontend can deploy anywhere Next.js runs (Vercel, Docker, etc.).

For Docker deployment, mount the vault directory and persist the data directory:

```yaml
volumes:
  - /path/to/vault:/vault
  - commonplace-data:/data
```

## License

MIT
