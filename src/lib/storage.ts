import { z } from "zod";
import {
  EmailRecordSchema,
  ScanRecordSchema,
  SettingsSchema,
  type EmailRecord,
  type ScanRecord,
  type Settings,
} from "./schemas.ts";
import log from "./logger.ts";

const STORAGE_KEYS = {
  emails: "trawl_emails",
  scans: "trawl_scans",
  settings: "trawl_settings",
} as const;

const QUOTA_WARNING_BYTES = 4 * 1024 * 1024; // 4MB of 5MB limit

function safeParseArray<T>(schema: z.ZodType<T>, data: unknown): T[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const valid: T[] = [];
  for (const item of data) {
    const result = schema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      log.warn("Invalid stored record skipped:", result.error.message);
    }
  }
  return valid;
}

export async function getEmails(): Promise<EmailRecord[]> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.emails);
  return safeParseArray(EmailRecordSchema, data[STORAGE_KEYS.emails]);
}

export async function saveEmails(emails: EmailRecord[]): Promise<void> {
  await ensureQuota();
  const validated = safeParseArray(EmailRecordSchema, emails);
  await chrome.storage.local.set({ [STORAGE_KEYS.emails]: validated });
}

export async function upsertEmail(record: EmailRecord): Promise<void> {
  await upsertEmails([record]);
}

export async function upsertEmails(records: EmailRecord[]): Promise<void> {
  const existing = await getEmails();
  for (const record of records) {
    const index = existing.findIndex((e) => e.email === record.email);
    if (index >= 0) {
      const prev = existing[index]!;
      existing[index] = {
        ...prev,
        ...record,
        firstSeen: Math.min(prev.firstSeen, record.firstSeen),
        sourceUrls: [...new Set([...prev.sourceUrls, ...record.sourceUrls])],
        confidence: Math.max(prev.confidence, record.confidence),
      };
    } else {
      existing.push(record);
    }
  }
  await saveEmails(existing);
}

export async function deleteEmail(email: string): Promise<void> {
  const existing = await getEmails();
  await saveEmails(existing.filter((e) => e.email !== email));
}

export async function getScans(): Promise<ScanRecord[]> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.scans);
  return safeParseArray(ScanRecordSchema, data[STORAGE_KEYS.scans]);
}

const MAX_SCAN_RECORDS = 200;

export async function saveScan(scan: ScanRecord): Promise<void> {
  const parsed = ScanRecordSchema.safeParse(scan);
  if (!parsed.success) {
    log.warn("Invalid scan record:", parsed.error.message);
    return;
  }
  await ensureQuota();
  const existing = await getScans();
  existing.push(parsed.data);
  while (existing.length > MAX_SCAN_RECORDS) {
    existing.shift();
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.scans]: existing });
}

export async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const parsed = SettingsSchema.safeParse(data[STORAGE_KEYS.settings]);
  if (parsed.success) {
    return parsed.data;
  }
  return {
    autoScan: false,
    shortcuts: {},
    allowlist: [],
    blocklist: [],
  };
}

async function ensureQuota(): Promise<void> {
  const bytesUsed = await chrome.storage.local.getBytesInUse();
  if (bytesUsed > QUOTA_WARNING_BYTES) {
    throw new Error(
      `Storage quota exceeded: ${(bytesUsed / 1024 / 1024).toFixed(1)}MB of 5MB. Export and clean up data to free space.`,
    );
  }
}
