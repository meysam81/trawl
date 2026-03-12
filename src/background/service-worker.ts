import { extractAll, type ExtractedData } from "../lib/extract.ts";
import {
  getSettings,
  saveScan,
  upsertEmails,
  getEmails,
} from "../lib/storage.ts";
import { classifyEmailType } from "../lib/intelligence.ts";
import log from "../lib/logger.ts";

const MENU_EXTRACT_PAGE = "trawl-extract-page";
const MENU_EXTRACT_SELECTION = "trawl-extract-selection";
const SCHEMA_VERSION = 1;
const SCHEMA_VERSION_KEY = "trawl_schema_version";

// --- Install / Context Menus ---

chrome.runtime.onInstalled.addListener(
  async (details: chrome.runtime.InstalledDetails) => {
    chrome.contextMenus.create({
      id: MENU_EXTRACT_PAGE,
      title: "Extract emails from page",
      contexts: ["page"],
    });

    chrome.contextMenus.create({
      id: MENU_EXTRACT_SELECTION,
      title: "Extract emails from selection",
      contexts: ["selection"],
    });

    if (details.reason === "update") {
      await runMigrations();
    }

    await chrome.storage.local.set({ [SCHEMA_VERSION_KEY]: SCHEMA_VERSION });
    log.info("Trawl installed/updated", {
      reason: details.reason,
      schemaVersion: SCHEMA_VERSION,
    });
  },
);

// --- Context Menu Handler ---

chrome.contextMenus.onClicked.addListener(
  async (info: chrome.contextMenus.OnClickData, tab) => {
    if (!tab?.id) {
      return;
    }

    if (info.menuItemId === MENU_EXTRACT_SELECTION && info.selectionText) {
      const result = extractAll({
        mode: "text",
        text: info.selectionText,
      });
      await updateBadge(tab.id, result.emails.length);
      await storeTemporaryResults(result.emails);
    }

    if (info.menuItemId === MENU_EXTRACT_PAGE) {
      await extractFromTab(tab.id, tab.url);
    }
  },
);

// --- Keyboard Shortcuts ---

chrome.commands.onCommand.addListener(async (command: string) => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) {
    return;
  }

  if (command === "extract-page") {
    await extractFromTab(tab.id, tab.url);
  }

  if (command === "open-dashboard") {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("src/dashboard/dashboard.html"),
    });
  }
});

// --- Auto-Scan (Tab Navigation) ---

const autoScanTimers = new Map<number, ReturnType<typeof setTimeout>>();

chrome.tabs.onUpdated.addListener(
  async (
    tabId: number,
    changeInfo: { status?: string },
    tab: chrome.tabs.Tab,
  ) => {
    if (changeInfo.status !== "complete" || !tab.url) {
      return;
    }

    const settings = await getSettings();
    if (!settings.autoScan) {
      return;
    }

    // Check allowlist/blocklist
    const domain = getDomainFromUrl(tab.url);
    if (!domain) {
      return;
    }

    if (
      settings.blocklist.length > 0 &&
      settings.blocklist.some((d) => domain === d || domain.endsWith("." + d))
    ) {
      return;
    }

    if (
      settings.allowlist.length > 0 &&
      !settings.allowlist.some((d) => domain === d || domain.endsWith("." + d))
    ) {
      return;
    }

    // Debounce: clear previous timer for this tab
    const existing = autoScanTimers.get(tabId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    // Auto-extract with a small delay to let page render
    const timerId = setTimeout(() => {
      autoScanTimers.delete(tabId);
      autoScanTab(tabId, tab.url ?? "").catch((error: unknown) =>
        log.debug("Auto-scan error:", error),
      );
    }, 1500);
    autoScanTimers.set(tabId, timerId);
  },
);

// Clean up timers when tabs close
chrome.tabs.onRemoved.addListener((tabId: number) => {
  const timerId = autoScanTimers.get(tabId);
  if (timerId !== undefined) {
    clearTimeout(timerId);
    autoScanTimers.delete(tabId);
  }
});

// --- Message Handler ---

chrome.runtime.onMessage.addListener(
  (
    message: { type: string },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    // Only accept messages from our own extension
    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    if (message.type === "UPDATE_BADGE") {
      const msg = message as {
        type: string;
        tabId: number;
        count: number;
      };
      updateBadge(msg.tabId, msg.count).catch((error: unknown) =>
        log.warn("Badge update failed:", error),
      );
      sendResponse({ ok: true });
    }
    return false;
  },
);

// --- Migrations ---

async function runMigrations(): Promise<void> {
  const data = await chrome.storage.local.get(SCHEMA_VERSION_KEY);
  const currentVersion =
    typeof data[SCHEMA_VERSION_KEY] === "number"
      ? (data[SCHEMA_VERSION_KEY] as number)
      : 0;

  if (currentVersion < SCHEMA_VERSION) {
    log.info(
      `Migrating schema from v${String(currentVersion)} to v${String(SCHEMA_VERSION)}`,
    );
    // Future migrations go here, keyed by version number:
    // if (currentVersion < 2) { ... }
  }
}

// --- Helpers ---

async function extractPageContent(
  tabId: number,
): Promise<ExtractedData | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      html: document.documentElement.innerHTML,
      text: document.body.innerText,
    }),
  });

  const pageData = results[0]?.result;
  if (!pageData) {
    return null;
  }

  return extractAll({
    mode: "html",
    html: pageData.html,
    text: pageData.text,
  });
}

