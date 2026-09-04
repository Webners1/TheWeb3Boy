export function initTicker(): () => void {
  const track = document.getElementById("tickerTrack");
  if (!track) return () => {};
  const items = [
    "$ role: web3 builder, ai engineer, content creator",
    "$ product: youvsbtc, in development",
    "$ benchmark: btc, eth, sol",
    "$ experience: 6y web3, 2y ai, 40+ dapps shipped",
    "$ status: shipping, not hyping",
    "$ no ai slop detected",
  ];
  const html = items.map((t) => `<span>${t}</span>`).join("");
  track.innerHTML = html + html;
  return () => {
    track.innerHTML = "";
  };
}

export function initContactMenu(): () => void {
  const btn = document.getElementById("contactBtn");
  const menu = document.getElementById("contactMenu");
  if (!btn || !menu) return () => {};

  function close() {
    menu!.classList.remove("open");
    btn!.setAttribute("aria-expanded", "false");
  }
  function onBtnClick(e: MouseEvent) {
    e.stopPropagation();
    const isOpen = menu!.classList.toggle("open");
    btn!.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }
  function onDocClick(e: MouseEvent) {
    if (!menu!.contains(e.target as Node) && e.target !== btn) close();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  btn.addEventListener("click", onBtnClick);
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKeydown);

  return () => {
    btn.removeEventListener("click", onBtnClick);
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKeydown);
  };
}

export function initBlockCounter(): () => void {
  const el = document.getElementById("blockNum");
  if (!el) return () => {};
  let n = 118422 + Math.floor(Math.random() * 40);
  el.textContent = String(n).padStart(6, "0");
  const id = setInterval(() => {
    n += 1;
    el.textContent = String(n).padStart(6, "0");
  }, 4000);
  return () => clearInterval(id);
}
