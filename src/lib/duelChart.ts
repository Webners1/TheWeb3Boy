/**
 * Draws the "YOU vs BTC" sample line chart on a 2D canvas. Independent of
 * the WebGL hero shader — this is plain canvas, no Three.js needed for two lines.
 */
export function initDuelChart(): () => void {
  const canvas = document.getElementById("duelCanvas") as HTMLCanvasElement | null;
  if (!canvas) return () => {};
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const wrap = canvas.parentElement;
  if (!wrap) return () => {};

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let W = 0;
  const H = 220;

  function resize() {
    const rect = wrap!.getBoundingClientRect();
    W = rect.width;
    canvas!.width = Math.max(1, Math.round(W * dpr));
    canvas!.height = Math.max(1, Math.round(H * dpr));
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  const N = 60;
  const seriesYou = (x: number, ph: number) => x * 0.62 + Math.sin(x * 0.9 + ph) * 9 + Math.sin(x * 2.3 + ph * 1.3) * 3;
  const seriesBtc = (x: number, ph: number) => x * 0.34 + Math.sin(x * 0.8 + ph * 0.8 + 1.0) * 10 + Math.sin(x * 2.0 + ph) * 4;

  function strokeLine(pts: number[][], color: string) {
    ctx!.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx!.moveTo(x, y) : ctx!.lineTo(x, y)));
    ctx!.strokeStyle = color;
    ctx!.lineWidth = 2;
    ctx!.shadowColor = color;
    ctx!.shadowBlur = 8;
    ctx!.stroke();
    ctx!.shadowBlur = 0;
    const last = pts[pts.length - 1];
    const pulse = 2.5 + Math.sin(performance.now() / 450) * 1.2;
    ctx!.beginPath();
    ctx!.arc(last[0], last[1], 4 + pulse, 0, Math.PI * 2);
    ctx!.globalAlpha = 0.35;
    ctx!.fillStyle = color;
    ctx!.fill();
    ctx!.globalAlpha = 1;
    ctx!.beginPath();
    ctx!.arc(last[0], last[1], 3.5, 0, Math.PI * 2);
    ctx!.fillStyle = color;
    ctx!.fill();
  }

  function draw(t: number) {
    const ph = t * 0.05;
    ctx!.clearRect(0, 0, W, H);
    const padX = 4;
    const padTop = 26;
    const padBottom = 26;
    const youVals: number[] = [];
    const btcVals: number[] = [];
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 10;
      const yv = seriesYou(x, ph);
      const bv = seriesBtc(x, ph);
      youVals.push(yv);
      btcVals.push(bv);
      minV = Math.min(minV, yv, bv);
      maxV = Math.max(maxV, yv, bv);
    }
    const range = maxV - minV || 1;
    function toPts(vals: number[]) {
      return vals.map((v, i) => {
        const px = padX + (i / (vals.length - 1)) * (W - padX * 2);
        const py = padTop + (1 - (v - minV) / range) * (H - padTop - padBottom);
        return [px, py];
      });
    }
    strokeLine(toPts(btcVals), "#E2793B");
    strokeLine(toPts(youVals), "#5FD8C9");
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  draw(0);
  if (reducedMotion) {
    return () => window.removeEventListener("resize", resize);
  }

  let rafId: number | null = null;
  function loop(now: number) {
    draw(now / 1000);
    rafId = requestAnimationFrame(loop);
  }
  function startLoop() {
    if (rafId === null) rafId = requestAnimationFrame(loop);
  }
  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  const io = new IntersectionObserver((entries) => (entries[0].isIntersecting ? startLoop() : stopLoop()), {
    threshold: 0,
  });
  io.observe(wrap);
  function onVisibility() {
    if (document.hidden) stopLoop();
    else startLoop();
  }
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    stopLoop();
    io.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("resize", resize);
  };
}
