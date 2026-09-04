/**
 * Hero text-identity cycler: scrambles the kinetic headline word and its
 * subline between a few short "what I build" pairs. The lens/hotspot
 * effect that used to live here moved to the HeroSpotlight component
 * (Framer Motion + CSS masks) - this file is just the text now.
 */
export function initHeroEffects() {
  return initTextScramble();
}

function initTextScramble(): () => void {
  const wordEl = document.getElementById("heroWord");
  const subEl = document.getElementById("heroSubline");
  if (!wordEl || !subEl) return () => {};

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pairs = [
    { word: "DAPP", sub: "web3 products, shipped and working." },
    { word: "AI AUTOMATION", sub: "systems that run without babysitting." },
    { word: "APPS", sub: "built for people, not for hype." },
    { word: "OPENSOURCE", sub: "public code, real transparency." },
  ];

  if (reducedMotion) {
    wordEl.textContent = pairs[0].word;
    subEl.textContent = pairs[0].sub;
    return () => {};
  }

  class TextScramble {
    el: HTMLElement;
    chars = "!<>-_\\/[]{}—=+*^?#01";
    queue: Array<{ from: string; to: string; start: number; end: number; char: string | null }> = [];
    frame = 0;
    frameRequest: number | null = null;
    resolve: (() => void) | null = null;

    constructor(el: HTMLElement) {
      this.el = el;
    }

    setText(newText: string) {
      const oldText = this.el.textContent || "";
      const length = Math.max(oldText.length, newText.length);
      const promise = new Promise<void>((resolve) => {
        this.resolve = resolve;
      });
      this.queue = [];
      for (let i = 0; i < length; i++) {
        const from = oldText[i] || "";
        const to = newText[i] || "";
        const start = Math.floor(Math.random() * 30);
        const end = start + Math.floor(Math.random() * 30);
        this.queue.push({ from, to, start, end, char: null });
      }
      if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
      this.frame = 0;
      this.update();
      return promise;
    }

    update = () => {
      let output = "";
      let complete = 0;
      for (const item of this.queue) {
        if (this.frame >= item.end) {
          complete++;
          output += item.to;
        } else if (this.frame >= item.start) {
          if (!item.char || Math.random() < 0.28) {
            item.char = this.chars[Math.floor(Math.random() * this.chars.length)];
          }
          output += `<span class="scramble-char">${item.char}</span>`;
        } else {
          output += item.from;
        }
      }
      this.el.innerHTML = output;
      if (complete === this.queue.length) {
        this.resolve?.();
      } else {
        this.frameRequest = requestAnimationFrame(this.update);
        this.frame++;
      }
    };
  }

  const wordFx = new TextScramble(wordEl);
  const subFx = new TextScramble(subEl);
  // Start at index 1: index 0 is already on screen as the static initial
  // markup, so the very first scramble should visibly change something
  // instead of re-scrambling the same word back onto itself.
  let counter = 1;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let paused = false;
  let stopped = false;

  function next() {
    if (stopped) return;
    const pair = pairs[counter % pairs.length];
    wordFx.setText(pair.word);
    subFx.setText(pair.sub).then(() => {
      if (!stopped) timeoutId = setTimeout(next, 2800);
    });
    counter += 1;
  }

  const io = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && paused) {
        paused = false;
        next();
      } else if (!entries[0].isIntersecting) {
        paused = true;
        if (timeoutId) clearTimeout(timeoutId);
      }
    },
    { threshold: 0 }
  );
  io.observe(wordEl);

  const startTimeout = setTimeout(next, 900);

  return () => {
    stopped = true;
    if (timeoutId) clearTimeout(timeoutId);
    clearTimeout(startTimeout);
    io.disconnect();
  };
}
