import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "youVsBTC Dashboard — theweb3boy",
  description:
    "Track Hyperliquid and OKX vaults against just holding Bitcoin. Flow-neutral NAV, benchmarked daily. Currently in development.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
