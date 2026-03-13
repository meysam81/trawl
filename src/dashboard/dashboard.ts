import {
  getEmails,
  saveEmails,
  upsertEmail,
  deleteEmail,
  getScans,
} from "../lib/storage.ts";
import {
  toCSV,
  toJSON,
  toVCard,
  downloadBlob,
  composeGmailUrl,
  composeOutlookUrl,
} from "../lib/export.ts";
import type { EmailRecord } from "../lib/schemas.ts";
import log from "../lib/logger.ts";

const searchInput = document.getElementById("search") as HTMLInputElement;
const filterDomain = document.getElementById(
  "filter-domain",
) as HTMLSelectElement;
const filterType = document.getElementById("filter-type") as HTMLSelectElement;
const emailTbody = document.getElementById(
  "email-tbody",
) as HTMLTableSectionElement;
const emptyState = document.getElementById("empty-state") as HTMLDivElement;
const statsBar = document.getElementById("stats-bar") as HTMLDivElement;
const selectAll = document.getElementById("select-all") as HTMLInputElement;
const recentScansEl = document.getElementById("recent-scans") as HTMLDivElement;
const bulkDeleteBtn = document.getElementById(
  "bulk-delete",
) as HTMLButtonElement;
const bulkTagBtn = document.getElementById("bulk-tag") as HTMLButtonElement;
const bulkExportCsvBtn = document.getElementById(
  "bulk-export-csv",
) as HTMLButtonElement;
const bulkExportJsonBtn = document.getElementById(
  "bulk-export-json",
) as HTMLButtonElement;
const bulkExportVcardBtn = document.getElementById(
  "bulk-export-vcard",
) as HTMLButtonElement;

let allEmails: EmailRecord[] = [];
let filteredEmails: EmailRecord[] = [];
const selectedEmails = new Set<string>();

async function init(): Promise<void> {
  allEmails = await getEmails();
  applyFilters();
  renderStats();
  populateDomainFilter();
  await renderRecentScans();
}

function applyFilters(): void {
  const query = searchInput.value.toLowerCase();
  const domainFilter = filterDomain.value;
  const typeFilter = filterType.value;

  filteredEmails = allEmails.filter((e) => {
    if (query) {
      const matchesQuery =
        e.email.toLowerCase().includes(query) ||
        e.domain.toLowerCase().includes(query) ||
        e.tags.some((t) => t.toLowerCase().includes(query)) ||
        e.notes.toLowerCase().includes(query);
      if (!matchesQuery) {
        return false;
      }
    }
    if (domainFilter && e.domain !== domainFilter) {
      return false;
    }
    if (typeFilter && e.type !== typeFilter) {
      return false;
    }
    return true;
  });

  renderTable();
}

function renderStats(): void {
  const domains = new Set(allEmails.map((e) => e.domain));
  statsBar.replaceChildren();

  const stats = [
    { label: "Total emails", value: String(allEmails.length) },
    { label: "Domains", value: String(domains.size) },
    {
      label: "Starred",
      value: String(allEmails.filter((e) => e.starred).length),
    },
  ];

  for (const stat of stats) {
    const el = document.createElement("span");
    el.className = "stat";

    const valueEl = document.createElement("span");
    valueEl.className = "stat-value";
    valueEl.textContent = stat.value;

    el.append(valueEl);
    el.append(document.createTextNode(` ${stat.label}`));
    statsBar.append(el);
  }
}

function populateDomainFilter(): void {
  const domains = [...new Set(allEmails.map((e) => e.domain))].sort();
  const current = filterDomain.value;

  while (filterDomain.options.length > 1) {
    filterDomain.remove(1);
  }

  for (const domain of domains) {
    const option = document.createElement("option");
    option.value = domain;
    option.textContent = domain;
    filterDomain.append(option);
  }

  filterDomain.value = current;
}

