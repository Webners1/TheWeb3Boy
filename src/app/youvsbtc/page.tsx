import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Crypto Copy Trading Performance vs Bitcoin, Ethereum and Solana",
  description:
    "youVsBTC compares crypto copy traders and vaults against Bitcoin, Ethereum, and Solana using flow-neutral performance, drawdown, beta, and coverage data.",
  alternates: { canonical: "/youvsbtc" },
  openGraph: {
    title: "Crypto Copy Trading Performance vs Bitcoin, Ethereum and Solana",
    description:
      "Compare crypto copy traders and vaults against Bitcoin, Ethereum, and Solana using transparent performance data.",
    url: "https://theweb3boy.com/youvsbtc",
    type: "website",
  },
};

const productJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "youVsBTC",
  url: "https://theweb3boy.com/youvsbtc",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description:
    "A crypto copy trading and vault performance comparison tool that measures flow-neutral returns against Bitcoin, Ethereum, and Solana.",
  isAccessibleForFree: true,
  creator: { "@type": "Organization", name: "theweb3boy", url: "https://theweb3boy.com/" },
  featureList: [
    "Crypto copy trader comparison",
    "Bitcoin, Ethereum, and Solana benchmarks",
    "Flow-neutral performance analysis",
    "Drawdown and beta metrics",
  ],
};

export default function YouVsBtcPage() {
  return (
    <>
      <Nav />
      <main className="product-page">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd).replace(/</g, "\\u003c") }}
        />

        <section className="product-hero">
          <div className="wrap product-hero-grid">
            <div>
              <p className="eyebrow teal">youVsBTC · open comparison tool</p>
              <h1>Crypto copy trading performance, compared honestly.</h1>
              <p className="product-lede">
                See whether a crypto copy trader or vault actually beat Bitcoin, Ethereum, or Solana over the
                same dates. youVsBTC separates investment performance from deposits and withdrawals so a bigger
                account does not automatically look like a better strategy.
              </p>
              <div className="product-actions">
                <Link className="btn btn-primary" href="/dashboard">
                  Explore the dashboard ↗
                </Link>
                <a className="btn btn-ghost" href="https://github.com/Webners1/youVsBtc" target="_blank" rel="noopener">
                  Read the open source method ↗
                </a>
              </div>
            </div>
            <aside className="product-signal" aria-label="youVsBTC comparison summary">
              <span className="product-signal-label">The question</span>
              <strong>Did the trader beat the benchmark?</strong>
              <span className="product-signal-rule" />
              <span className="product-signal-label">The answer</span>
              <p>Same window. Same starting stake. Flows removed. Coverage shown.</p>
            </aside>
          </div>
        </section>

        <section className="section product-section">
          <div className="wrap">
            <p className="eyebrow copper">What it measures</p>
            <h2>More than a screenshot of a winning month.</h2>
            <div className="product-feature-grid">
              <article>
                <span className="product-number">01</span>
                <h3>Flow-neutral returns</h3>
                <p>
                  Deposits and withdrawals can make account value rise or fall without reflecting trading skill.
                  youVsBTC uses time-weighted performance where the data supports it.
                </p>
              </article>
              <article>
                <span className="product-number">02</span>
                <h3>Market benchmarks</h3>
                <p>
                  Compare a vault or copy trader with Bitcoin, Ethereum, and Solana buy-and-hold over the same
                  comparison window.
                </p>
              </article>
              <article>
                <span className="product-number">03</span>
                <h3>Risk and coverage context</h3>
                <p>
                  Returns are shown alongside drawdown, volatility, beta, data coverage, sampling, and eligibility
                  so partial evidence is not presented as a complete track record.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="section product-section product-method">
          <div className="wrap product-method-grid">
            <div>
              <p className="eyebrow teal">For crypto researchers</p>
              <h2>Compare copy traders without confusing capital with performance.</h2>
            </div>
            <div className="product-copy">
              <p>
                Crypto copy trading directories often mix current assets under management, reported ROI, and
                historical returns as if they were the same measurement. youVsBTC keeps those signals separate and
                labels the source, date, window, and data quality behind each figure.
              </p>
              <p>
                The dashboard currently covers supported vault and strategy sources, including Hyperliquid and
                Enzyme data where the required observations are available. A missing or partial window stays
                visible as a limitation instead of becoming a silent ranking.
              </p>
            </div>
          </div>
        </section>

        <section className="section product-section product-cta-section">
          <div className="wrap product-cta">
            <p className="eyebrow copper">Start with the data</p>
            <h2>Find out what your crypto strategy really did.</h2>
            <p>Open the live comparison dashboard, choose a window, and compare a vault with BTC, ETH, or SOL.</p>
            <Link className="btn btn-primary" href="/dashboard">
              Open youVsBTC dashboard ↗
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}