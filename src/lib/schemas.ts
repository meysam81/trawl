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
  sourceUrls: z.array(z.string().url().or(z.literal(""))),
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
  url: z.string().url().or(z.literal("")),
  timestamp: z.number(),
  emailCount: z.number().int().min(0),
  emails: z.array(z.string().email()),
});
export type ScanRecord = z.infer<typeof ScanRecordSchema>;

export const UrlVisibilityModeSchema = z.enum(["all", "visible", "viewport"]);
export type UrlVisibilityMode = z.infer<typeof UrlVisibilityModeSchema>;

export const UrlSourceModeSchema = z.enum([
  "anchors",
  "comprehensive",
  "everything",
]);
export type UrlSourceMode = z.infer<typeof UrlSourceModeSchema>;

export const UrlSortModeSchema = z.enum(["alpha", "pageOrder"]);
export type UrlSortMode = z.infer<typeof UrlSortModeSchema>;

export const UrlRecordSchema = z.object({
  url: z.string().url(),
  domain: z.string().min(1),
  firstIndex: z.number().int().nonnegative(),
  count: z.number().int().positive(),
});
export type UrlRecord = z.infer<typeof UrlRecordSchema>;

export const UrlSettingsSchema = z.object({
  visibilityMode: UrlVisibilityModeSchema.default("visible"),
  sourceMode: UrlSourceModeSchema.default("comprehensive"),
  sortMode: UrlSortModeSchema.default("alpha"),
});
export type UrlSettings = z.infer<typeof UrlSettingsSchema>;

export const SettingsSchema = z.object({
  autoScan: z.boolean().default(false),
  shortcuts: z.record(z.string(), z.string()),
  allowlist: z.array(z.string()),
  blocklist: z.array(z.string()),
  url: UrlSettingsSchema.default({
    visibilityMode: "visible",
    sourceMode: "comprehensive",
    sortMode: "alpha",
  }),
});
export type Settings = z.infer<typeof SettingsSchema>;
