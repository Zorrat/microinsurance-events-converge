"use client";

import { useState } from "react";

import { HeroUIProvider } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { http } from "viem";
import { WagmiProvider, createConfig, injected } from "wagmi";
import { baseSepolia } from "wagmi/chains";

import { config as clientConfig } from "@/app/lib/config";
import { getMetaMaskProvider } from "@/app/lib/wallet/metaMaskProvider";

const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [
    injected({
      shimDisconnect: true,
      target: {
        id: "metaMask",
        name: "MetaMask",
        provider: getMetaMaskProvider,
      },
    }),
  ],
  transports: {
    [baseSepolia.id]: http(clientConfig.baseRpcUrl),
  },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <HeroUIProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider
            initialChain={baseSepolia}
            theme={lightTheme({
              accentColor: "#0284c7",
              accentColorForeground: "#f8fafc",
              borderRadius: "small",
              fontStack: "system",
              overlayBlur: "small",
            })}
          >
            {children}
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </HeroUIProvider>
  );
}
