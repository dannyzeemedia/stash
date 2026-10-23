/* Click the toolbar button: the current tab goes to Stash's inbox.
   Right-click on a Papaly page: import that whole board.
   The badge says what happened, then clears itself. */

const STASH = "http://localhost:8800";

function flash(tabId, text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text, tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId }), 2600);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
    flash(tab && tab.id, "—", "#8b94a6");
    return;
  }
  try {
    const body = new URLSearchParams({ url: tab.url, title: tab.title || tab.url });
    const res = await fetch(STASH + "/save", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    const text = await res.text();
    if (!res.ok) throw new Error(res.status);
    flash(tab.id, text.includes("Already") ? "dup" : "✓", "#2f9e63");
  } catch (e) {
    // Stash isn't running, or it moved.
    flash(tab.id, "!", "#e8685d");
  }
});

/* ---------------------------------------------------------------- import */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "import-papaly",
      title: "Import this Papaly board into Stash",
      contexts: ["page", "action"],
      documentUrlPatterns: ["https://papaly.com/*", "https://*.papaly.com/*"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "import-papaly" || !tab) return;
  try {
    const [run] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["scrape-papaly.js"]
    });
    const categories = run && run.result;
    if (!categories || !categories.length) {
      flash(tab.id, "0", "#e8b84b");
      notify("Nothing found", "Open the board you want, then try again.");
      return;
    }
    const res = await fetch(STASH + "/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories })
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || res.status);
    flash(tab.id, String(out.links), "#2f9e63");
    notify(
      "Imported into Stash",
      `${out.links} link${out.links === 1 ? "" : "s"} in ${out.categories} ` +
      `categor${out.categories === 1 ? "y" : "ies"}` +
      (out.skipped ? `, ${out.skipped} already there` : "")
    );
  } catch (e) {
    flash(tab.id, "!", "#e8685d");
    notify("Import failed", String(e.message || e));
  }
});

function notify(title, message) {
  if (chrome.notifications) {
    chrome.notifications.create({
      type: "basic", iconUrl: "icons/icon128.png", title, message
    });
  }
}
