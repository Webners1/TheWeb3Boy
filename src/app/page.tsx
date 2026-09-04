"use client";

import { useEffect } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import HeroSpotlight from "@/components/HeroSpotlight";
import { initHeroEffects } from "@/lib/heroEffects";
import { initDuelChart } from "@/lib/duelChart";
import { initContactMenu, initBlockCounter } from "@/lib/uiEffects";

export default function Home() {
  useEffect(() => {
    const cleanups = [initContactMenu(), initBlockCounter(), initHeroEffects(), initDuelChart()];
    return () => cleanups.forEach((fn) => fn());
  }, []);

  return (
    <>
      <div className="grain" aria-hidden="true" />

      <Nav />

      <section id="hero">
        <div className="absolute inset-0">
          <HeroSpotlight />
        </div>
        <div className="wrap hero-inner">
          <p className="eyebrow teal fade-up d1">6 years in Web3 &amp; AI · Karachi, PK</p>
          <h1 className="headline-kinetic">
            <span id="heroWord" className="accent-c">
              DAPP
            </span>{" "}
            <span className="fixed-build accent-t">BUILD</span>
            <span className="role-line fade-up d2" id="heroSubline">
              web3 products, shipped and working.
            </span>
          </h1>
          <p className="sub fade-up d3">
            I&apos;ve spent 6 years building in web3, and I&apos;m now deep into AI, shipping open-source tools
            because this space has too many gimmicks and not enough things that work.{" "}
            <strong>youVsBTC</strong> is the first. If you&apos;re building a product and need real execution,
            that&apos;s exactly what I do.
          </p>
          <div className="cta-row fade-up d4">
            <a className="btn btn-primary" href="#tools">
              See youVsBTC ↓
            </a>
            <div className="contact-wrap">
              <button
                className="btn btn-ghost"
                id="contactBtn"
                type="button"
                aria-expanded="false"
                aria-controls="contactMenu"
              >
                Contact me
              </button>
              <div className="contact-menu" id="contactMenu">
                <a
                  className="contact-item"
                  href="https://calendly.com/muzammilsiddiqui001/30min"
                  target="_blank"
                  rel="noopener"
                >
                  <span className="ci-name">Book a call</span>
                  <span className="ci-detail">Calendly, 30 min</span>
                </a>
                <a className="contact-item" href="https://t.me/MuzammilSiddiqui_14" target="_blank" rel="noopener">
                  <span className="ci-name">Telegram</span>
                  <span className="ci-detail">@MuzammilSiddiqui_14</span>
                </a>
                <a className="contact-item" href="mailto:muzammilsiddiqui001@gmail.com">
                  <span className="ci-name">Email</span>
                  <span className="ci-detail">muzammilsiddiqui001@gmail.com</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section tools" id="tools">
        <div className="wrap">
          <p className="eyebrow copper">Tools</p>
          <h2>One shipped. More on the way.</h2>

          <div className="tool-stack">
            <div className="tool-row tool-row-live">
              <div className="tool-head">
                <span className="tool-index">N° 01</span>
                <span className="tool-name">youVsBTC</span>
                <span className="status-pill">
                  <span className="pulse-dot" />
                  In development
                </span>
              </div>
              <p className="tool-pitch">
                A simple way to see if your crypto trades are actually beating Bitcoin. Vault managers post
                screenshots of huge gains, but hide how much of that came from new money flowing in versus real
                skill.
              </p>
              <ul className="tool-features">
                <li>
                  <span className="tf-mark" />
                  Tracks every Hyperliquid and OKX vault, daily.
                </li>
                <li>
                  <span className="tf-mark" />
                  Computes flow-neutral NAV, so deposits and withdrawals can&apos;t fake the return.
                </li>
                <li>
                  <span className="tf-mark" />
                  Benchmarks every vault against Bitcoin, Ethereum, and Solana.
                </li>
                <li>
                  <span className="tf-mark" />
                  Open source. The ingestion and storage layer is public on GitHub.
                </li>
              </ul>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <a
                  className="tool-github"
                  href="https://github.com/Webners1/youVsBtc"
                  target="_blank"
                  rel="noopener"
                >
                  <span>View source on GitHub</span>
                  <span className="tool-github-arrow">↗</span>
                </a>
                <Link className="tool-github" href="/dashboard">
                  <span>Open the dashboard</span>
                  <span className="tool-github-arrow">↗</span>
                </Link>
              </div>
              <div className="tool-preview">
                <canvas id="duelCanvas" aria-hidden="true" />
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

            <div className="tool-row tool-row-sealed">
              <div className="tool-head">
                <span className="tool-index">N° 02</span>
                <span className="tool-line" />
                <span className="tool-status-text">sealed</span>
              </div>
            </div>

            <div className="tool-row tool-row-sealed">
              <div className="tool-head">
                <span className="tool-index">N° 03</span>
                <span className="tool-line" />
                <span className="tool-status-text">sealed</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section about" id="about">
        <div className="wrap about-inner">
          <p className="eyebrow teal">Read Contract</p>
          <h2 className="pull-quote">
            Building isn&apos;t a hobby.
            <br />
            It&apos;s <span className="accent-c">the calling.</span>
          </h2>
          <p className="about-bio">
            I&apos;m Muzammil, a WEB3 builder and AI engineer based in Karachi, Pakistan, and{" "}
            <a href="https://x.com/TheWeb3B0Y" target="_blank" rel="noopener">
              @TheWeb3B0Y
            </a>{" "}
            everywhere else. Most of what gets hyped in this space is noise: gimmicky products dressed up to
            look impressive, AI slop with nothing real behind it. I build automation systems that actually work,
            and I make content about it so people can spot the real deal instead of getting caught up in the
            hype. <strong>youVsBTC</strong> is the first product out the door. More is coming, and I&apos;m
            still learning as I go.
          </p>
          <p className="build-public">
            I build in public. Progress, wins, and the stuff that breaks all get posted on{" "}
            <a href="https://x.com/TheWeb3B0Y" target="_blank" rel="noopener">
              X
            </a>{" "}
            as it happens, not just the highlight reel.
          </p>
          <p className="tag-line">6 years in Web3 · 2 years in AI · 40+ dApps shipped</p>
          <p className="meta-line">role: web3 builder · ai engineer · content creator · base: karachi, pk</p>
        </div>
      </section>

      <section className="section connect" id="connect">
        <div className="wrap">
          <p className="eyebrow copper">Verify</p>
          <h2>Find me elsewhere.</h2>
          <p className="connect-cta">Got something real to build, or just want to talk shop? Start here.</p>
          <div className="link-stack">
            <a className="link-row" href="mailto:muzammilsiddiqui001@gmail.com">
              <span className="lr-left">
                <span className="lr-name">Email</span>
                <span className="lr-handle">muzammilsiddiqui001@gmail.com</span>
              </span>
              <span className="lr-arrow">↗</span>
            </a>
            <a
              className="link-row"
              href="https://calendly.com/muzammilsiddiqui001/30min"
              target="_blank"
              rel="noopener"
            >
              <span className="lr-left">
                <span className="lr-name">Book a call</span>
                <span className="lr-handle">Calendly, 30 min</span>
              </span>
              <span className="lr-arrow">↗</span>
            </a>
            <a className="link-row" href="https://t.me/MuzammilSiddiqui_14" target="_blank" rel="noopener">
              <span className="lr-left">
                <span className="lr-name">Telegram</span>
                <span className="lr-handle">@MuzammilSiddiqui_14</span>
              </span>
              <span className="lr-arrow">↗</span>
            </a>
            <a className="link-row" href="https://x.com/TheWeb3B0Y" target="_blank" rel="noopener">
              <span className="lr-left">
                <span className="lr-name">X</span>
                <span className="lr-handle">@TheWeb3B0Y</span>
              </span>
              <span className="lr-arrow">↗</span>
            </a>
            <a
              className="link-row"
              href="https://www.linkedin.com/in/muzammilsiddiqui001/"
              target="_blank"
              rel="noopener"
            >
              <span className="lr-left">
                <span className="lr-name">LinkedIn</span>
                <span className="lr-handle">muzammilsiddiqui001</span>
              </span>
              <span className="lr-arrow">↗</span>
            </a>
            <a className="link-row" href="https://www.instagram.com/theweb3boy/" target="_blank" rel="noopener">
              <span className="lr-left">
                <span className="lr-name">Instagram</span>
                <span className="lr-handle">@theweb3boy</span>
              </span>
              <span className="lr-arrow">↗</span>
            </a>
          </div>
        </div>
      </section>

      <footer>
        <span>© 2026 theweb3boy. Built one block at a time.</span>
        <span>
          Session block #<span id="blockNum">000000</span>
        </span>
      </footer>
    </>
  );
}
