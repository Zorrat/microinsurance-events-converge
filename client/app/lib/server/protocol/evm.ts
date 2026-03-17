import type { Chain, Hash, PublicClient, WalletClient } from "viem";
import { createPublicClient, createWalletClient, defineChain, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

import type { OnchainPolicy, ReportData, ReserveSnapshot } from "@/app/lib/protocol-types";

import { erc20Abi, policyNftAbi, policyVaultAbi, receiverAbi } from "./abi";
import { encodeReportBytes } from "./reports";

export type RelayGatewayConfig = {
  chainId: number;
  baseRpcUrl: string;
  receiverAddress: `0x${string}`;
  relayPrivateKey: `0x${string}`;
};

export type ReceiverTargets = {
  receiver: `0x${string}`;
  forwarder: `0x${string}`;
  policyNft: `0x${string}`;
  policyVault: `0x${string}`;
  relayAddress: `0x${string}`;
};

export type MintContext = ReceiverTargets & {
  nextPolicyId: bigint;
};

export interface ContractsGateway {
  getReceiverTargets(): Promise<ReceiverTargets>;
  getReserveSnapshot(): Promise<ReserveSnapshot>;
  getMintContext(): Promise<MintContext>;
  getNextPolicyId(): Promise<bigint>;
  getPolicy(policyId: bigint): Promise<OnchainPolicy>;
  submitReport(report: ReportData | `0x${string}`): Promise<{ txHash: Hash }>;
}

const resolveChain = (chainId: number, rpcUrl: string): Chain => {
  if (chainId === baseSepolia.id) {
    return {
      ...baseSepolia,
      rpcUrls: {
        ...baseSepolia.rpcUrls,
        default: { http: [rpcUrl] },
        public: { http: [rpcUrl] },
      },
    };
  }

  if (chainId === base.id) {
    return {
      ...base,
      rpcUrls: {
        ...base.rpcUrls,
        default: { http: [rpcUrl] },
        public: { http: [rpcUrl] },
      },
    };
  }

  return defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  });
};

const ensureAddress = (value: unknown, error: string): `0x${string}` => {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(error);
  return value as `0x${string}`;
};

const toPolicyRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object") {
    throw new Error("INVALID_POLICY_RESPONSE");
  }
  return value as Record<string, unknown>;
};

