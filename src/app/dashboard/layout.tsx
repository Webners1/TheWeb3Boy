import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Crypto Copy Trader Dashboard and Vault Rankings",
  description:
    "Explore crypto copy trader and vault performance against Bitcoin, Ethereum, and Solana. Filter by window, return, drawdown, volatility, and coverage.",
  alternates: { canonical: "/dashboard" },
  openGraph: {
    title: "Crypto Copy Trader Dashboard and Vault Rankings",
    description:
      "Explore crypto copy trader and vault performance against Bitcoin, Ethereum, and Solana.",
    url: "https://theweb3boy.com/dashboard",
    type: "website",
  },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
