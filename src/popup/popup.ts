import { extractAll, type ExtractedData } from "../lib/extract.ts";
import {
  saveScan,
  upsertEmail,
  getEmails,
  getSettings,
  saveSettings,
} from "../lib/storage.ts";
import { enrichEmail } from "../lib/intelligence.ts";
import {
  guessEmailPatterns,
  generateRoleAddresses,
  detectLinkedPages,
  fetchGitHubEmails,
} from "../lib/discovery.ts";
import {
  toCSV,
  toJSON,
  toTabSeparated,
  toVCard,
  downloadBlob,
  urlsToTxt,
  urlsToCsv,
  urlsToJson,
} from "../lib/export.ts";
import {
  extractSocialLinks,
  classifyPage,
  detectRelatedPages,
  fetchDomainInfo,
} from "../lib/page-intelligence.ts";
import type {
  EmailRecord,
  UrlRecord,
  UrlSettings,
  UrlSortMode,
  UrlSourceMode,
  UrlVisibilityMode,
} from "../lib/schemas.ts";
import { sortUrls } from "../lib/url-extract.ts";
import log from "../lib/logger.ts";

const runBtn = document.getElementById("run") as HTMLButtonElement;
const outEl = document.getElementById("out") as HTMLPreElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const countEl = document.getElementById("count") as HTMLSpanElement;
const copyBtn = document.getElementById("copy") as HTMLButtonElement;
const modeSelect = document.getElementById("mode") as HTMLSelectElement;
const extrasEl = document.getElementById("extras") as HTMLDivElement;
const dashboardBtn = document.getElementById("dashboard") as HTMLButtonElement;

let lastResult: ExtractedData = { emails: [], phones: [], socialUrls: [] };

runBtn.addEventListener("click", async () => {
  runBtn.classList.add("loading");
  runBtn.textContent = "Scanning\u2026";

  const mode = modeSelect.value as "text" | "html";
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    showError("No active tab found.");
    resetButton();
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        html: document.documentElement.innerHTML,
        text: document.body.innerText,
      }),
    });

    const pageData = results[0]?.result;
    if (!pageData) {
      showError("Cannot access this page.");
      resetButton();
      return;
    }

    lastResult = extractAll({
      mode,
      html: pageData.html,
      text: pageData.text,
    });

    resultsEl.classList.add("visible");

    if (lastResult.emails.length > 0) {
      countEl.textContent = `${lastResult.emails.length} email${lastResult.emails.length > 1 ? "s" : ""} found`;
      outEl.textContent = lastResult.emails.join("\n");
      outEl.classList.remove("empty");
      copyBtn.style.display = "";
    } else {
      countEl.textContent = "";
      outEl.textContent = "No emails found on this page.";
      outEl.classList.add("empty");
      copyBtn.style.display = "none";
    }

    // Update badge
    chrome.runtime
      .sendMessage({
        type: "UPDATE_BADGE",
        tabId: tab.id,
        count: lastResult.emails.length,
      })
      .catch((error: unknown) => log.warn("Badge message failed:", error));

    // Auto-save scan + emails
    const sourceUrl = tab.url ?? "";
    const now = Date.now();

    saveScan({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      url: sourceUrl,
      timestamp: now,
      emailCount: lastResult.emails.length,
      emails: lastResult.emails,
    }).catch((error: unknown) => log.warn("Failed to save scan:", error));

    // Enrich and save emails (async, non-blocking)
    // Sequential: enrichment hits external APIs, parallelizing could rate-limit
    (async () => {
      for (const email of lastResult.emails) {
        try {
          const domain = email.split("@")[1] ?? "";
          const enrichment = await enrichEmail(email, 1);
          await upsertEmail({
            email,
            domain,
            firstSeen: now,
            lastSeen: now,
            sourceUrls: sourceUrl ? [sourceUrl] : [],
            tags: [],
            notes: "",
            starred: false,
            type: enrichment.type,
            provider: enrichment.provider,
            confidence: enrichment.confidence,
            mxValid: enrichment.mxValid,
          });
        } catch (error) {
          log.warn("Failed to enrich/save email:", error);
        }
      }
    })().catch((error: unknown) =>
      log.warn("Enrichment pipeline failed:", error),
    );

    renderExtras();
  } catch {
    showError("Cannot access this page.");
  }

  resetButton();
});

