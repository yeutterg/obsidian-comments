import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

const packageDir = process.cwd();
const repoRoot = path.resolve(packageDir, "../..");

for (const envPath of [
  path.join(repoRoot, ".env"),
  path.join(repoRoot, ".env.local"),
  path.join(packageDir, ".env"),
  path.join(packageDir, ".env.local"),
]) {
  loadEnv({ path: envPath, override: false });
}

function slugifyVaultName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "vault";
}

function parseVaults(input: { vaultDir: string; vaultDirs?: string | undefined }) {
  const rawEntries = (input.vaultDirs ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const paths = rawEntries.length > 0 ? rawEntries : [input.vaultDir];
  const idCounts = new Map<string, number>();

  return paths.map((rawPath) => {
    const absolutePath = path.resolve(rawPath);
    const baseName = path.basename(absolutePath) || "Vault";
    const baseId = slugifyVaultName(baseName);
    const count = (idCounts.get(baseId) ?? 0) + 1;
    idCounts.set(baseId, count);
    return {
      id: count === 1 ? baseId : `${baseId}-${count}`,
      name: count === 1 ? baseName : `${baseName} ${count}`,
      dir: absolutePath,
    };
  });
}

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  VAULT_DIR: z.string().default(path.resolve(packageDir, "../web/content")),
  VAULT_DIRS: z.string().optional(),
  STATE_DIR: z.string().default(path.resolve(packageDir, "../../data")),
  PUBLIC_API_BASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(32).default("change-me-in-production-session-secret"),
  SESSION_MAX_AGE_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax")
});

export const env = envSchema.parse(process.env);
const vaults = parseVaults({
  vaultDir: env.VAULT_DIR,
  vaultDirs: env.VAULT_DIRS,
});

export const apiConfig = {
  port: env.PORT,
  vaultDir: vaults[0]?.dir ?? env.VAULT_DIR,
  vaults,
  stateDir: env.STATE_DIR,
  publicApiBaseUrl: env.PUBLIC_API_BASE_URL || `http://localhost:${env.PORT}`,
  corsOrigin: env.CORS_ORIGIN,
  sessionSecret: env.SESSION_SECRET,
  sessionMaxAgeDays: env.SESSION_MAX_AGE_DAYS,
  cookieDomain: env.COOKIE_DOMAIN,
  cookieSameSite: env.COOKIE_SAME_SITE,
  sqlitePath: path.join(env.STATE_DIR, "commonplace.sqlite")
};
