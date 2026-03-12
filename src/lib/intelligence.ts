import log from "./logger.ts";
import type { EmailType, Provider } from "./schemas.ts";
import disposableDomains from "../data/disposable-domains.json";

const DISPOSABLE_SET = new Set<string>(disposableDomains as string[]);

const ROLE_PREFIXES = new Set([
  "admin",
  "info",
  "support",
  "contact",
  "hello",
  "help",
  "sales",
  "billing",
  "noreply",
  "no-reply",
  "postmaster",
  "webmaster",
  "abuse",
  "security",
  "privacy",
  "marketing",
  "press",
  "media",
  "team",
  "office",
  "hr",
  "jobs",
  "careers",
  "feedback",
]);

const MX_PROVIDER_MAP: Record<string, Provider> = {
  "google.com": "gmail",
  "googlemail.com": "gmail",
  "outlook.com": "outlook",
  "hotmail.com": "outlook",
  "yahoo.com": "yahoo",
  "protonmail.ch": "protonmail",
  "protonmail.com": "protonmail",
};

const mxCache = new Map<string, { records: string[]; timestamp: number }>();
const MX_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const MX_CACHE_MAX_SIZE = 500;

function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_SET.has(domain.toLowerCase());
}

export function classifyEmailType(email: string): EmailType {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (isDisposableDomain(domain)) {
    return "disposable";
  }
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (ROLE_PREFIXES.has(local)) {
    return "role";
  }
  return "personal";
}

const DOMAIN_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

interface DnsProvider {
  name: string;
  buildUrl: (domain: string) => string;
  headers?: Record<string, string>;
}

const DNS_PROVIDERS: Record<string, DnsProvider> = {
  cloudflare: {
    name: "Cloudflare",
    buildUrl: (d) =>
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(d)}&type=MX`,
    headers: { Accept: "application/dns-json" },
  },
  google: {
    name: "Google",
    buildUrl: (d) =>
      `https://dns.google/resolve?name=${encodeURIComponent(d)}&type=MX`,
  },
};

const primaryKey =
  (import.meta.env.VITE_DNS_PRIMARY as string)?.toLowerCase() === "google"
    ? "google"
    : "cloudflare";
const fallbackKey = primaryKey === "cloudflare" ? "google" : "cloudflare";
const DNS_PRIMARY = DNS_PROVIDERS[primaryKey]!;
const DNS_FALLBACK = DNS_PROVIDERS[fallbackKey]!;

async function fetchMxFromProvider(
  provider: DnsProvider,
  domain: string,
): Promise<string[]> {
  const response = await fetch(provider.buildUrl(domain), {
    headers: provider.headers,
  });
  if (!response.ok) {
    throw new Error(`${provider.name} MX lookup failed: ${response.status}`);
  }

  const data: unknown = await response.json();
  const parsed = data as { Answer?: Array<{ data?: string }> };
  return (parsed.Answer ?? [])
    .map((a) => {
      const parts = (a.data ?? "").split(" ");
      return (parts[1] ?? "").replace(/\.$/, "").toLowerCase();
    })
    .filter(Boolean);
}

async function lookupMx(domain: string): Promise<string[]> {
  if (!DOMAIN_RE.test(domain)) {
    log.warn(`Invalid domain format for MX lookup: ${domain}`);
    return [];
  }

  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.timestamp < MX_CACHE_TTL) {
    return cached.records;
  }

  let records: string[];
  try {
    records = await fetchMxFromProvider(DNS_PRIMARY, domain);
  } catch (primaryError) {
    log.warn(
      `${DNS_PRIMARY.name} DNS failed for ${domain}, trying ${DNS_FALLBACK.name}:`,
      primaryError,
    );
    try {
      records = await fetchMxFromProvider(DNS_FALLBACK, domain);
    } catch (fallbackError) {
      log.warn(
        `${DNS_FALLBACK.name} DNS also failed for ${domain}:`,
        fallbackError,
      );
      return [];
    }
  }

  // Evict oldest entry if cache is full
  if (mxCache.size >= MX_CACHE_MAX_SIZE) {
    const oldestKey = mxCache.keys().next().value;
    if (oldestKey !== undefined) {
      mxCache.delete(oldestKey);
    }
  }
  mxCache.set(domain, { records, timestamp: Date.now() });
  return records;
}

function detectProvider(mxRecords: string[]): Provider {
  for (const mx of mxRecords) {
    for (const [pattern, provider] of Object.entries(MX_PROVIDER_MAP)) {
      if (mx.includes(pattern)) {
        return provider;
      }
    }
  }
  return "custom";
}

function computeConfidence(params: {
  mxValid: boolean | null;
  isDisposable: boolean;
  emailType: EmailType;
  sourceCount: number;
}): number {
  let score = 50;

  if (params.mxValid === true) {
    score += 30;
  } else if (params.mxValid === false) {
    score -= 40;
  }

  if (params.isDisposable) {
    score -= 30;
  }

  if (params.emailType === "role") {
    score += 5;
  }

  score += Math.min(params.sourceCount * 5, 15);

  return Math.max(0, Math.min(100, score));
}

interface EnrichmentResult {
  type: EmailType;
  provider: Provider;
  mxValid: boolean | null;
  confidence: number;
}

export async function enrichEmail(
  email: string,
  sourceCount: number,
): Promise<EnrichmentResult> {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const emailType = classifyEmailType(email);
  const isDisposable = isDisposableDomain(domain);

  let mxValid: boolean | null = null;
  let provider: Provider = "custom";

  try {
    const mxRecords = await lookupMx(domain);
    mxValid = mxRecords.length > 0;
    provider = detectProvider(mxRecords);
  } catch (error) {
    log.warn(`Enrichment MX lookup failed for ${domain}:`, error);
  }

  // Detect known providers by domain even without MX
  if (provider === "custom") {
    if (domain === "gmail.com" || domain === "googlemail.com") {
      provider = "gmail";
    } else if (
      domain === "outlook.com" ||
      domain === "hotmail.com" ||
      domain === "live.com"
    ) {
      provider = "outlook";
    } else if (domain === "yahoo.com" || domain === "ymail.com") {
      provider = "yahoo";
    } else if (domain === "protonmail.com" || domain === "pm.me") {
      provider = "protonmail";
    }
  }

  const confidence = computeConfidence({
    mxValid,
    isDisposable,
    emailType,
    sourceCount,
  });

  return { type: emailType, provider, mxValid, confidence };
}