copyBtn.addEventListener("click", () => {
  if (lastResult.emails.length === 0) {
    return;
  }
  navigator.clipboard
    .writeText(lastResult.emails.join("\n"))
    .catch((error: unknown) => log.warn("Clipboard write failed:", error));
  copyBtn.textContent = "Copied!";
  copyBtn.classList.add("copied");
  setTimeout(() => {
    copyBtn.textContent = "Copy";
    copyBtn.classList.remove("copied");
  }, 1200);
});

const exportSelect = document.getElementById(
  "export-format",
) as HTMLSelectElement;

exportSelect.addEventListener("change", () => {
  const format = exportSelect.value;
  if (lastResult.emails.length === 0 || !format) {
    return;
  }

  getEmails()
    .then((storedEmails) => {
      const storedMap = new Map(storedEmails.map((r) => [r.email, r]));
      const now = Date.now();

      const records: EmailRecord[] = lastResult.emails.map((email) => {
        const stored = storedMap.get(email);
        if (stored) {
          return stored;
        }
        return {
          email,
          domain: email.split("@")[1] ?? "",
          firstSeen: now,
          lastSeen: now,
          sourceUrls: [],
          tags: [],
          notes: "",
          starred: false,
          type: "personal" as const,
          provider: "custom" as const,
          confidence: 50,
          mxValid: null,
        };
      });

      switch (format) {
        case "csv":
          downloadBlob(toCSV(records), "trawl-export.csv", "text/csv");
          break;
        case "json":
          downloadBlob(
            toJSON(records),
            "trawl-export.json",
            "application/json",
          );
          break;
        case "tsv":
          navigator.clipboard
            .writeText(toTabSeparated(records))
            .catch((error: unknown) =>
              log.warn("Clipboard write failed:", error),
            );
          break;
        case "vcard":
          downloadBlob(toVCard(records), "trawl-export.vcf", "text/vcard");
          break;
        default:
          break;
      }
    })
    .catch((error: unknown) =>
      log.warn("Failed to load records for export:", error),
    );

  // Reset select
  exportSelect.value = "";
});

dashboardBtn.addEventListener("click", () => {
  chrome.tabs
    .create({
      url: chrome.runtime.getURL("src/dashboard/dashboard.html"),
    })
    .catch((error: unknown) => log.warn("Failed to open dashboard:", error));
});

function showError(message: string): void {
  resultsEl.classList.add("visible");
  countEl.textContent = "";
  outEl.textContent = message;
  outEl.classList.add("empty");
  copyBtn.style.display = "none";
}

function resetButton(): void {
  runBtn.classList.remove("loading");
  runBtn.textContent = "Collect";
}

function createExtrasSection(title: string, items: string[]): HTMLElement {
  const details = document.createElement("details");
  details.className = "extras-section";

  const summary = document.createElement("summary");
  summary.textContent = `${title} (${items.length})`;
  details.append(summary);

  const pre = document.createElement("pre");
  pre.textContent = items.join("\n");
  details.append(pre);

  return details;
}

function renderExtras(): void {
  extrasEl.replaceChildren();

  if (lastResult.phones.length > 0) {
    extrasEl.append(createExtrasSection("Phone numbers", lastResult.phones));
  }

  if (lastResult.socialUrls.length > 0) {
    extrasEl.append(
      createExtrasSection("Social profiles", lastResult.socialUrls),
    );
  }
}

// Discovery panel
const discGuessBtn = document.getElementById("disc-guess") as HTMLButtonElement;
const discGuessOut = document.getElementById(
  "disc-guess-out",
) as HTMLPreElement;
const discFirstInput = document.getElementById(
  "disc-first",
) as HTMLInputElement;
const discLastInput = document.getElementById("disc-last") as HTMLInputElement;
const discRolesBtn = document.getElementById("disc-roles") as HTMLButtonElement;
const discRolesOut = document.getElementById(
  "disc-roles-out",
) as HTMLPreElement;
const discLinksBtn = document.getElementById("disc-links") as HTMLButtonElement;
const discLinksOut = document.getElementById(
  "disc-links-out",
) as HTMLPreElement;
const discGithubBtn = document.getElementById(
  "disc-github-btn",
) as HTMLButtonElement;
const discGithubInput = document.getElementById(
  "disc-github",
) as HTMLInputElement;
const discGithubOut = document.getElementById(
  "disc-github-out",
) as HTMLPreElement;

async function getCurrentDomain(): Promise<string> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.url) {
    return "";
  }
  try {
    return new URL(tab.url).hostname;
  } catch {
    return "";
  }
}

