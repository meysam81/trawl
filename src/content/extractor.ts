// Content script — runs in page context at document_idle.
// Listens for messages from popup/service-worker to extract data.

import {
  extractAll,
  extractEmailsFromSelection,
  type ExtractedData,
} from "../lib/extract.ts";
import { extractVisibleUrls } from "../lib/url-extract.ts";
import type {
  UrlRecord,
  UrlSourceMode,
  UrlVisibilityMode,
} from "../lib/schemas.ts";

interface ExtractMessage {
  type: "EXTRACT_PAGE" | "EXTRACT_SELECTION" | "EXTRACT_URLS";
  mode?: "text" | "html";
  visibilityMode?: UrlVisibilityMode;
  sourceMode?: UrlSourceMode;
}

type ExtractResponse =
  | ExtractedData
  | { emails: string[] }
  | { urls: UrlRecord[] };

chrome.runtime.onMessage.addListener(
  (
    message: ExtractMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtractResponse) => void,
  ) => {
    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    if (message.type === "EXTRACT_PAGE") {
      const mode = message.mode ?? "html";
      const result = extractAll({
        mode,
        html: document.documentElement.innerHTML,
        text: document.body.innerText,
      });
      sendResponse(result);
    }

    if (message.type === "EXTRACT_SELECTION") {
      const selection = window.getSelection()?.toString() ?? "";
      const emails = extractEmailsFromSelection(selection);
      sendResponse({ emails });
    }

    if (message.type === "EXTRACT_URLS") {
      const urls = extractVisibleUrls({
        root: document,
        visibilityMode: message.visibilityMode ?? "visible",
        sourceMode: message.sourceMode ?? "comprehensive",
      });
      sendResponse({ urls });
    }

    return false;
  },
);
