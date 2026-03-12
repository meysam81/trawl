const runBtn = document.getElementById("run");
const outEl = document.getElementById("out");
const resultsEl = document.getElementById("results");
const countEl = document.getElementById("count");
const copyBtn = document.getElementById("copy");

let lastEmails = [];

runBtn.addEventListener("click", async () => {
  runBtn.classList.add("loading");
  runBtn.textContent = "Scanning\u2026";

  const mode = document.getElementById("mode").value;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (m) => {
        const src =
          m === "html"
            ? document.documentElement.innerHTML
            : document.body.innerText;
        return [
          ...new Set(
            [
              ...src.matchAll(
                /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
              ),
            ].map((x) => x[0]),
          ),
        ];
      },
      args: [mode],
    });

    lastEmails = result;
    resultsEl.classList.add("visible");

    if (result.length) {
      countEl.textContent = `${result.length} email${result.length > 1 ? "s" : ""} found`;
      outEl.textContent = result.join("\n");
      outEl.classList.remove("empty");
      copyBtn.style.display = "";
    } else {
      countEl.textContent = "";
      outEl.textContent = "No emails found on this page.";
      outEl.classList.add("empty");
      copyBtn.style.display = "none";
    }
  } catch {
    resultsEl.classList.add("visible");
    countEl.textContent = "";
    outEl.textContent = "Cannot access this page.";
    outEl.classList.add("empty");
    copyBtn.style.display = "none";
  }

  runBtn.classList.remove("loading");
  runBtn.textContent = "Collect";
});

copyBtn.addEventListener("click", () => {
  if (!lastEmails.length) {
    return;
  }
  navigator.clipboard.writeText(lastEmails.join("\n"));
  copyBtn.textContent = "Copied!";
  copyBtn.classList.add("copied");
  setTimeout(() => {
    copyBtn.textContent = "Copy";
    copyBtn.classList.remove("copied");
  }, 1200);
});
