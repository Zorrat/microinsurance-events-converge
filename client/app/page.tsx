import type { Metadata } from "next";

import { LandingPageClient } from "@/app/components/landing/landing-page-client";

export const metadata: Metadata = {
  title: "CoverFi | Event Cancellation Micro-Insurance",
  description:
    "CoverFi is a micro-insurance landing page for decentralized event cancellation risk hedging using Chainlink CRE + x402 on Base Sepolia.",
};

export default function LandingPage() {
  return <LandingPageClient />;
}
