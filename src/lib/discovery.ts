import log from "./logger.ts";

const COMMON_PATTERNS = [
  "{first}@{domain}",
  "{last}@{domain}",
  "{first}.{last}@{domain}",
  "{first}{last}@{domain}",
  "{f}{last}@{domain}",
  "{first}.{l}@{domain}",
  "{first}_{last}@{domain}",
];

const ROLE_ADDRESSES = [
  "info",
  "contact",
  "hello",
  "support",
  "sales",
  "admin",
  "team",
  "help",
  "billing",
  "press",
  "hr",
  "careers",
  "jobs",
  "marketing",
];

export function guessEmailPatterns(
  firstName: string,
  lastName: string,
  domain: string,
): string[] {
  const f = firstName.toLowerCase().trim();
  const l = lastName.toLowerCase().trim();
  if (!f || !l || !domain) {
    return [];
  }

  return COMMON_PATTERNS.map((pattern) =>
    pattern
      .replace("{first}", f)
      .replace("{last}", l)
      .replace("{f}", f[0] ?? "")
      .replace("{l}", l[0] ?? "")
      .replace("{domain}", domain.toLowerCase()),
  );
}

export function generateRoleAddresses(domain: string): string[] {
  return ROLE_ADDRESSES.map((role) => `${role}@${domain.toLowerCase()}`);
}

export function detectLinkedPages(html: string, baseUrl: string): string[] {
  const linkPatterns = [
    /href=["']([^"']*(?:contact|about|team|staff|people|directory)[^"']*)["']/gi,
  ];

  const urls = new Set<string>();
  for (const pattern of linkPatterns) {
    let match: RegExpExecArray | null = pattern.exec(html);
    while (match) {
      const href = match[1];
      if (href) {
        try {
          const resolved = new URL(href, baseUrl).href;
          urls.add(resolved);
        } catch {
          log.debug("Could not resolve URL:", href);
        }
      }
      match = pattern.exec(html);
    }
  }
  return [...urls];
}

const GITHUB_USERNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;

export async function fetchGitHubEmails(username: string): Promise<string[]> {
  if (!GITHUB_USERNAME_RE.test(username) || username.length > 39) {
    log.warn(`Invalid GitHub username: ${username}`);
    return [];
  }

  try {
    const response = await fetch(
      `https://api.github.com/users/${encodeURIComponent(username)}/events/public`,
      { headers: { Accept: "application/vnd.github.v3+json" } },
    );

    if (!response.ok) {
      log.warn(`GitHub API error: ${response.status}`);
      return [];
    }

    const events: unknown = await response.json();
    if (!Array.isArray(events)) {
      return [];
    }

    const emails = new Set<string>();
    for (const event of events) {
      const payload = (event as Record<string, unknown>).payload as
        | Record<string, unknown>
        | undefined;
      const commits = payload?.commits;
      if (!Array.isArray(commits)) {
        continue;
      }
      for (const commit of commits) {
        const author = (commit as Record<string, unknown>).author as
          | Record<string, unknown>
          | undefined;
        const email = author?.email;
        if (
          typeof email === "string" &&
          email.includes("@") &&
          !email.includes("noreply")
        ) {
          emails.add(email.toLowerCase());
        }
      }
    }

    return [...emails];
  } catch (error) {
    log.warn("GitHub email fetch error:", error);
    return [];
  }
}
