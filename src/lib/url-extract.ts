import type {
  UrlRecord,
  UrlSortMode,
  UrlVisibilityMode,
  UrlSourceMode,
} from "./schemas.ts";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

interface NormalizedUrl {
  url: string;
  domain: string;
}

export function parseAndNormalize(
  raw: string,
  baseUrl: string,
): NormalizedUrl | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(trimmed, baseUrl);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return {
      url: parsed.toString(),
      domain: parsed.hostname.toLowerCase(),
    };
  } catch {
    return null;
  }
}

type SourceCandidate = { raw: string; element: Element };

function collectFromAttr(
  root: Document,
  selector: string,
  attr: string,
): SourceCandidate[] {
  const out: SourceCandidate[] = [];
  for (const el of root.querySelectorAll(selector)) {
    const raw = el.getAttribute(attr);
    if (raw !== null) {
      out.push({ raw, element: el });
    }
  }
  return out;
}

function collectAnchors(root: Document): SourceCandidate[] {
  return [
    ...collectFromAttr(root, "a[href]", "href"),
    ...collectFromAttr(root, "area[href]", "href"),
  ];
}

function collectMedia(root: Document): SourceCandidate[] {
  return [
    ...collectFromAttr(root, "iframe[src]", "src"),
    ...collectFromAttr(root, "img[src]", "src"),
    ...collectFromAttr(root, "video[src]", "src"),
    ...collectFromAttr(root, "audio[src]", "src"),
    ...collectFromAttr(root, "source[src]", "src"),
    ...collectFromAttr(root, "embed[src]", "src"),
    ...collectFromAttr(root, "object[data]", "data"),
  ];
}

const URL_TEXT_REGEX = /\bhttps?:\/\/[^\s<>"'`)]+/gi;

function collectTextUrls(root: Document): SourceCandidate[] {
  const out: SourceCandidate[] = [];
  const walker = root.createTreeWalker(root.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node !== null) {
    const text = node.textContent ?? "";
    const matches = text.match(URL_TEXT_REGEX);
    if (matches !== null && node.parentElement !== null) {
      for (const raw of matches) {
        out.push({ raw, element: node.parentElement });
      }
    }
    node = walker.nextNode();
  }
  return out;
}

function collectHeadAndScripts(root: Document): SourceCandidate[] {
  const out: SourceCandidate[] = [];
  for (const el of root.querySelectorAll("link[href]")) {
    const rel = (el.getAttribute("rel") ?? "").toLowerCase();
    if (
      rel.includes("stylesheet") ||
      rel.includes("preconnect") ||
      rel.includes("dns-prefetch")
    ) {
      continue;
    }
    const raw = el.getAttribute("href");
    if (raw !== null) {
      out.push({ raw, element: el });
    }
  }
  for (const el of root.querySelectorAll("script[src]")) {
    const raw = el.getAttribute("src");
    if (raw !== null) {
      out.push({ raw, element: el });
    }
  }
  for (const el of root.querySelectorAll("meta[content]")) {
    const raw = el.getAttribute("content") ?? "";
    if (/^https?:\/\//i.test(raw)) {
      out.push({ raw, element: el });
    }
  }
  return out;
}

function isInHead(element: Element): boolean {
  let cur: Element | null = element;
  while (cur !== null) {
    if (cur.tagName === "HEAD") {
      return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

function isComputedVisible(element: Element): boolean {
  let cur: Element | null = element;
  while (cur !== null) {
    if (cur.hasAttribute("hidden")) {
      return false;
    }
    if (cur.getAttribute("aria-hidden") === "true") {
      return false;
    }
    const style = element.ownerDocument.defaultView?.getComputedStyle(cur);
    if (style) {
      if (style.display === "none") {
        return false;
      }
      if (style.visibility === "hidden") {
        return false;
      }
      if (style.visibility === "collapse") {
        return false;
      }
      if (parseFloat(style.opacity) === 0) {
        return false;
      }
    }
    cur = cur.parentElement;
  }
  return true;
}

function isInViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const win = element.ownerDocument.defaultView;
  if (!win) {
    return true;
  }
  return (
    rect.top < win.innerHeight &&
    rect.bottom > 0 &&
    rect.left < win.innerWidth &&
    rect.right > 0
  );
}

function passesVisibility(element: Element, mode: UrlVisibilityMode): boolean {
  if (mode === "all") {
    return true;
  }
  if (!isComputedVisible(element)) {
    return false;
  }
  if (mode === "visible") {
    return true;
  }
  return isInViewport(element);
}

function sortByDocumentPosition(candidates: SourceCandidate[]): void {
  candidates.sort((a, b) => {
    if (a.element === b.element) {
      return 0;
    }
    const pos = a.element.compareDocumentPosition(b.element);
    // compareDocumentPosition returns a bitmask; bitwise-AND is the spec API.
    // eslint-disable-next-line no-bitwise
    if ((pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) {
      return -1;
    }
    // eslint-disable-next-line no-bitwise
    if ((pos & Node.DOCUMENT_POSITION_PRECEDING) !== 0) {
      return 1;
    }
    return 0;
  });
}

export function sortUrls(records: UrlRecord[], mode: UrlSortMode): UrlRecord[] {
  const copy = [...records];
  if (mode === "pageOrder") {
    copy.sort((a, b) => a.firstIndex - b.firstIndex);
    return copy;
  }
  copy.sort((a, b) => a.url.toLowerCase().localeCompare(b.url.toLowerCase()));
  return copy;
}

interface ExtractVisibleUrlsOpts {
  root: Document;
  visibilityMode: UrlVisibilityMode;
  sourceMode: UrlSourceMode;
}

export function extractVisibleUrls(opts: ExtractVisibleUrlsOpts): UrlRecord[] {
  const { root, visibilityMode, sourceMode } = opts;

  const candidates: SourceCandidate[] = [];
  candidates.push(...collectAnchors(root));

  if (sourceMode === "comprehensive" || sourceMode === "everything") {
    candidates.push(...collectMedia(root));
    candidates.push(...collectTextUrls(root));
  }

  if (sourceMode === "everything") {
    candidates.push(...collectHeadAndScripts(root));
  }

  sortByDocumentPosition(candidates);

  const baseUrl = root.baseURI;
  const records = new Map<string, UrlRecord>();
  let counter = 0;

  for (const { raw, element } of candidates) {
    if (sourceMode !== "everything" && isInHead(element)) {
      continue;
    }
    if (!passesVisibility(element, visibilityMode)) {
      continue;
    }
    const normalized = parseAndNormalize(raw, baseUrl);
    if (normalized === null) {
      continue;
    }
    const existing = records.get(normalized.url);
    if (existing !== undefined) {
      existing.count += 1;
      continue;
    }
    records.set(normalized.url, {
      url: normalized.url,
      domain: normalized.domain,
      firstIndex: counter,
      count: 1,
    });
    counter += 1;
  }

  return Array.from(records.values());
}
