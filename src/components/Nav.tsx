"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const SOCIAL_LINKS = [
  { href: "https://x.com/TheWeb3B0Y", label: "X" },
  { href: "https://www.linkedin.com/in/muzammilsiddiqui001/", label: "LinkedIn" },
  { href: "https://www.instagram.com/theweb3boy/", label: "Instagram" },
];

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <line x1="4" y1="4" x2="20" y2="20" />
      <line x1="20" y1="4" x2="4" y2="20" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="7.5" y1="10.5" x2="7.5" y2="16.5" />
      <circle cx="7.5" cy="7" r="0.6" fill="currentColor" stroke="none" />
      <path d="M11.5 16.5v-4c0-1.4 1-2.2 2.2-2.2 1.2 0 2 .8 2 2.2v4" />
      <line x1="11.5" y1="10.5" x2="11.5" y2="16.5" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

const ICONS: Record<string, () => React.JSX.Element> = {
  X: XIcon,
  LinkedIn: LinkedInIcon,
  Instagram: InstagramIcon,
};

export default function Nav() {
  const [open, setOpen] = useState(false);

  // Close the mobile menu on Escape, and if the viewport grows back past
  // the breakpoint while it's open (e.g. rotating a tablet).
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onResize() {
      if (window.innerWidth > 780) setOpen(false);
    }
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKeydown);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <header className="nav">
      <Link href="/" className="brand">
        <span className="pulse-dot" />
        theweb3boy
      </Link>

      <ul className="nav-links">
        <li className="nav-dropdown">
          <a href="#tools">Tools</a>
          <div className="nav-dropdown-menu">
            <Link href="/dashboard" className="nav-dropdown-item">
              <span className="ndi-name">youVsBTC</span>
              <span className="ndi-status">In development</span>
            </Link>
            <p className="nav-dropdown-note">More tools ship here as they&apos;re ready.</p>
          </div>
        </li>
        <li>
          <a href="#about">About</a>
        </li>
        <li>
          <a href="#connect">Connect</a>
        </li>
      </ul>

      <div className="nav-right">
        {SOCIAL_LINKS.map((s) => {
          const Icon = ICONS[s.label];
          return (
            <a key={s.label} className="icon-link" href={s.href} target="_blank" rel="noopener" aria-label={s.label}>
              <Icon />
            </a>
          );
        })}
        <button
          className={`nav-toggle ${open ? "open" : ""}`}
          type="button"
          aria-expanded={open}
          aria-controls="mobileMenu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
        </button>
      </div>

      <nav id="mobileMenu" className={`mobile-menu ${open ? "open" : ""}`} aria-hidden={!open}>
        <a href="#tools" onClick={() => setOpen(false)}>
          Tools
        </a>
        <Link href="/dashboard" onClick={() => setOpen(false)}>
          youVsBTC dashboard
        </Link>
        <a href="#about" onClick={() => setOpen(false)}>
          About
        </a>
        <a href="#connect" onClick={() => setOpen(false)}>
          Connect
        </a>
        <div className="mobile-menu-socials">
          {SOCIAL_LINKS.map((s) => {
            const Icon = ICONS[s.label];
            return (
              <a key={s.label} className="icon-link" href={s.href} target="_blank" rel="noopener" aria-label={s.label}>
                <Icon />
              </a>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
