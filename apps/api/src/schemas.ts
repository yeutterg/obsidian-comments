import { z } from "zod";

export const authRequestSchema = z.object({
  slug: z.string().min(1),
  password: z.string().min(1),
  email: z.string().email()
});

export const adminNoteSettingsSchema = z.object({
  slug: z.string().min(1),
  publish: z.boolean(),
  visibility: z.enum(["public", "password"]),
  comments: z.boolean(),
  editing: z.boolean(),
  password: z.string().optional(),
});

export const adminNoteContentSchema = z.object({
  slug: z.string().min(1),
  anchorText: z.string().min(1),
  anchorStart: z.coerce.number().int().min(0),
  anchorEnd: z.coerce.number().int().min(0),
  replacementText: z.string(),
});

export const vaultConnectionSchema = z.object({
  connected: z.boolean().default(true),
  vaultName: z.string().trim().max(200),
  folderPath: z.string().trim().max(300),
  siteUrlPrefix: z.string().trim().max(200),
});

export const createCommentSchema = z.object({
  authorEmail: z.string().email().max(200),
  body: z.string().trim().min(1).max(2000),
  anchorText: z.string().max(500),
  anchorStart: z.coerce.number().int().min(0),
  anchorEnd: z.coerce.number().int().min(0),
  honeypot: z.string().optional()
});

export const createReplySchema = z.object({
  authorEmail: z.string().email().max(200),
  body: z.string().trim().min(1).max(2000),
  honeypot: z.string().optional(),
});

export const updateCommentSchema = z.object({
  status: z.enum(["open", "resolved"])
});
