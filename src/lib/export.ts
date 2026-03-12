import type { EmailRecord } from "./schemas.ts";

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
          return `"${value.join("; ")}"`;
        }
        if (typeof value === "string" && value.includes(",")) {
          return `"${value}"`;
        }
        return String(value ?? "");
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

export function toVCard(records: EmailRecord[]): string {
  return records
    .map(
      (r) =>
        `BEGIN:VCARD\nVERSION:3.0\nEMAIL:${r.email}\nNOTE:${r.notes}\nEND:VCARD`,
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
