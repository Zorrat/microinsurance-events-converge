import type { Metadata } from "next";

import { LandingPageClient } from "@/app/components/landing/landing-page-client";

export const metadata: Metadata = {
  title: "CoverFi | Web3 Event Cover",
  description:
    "CoverFi is a Web3 event cancellation cover app where you quote, mint, and settle coverage onchain with Chainlink CRE, x402, and USDC-backed policy contracts on Base Sepolia.",
};

export default function LandingPage() {
  return <LandingPageClient />;
}
