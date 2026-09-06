"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SOCIAL_LINKS = [
  { href: "https://x.com/TheWeb3B0Y", label: "X" },
  { href: "https://www.linkedin.com/in/muzammilsiddiqui001/", label: "LinkedIn" },
  { href: "https://www.instagram.com/theweb3boy/", label: "Instagram" },
];

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <line x1="4" y1="4" x2="20" y2="20" />
      <line x1="20" y1="4" x2="4" y2="20" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
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
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
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
  const pathname = usePathname();
  const sectionHref = (id: string) => (pathname === "/" ? `#${id}` : `/#${id}`);

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onResize() {
      if (window.innerWidth >= 780) setOpen(false);
    }
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKeydown);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const mobileLinks = [
    { href: sectionHref("tools"), label: "Tools" },
    { href: "/dashboard", label: "youVsBTC dashboard" },
    { href: "/youvsbtc", label: "How youVsBTC works" },
    { href: sectionHref("about"), label: "About" },
    { href: sectionHref("connect"), label: "Connect" },
  ];

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand">
          <span className="pulse-dot" />
          theweb3boy
        </Link>

        <div className="nav-cluster">
          <ul className="nav-links">
            <li className="nav-dropdown">
              <Link href={sectionHref("tools")}>Tools</Link>
              <div className="nav-dropdown-menu">
                <Link href="/dashboard" className="nav-dropdown-item">
                  <span className="ndi-name">youVsBTC</span>
                  <span className="ndi-status">In development</span>
                </Link>
                <Link href="/youvsbtc" className="nav-dropdown-item">
                  <span className="ndi-name">How it works</span>
                  <span className="ndi-status">Compare performance</span>
                </Link>
                <p className="nav-dropdown-note">More tools ship here as they&apos;re ready.</p>
              </div>
            </li>
            <li>
              <Link href={sectionHref("about")}>About</Link>
            </li>
            <li>
              <Link href={sectionHref("connect")}>Connect</Link>
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
              className="nav-toggle"
              type="button"
              aria-expanded={open}
              aria-controls="mobileMenu"
              aria-label={open ? "Close menu" : "Menu"}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "✕" : "☰"}
            </button>
          </div>
        </div>
      </div>

      <nav id="mobileMenu" className={`mobile-menu ${open ? "open" : ""}`} aria-hidden={!open} hidden={!open}>
        {mobileLinks.map((l) => (
          <Link key={l.label} href={l.href} onClick={() => setOpen(false)}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
