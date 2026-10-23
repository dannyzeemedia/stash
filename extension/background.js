/* Click the toolbar button: the current tab goes to Stash's inbox.
   The badge says what happened, then clears itself. */

const STASH = "http://localhost:8800";

function flash(tabId, text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text, tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId }), 2200);
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