function syncSelectAll(): void {
  const total = filteredEmails.length;
  const selected = filteredEmails.filter((e) =>
    selectedEmails.has(e.email),
  ).length;
  selectAll.checked = total > 0 && selected === total;
  selectAll.indeterminate = selected > 0 && selected < total;
}

function renderTable(): void {
  emailTbody.replaceChildren();

  if (filteredEmails.length === 0) {
    emptyState.classList.add("visible");
    syncSelectAll();
    return;
  }

  emptyState.classList.remove("visible");

  for (const record of filteredEmails) {
    const tr = document.createElement("tr");

    // Checkbox
    const checkTd = document.createElement("td");
    checkTd.className = "col-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedEmails.has(record.email);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedEmails.add(record.email);
      } else {
        selectedEmails.delete(record.email);
      }
      syncSelectAll();
    });
    checkTd.append(checkbox);
    tr.append(checkTd);

    // Star
    const starTd = document.createElement("td");
    starTd.className = "col-star";
    const starBtn = document.createElement("button");
    starBtn.className = `star-btn${record.starred ? " starred" : ""}`;
    starBtn.textContent = record.starred ? "\u2605" : "\u2606";
    starBtn.addEventListener("click", () => {
      toggleStar(record.email).catch((error: unknown) =>
        log.warn("Toggle star failed:", error),
      );
    });
    starTd.append(starBtn);
    tr.append(starTd);

    // Email
    const emailTd = document.createElement("td");
    emailTd.className = "email-cell";
    emailTd.textContent = record.email;
    tr.append(emailTd);

    // Domain
    const domainTd = document.createElement("td");
    domainTd.textContent = record.domain;
    tr.append(domainTd);

    // Type
    const typeTd = document.createElement("td");
    const typeBadge = document.createElement("span");
    typeBadge.className = `type-badge type-${record.type}`;
    typeBadge.textContent = record.type;
    typeTd.append(typeBadge);
    tr.append(typeTd);

    // Confidence
    const confTd = document.createElement("td");
    const confBar = document.createElement("span");
    confBar.className = "confidence-bar";
    const confFill = document.createElement("span");
    confFill.className = `confidence-fill ${getConfidenceClass(record.confidence)}`;
    confFill.style.width = `${record.confidence}%`;
    confBar.append(confFill);
    confTd.append(confBar);
    confTd.append(document.createTextNode(`${record.confidence}`));
    tr.append(confTd);

    // Tags
    const tagsTd = document.createElement("td");
    for (const tag of record.tags) {
      const tagEl = document.createElement("span");
      tagEl.className = "tag";
      tagEl.textContent = tag;
      tagsTd.append(tagEl);
    }
    tr.append(tagsTd);

    // Last seen
    const seenTd = document.createElement("td");
    seenTd.textContent = formatDate(record.lastSeen);
    tr.append(seenTd);

    // Actions
    const actionsTd = document.createElement("td");
    const copyBtn = createActionBtn("Copy", () => {
      navigator.clipboard
        .writeText(record.email)
        .catch((error: unknown) => log.warn("Clipboard write failed:", error));
    });
    const deleteBtn = createActionBtn("Delete", () => {
      handleDelete(record.email).catch((error: unknown) =>
        log.warn("Delete failed:", error),
      );
    });
    const noteBtn = createActionBtn("Note", () => {
      handleNote(record.email).catch((error: unknown) =>
        log.warn("Note update failed:", error),
      );
    });
    const gmailBtn = createActionBtn("Gmail", () => {
      window.open(composeGmailUrl(record.email), "_blank");
    });
    const outlookBtn = createActionBtn("Outlook", () => {
      window.open(composeOutlookUrl(record.email), "_blank");
    });
    actionsTd.append(copyBtn, deleteBtn, noteBtn, gmailBtn, outlookBtn);
    tr.append(actionsTd);

    emailTbody.append(tr);
  }

  syncSelectAll();
}

