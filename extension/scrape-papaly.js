/* Injected into a Papaly tab. Reads the board that is on screen - which works
   whether or not the board is public, because the person is logged in.
   Papaly's own export returns folder names and no links, so this is the only
   reliable way out. */
(() => {
  const text = (el) => (el ? el.textContent.trim() : "");
  const out = [];

  document.querySelectorAll("div.board[board-name]").forEach((board) => {
    if (board.offsetParent === null && document.querySelectorAll("div.board").length > 1) return;
    board.querySelectorAll("[category-name]").forEach((card) => {
      const links = [];
      card.querySelectorAll("li.item-bookmark").forEach((li) => {
        const url = li.getAttribute("url");
        if (!url) return;
        links.push({ url, title: text(li.querySelector(".item-name")) || url });
      });
      if (links.length) out.push({ name: card.getAttribute("category-name"), links });
    });
  });

  // The link bar down the side holds anything never filed.
  const inbox = [];
  document.querySelectorAll("#inbox-section li.item-bookmark").forEach((li) => {
    const url = li.getAttribute("url");
    if (url) inbox.push({ url, title: text(li.querySelector(".item-name")) || url });
  });
  if (inbox.length) out.push({ name: "Papaly inbox", links: inbox });

  return out;
})();