export const createRelayGateway = (
  config: RelayGatewayConfig,
  clients?: {
    publicClient?: Pick<PublicClient, "readContract" | "waitForTransactionReceipt">;
    walletClient?: Pick<WalletClient, "writeContract">;
  },
): ContractsGateway => {
  const relayAccount = privateKeyToAccount(config.relayPrivateKey);
  const chain = resolveChain(config.chainId, config.baseRpcUrl);
  const publicClient =
    clients?.publicClient ??
    createPublicClient({
      chain,
      transport: http(config.baseRpcUrl),
    });
  const walletClient =
    clients?.walletClient ??
    createWalletClient({
      account: relayAccount,
      chain,
      transport: http(config.baseRpcUrl),
    });

  const getReceiverTargets = async (): Promise<ReceiverTargets> => {
    const [forwarder, policyNft, policyVault] = await Promise.all([
      publicClient.readContract({
        address: config.receiverAddress,
        abi: receiverAbi,
        functionName: "forwarder",
      }),
      publicClient.readContract({
        address: config.receiverAddress,
        abi: receiverAbi,
        functionName: "policyNft",
      }),
      publicClient.readContract({
        address: config.receiverAddress,
        abi: receiverAbi,
        functionName: "policyVault",
      }),
    ]);

    return {
      receiver: config.receiverAddress,
      forwarder: ensureAddress(forwarder, "INVALID_FORWARDER_ADDRESS"),
      policyNft: ensureAddress(policyNft, "INVALID_POLICY_NFT_ADDRESS"),
      policyVault: ensureAddress(policyVault, "INVALID_POLICY_VAULT_ADDRESS"),
      relayAddress: relayAccount.address,
    };
  };

  const assertRelayForwarder = async (): Promise<ReceiverTargets> => {
    const targets = await getReceiverTargets();
    if (targets.forwarder.toLowerCase() !== relayAccount.address.toLowerCase()) {
      throw new Error("RELAY_FORWARDER_MISMATCH");
    }
    return targets;
  };

  return {
    getReceiverTargets,
    async getReserveSnapshot(): Promise<ReserveSnapshot> {
      const targets = await getReceiverTargets();
      const [requiredReserves, totalActiveLiabilityUSDC, minReserveRatioBps, usdc] = await Promise.all([
        publicClient.readContract({
          address: targets.policyVault,
          abi: policyVaultAbi,
          functionName: "requiredReserves",
        }),
        publicClient.readContract({
          address: targets.policyVault,
          abi: policyVaultAbi,
          functionName: "totalActiveLiabilityUSDC",
        }),
        publicClient.readContract({
          address: targets.policyVault,
          abi: policyVaultAbi,
          functionName: "minReserveRatioBps",
        }),
        publicClient.readContract({
          address: targets.policyVault,
          abi: policyVaultAbi,
          functionName: "usdc",
        }),
      ]);

      const usdcAddress = ensureAddress(usdc, "INVALID_USDC_ADDRESS");
      const vaultBalanceUSDC = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [targets.policyVault],
      });

      return {
        requiredReserves: BigInt(requiredReserves),
        totalActiveLiabilityUSDC: BigInt(totalActiveLiabilityUSDC),
        minReserveRatioBps: BigInt(minReserveRatioBps),
        vaultBalanceUSDC: BigInt(vaultBalanceUSDC),
      };
    },
    async getMintContext(): Promise<MintContext> {
      const targets = await getReceiverTargets();
      const nextPolicyId = await publicClient.readContract({
        address: targets.policyNft,
        abi: policyNftAbi,
        functionName: "nextPolicyId",
      });

      return {
        ...targets,
        nextPolicyId: BigInt(nextPolicyId),
      };
    },
    async getNextPolicyId(): Promise<bigint> {
      const targets = await getReceiverTargets();
      const nextPolicyId = await publicClient.readContract({
        address: targets.policyNft,
        abi: policyNftAbi,
        functionName: "nextPolicyId",
      });

      return BigInt(nextPolicyId);
    },
    async getPolicy(policyId: bigint): Promise<OnchainPolicy> {
      const targets = await getReceiverTargets();
      const policy = toPolicyRecord(
        await publicClient.readContract({
          address: targets.policyNft,
          abi: policyNftAbi,
          functionName: "getPolicy",
          args: [policyId],
        }),
      );

      return {
        eventIdHash: policy.eventIdHash as `0x${string}`,
        eventId: String(policy.eventId ?? ""),
        eventStart: BigInt(policy.eventStart as bigint | number | string),
        coverageStart: BigInt(policy.coverageStart as bigint | number | string),
        coverageEnd: BigInt(policy.coverageEnd as bigint | number | string),
        quoteExpiry: BigInt(policy.quoteExpiry as bigint | number | string),
        payoutUSDC: BigInt(policy.payoutUSDC as bigint | number | string),
        premiumUSDC: BigInt(policy.premiumUSDC as bigint | number | string),
        insured: ensureAddress(policy.insured, "INVALID_POLICY_INSURED_ADDRESS"),
        status: typeof policy.status === "number" ? policy.status : Number(policy.status),
      };
    },
    async submitReport(report: ReportData | `0x${string}`): Promise<{ txHash: Hash }> {
      await assertRelayForwarder();

      const encodedReport = typeof report === "string" ? report : encodeReportBytes(report);

      let txHash: Hash;
      try {
        txHash = await walletClient.writeContract({
          address: config.receiverAddress,
          abi: receiverAbi,
          functionName: "onReport",
          args: ["0x", encodedReport],
          chain,
          account: relayAccount,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`RELAY_TX_FAILED:${message}`);
      }

      if ("waitForTransactionReceipt" in publicClient && typeof publicClient.waitForTransactionReceipt === "function") {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") {
          throw new Error("RELAY_TX_FAILED:RECEIPT_REVERTED");
        }
      }

      return { txHash };
    },
  };
};
