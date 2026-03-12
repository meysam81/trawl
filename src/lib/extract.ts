import log from "./logger.ts";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const OBFUSCATION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\s*\[at\]\s*/gi, replacement: "@" },
  { pattern: /\s*\(at\)\s*/gi, replacement: "@" },
  { pattern: /\s*\{at\}\s*/gi, replacement: "@" },
  { pattern: /\s*\bat\b\s*/gi, replacement: "@" },
  { pattern: /\s*\[dot\]\s*/gi, replacement: "." },
  { pattern: /\s*\(dot\)\s*/gi, replacement: "." },
  { pattern: /\s*\{dot\}\s*/gi, replacement: "." },
];

const HTML_ENTITY_MAP: Record<string, string> = {
  "&#64;": "@",
  "&#x40;": "@",
  "&commat;": "@",
  "&#46;": ".",
  "&#x2e;": ".",
  "&period;": ".",
};

const PHONE_REGEX =
  /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+\d{1,3}[-.\s]?\d{4,14}/g;

const SOCIAL_URL_REGEX =
  /https?:\/\/(?:www\.)?(?:linkedin\.com\/(?:in|company)\/[\w-]+|twitter\.com\/\w+|x\.com\/\w+|github\.com\/[\w-]+|facebook\.com\/[\w.-]+)/gi;

function decodeHtmlEntities(text: string): string {
  let decoded = text;
  for (const [entity, char] of Object.entries(HTML_ENTITY_MAP)) {
    decoded = decoded.replaceAll(entity, char);
  }
  return decoded;
}

function decodeObfuscations(text: string): string {
  let decoded = text;
  for (const { pattern, replacement } of OBFUSCATION_PATTERNS) {
    decoded = decoded.replace(pattern, replacement);
  }
  return decoded;
}

function extractFromMailtoLinks(html: string): string[] {
  const mailtoRegex = /mailto:([^"'?\s]+)/gi;
  const emails: string[] = [];
  let match: RegExpExecArray | null = mailtoRegex.exec(html);
  while (match) {
    const email = decodeURIComponent(match[1] ?? "");
    if (email) {
      emails.push(email);
    }
    match = mailtoRegex.exec(html);
  }
  return emails;
}

function extractFromDataAttributes(html: string): string[] {
  const dataEmailRegex = /data-email=["']([^"']+)["']/gi;
  const emails: string[] = [];
  let match: RegExpExecArray | null = dataEmailRegex.exec(html);
  while (match) {
    if (match[1]) {
      emails.push(match[1]);
    }
    match = dataEmailRegex.exec(html);
  }
  return emails;
}

function extractFromJsonLd(html: string): string[] {
  const scriptRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const emails: string[] = [];
  let match: RegExpExecArray | null = scriptRegex.exec(html);
  while (match) {
    try {
      const data: unknown = JSON.parse(match[1] ?? "");
      const found = findEmailsInObject(data);
      emails.push(...found);
    } catch {
      log.debug("Failed to parse JSON-LD block");
    }
    match = scriptRegex.exec(html);
  }
  return emails;
}

function findEmailsInObject(obj: unknown): string[] {
  const emails: string[] = [];
  if (typeof obj === "string") {
    const found = obj.match(EMAIL_REGEX);
    if (found) {
      emails.push(...found);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      emails.push(...findEmailsInObject(item));
    }
  } else if (typeof obj === "object" && obj !== null) {
    for (const value of Object.values(obj as Record<string, unknown>)) {
      emails.push(...findEmailsInObject(value));
    }
  }
  return emails;
}

function extractPhoneNumbers(text: string): string[] {
  const matches = text.match(PHONE_REGEX) ?? [];
  return [...new Set(matches)];
}

function extractSocialUrls(text: string): string[] {
  const matches = text.match(SOCIAL_URL_REGEX) ?? [];
  return [...new Set(matches)];
}

function isValidEmail(email: string): boolean {
  const parts = email.split("@");
  if (parts.length !== 2) {
    return false;
  }
  const [local, domain] = parts as [string, string];
  if (local.length === 0 || local.length > 64) {
    return false;
  }
  if (domain.length === 0 || domain.length > 253) {
    return false;
  }
  if (!domain.includes(".")) {
    return false;
  }
  const tld = domain.split(".").pop() ?? "";
  if (tld.length < 2) {
    return false;
  }
  return true;
}

interface ExtractOptions {
  mode: "text" | "html";
  html?: string;
  text?: string;
}

export interface ExtractedData {
  emails: string[];
  phones: string[];
  socialUrls: string[];
}

export function extractAll(options: ExtractOptions): ExtractedData {
  const { mode, html = "", text = "" } = options;
  const source = mode === "html" ? html : text;
  const emailSet = new Set<string>();

  // 1. Direct regex on source
  const directMatches = source.match(EMAIL_REGEX) ?? [];
  for (const email of directMatches) {
    emailSet.add(email.toLowerCase());
  }

  // 2. Decode HTML entities then extract
  const entityDecoded = decodeHtmlEntities(source);
  const entityMatches = entityDecoded.match(EMAIL_REGEX) ?? [];
  for (const email of entityMatches) {
    emailSet.add(email.toLowerCase());
  }

  // 3. Decode obfuscations then extract
  const deobfuscated = decodeObfuscations(source);
  const deobfMatches = deobfuscated.match(EMAIL_REGEX) ?? [];
  for (const email of deobfMatches) {
    emailSet.add(email.toLowerCase());
  }

  // 4. mailto: links (HTML mode)
  if (mode === "html") {
    for (const email of extractFromMailtoLinks(html)) {
      emailSet.add(email.toLowerCase());
    }

    // 5. data-email attributes
    for (const email of extractFromDataAttributes(html)) {
      emailSet.add(email.toLowerCase());
    }

    // 6. JSON-LD / schema.org
    for (const email of extractFromJsonLd(html)) {
      emailSet.add(email.toLowerCase());
    }
  }

  // Filter invalid
  const validEmails = [...emailSet].filter((email) => {
    if (!isValidEmail(email)) {
      log.debug("Skipping invalid email:", email);
      return false;
    }
    return true;
  });

  // Multi-entity extraction
  const phones = extractPhoneNumbers(source);
  const socialUrls = extractSocialUrls(source);

  return {
    emails: validEmails,
    phones,
    socialUrls,
  };
}

export function extractEmailsFromSelection(selectedText: string): string[] {
  const decoded = decodeObfuscations(decodeHtmlEntities(selectedText));
  const matches = decoded.match(EMAIL_REGEX) ?? [];
  return [...new Set(matches)].map((e) => e.toLowerCase()).filter(isValidEmail);
}
