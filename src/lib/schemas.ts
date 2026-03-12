import { z } from "zod";

export const EmailTypeSchema = z.enum(["personal", "role", "disposable"]);
export type EmailType = z.infer<typeof EmailTypeSchema>;

export const ProviderSchema = z.enum([
  "gmail",
  "outlook",
  "yahoo",
  "protonmail",
  "custom",
]);
export type Provider = z.infer<typeof ProviderSchema>;

export const EmailRecordSchema = z.object({
  email: z.string().email(),
  domain: z.string().min(1),
  firstSeen: z.number(),
  lastSeen: z.number(),
  sourceUrls: z.array(z.string().url()),
  tags: z.array(z.string()),
  notes: z.string().default(""),
  starred: z.boolean().default(false),
  type: EmailTypeSchema,
  provider: ProviderSchema,
  confidence: z.number().min(0).max(100),
  mxValid: z.boolean().nullable(),
});
export type EmailRecord = z.infer<typeof EmailRecordSchema>;

export const ScanRecordSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  timestamp: z.number(),
  emailCount: z.number().int().min(0),
  emails: z.array(z.string().email()),
});
export type ScanRecord = z.infer<typeof ScanRecordSchema>;

export const SettingsSchema = z.object({
  autoScan: z.boolean().default(false),
  shortcuts: z.record(z.string(), z.string()),
  allowlist: z.array(z.string()),
  blocklist: z.array(z.string()),
});
export type Settings = z.infer<typeof SettingsSchema>;