function createActionBtn(
  label: string,
  handler: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "action-btn";
  btn.textContent = label;
  btn.addEventListener("click", handler);
  return btn;
}

function getConfidenceClass(confidence: number): string {
  if (confidence >= 70) {
    return "confidence-high";
  }
  if (confidence >= 40) {
    return "confidence-mid";
  }
  return "confidence-low";
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}

async function toggleStar(email: string): Promise<void> {
  const record = allEmails.find((e) => e.email === email);
  if (!record) {
    return;
  }
  record.starred = !record.starred;
  await upsertEmail(record);
  applyFilters();
  renderStats();
}

async function handleDelete(email: string): Promise<void> {
  await deleteEmail(email);
  allEmails = allEmails.filter((e) => e.email !== email);
  selectedEmails.delete(email);
  applyFilters();
  renderStats();
  populateDomainFilter();
}

function showPromptDialog(
  message: string,
  defaultValue: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999";

    const dialog = document.createElement("div");
    dialog.style.cssText =
      "background:#fff;border-radius:8px;padding:20px;min-width:340px;box-shadow:0 8px 32px rgba(0,0,0,0.2)";

    const label = document.createElement("p");
    label.textContent = message;
    label.style.cssText = "margin:0 0 12px;font-size:14px;color:#2d2d2d";

    const input = document.createElement("input");
    input.type = "text";
    input.value = defaultValue;
    input.style.cssText =
      "width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box";

    const btnRow = document.createElement("div");
    btnRow.style.cssText =
      "display:flex;gap:8px;justify-content:flex-end;margin-top:12px";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText =
      "padding:6px 16px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer";

    const okBtn = document.createElement("button");
    okBtn.textContent = "OK";
    okBtn.style.cssText =
      "padding:6px 16px;border:none;border-radius:4px;background:#6366f1;color:#fff;cursor:pointer";

    cancelBtn.addEventListener("click", () => {
      overlay.remove();
      resolve(null);
    });
    okBtn.addEventListener("click", () => {
      overlay.remove();
      resolve(input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        overlay.remove();
        resolve(input.value);
      }
      if (e.key === "Escape") {
        overlay.remove();
        resolve(null);
      }
    });

    btnRow.append(cancelBtn, okBtn);
    dialog.append(label, input, btnRow);
    overlay.append(dialog);
    document.body.append(overlay);
    input.focus();
  });
}

function showConfirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999";

    const dialog = document.createElement("div");
    dialog.style.cssText =
      "background:#fff;border-radius:8px;padding:20px;min-width:340px;box-shadow:0 8px 32px rgba(0,0,0,0.2)";

    const label = document.createElement("p");
    label.textContent = message;
    label.style.cssText = "margin:0 0 12px;font-size:14px;color:#2d2d2d";

    const btnRow = document.createElement("div");
    btnRow.style.cssText =
      "display:flex;gap:8px;justify-content:flex-end;margin-top:12px";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText =
      "padding:6px 16px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer";

    const okBtn = document.createElement("button");
    okBtn.textContent = "Delete";
    okBtn.style.cssText =
      "padding:6px 16px;border:none;border-radius:4px;background:#ef4444;color:#fff;cursor:pointer";

    cancelBtn.addEventListener("click", () => {
      overlay.remove();
      resolve(false);
    });
    okBtn.addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        overlay.remove();
        resolve(false);
      }
    });

    btnRow.append(cancelBtn, okBtn);
    dialog.append(label, btnRow);
    overlay.append(dialog);
    document.body.append(overlay);
    okBtn.focus();
  });
}

async function handleNote(email: string): Promise<void> {
  const record = allEmails.find((e) => e.email === email);
  if (!record) {
    return;
  }
  const note = await showPromptDialog("Note for " + email + ":", record.notes);
  if (note !== null) {
    record.notes = note;
    await upsertEmail(record);
  }
}