discGuessBtn.addEventListener("click", async () => {
  const firstName = discFirstInput.value.trim();
  const lastName = discLastInput.value.trim();
  const domain = await getCurrentDomain();
  if (!firstName || !lastName || !domain) {
    discGuessOut.textContent =
      "Enter first & last name. Domain from current tab.";
    return;
  }
  const patterns = guessEmailPatterns(firstName, lastName, domain);
  discGuessOut.textContent = patterns.join("\n");
});

discRolesBtn.addEventListener("click", async () => {
  const domain = await getCurrentDomain();
  if (!domain) {
    discRolesOut.textContent = "No domain detected.";
    return;
  }
  const roles = generateRoleAddresses(domain);
  discRolesOut.textContent = roles.join("\n");
});

discLinksBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id || !tab.url) {
    discLinksOut.textContent = "No active tab.";
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.documentElement.innerHTML,
    });
    const html = results[0]?.result ?? "";
    const links = detectLinkedPages(html, tab.url);
    discLinksOut.textContent =
      links.length > 0
        ? links.join("\n")
        : "No contact/about/team pages found.";
  } catch {
    discLinksOut.textContent = "Cannot access this page.";
  }
});

discGithubBtn.addEventListener("click", async () => {
  const username = discGithubInput.value.trim();
  if (!username) {
    discGithubOut.textContent = "Enter a GitHub username.";
    return;
  }
  discGithubOut.textContent = "Fetching...";
  const emails = await fetchGitHubEmails(username);
  discGithubOut.textContent =
    emails.length > 0 ? emails.join("\n") : "No public emails found.";
});

// Page intelligence panel
const pageTypeEl = document.getElementById("page-type") as HTMLSpanElement;
const pageSocialEl = document.getElementById("page-social") as HTMLPreElement;
const pageRelatedEl = document.getElementById("page-related") as HTMLPreElement;
const pageWhoisBtn = document.getElementById(
  "page-whois-btn",
) as HTMLButtonElement;
const pageWhoisEl = document.getElementById("page-whois") as HTMLPreElement;

// Auto-populate page intelligence when panel opens
const pageIntelPanel = document.getElementById(
  "page-intel-panel",
) as HTMLDetailsElement;

pageIntelPanel.addEventListener("toggle", async () => {
  if (!pageIntelPanel.open) {
    return;
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id || !tab.url) {
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.documentElement.innerHTML,
    });
    const html = results[0]?.result ?? "";

    // Page type
    const pageType = classifyPage(tab.url, html);
    pageTypeEl.textContent = pageType;

    // Social links
    const socialLinks = extractSocialLinks(html);
    pageSocialEl.textContent =
      socialLinks.length > 0
        ? socialLinks.map((l) => `${l.platform}: ${l.url}`).join("\n")
        : "No social links found.";

    // Related pages
    const related = detectRelatedPages(html, tab.url);
    pageRelatedEl.textContent =
      related.length > 0 ? related.join("\n") : "No related pages found.";
  } catch {
    pageTypeEl.textContent = "unavailable";
  }
});

pageWhoisBtn.addEventListener("click", async () => {
  const domain = await getCurrentDomain();
  if (!domain) {
    pageWhoisEl.textContent = "No domain detected.";
    return;
  }
  pageWhoisEl.textContent = "Looking up...";
  const info = await fetchDomainInfo(domain);
  const lines = [
    `Domain: ${info.domain}`,
    `Registrar: ${info.registrar ?? "unknown"}`,
    `Created: ${info.creationDate ?? "unknown"}`,
    `Expires: ${info.expiryDate ?? "unknown"}`,
  ];
  pageWhoisEl.textContent = lines.join("\n");
});

// Settings panel
const autoScanToggle = document.getElementById(
  "auto-scan-toggle",
) as HTMLInputElement;
const allowlistEl = document.getElementById("allowlist") as HTMLTextAreaElement;
const blocklistEl = document.getElementById("blocklist") as HTMLTextAreaElement;

