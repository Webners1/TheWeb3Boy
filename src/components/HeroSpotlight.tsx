"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useMotionTemplate } from "framer-motion";

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

const IMAGE_URL = "https://pbs.twimg.com/profile_banners/1533699647683940352/1784648933/1500x500";
const IMG_W = 1500;
const IMG_H = 500;

const LENS_RADIUS = 70;

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
  { id: "pc", label: "My PC — main monitors", uLeft: 0.057, uRight: 0.57, vTop: 0.624, vBottom: 0.08 },
  { id: "laptop", label: "My laptop", uLeft: 0.057, uRight: 0.2, vTop: 0.244, vBottom: 0.0 },
  { id: "mic", label: "My podcast mic and camera setup", uLeft: 0.333, uRight: 0.379, vTop: 0.254, vBottom: 0.064 },
  { id: "led1", label: "RGB LED setup", uLeft: 0.34, uRight: 0.372, vTop: 0.22, vBottom: 0.104 },
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

  // Raw cursor position, relative to the container. Plain motion values -
  // updating these never triggers a React re-render.
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Smoothed, trailing version of the same position for the lens/tooltip.
  const springConfig = { stiffness: 400, damping: 40 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  const maskImage = useMotionTemplate`radial-gradient(circle ${LENS_RADIUS}px at ${smoothX}px ${smoothY}px, black 100%, transparent 100%)`;
  const transformOrigin = useMotionTemplate`${smoothX}px ${smoothY}px`;

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  }

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerEnter={() => setIsHovering(true)}
      onPointerLeave={() => setIsHovering(false)}
      className="relative isolate h-full w-full overflow-hidden bg-black"
    >
      {/* Layer 1: base environment, dulled */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-40 blur-[4px] grayscale-[50%]"
        style={{ backgroundImage: `url(${IMAGE_URL})` }}
      />

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
        }}
        animate={{ scale: isHovering ? 1.5 : 1, opacity: isHovering ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      />

      {/* Layer 4: floating tooltip */}
      {hoveredItemText && (
        <motion.div
          className="pointer-events-none absolute top-0 left-0 z-30 rounded-md border border-white/10 bg-black/80 px-3 py-1.5 font-mono text-xs tracking-wide text-white backdrop-blur-sm"
          style={{
            x: smoothX,
            y: smoothY,
            marginLeft: 90,
            marginTop: -20,
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