async function extractFromTab(
  tabId: number,
  tabUrl: string | undefined,
): Promise<void> {
  try {
    const result = await extractPageContent(tabId);
    if (!result) {
      return;
    }

    await updateBadge(tabId, result.emails.length);
    await storeTemporaryResults(result.emails);

    const now = Date.now();
    await saveScan({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      url: tabUrl ?? "",
      timestamp: now,
      emailCount: result.emails.length,
      emails: result.emails,
    });

    if (result.emails.length > 0) {
      await showNotification(
        `Found ${result.emails.length} email${result.emails.length > 1 ? "s" : ""}`,
        tabUrl ?? "Unknown page",
      );
    }
  } catch (error) {
    log.warn("Failed to extract from tab:", error);
  }
}

async function autoScanTab(tabId: number, tabUrl: string): Promise<void> {
  try {
    const result = await extractPageContent(tabId);
    if (!result || result.emails.length === 0) {
      return;
    }

    await updateBadge(tabId, result.emails.length);

    const existingEmails = await getEmails();
    const existingSet = new Set(existingEmails.map((e) => e.email));
    const newEmails = result.emails.filter((e) => !existingSet.has(e));

    const now = Date.now();
    await saveScan({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      url: tabUrl,
      timestamp: now,
      emailCount: result.emails.length,
      emails: result.emails,
    });

    await upsertEmails(
      result.emails.map((email) => {
        const domain = email.split("@")[1] ?? "";
        return {
          email,
          domain,
          firstSeen: now,
          lastSeen: now,
          sourceUrls: tabUrl ? [tabUrl] : [],
          tags: [],
          notes: "",
          starred: false,
          type: classifyEmailType(email),
          provider: "custom" as const,
          confidence: 50,
          mxValid: null,
        };
      }),
    );

    if (newEmails.length > 0) {
      await showNotification(
        `${newEmails.length} new email${newEmails.length > 1 ? "s" : ""} found`,
        tabUrl,
      );
    }
  } catch (error) {
    log.debug("Auto-scan failed (expected on restricted pages):", error);
  }
}

async function updateBadge(tabId: number, count: number): Promise<void> {
  const text = count > 0 ? String(count) : "";
  const color = count > 0 ? "#6366f1" : "#999";
  await chrome.action.setBadgeText({ text, tabId });
  await chrome.action.setBadgeBackgroundColor({ color, tabId });
}

async function storeTemporaryResults(emails: string[]): Promise<void> {
  await chrome.storage.local.set({ _lastContextMenuResult: emails });
}

async function showNotification(title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: `Trawl: ${title}`,
      message,
    });
  } catch (error) {
    log.debug("Notification failed:", error);
  }
}

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
