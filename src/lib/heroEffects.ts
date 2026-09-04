import * as THREE from "three";

/**
 * Wires up every piece of hero interactivity: the text-scramble identity
 * cycler, the Three.js photo-distortion/magnify-lens shader, and the
 * hotspot label overlay. Ported from the original static prototype;
 * kept as one file since all three pieces read the same mouse state.
 */
export function initHeroEffects() {
  const cleanups: Array<() => void> = [];

  cleanups.push(initTextScramble());
  cleanups.push(initHotspots());
  cleanups.push(initHeroShader());

  return () => cleanups.forEach((fn) => fn());
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

function initHotspots(): () => void {
  const hero = document.getElementById("hero");
  const container = document.querySelector<HTMLElement>(".hero-hotspots");
  if (!hero || !container) return () => {};

  const hotspots = Array.from(container.querySelectorAll<HTMLElement>(".hotspot"));
  const IMG_W = 1500;
  const IMG_H = 500;

  function computeScale(rect: DOMRect) {
    const resRatio = rect.width / rect.height;
    const imgRatio = IMG_W / IMG_H;
    if (resRatio > imgRatio) return { x: 1, y: resRatio / imgRatio };
    return { x: imgRatio / resRatio, y: 1 };
  }

  function toScreen(u: number, v: number, scale: { x: number; y: number }) {
    return { x: (u - 0.5) * scale.x + 0.5, y: 1 - ((v - 0.5) * scale.y + 0.5) };
  }

  function layout() {
    const rect = hero!.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = computeScale(rect);
    hotspots.forEach((el) => {
      const uLeft = parseFloat(el.dataset.uleft || "0");
      const uRight = parseFloat(el.dataset.uright || "0");
      const vTop = parseFloat(el.dataset.vtop || "0");
      const vBottom = parseFloat(el.dataset.vbottom || "0");
      const tl = toScreen(uLeft, vTop, scale);
      const br = toScreen(uRight, vBottom, scale);
      el.style.left = `${tl.x * 100}%`;
      el.style.top = `${tl.y * 100}%`;
      el.style.width = `${(br.x - tl.x) * 100}%`;
      el.style.height = `${(br.y - tl.y) * 100}%`;
    });
  }

  window.addEventListener("resize", layout);
  layout();

  const win = window as unknown as { __heroHotspotBoost: number };
  win.__heroHotspotBoost = 0;
  const onEnter = () => (win.__heroHotspotBoost = 1);
  const onLeave = () => (win.__heroHotspotBoost = 0);
  hotspots.forEach((el) => {
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
  });

  return () => {
    window.removeEventListener("resize", layout);
    hotspots.forEach((el) => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    });
  };
}

