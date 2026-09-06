import type { Metadata } from "next";
import { Unbounded, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const unbounded = Unbounded({
  variable: "--font-display",
  weight: ["500", "700", "800"],
  subsets: ["latin"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-body",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://theweb3boy.com"),
  title: {
    default: "youVsBTC | Crypto Copy Trading Performance Compared",
    template: "%s | youVsBTC",
  },
  description:
    "Compare crypto copy traders and vaults against Bitcoin, Ethereum, and Solana. youVsBTC tracks flow-neutral performance so deposits and withdrawals do not disguise trading results.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "https://theweb3boy.com/",
    siteName: "youVsBTC",
    title: "youVsBTC | Crypto Copy Trading Performance Compared",
    description:
      "Compare crypto copy traders and vaults against Bitcoin, Ethereum, and Solana using transparent, flow-neutral performance data.",
    locale: "en_US",
    images: [{ url: "/hero.jpg", width: 1500, height: 500, alt: "youVsBTC crypto performance comparison" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "youVsBTC | Crypto Copy Trading Performance Compared",
    description:
      "Compare crypto copy traders and vaults against Bitcoin, Ethereum, and Solana with flow-neutral performance data.",
    images: ["/hero.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://theweb3boy.com/#organization",
      name: "theweb3boy",
      url: "https://theweb3boy.com/",
      founder: { "@type": "Person", name: "Muzammil Siddiqui" },
      sameAs: [
        "https://x.com/TheWeb3B0Y",
        "https://www.linkedin.com/in/muzammilsiddiqui001/",
        "https://github.com/Webners1/youVsBtc",
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://theweb3boy.com/#website",
      url: "https://theweb3boy.com/",
      name: "youVsBTC",
      publisher: { "@id": "https://theweb3boy.com/#organization" },
      inLanguage: "en-US",
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${unbounded.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd).replace(/</g, "\\u003c") }}
        />
        {children}
      </body>
    </html>
  );
}
