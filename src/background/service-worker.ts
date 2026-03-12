import { extractAll } from "../lib/extract.ts";
import {
  getSettings,
  saveScan,
  upsertEmail,
  getEmails,
} from "../lib/storage.ts";
import { classifyEmailType } from "../lib/intelligence.ts";
import log from "../lib/logger.ts";

const MENU_EXTRACT_PAGE = "trawl-extract-page";
const MENU_EXTRACT_SELECTION = "trawl-extract-selection";

// --- Install / Context Menus ---

chrome.runtime.onInstalled.addListener(() => {
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

  log.info("Trawl context menus created");
});

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
      settings.blocklist.some((d) => domain.includes(d))
    ) {
      return;
    }

    if (
      settings.allowlist.length > 0 &&
      !settings.allowlist.some((d) => domain.includes(d))
    ) {
      return;
    }

    // Auto-extract with a small delay to let page render
    setTimeout(() => {
      autoScanTab(tabId, tab.url ?? "").catch((error: unknown) =>
        log.debug("Auto-scan error:", error),
      );
    }, 1500);
  },
);

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

// --- Helpers ---

async function extractFromTab(
  tabId: number,
  tabUrl: string | undefined,
): Promise<void> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        html: document.documentElement.innerHTML,
        text: document.body.innerText,
      }),
    });

    const pageData = results[0]?.result;
    if (pageData) {
      const result = extractAll({
        mode: "html",
        html: pageData.html,
        text: pageData.text,
      });
      await updateBadge(tabId, result.emails.length);
      await storeTemporaryResults(result.emails);

      // Save scan
      const now = Date.now();
      await saveScan({
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        url: tabUrl ?? "",
        timestamp: now,
        emailCount: result.emails.length,
        emails: result.emails,
      });

      // Notify if emails found
      if (result.emails.length > 0) {
        await showNotification(
          `Found ${result.emails.length} email${result.emails.length > 1 ? "s" : ""}`,
          tabUrl ?? "Unknown page",
        );
      }
    }
  } catch (error) {
    log.warn("Failed to extract from tab:", error);
  }
}

async function autoScanTab(tabId: number, tabUrl: string): Promise<void> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        html: document.documentElement.innerHTML,
        text: document.body.innerText,
      }),
    });

    const pageData = results[0]?.result;
    if (!pageData) {
      return;
    }

    const result = extractAll({
      mode: "html",
      html: pageData.html,
      text: pageData.text,
    });

    if (result.emails.length === 0) {
      return;
    }

    await updateBadge(tabId, result.emails.length);

    // Check for new emails (change detection)
    const existingEmails = await getEmails();
    const existingSet = new Set(existingEmails.map((e) => e.email));
    const newEmails = result.emails.filter((e) => !existingSet.has(e));

    // Save all
    const now = Date.now();
    await saveScan({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      url: tabUrl,
      timestamp: now,
      emailCount: result.emails.length,
      emails: result.emails,
    });

    await Promise.allSettled(
      result.emails.map((email) => {
        const domain = email.split("@")[1] ?? "";
        return upsertEmail({
          email,
          domain,
          firstSeen: now,
          lastSeen: now,
          sourceUrls: tabUrl ? [tabUrl] : [],
          tags: [],
          notes: "",
          starred: false,
          type: classifyEmailType(email),
          provider: "custom",
          confidence: 50,
          mxValid: null,
        });
      }),
    );

    // Notify about new emails
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
