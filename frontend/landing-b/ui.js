const menu = document.getElementById("menu");
const openBtn = document.getElementById("menu-open");
const closeBtn = document.getElementById("menu-close");
const backdrop = document.getElementById("menu-backdrop");

function setMenu(open) {
  menu.classList.toggle("is-open", open);
  openBtn.setAttribute("aria-expanded", String(open));
  (open ? closeBtn : openBtn).focus({ preventScroll: true });
}
openBtn.addEventListener("click", () => setMenu(true));
closeBtn.addEventListener("click", () => setMenu(false));
backdrop.addEventListener("click", () => setMenu(false));
for (const link of menu.querySelectorAll(".menu__link")) link.addEventListener("click", () => setMenu(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menu.classList.contains("is-open")) setMenu(false);
});

// Entering the product: fade the hero, then go. The dashboard shares the palette and type, so the
// cut reads as the same surface changing state rather than a new site.
for (const a of document.querySelectorAll("[data-enter]")) {
  a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    document.body.classList.add("is-leaving");
    setTimeout(() => { window.location.href = a.getAttribute("href"); }, 320);
  });
}
