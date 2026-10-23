/* The new tab shows Stash in a frame rather than navigating to it. Chrome
   keeps the address bar focused on an extension new-tab page, so a new tab is
   still "open and start typing" — which navigating away would take from you. */

const STASH = "http://localhost:8800/";

async function show() {
  document.getElementById("down").classList.add("hidden");
  try {
    const ping = await fetch(STASH + "api/board", {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(2500)
    });
    if (!ping.ok) throw new Error(ping.status);
  } catch (e) {
    document.getElementById("holder").innerHTML = "";
    document.getElementById("down").classList.remove("hidden");
    return;
  }

  const frame = document.createElement("iframe");
  frame.src = STASH + "?framed=1";
  // Never steal the caret from the address bar on load.
  frame.setAttribute("tabindex", "-1");
  document.getElementById("holder").appendChild(frame);
}

document.getElementById("retry").addEventListener("click", show);
show();