function parseDomainList(text: string): string[] {
  return text
    .split("\n")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

// Load settings on popup open
(async () => {
  const settings = await getSettings();
  autoScanToggle.checked = settings.autoScan;
  allowlistEl.value = settings.allowlist.join("\n");
  blocklistEl.value = settings.blocklist.join("\n");
})().catch((error: unknown) => log.warn("Failed to load settings:", error));

autoScanToggle.addEventListener("change", async () => {
  const s = await getSettings();
  s.autoScan = autoScanToggle.checked;
  await saveSettings(s);
});

allowlistEl.addEventListener("change", async () => {
  const s = await getSettings();
  s.allowlist = parseDomainList(allowlistEl.value);
  await saveSettings(s);
});

blocklistEl.addEventListener("change", async () => {
  const s = await getSettings();
  s.blocklist = parseDomainList(blocklistEl.value);
  await saveSettings(s);
});

// =============================================================================
// URLs section
// =============================================================================

const urlsCountEl = document.getElementById("urls-count") as HTMLSpanElement;
const urlsRunBtn = document.getElementById("urls-run") as HTMLButtonElement;
const urlsSortAlphaBtn = document.getElementById(
  "urls-sort-alpha",
) as HTMLButtonElement;
const urlsSortPageBtn = document.getElementById(
  "urls-sort-page",
) as HTMLButtonElement;
const urlsFilterToggleBtn = document.getElementById(
  "urls-filter-toggle",
) as HTMLButtonElement;
const urlsFiltersEl = document.getElementById("urls-filters") as HTMLDivElement;
const urlsVisibilitySelect = document.getElementById(
  "urls-visibility",
) as HTMLSelectElement;
const urlsSourceSelect = document.getElementById(
  "urls-source",
) as HTMLSelectElement;
const urlsCopyBtn = document.getElementById("urls-copy") as HTMLButtonElement;
const urlsExportSelect = document.getElementById(
  "urls-export",
) as HTMLSelectElement;
const urlsListEl = document.getElementById("urls-list") as HTMLDivElement;
const urlsEmptyEl = document.getElementById("urls-empty") as HTMLDivElement;

let urlsLastResult: UrlRecord[] = [];
let urlsCurrentSettings: UrlSettings = {
  visibilityMode: "visible",
  sourceMode: "comprehensive",
  sortMode: "alpha",
};

function applySortButtonsActive(mode: UrlSortMode): void {
  urlsSortAlphaBtn.classList.toggle("active", mode === "alpha");
  urlsSortPageBtn.classList.toggle("active", mode === "pageOrder");
}

function renderUrlsList(): void {
  const sorted = sortUrls(urlsLastResult, urlsCurrentSettings.sortMode);
  urlsListEl.replaceChildren();
  if (sorted.length === 0) {
    urlsListEl.hidden = true;
    urlsEmptyEl.hidden = false;
    urlsEmptyEl.textContent =
      urlsLastResult.length === 0
        ? "Click Extract to scan this page."
        : "No URLs match the current filter.";
    return;
  }
  urlsEmptyEl.hidden = true;
  urlsListEl.hidden = false;

  for (const record of sorted) {
    const row = document.createElement("div");
    row.className = "urls-row";

    const link = document.createElement("a");
    link.className = "urls-row-link";
    link.href = record.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = record.url;
    link.textContent = record.url;
    row.append(link);

    if (record.count > 1) {
      const countSpan = document.createElement("span");
      countSpan.className = "urls-row-count";
      countSpan.textContent = `\u00d7${record.count}`;
      row.append(countSpan);
    }

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "urls-row-copy";
    copyBtn.title = "Copy this URL";
    copyBtn.textContent = "\u29c9";
    copyBtn.addEventListener("click", (event) => {
      event.preventDefault();
      navigator.clipboard
        .writeText(record.url)
        .catch((err: unknown) => log.warn("URL copy failed:", err));
      copyBtn.classList.add("copied");
      setTimeout(() => copyBtn.classList.remove("copied"), 1000);
    });
    row.append(copyBtn);

    urlsListEl.append(row);
  }
}

function renderUrlsHeader(): void {
  urlsCountEl.textContent =
    urlsLastResult.length > 0 ? String(urlsLastResult.length) : "";
}

async function persistUrlSettings(): Promise<void> {
  const s = await getSettings();
  s.url = urlsCurrentSettings;
  await saveSettings(s);
}

async function runUrlExtraction(): Promise<void> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) {
    urlsEmptyEl.hidden = false;
    urlsEmptyEl.textContent = "No active tab.";
    return;
  }
  urlsRunBtn.classList.add("loading");
  urlsRunBtn.textContent = "Scanning\u2026";
  try {
    const response = (await chrome.tabs.sendMessage(tab.id, {
      type: "EXTRACT_URLS",
      visibilityMode: urlsCurrentSettings.visibilityMode,
      sourceMode: urlsCurrentSettings.sourceMode,
    })) as { urls: UrlRecord[] } | undefined;
    urlsLastResult = response?.urls ?? [];
  } catch (err) {
    log.warn("URL extraction failed:", err);
    urlsLastResult = [];
    urlsEmptyEl.hidden = false;
    urlsEmptyEl.textContent =
      "Cannot access this page. Reload the tab and try again.";
  }
  urlsRunBtn.classList.remove("loading");
  urlsRunBtn.textContent = "Extract";
  renderUrlsHeader();
  renderUrlsList();
}

