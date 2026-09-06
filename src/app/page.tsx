"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Nav from "@/components/Nav";
import HeroSpotlight from "@/components/HeroSpotlight";
import { initHeroEffects } from "@/lib/heroEffects";
import { initDuelChart } from "@/lib/duelChart";
import { initBlockCounter } from "@/lib/uiEffects";
import {
  CONNECT_LINKS,
  CONTACT_ITEMS,
  DO_ROWS,
  MARQUEE,
  PLATFORMS,
  STATS,
  TOOL_FEATURES,
  type PlatformKey,
} from "@/lib/homeContent";

export default function Home() {
  const [contactOpen, setContactOpen] = useState(false);
  const [workOpen, setWorkOpen] = useState(0);
  const [platform, setPlatform] = useState<PlatformKey>("x");

  useEffect(() => {
    const cleanups = [initBlockCounter(), initHeroEffects(), initDuelChart()];
    return () => cleanups.forEach((fn) => fn());
  }, []);

  const active = PLATFORMS.find((p) => p.key === platform) ?? PLATFORMS[0];
  const marquee = [...MARQUEE, ...MARQUEE];

  return (
    <>
      <div className="grain" aria-hidden="true" />
      <Nav />

      <section id="hero">
        <div className="absolute inset-0">
          <HeroSpotlight />
        </div>
        <div className="wrap hero-inner">
          <p className="eyebrow teal fade-up d1">
            <span className="pulse-dot" />
            6 years in Web3 &amp; AI · Karachi, PK
          </p>
          <h1 className="headline-kinetic">
            <span id="heroWord" style={{ color: "#E2793B" }}>
              DAPP
            </span>
            <span style={{ color: "#5FD8C9" }}> BUILD</span>
            <span className="role-line fade-up d2" id="heroSubline">
              web3 products, shipped and working.
            </span>
          </h1>
          <p className="sub fade-up d3">
            I&apos;ve spent 6 years building in web3, and I&apos;m now deep into AI — shipping open-source tools
            because this space has too many gimmicks and not enough things that work.{" "}
            <strong>youVsBTC</strong> is the first. If you&apos;re building a product and need real execution,
            that&apos;s exactly what I do.
          </p>
          <div className="cta-row fade-up d4">
            <a className="hv-btn hv-btn-fill" href="#tools">
              See youVsBTC ↓
            </a>
            <button
              className={`hv-btn ${contactOpen ? "hv-btn-on" : "hv-btn-ghost"}`}
              type="button"
              aria-expanded={contactOpen}
              aria-controls="contactMenu"
              onClick={() => setContactOpen((v) => !v)}
            >
              Contact me {contactOpen ? "▲" : "▼"}
            </button>
            <a className="hv-btn hv-btn-ghost" href="#content">
              Watch the content
            </a>
          </div>
          {contactOpen ? (
            <div className="hv-contact" id="contactMenu">
              {CONTACT_ITEMS.map((c) => (
                <a
                  key={c.name}
                  href={c.href}
                  target={c.external ? "_blank" : undefined}
                  rel={c.external ? "noopener" : undefined}
                >
                  <span className="hv-contact-name">{c.name}</span>
                  <span className="hv-contact-detail">{c.detail}</span>
                </a>
              ))}
            </div>
          ) : null}
          <p className="hero-lens-hint">Move your cursor over the desk — the lens names what&apos;s in the shot.</p>
        </div>
      </section>

      <div className="hv-marquee" aria-hidden="true">
        <div className="hv-marquee-track">
          {marquee.map((text, i) => (
            <span key={`${text}-${i}`}>
              {text}
              <i />
            </span>
          ))}
        </div>
      </div>

      <section id="work" className="hv-section">
        <div className="wrap">
          <p className="eyebrow teal">What I actually do</p>
          <h2 className="hv-h2 hv-h2-wide">Three things, done properly.</h2>
          <div className="hv-do">
            {DO_ROWS.map((row, i) => {
              const open = workOpen === i;
              return (
                <div key={row.index} className="hv-do-row">
                  <button
                    type="button"
                    className="hv-do-head"
                    aria-expanded={open}
                    onClick={() => setWorkOpen(open ? -1 : i)}
                  >
                    <span className="hv-do-index">{row.index}</span>
                    <span className="hv-do-title" style={{ color: open ? "#5FD8C9" : "#F4EEE2" }}>
                      {row.title}
                    </span>
                    <span className="hv-do-sign" style={{ color: open ? "#5FD8C9" : "#F4EEE2" }}>
                      {open ? "−" : "+"}
                    </span>
                  </button>
                  {open ? (
                    <div className="hv-do-body">
                      <p>{row.body}</p>
                      <div className="hv-do-points">
                        {row.points.map((text) => (
                          <span key={text}>
                            <i />
                            {text}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="tools" className="hv-section hv-tools">
        <div className="wrap">
          <p className="eyebrow copper">Tools</p>
          <h2 className="hv-h2">One shipped. More on the way.</h2>
          <div className="hv-tool-card">
            <div className="hv-tool-grid">
              <div className="hv-tool-copy">
                <div className="hv-tool-head">
                  <span className="hv-tool-index">N° 01</span>
                  <span className="hv-tool-name">youVsBTC</span>
                  <span className="hv-status">
                    <i />
                    In development
                  </span>
                </div>
                <p className="hv-tool-pitch">
                  A simple way to see if your crypto trades are actually beating Bitcoin. Vault managers post
                  screenshots of huge gains but hide how much came from new money flowing in versus real skill.
                </p>
                <div className="hv-tool-features">
                  {TOOL_FEATURES.map((text) => (
                    <span key={text}>
                      <i />
                      {text}
                    </span>
                  ))}
                </div>
                <div className="hv-tool-actions">
                  <Link className="hv-btn hv-btn-fill hv-btn-sm" href="/dashboard">
                    Open the dashboard ↗
                  </Link>
                  <a
                    className="hv-btn hv-btn-ghost hv-btn-sm"
                    href="https://github.com/Webners1/youVsBtc"
                    target="_blank"
                    rel="noopener"
                  >
                    Source ↗
                  </a>
                  <Link className="hv-btn hv-btn-ghost hv-btn-sm" href="/youvsbtc">
                    How it works ↗
                  </Link>
                </div>
              </div>
              <div className="hv-tool-preview">
                <div className="hv-duel-meta">
                  <span>Sample duel</span>
                  <span>live</span>
                </div>
                <div className="hv-duel-wrap">
                  <canvas id="duelCanvas" aria-hidden="true" />
                </div>
                <div className="duel-legend">
                  <span className="legend-item">
                    <i className="dot t" />
                    YOU <b>+21.4%</b>
                  </span>
                  <span className="legend-item">
                    <i className="dot c" />
                    BTC <b>+8.7%</b>
                  </span>
                </div>
                <p className="duel-caption">Sample chart. Not real numbers yet.</p>
              </div>
            </div>
            <div className="hv-sealed">
              {["N° 02", "N° 03"].map((index) => (
                <div key={index}>
                  <span>{index}</span>
                  <i />
                  <span>sealed</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="content" className="hv-section">
        <div className="wrap">
          <div className="hv-content-head">
            <div>
              <p className="eyebrow teal">Content</p>
              <h2 className="hv-h2 hv-h2-wide">I build in public and film it.</h2>
              <p className="hv-lede">
                Progress, wins, and the stuff that breaks — posted as it happens, not just the highlight reel. Pick
                a platform.
              </p>
            </div>
            <div className="hv-platforms">
              {PLATFORMS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`hv-plat ${platform === p.key ? "on" : ""}`}
                  style={
                    platform === p.key
                      ? { color: "#0B0908", background: p.color, borderColor: p.color }
                      : undefined
                  }
                  onClick={() => setPlatform(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="hv-content-card">
            <div className="hv-content-top">
              <div className="hv-content-id">
                <span className="hv-content-chip" style={{ color: active.color, background: `${active.color}1f` }}>
                  {active.initial}
                </span>
                <div>
                  <div className="hv-content-name">{active.name}</div>
                  <div className="hv-content-handle">
                    {active.handle} · {active.format}
                  </div>
                </div>
              </div>
              <a
                className="hv-btn hv-btn-sm"
                href={active.href}
                target="_blank"
                rel="noopener"
                style={{ color: "#0B0908", background: active.color }}
              >
                {active.cta} ↗
              </a>
            </div>
            <p className="hv-lede hv-lede-tight">{active.blurb}</p>
            <div className="hv-posts">
              {active.posts.map((post) => (
                <a key={post.title} href={active.href} target="_blank" rel="noopener" className="hv-post">
                  <div className={`hv-slot ${active.key === "ig" ? "ig" : ""}`}>
                    <span>{post.hint}</span>
                  </div>
                  <div className="hv-post-body">
                    <span className="hv-post-kicker">{post.kicker}</span>
                    <span className="hv-post-title">{post.title}</span>
                    <span className="hv-post-note">{post.note}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="about" className="hv-section hv-about">
        <div className="wrap hv-about-grid">
          <div className="hv-portrait-col">
            <div className="hv-portrait">
              <div className="hv-portrait-frame">
                <Image src="/hero.jpg" alt="Muzammil at the desk" fill sizes="(min-width: 900px) 380px, 100vw" style={{ objectFit: "cover" }} />
              </div>
            </div>
            <p className="hv-portrait-meta">
              role: web3 builder · ai engineer · content creator
              <br />
              base: karachi, pk · @TheWeb3B0Y everywhere
            </p>
          </div>
          <div>
            <p className="eyebrow teal">Read contract</p>
            <h2 className="hv-quote">
              Building isn&apos;t a hobby.
              <br />
              It&apos;s <span>the calling.</span>
            </h2>
            <p className="hv-about-copy">
              I&apos;m Muzammil — a web3 builder and AI engineer based in Karachi, Pakistan, and{" "}
              <a href="https://x.com/TheWeb3B0Y" target="_blank" rel="noopener">
                @TheWeb3B0Y
              </a>{" "}
              everywhere else. Most of what gets hyped in this space is noise: gimmicky products dressed up to look
              impressive, AI slop with nothing real behind it.
            </p>
            <p className="hv-about-copy last">
              I build automation systems that actually work, and I make content about it so people can spot the real
              deal instead of getting caught up in the hype. <strong>youVsBTC</strong> is the first product out the
              door. More is coming, and I&apos;m still learning as I go.
            </p>
            <div className="hv-stats">
              {STATS.map((s) => (
                <div key={s.label}>
                  <span className={`hv-stat-val ${s.tone}`}>{s.value}</span>
                  <span className="hv-stat-label">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="connect" className="hv-section">
        <div className="wrap">
          <p className="eyebrow copper">Verify</p>
          <h2 className="hv-h2">Find me elsewhere.</h2>
          <p className="hv-lede hv-lede-connect">
            Got something real to build, or just want to talk shop? Start here.
          </p>
          <div className="hv-links">
            {CONNECT_LINKS.map((l) => (
              <a
                key={l.name}
                href={l.href}
                target={l.external ? "_blank" : undefined}
                rel={l.external ? "noopener" : undefined}
              >
                <span>
                  <span className="hv-link-name">{l.name}</span>
                  <span className="hv-link-handle">{l.handle}</span>
                </span>
                <span className="hv-link-arrow">↗</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap hv-foot">
          <span>© 2026 theweb3boy. Built one block at a time.</span>
          <span>
            Session block #<span id="blockNum">000000</span>
          </span>
        </div>
      </footer>
    </>
  );
}
