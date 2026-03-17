"use client";

import { useMemo } from "react";

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { Network } from "@x402/core/types";
import { usePublicClient, useWalletClient } from "wagmi";

import { config } from "@/app/lib/config";

export const usePaidFetch = () => {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: config.chainId });

  return useMemo(() => {
    if (!walletClient || !publicClient || !walletClient.account) return null;
    if (walletClient.chain?.id !== config.chainId) return null;
    const account = walletClient.account;

    const client = new x402Client();
    const signer = toClientEvmSigner(
      {
        address: account.address,
        signTypedData: (args) =>
          walletClient.signTypedData({
            account,
            ...args,
          }),
        ...(walletClient.signTransaction
          ? {
              signTransaction: (args) =>
                walletClient.signTransaction({
                  account,
                  ...args,
                }),
            }
          : {}),
      },
      publicClient,
    );

    registerExactEvmScheme(client, {
      signer,
      networks: [config.chainCaip2 as Network],
    });

    return wrapFetchWithPayment(fetch, client);
  }, [publicClient, walletClient]);
};