urlsRunBtn.addEventListener("click", () => {
  runUrlExtraction().catch((err: unknown) =>
    log.warn("URL run handler failed:", err),
  );
});

urlsSortAlphaBtn.addEventListener("click", () => {
  urlsCurrentSettings = { ...urlsCurrentSettings, sortMode: "alpha" };
  applySortButtonsActive("alpha");
  renderUrlsList();
  persistUrlSettings().catch((err: unknown) =>
    log.warn("Persist sort failed:", err),
  );
});

urlsSortPageBtn.addEventListener("click", () => {
  urlsCurrentSettings = { ...urlsCurrentSettings, sortMode: "pageOrder" };
  applySortButtonsActive("pageOrder");
  renderUrlsList();
  persistUrlSettings().catch((err: unknown) =>
    log.warn("Persist sort failed:", err),
  );
});

urlsFilterToggleBtn.addEventListener("click", () => {
  const willOpen = urlsFiltersEl.hidden as boolean;
  urlsFiltersEl.hidden = !willOpen;
  urlsFilterToggleBtn.classList.toggle("active", willOpen);
});

urlsVisibilitySelect.addEventListener("change", () => {
  urlsCurrentSettings = {
    ...urlsCurrentSettings,
    visibilityMode: urlsVisibilitySelect.value as UrlVisibilityMode,
  };
  persistUrlSettings()
    .then(() => runUrlExtraction())
    .catch((err: unknown) =>
      log.warn("Persist+rerun (visibility) failed:", err),
    );
});

urlsSourceSelect.addEventListener("change", () => {
  urlsCurrentSettings = {
    ...urlsCurrentSettings,
    sourceMode: urlsSourceSelect.value as UrlSourceMode,
  };
  persistUrlSettings()
    .then(() => runUrlExtraction())
    .catch((err: unknown) => log.warn("Persist+rerun (source) failed:", err));
});

urlsCopyBtn.addEventListener("click", () => {
  if (urlsLastResult.length === 0) {
    return;
  }
  const sorted = sortUrls(urlsLastResult, urlsCurrentSettings.sortMode);
  navigator.clipboard
    .writeText(sorted.map((r) => r.url).join("\n"))
    .catch((err: unknown) => log.warn("URL copy-all failed:", err));
  urlsCopyBtn.textContent = "Copied!";
  urlsCopyBtn.classList.add("copied");
  setTimeout(() => {
    urlsCopyBtn.textContent = "Copy";
    urlsCopyBtn.classList.remove("copied");
  }, 1200);
});

urlsExportSelect.addEventListener("change", () => {
  const format = urlsExportSelect.value;
  if (urlsLastResult.length === 0 || !format) {
    urlsExportSelect.value = "";
    return;
  }
  const sorted = sortUrls(urlsLastResult, urlsCurrentSettings.sortMode);
  switch (format) {
    case "txt":
      downloadBlob(urlsToTxt(sorted), "trawl-urls.txt", "text/plain");
      break;
    case "csv":
      downloadBlob(urlsToCsv(sorted), "trawl-urls.csv", "text/csv");
      break;
    case "json":
      downloadBlob(urlsToJson(sorted), "trawl-urls.json", "application/json");
      break;
    default:
      break;
  }
  urlsExportSelect.value = "";
});

(async () => {
  const settings = await getSettings();
  urlsCurrentSettings = settings.url;
  urlsVisibilitySelect.value = urlsCurrentSettings.visibilityMode;
  urlsSourceSelect.value = urlsCurrentSettings.sourceMode;
  applySortButtonsActive(urlsCurrentSettings.sortMode);
  urlsEmptyEl.hidden = false;
  urlsListEl.hidden = true;
})().catch((err: unknown) => log.warn("Failed to load URL settings:", err));
