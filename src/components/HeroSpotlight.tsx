"use client";

import { useRef, useState } from "react";
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

const LENS_RADIUS = 120;

type Hotspot = {
  id: string;
  label: string;
  className: string;
};

// Positioned from an actual pixel-by-pixel pass over the source photo
// (1500x500), converted to plain percentages of this container. Because
// this uses simple top/left/width/height rather than a cover-fit-aware
// mapping, these will drift slightly at container aspect ratios far from
// the photo's own 3:1 - nudge the percentages below if a box sits off
// the real object.
const HOTSPOTS: Hotspot[] = [
  {
    id: "face",
    label: "This is me, the Web 3 Boy",
    className: "top-[5%] left-[43%] w-[15%] h-[47%]",
  },
  {
    id: "mic",
    label: "My podcast mic and camera setup",
    className: "top-[73%] left-[33%] w-[5%] h-[19%]",
  },
  {
    id: "led",
    label: "RGB LED Setup",
    className: "top-[77%] left-[34%] w-[4%] h-[13%]",
  },
];

export default function HeroSpotlight() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredItemText, setHoveredItemText] = useState<string | null>(null);
  const [isHovering, setIsHovering] = useState(false);

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
        {HOTSPOTS.map((spot) => (
          <div
            key={spot.id}
            className={`absolute cursor-crosshair ${spot.className}`}
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
            marginLeft: 140,
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
