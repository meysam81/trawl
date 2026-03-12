import type { EmailRecord } from "./schemas.ts";

const CSV_FORMULA_PREFIXES = ["=", "+", "-", "@"];

function sanitizeCsvCell(value: string): string {
  if (value.length > 0 && CSV_FORMULA_PREFIXES.includes(value[0]!)) {
    return "\t" + value;
  }
  return value;
}

export function toCSV(
  records: EmailRecord[],
  columns?: Array<keyof EmailRecord>,
): string {
  const cols = columns ?? [
    "email",
    "domain",
    "type",
    "provider",
    "confidence",
    "mxValid",
    "tags",
    "firstSeen",
    "lastSeen",
  ];

  const header = cols.join(",");
  const rows = records.map((record) =>
    cols
      .map((col) => {
        const value = record[col];
        if (Array.isArray(value)) {
          const joined = sanitizeCsvCell(value.join("; "));
          return `"${joined.replace(/"/g, '""')}"`;
        }
        const str = String(value ?? "");
        const safe = sanitizeCsvCell(str);
        if (safe.includes(",") || safe.includes('"') || safe.includes("\n")) {
          return `"${safe.replace(/"/g, '""')}"`;
        }
        return safe;
      })
      .join(","),
  );

  return [header, ...rows].join("\n");
}

export function toJSON(records: EmailRecord[]): string {
  return JSON.stringify(records, null, 2);
}

export function toTabSeparated(records: EmailRecord[]): string {
  return records.map((r) => r.email).join("\t");
}

function escapeVCardValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function toVCard(records: EmailRecord[]): string {
  return records
    .map(
      (r) =>
        `BEGIN:VCARD\nVERSION:3.0\nEMAIL:${r.email}\nNOTE:${escapeVCardValue(r.notes)}\nEND:VCARD`,
    )
    .join("\n");
}

export function composeGmailUrl(email: string): string {
  return `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(email)}`;
}

export function composeOutlookUrl(email: string): string {
  return `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(email)}`;
}

export function downloadBlob(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