async function renderRecentScans(): Promise<void> {
  const scans = await getScans();
  recentScansEl.replaceChildren();

  const recent = scans.slice(-10).reverse();

  if (recent.length === 0) {
    const p = document.createElement("p");
    p.textContent = "No scans yet.";
    p.style.color = "#9090a0";
    p.style.fontStyle = "italic";
    recentScansEl.append(p);
    return;
  }

  for (const scan of recent) {
    const item = document.createElement("div");
    item.className = "scan-item";

    const urlEl = document.createElement("span");
    urlEl.className = "scan-url";
    urlEl.textContent = scan.url;
    item.append(urlEl);

    const metaEl = document.createElement("span");
    metaEl.className = "scan-meta";

    const countEl = document.createElement("span");
    countEl.textContent = `${scan.emailCount} emails`;
    metaEl.append(countEl);

    const timeEl = document.createElement("span");
    timeEl.textContent = new Date(scan.timestamp).toLocaleString();
    metaEl.append(timeEl);

    item.append(metaEl);
    recentScansEl.append(item);
  }
}

// Event listeners
searchInput.addEventListener("input", () => {
  applyFilters();
});

filterDomain.addEventListener("change", () => {
  applyFilters();
});

filterType.addEventListener("change", () => {
  applyFilters();
});

selectAll.addEventListener("change", () => {
  selectedEmails.clear();
  if (selectAll.checked) {
    for (const e of filteredEmails) {
      selectedEmails.add(e.email);
    }
  }
  renderTable();
});

bulkDeleteBtn.addEventListener("click", () => {
  if (selectedEmails.size === 0) {
    return;
  }
  const count = selectedEmails.size;
  showConfirmDialog(
    `Delete ${count} email${count > 1 ? "s" : ""}? This cannot be undone.`,
  )
    .then((confirmed) => {
      if (!confirmed) {
        return;
      }
      return Promise.allSettled(
        [...selectedEmails].map((email) => deleteEmail(email)),
      ).then(() => {
        allEmails = allEmails.filter((e) => !selectedEmails.has(e.email));
        selectedEmails.clear();
        selectAll.checked = false;
        applyFilters();
        renderStats();
        populateDomainFilter();
        if (
          filteredEmails.length === 0 &&
          (searchInput.value || filterDomain.value || filterType.value)
        ) {
          searchInput.value = "";
          filterDomain.value = "";
          filterType.value = "";
          applyFilters();
        }
      });
    })
    .catch((error: unknown) => log.warn("Bulk delete failed:", error));
});

bulkTagBtn.addEventListener("click", () => {
  if (selectedEmails.size === 0) {
    return;
  }
  showPromptDialog("Enter tag:", "")
    .then(async (tag) => {
      if (!tag) {
        return;
      }
      for (const email of selectedEmails) {
        const record = allEmails.find((e) => e.email === email);
        if (record && !record.tags.includes(tag)) {
          record.tags.push(tag);
        }
      }
      await saveEmails(allEmails);
      applyFilters();
    })
    .catch((error: unknown) => log.warn("Bulk tag failed:", error));
});

bulkExportCsvBtn.addEventListener("click", () => {
  const records = getSelectedRecords();
  const csv = toCSV(records);
  downloadBlob(csv, "trawl-export.csv", "text/csv");
});

bulkExportJsonBtn.addEventListener("click", () => {
  const records = getSelectedRecords();
  const json = toJSON(records);
  downloadBlob(json, "trawl-export.json", "application/json");
});

bulkExportVcardBtn.addEventListener("click", () => {
  const records = getSelectedRecords();
  const vcard = toVCard(records);
  downloadBlob(vcard, "trawl-export.vcf", "text/vcard");
});

function getSelectedRecords(): EmailRecord[] {
  if (selectedEmails.size > 0) {
    return allEmails.filter((e) => selectedEmails.has(e.email));
  }
  return filteredEmails;
}

init().catch((error: unknown) => log.warn("Dashboard init failed:", error));
