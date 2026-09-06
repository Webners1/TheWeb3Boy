"use client";

import type { MouseEvent } from "react";
import { venueProtocolLabel } from "@/components/VenueBadge";

export default function ExternalVenueLink({
  href,
  venue,
  source,
  compact = false,
}: {
  href: string | null;
  venue: string;
  source?: string;
  compact?: boolean;
}) {
  if (!href) {
    if (compact) return null;
    return (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#6F6455" }}>
        Source link unavailable
      </span>
    );
  }
  const label = `Open on ${venueProtocolLabel(venue)}`;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: compact ? "flex-end" : "flex-start", gap: 4 }}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e: MouseEvent) => e.stopPropagation()}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: compact ? 10.5 : 12,
          letterSpacing: ".04em",
          textTransform: "uppercase",
          color: "#5FD8C9",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        {label}
      </a>
      {source === "okx" ? (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#6F6455", maxWidth: 220 }}>
          OKX availability depends on your region.
        </span>
      ) : null}
    </span>
  );
}
