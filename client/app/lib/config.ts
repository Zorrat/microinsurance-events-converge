const DEFAULT_CHAIN_ID = 84532;

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || DEFAULT_CHAIN_ID);
const safeChainId = Number.isFinite(chainId) ? chainId : DEFAULT_CHAIN_ID;

export const config = {
  appName: "Converge Event Insurance",
  chainId: safeChainId,
  chainCaip2: `eip155:${safeChainId}` as `eip155:${number}`,
  creExecutionMode: (process.env.NEXT_PUBLIC_CRE_EXECUTION_MODE || "gateway") as "gateway" | "simulate",
  basescan: process.env.NEXT_PUBLIC_BASESCAN || "https://sepolia.basescan.org",
  baseRpcUrl: process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://sepolia.base.org",
  x402FixedFeeUsd: process.env.NEXT_PUBLIC_X402_FIXED_FEE_USD || "0.01",
  x402PayTo: (process.env.NEXT_PUBLIC_X402_PAY_TO || process.env.NEXT_PUBLIC_POLICY_VAULT || "") as `0x${string}`,

  usdc: (process.env.NEXT_PUBLIC_USDC_ADDRESS ||
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`,

  policyNft: (process.env.NEXT_PUBLIC_POLICY_NFT || "") as `0x${string}`,
  policyVault: (process.env.NEXT_PUBLIC_POLICY_VAULT || "") as `0x${string}`,
  creReceiver: (process.env.NEXT_PUBLIC_CRE_RECEIVER || "") as `0x${string}`,
} as const;
