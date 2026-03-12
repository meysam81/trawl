import log from "./logger.ts";

type PageCategory =
  | "company"
  | "blog"
  | "directory"
  | "forum"
  | "ecommerce"
  | "personal"
  | "government"
  | "education"
  | "unknown";

const CATEGORY_SIGNALS: Array<{
  pattern: RegExp;
  category: PageCategory;
}> = [
  { pattern: /\.edu($|\/)/i, category: "education" },
  { pattern: /\.gov($|\/)/i, category: "government" },
  { pattern: /\/(blog|article|post|news)\b/i, category: "blog" },
  {
    pattern: /\/(directory|listing|members|profiles)\b/i,
    category: "directory",
  },
  { pattern: /\/(forum|thread|discussion|topic)\b/i, category: "forum" },
  {
    pattern: /\/(shop|store|product|cart|checkout)\b/i,
    category: "ecommerce",
  },
  {
    pattern: /\/(about|team|careers|company|contact)\b/i,
    category: "company",
  },
];

const SOCIAL_PATTERNS: Array<{ platform: string; regex: RegExp }> = [
  {
    platform: "LinkedIn",
    regex: /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[\w-]+/gi,
  },
  {
    platform: "Twitter/X",
    regex: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/\w+/gi,
  },
  {
    platform: "GitHub",
    regex: /https?:\/\/(?:www\.)?github\.com\/[\w-]+/gi,
  },
  {
    platform: "Facebook",
    regex: /https?:\/\/(?:www\.)?facebook\.com\/[\w.-]+/gi,
  },
  {
    platform: "Instagram",
    regex: /https?:\/\/(?:www\.)?instagram\.com\/[\w.]+/gi,
  },
  {
    platform: "YouTube",
    regex:
      /https?:\/\/(?:www\.)?youtube\.com\/(?:@[\w]+|channel\/[\w-]+|c\/[\w-]+)/gi,
  },
];

interface SocialLink {
  platform: string;
  url: string;
}

export function extractSocialLinks(html: string): SocialLink[] {
  const links: SocialLink[] = [];
  const seen = new Set<string>();

  for (const { platform, regex } of SOCIAL_PATTERNS) {
    // Reset regex state for each pass
    regex.lastIndex = 0;
    let match: RegExpExecArray | null = regex.exec(html);
    while (match) {
      const url = match[0];
      if (!seen.has(url)) {
        seen.add(url);
        links.push({ platform, url });
      }
      match = regex.exec(html);
    }
  }

  return links;
}

export function classifyPage(url: string, html: string): PageCategory {
  for (const { pattern, category } of CATEGORY_SIGNALS) {
    if (pattern.test(url)) {
      return category;
    }
  }

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch?.[1]?.toLowerCase() ?? "";

  if (title.includes("blog") || title.includes("article")) {
    return "blog";
  }
  if (title.includes("shop") || title.includes("store")) {
    return "ecommerce";
  }
  if (title.includes("forum") || title.includes("community")) {
    return "forum";
  }

  return "unknown";
}

export function detectRelatedPages(html: string, baseUrl: string): string[] {
  const relatedPatterns =
    /href=["']([^"']*(?:contact|about|team|staff|privacy|terms|faq|help|support|blog|news|careers|jobs)[^"']*)["']/gi;

  const urls = new Set<string>();
  let match: RegExpExecArray | null = relatedPatterns.exec(html);
  while (match) {
    const href = match[1];
    if (href) {
      try {
        const resolved = new URL(href, baseUrl);
        if (resolved.hostname === new URL(baseUrl).hostname) {
          urls.add(resolved.href);
        }
      } catch {
        log.debug("Could not resolve related page URL:", href);
      }
    }
    match = relatedPatterns.exec(html);
  }

  return [...urls];
}

interface DomainInfo {
  domain: string;
  registrar: string | null;
  creationDate: string | null;
  expiryDate: string | null;
}

function extractRegistrarFromEntities(
  entities: Array<Record<string, unknown>>,
): string | null {
  for (const entity of entities) {
    const roles = entity.roles as string[] | undefined;
    if (!Array.isArray(roles) || !roles.includes("registrar")) {
      continue;
    }
    const vcardArray = entity.vcardArray as unknown[] | undefined;
    if (!Array.isArray(vcardArray)) {
      continue;
    }
    const vcard = vcardArray[1] as Array<Array<unknown>> | undefined;
    if (!Array.isArray(vcard)) {
      continue;
    }
    for (const field of vcard) {
      if (Array.isArray(field) && field[0] === "fn") {
        return String(field[3] ?? "");
      }
    }
  }
  return null;
}

function extractDatesFromEvents(
  events: Array<{ eventAction?: string; eventDate?: string }>,
): { creationDate: string | null; expiryDate: string | null } {
  let creationDate: string | null = null;
  let expiryDate: string | null = null;
  for (const event of events) {
    if (event.eventAction === "registration") {
      creationDate = event.eventDate ?? null;
    }
    if (event.eventAction === "expiration") {
      expiryDate = event.eventDate ?? null;
    }
  }
  return { creationDate, expiryDate };
}

const DOMAIN_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export async function fetchDomainInfo(domain: string): Promise<DomainInfo> {
  const info: DomainInfo = {
    domain,
    registrar: null,
    creationDate: null,
    expiryDate: null,
  };

  if (!DOMAIN_RE.test(domain)) {
    log.warn(`Invalid domain format: ${domain}`);
    return info;
  }

  try {
    const response = await fetch(
      `https://rdap.org/domain/${encodeURIComponent(domain)}`,
      { headers: { Accept: "application/rdap+json" } },
    );

    if (!response.ok) {
      log.warn(`RDAP lookup failed for ${domain}: ${response.status}`);
      return info;
    }

    const data: unknown = await response.json();
    const rdap = data as Record<string, unknown>;

    const entities = rdap.entities as
      | Array<Record<string, unknown>>
      | undefined;
    if (Array.isArray(entities)) {
      info.registrar = extractRegistrarFromEntities(entities);
    }

    const events = rdap.events as
      | Array<{ eventAction?: string; eventDate?: string }>
      | undefined;
    if (Array.isArray(events)) {
      const dates = extractDatesFromEvents(events);
      info.creationDate = dates.creationDate;
      info.expiryDate = dates.expiryDate;
    }
  } catch (error) {
    log.warn(`RDAP lookup error for ${domain}:`, error);
  }

  return info;
}
