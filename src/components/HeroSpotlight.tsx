"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useSpring, useMotionTemplate } from "framer-motion";

/**
 * "Magic Lens Object Identification" hero background.
 *
 * Four stacked layers:
 *  1. Base  - the photo, dulled (dim/blurred/desaturated).
 *  2. Hotspots - invisible regions that set which tooltip is active.
 *  3. Lens  - the same photo at full clarity, revealed only inside a
 *     circular mask that follows the (spring-smoothed) cursor.
 *  4. Tooltip - floating label for whatever hotspot is under the lens.
 *
 * Mouse position is tracked with useMotionValue + useSpring, not React
 * state, so the lens can move every frame without re-rendering the tree.
 */

const IMAGE_URL = "/hero.jpg";
const IMG_W = 1500;
const IMG_H = 500;

const LENS_RADIUS = 70;

// Must live outside the component. A fresh object here re-initialises
// useSpring on every render, and because MotionValue.set() is a no-op when
// the value hasn't changed, an axis that isn't currently moving (e.g. Y
// while you track sideways) would stay stuck at whatever the reset left it.
const SPRING_CONFIG = { stiffness: 400, damping: 40 };

type HotspotDef = {
  id: string;
  label: string;
  /** Fractions of the *source photo* (0..1), not the container - u is
   * left-to-right, v is bottom-to-top (v=1 is the top of the image). */
  uLeft: number;
  uRight: number;
  vTop: number;
  vBottom: number;
};

// Measured from an actual pixel-by-pixel pass over the source photo
// (1500x500). Ordered back-to-front: where two regions overlap in the
// real photo (you sit in front of part of the right monitor), the later
// one in this list wins the hover.
const HOTSPOT_DEFS: HotspotDef[] = [
  { id: "pc", label: "My PC, main monitors", uLeft: 0.057, uRight: 0.57, vTop: 0.624, vBottom: 0.08 },
  { id: "laptop", label: "My laptop", uLeft: 0.057, uRight: 0.2, vTop: 0.244, vBottom: 0.0 },
  { id: "mic", label: "My podcast mic and camera setup", uLeft: 0.333, uRight: 0.379, vTop: 0.254, vBottom: 0.064 },
  // Kept deliberately small: the red band sits on the mic body, so a large
  // box here would cover the mic's own hotspot and make it unhoverable.
  { id: "led1", label: "RGB LED setup", uLeft: 0.342, uRight: 0.37, vTop: 0.228, vBottom: 0.19 },
  { id: "led2", label: "LED indicator", uLeft: 0.307, uRight: 0.323, vTop: 0.212, vBottom: 0.172 },
  { id: "face", label: "This is me, the Web 3 Boy", uLeft: 0.433, uRight: 0.66, vTop: 0.96, vBottom: 0.0 },
];

type ScreenRect = { left: string; top: string; width: string; height: string };

/** Mirrors the CSS `background-size: cover` crop so hotspot boxes land on
 * the real object regardless of the container's aspect ratio. */
function useHotspotRects(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [rects, setRects] = useState<Record<string, ScreenRect>>({});

  useEffect(() => {
    function layout() {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const resRatio = rect.width / rect.height;
      const imgRatio = IMG_W / IMG_H;
      const scale = resRatio > imgRatio ? { x: 1, y: resRatio / imgRatio } : { x: imgRatio / resRatio, y: 1 };

      const toScreen = (u: number, v: number) => ({
        x: (u - 0.5) * scale.x + 0.5,
        y: 1 - ((v - 0.5) * scale.y + 0.5),
      });

      const next: Record<string, ScreenRect> = {};
      for (const h of HOTSPOT_DEFS) {
        const tl = toScreen(h.uLeft, h.vTop);
        const br = toScreen(h.uRight, h.vBottom);
        next[h.id] = {
          left: `${tl.x * 100}%`,
          top: `${tl.y * 100}%`,
          width: `${(br.x - tl.x) * 100}%`,
          height: `${(br.y - tl.y) * 100}%`,
        };
      }
      setRects(next);
    }

    layout();
    window.addEventListener("resize", layout);
    return () => window.removeEventListener("resize", layout);
  }, [containerRef]);

  return rects;
}

export default function HeroSpotlight() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredItemText, setHoveredItemText] = useState<string | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const rects = useHotspotRects(containerRef);

  // Springs are driven directly with .set() rather than bound to a source
  // motion value. Binding to a source meant the subscription could be reset
  // by the re-render that hover state triggers, stranding an axis at its
  // last value until that axis happened to change again.
  const smoothX = useSpring(0, SPRING_CONFIG);
  const smoothY = useSpring(0, SPRING_CONFIG);

  const maskImage = useMotionTemplate`radial-gradient(circle ${LENS_RADIUS}px at ${smoothX}px ${smoothY}px, black 100%, transparent 100%)`;
  const transformOrigin = useMotionTemplate`${smoothX}px ${smoothY}px`;

  function track(e: React.PointerEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    smoothX.set(e.clientX - rect.left);
    smoothY.set(e.clientY - rect.top);
  }

  function handlePointerEnter(e: React.PointerEvent<HTMLDivElement>) {
    // Jump straight to the entry point so the lens doesn't sweep in from
    // wherever it was left, then fade/scale in from there.
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      smoothX.jump(e.clientX - rect.left);
      smoothY.jump(e.clientY - rect.top);
    }
    setIsHovering(true);
  }

  return (
    <div
      ref={containerRef}
      onPointerMove={track}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={() => setIsHovering(false)}
      className="relative isolate h-full w-full overflow-hidden bg-black"
    >
      {/* Layer 1: base environment, dulled */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-75 blur-[2px] grayscale-[20%]"
        style={{ backgroundImage: `url(${IMAGE_URL})` }}
      />

      {/* Layer 1b: reading scrim. Lives inside the spotlight and *below* the
          lens, so the lens punches through it - if this sat above everything
          it would dim the reveal just as much as the base, leaving nothing
          to reveal. */}
      <div className="hero-scrim pointer-events-none absolute inset-0 z-[5]" />

      {/* Layer 2: hotspot map */}
      <div className="absolute inset-0 z-10">
        {HOTSPOT_DEFS.map((spot) => (
          <div
            key={spot.id}
            className="absolute cursor-crosshair"
            style={rects[spot.id]}
            onMouseEnter={() => setHoveredItemText(spot.label)}
            onMouseLeave={() => setHoveredItemText(null)}
          />
        ))}
      </div>

      {/* Layer 3: the magic lens */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-20 bg-cover bg-center"
        style={{
          backgroundImage: `url(${IMAGE_URL})`,
          maskImage,
          WebkitMaskImage: maskImage,
          transformOrigin,
          filter: "brightness(1.45) contrast(1.05) saturate(1.15)",
        }}
        animate={{ scale: isHovering ? 1.5 : 1, opacity: isHovering ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      />

      {/* Layer 4: floating tooltip */}
      {hoveredItemText && (
        <motion.div
          className="pointer-events-none absolute top-0 left-0 z-30 rounded-md border border-white/10 bg-black/80 px-3 py-1.5 text-xs tracking-wide backdrop-blur-sm"
          style={{
            x: smoothX,
            y: smoothY,
            marginLeft: 90,
            marginTop: -20,
            color: "#F4EEE2",
            fontFamily: "var(--font-mono)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {hoveredItemText}
        </motion.div>
      )}
    </div>
  );
}