function initHeroShader(): () => void {
  const canvas = document.getElementById("glcanvas") as HTMLCanvasElement | null;
  const hero = document.getElementById("hero");
  const photoImg = document.querySelector<HTMLImageElement>(".hero-photo");
  if (!canvas || !hero || !photoImg) return () => {};

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "low-power" });
  } catch {
    hero.classList.add("no-webgl");
    return () => {};
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();

  const texture = new THREE.Texture(photoImg);
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const uniforms = {
    u_texture: { value: texture },
    u_resolution: { value: new THREE.Vector2(1, 1) },
    u_imageResolution: { value: new THREE.Vector2(1500, 500) },
    u_time: { value: 0 },
    u_mouse: { value: new THREE.Vector2(0.5, 0.5) },
    u_reveal: { value: reducedMotion ? 1 : 0 },
    u_magnifyAmount: { value: 0 },
    u_hotspotBoost: { value: 0 },
  };

  function markTextureReady() {
    texture.needsUpdate = true;
    if (photoImg!.naturalWidth) {
      uniforms.u_imageResolution.value.set(photoImg!.naturalWidth, photoImg!.naturalHeight);
    }
  }
  if (photoImg.complete && photoImg.naturalWidth) {
    markTextureReady();
  } else {
    photoImg.addEventListener("load", markTextureReady, { once: true });
  }

  const vertSrc = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const fragSrc = `
    uniform sampler2D u_texture;
    uniform vec2 u_resolution;
    uniform vec2 u_imageResolution;
    uniform float u_time;
    uniform vec2 u_mouse;
    uniform float u_reveal;
    uniform float u_magnifyAmount;
    uniform float u_hotspotBoost;
    varying vec2 vUv;

    float hash21(vec2 p){
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    vec2 coverUv(vec2 uv, vec2 res, vec2 imgRes){
      float resRatio = res.x / res.y;
      float imgRatio = imgRes.x / imgRes.y;
      vec2 scale = resRatio > imgRatio ? vec2(1.0, resRatio / imgRatio) : vec2(imgRatio / resRatio, 1.0);
      return (uv - 0.5) / scale + 0.5;
    }

    void main(){
      vec2 uv = coverUv(vUv, u_resolution, u_imageResolution);
      vec2 mouseUv = coverUv(u_mouse, u_resolution, u_imageResolution);
      float imgAspect = u_imageResolution.x / u_imageResolution.y;

      vec2 delta = uv - mouseUv;
      delta.x *= imgAspect;
      float dist = length(delta);
      vec2 dir = delta / (dist + 1e-4);

      float lensRadius = 0.11;
      float inLens = smoothstep(lensRadius, lensRadius * 0.94, dist) * u_magnifyAmount;
      float zoom = 1.0 + (0.55 + 0.35 * u_hotspotBoost) * u_magnifyAmount;
      vec2 lensUv = mouseUv + (uv - mouseUv) / zoom;
      uv = mix(uv, lensUv, inLens);
      float rim = smoothstep(0.016, 0.0, abs(dist - lensRadius)) * u_magnifyAmount * 0.9;

      float strength = smoothstep(0.4, 0.0, dist) * (1.0 - inLens);
      float ripple = sin(dist * 34.0 - u_time * 3.2) * 0.018 * strength;
      vec2 distortedUv = uv + dir * ripple;

      float caAmt = strength * 0.012;
      float r = texture2D(u_texture, distortedUv + dir * caAmt).r;
      float g = texture2D(u_texture, distortedUv).g;
      float b = texture2D(u_texture, distortedUv - dir * caAmt).b;
      vec3 rawColor = vec3(r, g, b);
      vec3 graded = (rawColor - 0.5) * 1.1 + 0.5;
      graded *= 0.82;
      vec3 clear = rawColor * 1.2;
      vec3 color = mix(graded, clear, inLens);
      color += vec3(1.0) * rim;

      float block = hash21(floor(uv * 46.0));
      float mask = step(block, u_reveal);
      float active = 1.0 - step(0.999, u_reveal);
      float edge = smoothstep(0.0, 0.06, u_reveal - block) * (1.0 - step(0.06, u_reveal - block)) * active;

      vec3 revealed = mix(vec3(0.0), color, mask);
      revealed += vec3(0.373, 0.847, 0.788) * edge * 1.4;

      gl_FragColor = vec4(revealed, 1.0);
    }
  `;

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertSrc,
    fragmentShader: fragSrc,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const mouseTarget = [0.5, 0.5];
  const mouseCurrent = [0.5, 0.5];
  let heroHovering = false;

  function onPointerMove(e: PointerEvent) {
    const rect = canvas!.getBoundingClientRect();
    mouseTarget[0] = (e.clientX - rect.left) / rect.width;
    mouseTarget[1] = 1.0 - (e.clientY - rect.top) / rect.height;
  }
  function onPointerEnter() {
    heroHovering = true;
  }
  function onPointerLeave() {
    heroHovering = false;
  }
  if (!reducedMotion) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    hero.addEventListener("pointerenter", onPointerEnter);
    hero.addEventListener("pointerleave", onPointerLeave);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const rect = hero!.getBoundingClientRect();
    renderer.setPixelRatio(dpr);
    renderer.setSize(rect.width, rect.height, false);
    uniforms.u_resolution.value.set(rect.width * dpr, rect.height * dpr);
  }
  window.addEventListener("resize", resize);
  resize();

  const scrimEl = document.querySelector<HTMLElement>(".hero-scrim");
  const start = performance.now();
  let rafId: number | null = null;
  let revealedCanvas = false;
  let magnifyAmount = 0;
  let hotspotBoost = 0;

  function draw(now: number) {
    const time = (now - start) / 1000;
    mouseCurrent[0] += (mouseTarget[0] - mouseCurrent[0]) * 0.06;
    mouseCurrent[1] += (mouseTarget[1] - mouseCurrent[1]) * 0.06;
    uniforms.u_time.value = time;
    uniforms.u_mouse.value.set(mouseCurrent[0], mouseCurrent[1]);
    if (!reducedMotion && uniforms.u_reveal.value < 1) {
      uniforms.u_reveal.value = Math.min(1, time / 1.3);
    }
    const win = window as unknown as { __heroHotspotBoost?: number };
    const boostTarget = win.__heroHotspotBoost || 0;
    magnifyAmount += ((heroHovering ? 1 : 0) - magnifyAmount) * 0.1;
    hotspotBoost += (boostTarget - hotspotBoost) * 0.12;
    uniforms.u_magnifyAmount.value = magnifyAmount;
    uniforms.u_hotspotBoost.value = hotspotBoost;
    if (scrimEl) {
      scrimEl.style.setProperty("--lens-x", `${mouseCurrent[0] * 100}%`);
      scrimEl.style.setProperty("--lens-y", `${(1 - mouseCurrent[1]) * 100}%`);
      const radius = magnifyAmount * (hotspotBoost > 0.5 ? 155 : 130);
      scrimEl.style.setProperty("--lens-r", `${radius}px`);
    }
    renderer.render(scene, camera);
    if (!revealedCanvas) {
      revealedCanvas = true;
      canvas!.style.opacity = "1";
    }
  }
  function loop(now: number) {
    draw(now);
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

  let io: IntersectionObserver | null = null;
  function onVisibility() {
    if (document.hidden) stopLoop();
    else startLoop();
  }

  if (reducedMotion) {
    draw(performance.now());
  } else {
    io = new IntersectionObserver(
      (entries) => (entries[0].isIntersecting ? startLoop() : stopLoop()),
      { threshold: 0 }
    );
    io.observe(hero);
    document.addEventListener("visibilitychange", onVisibility);
    startLoop();
  }

  return () => {
    stopLoop();
    io?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("resize", resize);
    hero.removeEventListener("pointerenter", onPointerEnter);
    hero.removeEventListener("pointerleave", onPointerLeave);
    renderer.dispose();
    geometry.dispose();
    material.dispose();
  };
}
