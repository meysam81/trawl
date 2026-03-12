// Content script — runs in page context at document_idle.
// Listens for messages from popup/service-worker to extract data.

import {
  extractAll,
  extractEmailsFromSelection,
  type ExtractedData,
} from "../lib/extract.ts";

interface ExtractMessage {
  type: "EXTRACT_PAGE" | "EXTRACT_SELECTION";
  mode?: "text" | "html";
}

chrome.runtime.onMessage.addListener(
  (
    message: ExtractMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtractedData | { emails: string[] }) => void,
  ) => {
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

    return false;
  },
);
