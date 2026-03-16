import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  VAULT_DIR: z.string().default(path.resolve(process.cwd(), "../web/content")),
  STATE_DIR: z.string().default(path.resolve(process.cwd(), "../../data")),
  PUBLIC_API_BASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(32).default("change-me-in-production-session-secret"),
  SESSION_MAX_AGE_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax")
});

export const env = envSchema.parse(process.env);

export const apiConfig = {
  port: env.PORT,
  vaultDir: env.VAULT_DIR,
  stateDir: env.STATE_DIR,
  publicApiBaseUrl: env.PUBLIC_API_BASE_URL || `http://localhost:${env.PORT}`,
  corsOrigin: env.CORS_ORIGIN,
  sessionSecret: env.SESSION_SECRET,
  sessionMaxAgeDays: env.SESSION_MAX_AGE_DAYS,
  cookieDomain: env.COOKIE_DOMAIN,
  cookieSameSite: env.COOKIE_SAME_SITE,
  sqlitePath: path.join(env.STATE_DIR, "obsidian-comments.sqlite")
};
