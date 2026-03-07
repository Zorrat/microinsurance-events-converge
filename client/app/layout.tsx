import type { Metadata } from "next";

import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";

import { Providers } from "@/app/providers";

export const metadata: Metadata = {
  title: "Converge Event Insurance",
  description: "Micro-insurance demo powered by Chainlink CRE + x402 on Base Sepolia.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
