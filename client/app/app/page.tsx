"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { decodePaymentResponseHeader } from "@x402/fetch";
import { formatUnits } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { ExplanationBox } from "@/app/components/workflow/explanation-box";
import { ResultPanel } from "@/app/components/workflow/result-panel";
import { WorkflowStageCard } from "@/app/components/workflow/workflow-stage-card";
import type {
  ClaimResultOk,
  MintResultOk,
  PolicyTier,
  ProtocolError,
  QuoteResultOk,
} from "@/app/lib/protocol-types";
import { config } from "@/app/lib/config";
import {
  WORKFLOW_STAGE_CONTENT,
  WORKFLOW_STAGE_ORDER,
  type WorkflowStageKey,
} from "@/app/lib/workflow-content";
import { usePaidFetch } from "@/app/lib/usePaidFetch";
import { useQuoteCache } from "@/app/lib/useQuoteCache";
import { workflowResultSchema } from "@/app/lib/validation";
import { getMetaMaskProvider } from "@/app/lib/wallet/metaMaskProvider";

import styles from "@/app/app/page.module.css";

type QuoteRouteResponse = QuoteResultOk | ProtocolError;
type BuyRouteResponse = MintResultOk | ProtocolError;
type ClaimRouteResponse = ClaimResultOk | ProtocolError;

type PaymentProof = {
  rawHeader: string;
  success?: boolean;
  network?: string;
  transaction?: string;
  decodeError?: string;
};

type NftImportStatus = "idle" | "success" | "failed" | "unavailable";

type WalletPolicy = {
  policyId: string;
  eventId: string;
  status: number;
  payoutUSDC: string;
  premiumUSDC: string;
  coverageStart: number;
  coverageEnd: number;
  quoteExpiry: number;
  insured: string;
};

const POLICY_SCAN_LIMIT = 500;
const POLICY_SCAN_BATCH_SIZE = 40;
const POLICY_NFT_ABI = [
  {
    inputs: [],
    name: "nextPolicyId",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "policyId", type: "uint256" }],
    name: "getPolicy",
    outputs: [
      {
        components: [
          { internalType: "bytes32", name: "eventIdHash", type: "bytes32" },
          { internalType: "string", name: "eventId", type: "string" },
          { internalType: "uint64", name: "eventStart", type: "uint64" },
          { internalType: "uint64", name: "coverageStart", type: "uint64" },
          { internalType: "uint64", name: "coverageEnd", type: "uint64" },
          { internalType: "uint64", name: "quoteExpiry", type: "uint64" },
          { internalType: "uint128", name: "payoutUSDC", type: "uint128" },
          { internalType: "uint128", name: "premiumUSDC", type: "uint128" },
          { internalType: "address", name: "insured", type: "address" },
          { internalType: "uint8", name: "status", type: "uint8" },
        ],
        internalType: "struct PolicyNFT.Policy",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const toStatusLabel = (status: number): string => {
  if (status === 1) return "ACTIVE";
  if (status === 2) return "PAID";
  if (status === 3) return "RESOLVED_NO_PAYOUT";
  return "UNKNOWN";
};

const toNumberishString = (value: unknown): string => {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value === "string") return value;
  return "0";
};

const toNumberishNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return 0;
};

const formatUsdcAmount = (baseAmount: string): string => {
  if (!/^\d+$/.test(baseAmount)) return baseAmount || "N/A";
  try {
    return `${formatUnits(BigInt(baseAmount), 6)} USDC`;
  } catch {
    return `${baseAmount} base units`;
  }
};

const formatUnixSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "N/A";
  return new Date(seconds * 1000).toLocaleString();
};

const asErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const parsePaymentProof = (response: Response): PaymentProof | null => {
  const header =
    response.headers.get("PAYMENT-RESPONSE") ||
    response.headers.get("X-PAYMENT-RESPONSE") ||
    response.headers.get("x-payment-response");

  if (!header) return null;

  try {
    const decoded = decodePaymentResponseHeader(header);
    return {
      rawHeader: header,
      success: decoded.success,
      network: decoded.network,
      transaction: decoded.transaction,
    };
  } catch (error) {
    return {
      rawHeader: header,
      decodeError: asErrorMessage(error),
    };
  }
};

const readPaymentRequiredFromResponse = async (response: Response): Promise<unknown | null> => {
  const requiredHeader =
    response.headers.get("PAYMENT-REQUIRED") || response.headers.get("X-PAYMENT-REQUIRED");

  if (requiredHeader) {
    try {
      return decodePaymentRequiredHeader(requiredHeader);
    } catch {
      // fall through to body parse
    }
  }

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const toPaymentRequiredError = (required: unknown, status: number): string => {
  const asRecord =
    required && typeof required === "object" ? (required as Record<string, unknown>) : null;
  const accepts = Array.isArray(asRecord?.accepts)
    ? (asRecord.accepts as Array<Record<string, unknown>>)
    : [];
  const first = accepts[0];
  const network = typeof first?.network === "string" ? first.network : "unknown";
  const payTo = typeof first?.payTo === "string" ? first.payTo : "unknown";
  const amount =
    typeof first?.amount === "string"
      ? first.amount
      : typeof first?.maxAmountRequired === "string"
        ? first.maxAmountRequired
        : "unknown";

  return `X402_PAYMENT_REQUIRED:${status}:network=${network};payTo=${payTo};amount=${amount}`;
};

async function readJsonSafely<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    throw new Error(`EMPTY_RESPONSE:${response.status}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`INVALID_JSON_RESPONSE:${response.status}`);
  }
}

const normalizeWorkflowResult = (
  payload: unknown,
  status: number,
): QuoteRouteResponse | BuyRouteResponse | ClaimRouteResponse => {
  const parsed = workflowResultSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: `INVALID_WORKFLOW_RESPONSE:${status}` };
  }
  return parsed.data;
};

const claimDecisionCopy = (
  decision: ClaimResultOk["decision"],
): { title: string; description: string } => {
  if (decision === "PAY") {
    return {
      title: "Claim approved for payout",
      description: "Cancellation conditions were met and payout settlement has been submitted.",
    };
  }
  if (decision === "RESOLVE_NO_PAYOUT") {
    return {
      title: "Claim resolved without payout",
      description: "The policy was closed with no payout based on event and policy conditions.",
    };
  }
  return {
    title: "Claim pending",
    description: "No settlement yet. Retry later after the event status changes.",
  };
};

export default function WorkflowDemoPage() {
  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient({ chainId: config.chainId });
  const paidFetch = usePaidFetch();
  const { cacheQuote, getAllCachedQuotes } = useQuoteCache();
  const [hasMetaMaskProvider, setHasMetaMaskProvider] = useState<boolean | null>(null);

  const [eventUrl, setEventUrl] = useState(
    "https://www.eventbrite.com/e/jay-jay-present-big-apple-brunch-day-party-each-n-every-sunday-tickets-896748186967",
  );
  const [insured, setInsured] = useState<string>(() => address ?? "");
  const [insuredOverridden, setInsuredOverridden] = useState(false);
  const [nonce, setNonce] = useState("");
  const [tier, setTier] = useState<PolicyTier>("MEDIUM");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [policyId, setPolicyId] = useState("");
  const [claimEventId, setClaimEventId] = useState("");

  const [quoteResponse, setQuoteResponse] = useState<QuoteRouteResponse | null>(null);
  const [buyResponse, setBuyResponse] = useState<BuyRouteResponse | null>(null);
  const [claimResponse, setClaimResponse] = useState<ClaimRouteResponse | null>(null);

  const [quoteRaw, setQuoteRaw] = useState<string>("");
  const [buyRaw, setBuyRaw] = useState<string>("");
  const [claimRaw, setClaimRaw] = useState<string>("");

  const [quotePaymentProof, setQuotePaymentProof] = useState<PaymentProof | null>(null);
  const [buyPaymentProof, setBuyPaymentProof] = useState<PaymentProof | null>(null);
  const [claimPaymentProof, setClaimPaymentProof] = useState<PaymentProof | null>(null);
  const [nftImportStatus, setNftImportStatus] = useState<NftImportStatus>("idle");
  const [nftImportMessage, setNftImportMessage] = useState("");

  const [loading, setLoading] = useState<"quote" | "buy" | "claim" | null>(null);
  const [walletPolicies, setWalletPolicies] = useState<WalletPolicy[]>([]);
  const [walletPoliciesLoading, setWalletPoliciesLoading] = useState(false);
  const [walletPoliciesError, setWalletPoliciesError] = useState<string | null>(null);
  const [walletPoliciesTruncated, setWalletPoliciesTruncated] = useState(false);

  const [activeStage, setActiveStage] = useState<WorkflowStageKey>("quote");

  const quoteSigned =
    quoteResponse && quoteResponse.ok && quoteResponse.action === "QUOTE_CHECK"
      ? quoteResponse.signedQuote
      : undefined;

  const canBuy = Boolean(
    quoteResponse &&
      quoteResponse.ok &&
      quoteResponse.action === "QUOTE_CHECK" &&
      quoteResponse.quoteValid &&
      quoteSigned,
  );

  const isWrongNetwork = isConnected && chainId !== config.chainId;

  const cachedQuotes = useMemo(() => {
    if (!address) return [];
    return getAllCachedQuotes(address);
  }, [address, getAllCachedQuotes, quoteResponse]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setHasMetaMaskProvider(Boolean(getMetaMaskProvider()));
  }, []);

  useEffect(() => {
    if (insuredOverridden) return;
    setInsured(address ?? "");
  }, [address, insuredOverridden]);

  const readinessError = useMemo(() => {
    if (hasMetaMaskProvider === null) return "Checking wallet provider...";
    if (!hasMetaMaskProvider) return "Install or enable MetaMask to use this demo.";
    if (!isConnected) return "Connect MetaMask to run paid x402 endpoints.";
    if (isWrongNetwork) return `Switch wallet to Base Sepolia (${config.chainId}).`;
    if (!paidFetch) return "Wallet signer not ready for x402 payment signing.";
    return null;
  }, [hasMetaMaskProvider, isConnected, isWrongNetwork, paidFetch]);

  const buyReadinessError = useMemo(() => {
    if (readinessError) return readinessError;
    if (!quoteResponse) return "Request an approved quote before buying coverage.";
    if (!quoteResponse.ok) return `Quote step failed: ${quoteResponse.error}`;
    if (quoteResponse.action !== "QUOTE_CHECK") return "Quote response is not in a buyable state.";
    if (!quoteResponse.quoteValid) {
      return quoteResponse.reason
        ? `Quote was rejected: ${quoteResponse.reason}`
        : "Quote was not approved for purchase.";
    }
    if (!quoteSigned) return "Quote is missing signed quote data required for minting.";
    return null;
  }, [quoteResponse, quoteSigned, readinessError]);

  const quoteStage = WORKFLOW_STAGE_CONTENT.quote;
  const buyStage = WORKFLOW_STAGE_CONTENT.buy;
  const claimStage = WORKFLOW_STAGE_CONTENT.claim;

  const stageCompleted = {
    quote: Boolean(quoteResponse && quoteResponse.ok && quoteResponse.action === "QUOTE_CHECK"),
    buy: Boolean(buyResponse && buyResponse.ok && buyResponse.action === "MINT"),
    claim: Boolean(claimResponse && claimResponse.ok && claimResponse.action === "CLAIM"),
  } as const;

  const derivedCurrentStage = useMemo<WorkflowStageKey>(() => {
    if (!stageCompleted.quote) return "quote";
    if (!stageCompleted.buy) return "buy";
    return "claim";
  }, [stageCompleted.buy, stageCompleted.quote]);

  useEffect(() => {
    const rank: Record<WorkflowStageKey, number> = {
      quote: 0,
      buy: 1,
      claim: 2,
    };

    setActiveStage((current) =>
      rank[derivedCurrentStage] > rank[current] ? derivedCurrentStage : current,
    );
  }, [derivedCurrentStage]);

  const currentStepBannerText =
    derivedCurrentStage === "quote"
      ? "Step 1 of 3: request a quote"
      : derivedCurrentStage === "buy"
        ? "Step 2 of 3: mint coverage"
        : "Step 3 of 3: submit claim";

  const quotePayload = useMemo(() => {
    const payload: {
      eventUrl: string;
      insured: string;
      tier: PolicyTier;
      nonce?: `0x${string}`;
    } = {
      eventUrl,
      insured,
      tier,
    };

    const trimmedNonce = nonce.trim();
    if (trimmedNonce.length > 0) {
      payload.nonce = trimmedNonce as `0x${string}`;
    }

    return payload;
  }, [eventUrl, insured, tier, nonce]);

  const postPaid = async <T,>(
    url: string,
    payload: unknown,
  ): Promise<{ data: T; raw: string; paymentProof: PaymentProof | null }> => {
    if (!paidFetch) throw new Error("PAID_FETCH_NOT_READY");

    const response = await paidFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 402) {
      const required = await readPaymentRequiredFromResponse(response);
      const errorPayload = {
        ok: false,
        error: toPaymentRequiredError(required, response.status),
      } as T;
      return {
        data: errorPayload,
        raw: JSON.stringify(errorPayload, null, 2),
        paymentProof: parsePaymentProof(response),
      };
    }

    const payloadJson = await readJsonSafely<unknown>(response);
    const data = normalizeWorkflowResult(payloadJson, response.status) as T;
    return {
      data,
      raw: JSON.stringify(data, null, 2),
      paymentProof: parsePaymentProof(response),
    };
  };

  const loadWalletPolicies = useCallback(async () => {
    if (!address) {
      setWalletPolicies([]);
      setWalletPoliciesError("Connect MetaMask to detect policy NFTs.");
      return;
    }
    if (isWrongNetwork) {
      setWalletPolicies([]);
      setWalletPoliciesError(`Switch wallet to Base Sepolia (${config.chainId}) to detect policies.`);
      return;
    }
    if (!publicClient) {
      setWalletPolicies([]);
      setWalletPoliciesError("RPC client not ready.");
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(config.policyNft)) {
      setWalletPolicies([]);
      setWalletPoliciesError("NEXT_PUBLIC_POLICY_NFT is not configured.");
      return;
    }

    setWalletPoliciesLoading(true);
    setWalletPoliciesError(null);
    try {
      const nftAddress = config.policyNft;
      const nextPolicyId = (await publicClient.readContract({
        address: nftAddress,
        abi: POLICY_NFT_ABI,
        functionName: "nextPolicyId",
      })) as bigint;

      const maxTokenId = nextPolicyId > BigInt(0) ? Number(nextPolicyId - BigInt(1)) : 0;
      if (maxTokenId <= 0) {
        setWalletPolicies([]);
        setWalletPoliciesTruncated(false);
        return;
      }

      const startTokenId = Math.max(1, maxTokenId - POLICY_SCAN_LIMIT + 1);
      setWalletPoliciesTruncated(startTokenId > 1);

      const found: WalletPolicy[] = [];
      for (let start = startTokenId; start <= maxTokenId; start += POLICY_SCAN_BATCH_SIZE) {
        const end = Math.min(maxTokenId, start + POLICY_SCAN_BATCH_SIZE - 1);
        const ids = Array.from({ length: end - start + 1 }, (_, i) => BigInt(start + i));

        const ownerResults = await publicClient.multicall({
          allowFailure: true,
          contracts: ids.map((id) => ({
            address: nftAddress,
            abi: POLICY_NFT_ABI,
            functionName: "ownerOf",
            args: [id] as const,
          })),
        });

        const ownedIds = ids.filter((_, idx) => {
          const result = ownerResults[idx];
          if (!result || result.status !== "success") return false;
          const owner = result.result as unknown;
          return typeof owner === "string" && owner.toLowerCase() === address.toLowerCase();
        });

        if (ownedIds.length === 0) continue;

        const policyResults = await publicClient.multicall({
          allowFailure: true,
          contracts: ownedIds.map((id) => ({
            address: nftAddress,
            abi: POLICY_NFT_ABI,
            functionName: "getPolicy",
            args: [id] as const,
          })),
        });

        for (let i = 0; i < ownedIds.length; i += 1) {
          const result = policyResults[i];
          if (!result || result.status !== "success") continue;
          const policy = result.result as {
            eventId?: unknown;
            status?: unknown;
            payoutUSDC?: unknown;
            premiumUSDC?: unknown;
            coverageStart?: unknown;
            coverageEnd?: unknown;
            quoteExpiry?: unknown;
            insured?: unknown;
          } | undefined;

          found.push({
            policyId: ownedIds[i].toString(),
            eventId: typeof policy?.eventId === "string" ? policy.eventId : "",
            status: toNumberishNumber(policy?.status),
            payoutUSDC: toNumberishString(policy?.payoutUSDC),
            premiumUSDC: toNumberishString(policy?.premiumUSDC),
            coverageStart: toNumberishNumber(policy?.coverageStart),
            coverageEnd: toNumberishNumber(policy?.coverageEnd),
            quoteExpiry: toNumberishNumber(policy?.quoteExpiry),
            insured: typeof policy?.insured === "string" ? policy.insured : "",
          });
        }
      }

      found.sort((a, b) => Number(b.policyId) - Number(a.policyId));
      setWalletPolicies(found);

      if (found.length > 0) {
        const selected =
          found.find((item) => item.policyId === policyId) ||
          found.find((item) => item.status === 1) ||
          found.find((item) => item.eventId.length > 0) ||
          found[0];

        setPolicyId(selected.policyId);
        if (selected.eventId) setClaimEventId(selected.eventId);
      }
    } catch (error) {
      setWalletPolicies([]);
      setWalletPoliciesError(`Failed to detect policies: ${asErrorMessage(error)}`);
    } finally {
      setWalletPoliciesLoading(false);
    }
  }, [address, isWrongNetwork, policyId, publicClient]);

  const walletReadyForDetection = Boolean(
    address &&
      !isWrongNetwork &&
      publicClient &&
      /^0x[0-9a-fA-F]{40}$/.test(config.policyNft),
  );

  useEffect(() => {
    if (!walletReadyForDetection) return;
    void loadWalletPolicies();
  }, [walletReadyForDetection, loadWalletPolicies]);

  const onQuote = async () => {
    setLoading("quote");
    setQuoteResponse(null);
    setBuyResponse(null);
    setClaimResponse(null);
    setQuoteRaw("");
    setBuyRaw("");
    setClaimRaw("");
    setQuotePaymentProof(null);
    setBuyPaymentProof(null);
    setClaimPaymentProof(null);
    setNftImportStatus("idle");
    setNftImportMessage("");

    try {
      const { data, raw, paymentProof } = await postPaid<QuoteRouteResponse>("/api/quote", quotePayload);

      setQuoteResponse(data);
      setQuoteRaw(raw);
      setQuotePaymentProof(paymentProof);

      if (data.ok && data.action === "QUOTE_CHECK") {
        const canonicalId = data.canonicalEventId || data.signedQuote?.quote.eventId || "";
        if (canonicalId) setClaimEventId(canonicalId);

        if (address && data.signedQuote) {
          cacheQuote(address, data.signedQuote);
        }
      }
    } catch (error) {
      const fallback = { ok: false, error: asErrorMessage(error) } as ProtocolError;
      setQuoteResponse(fallback);
      setQuoteRaw(JSON.stringify(fallback, null, 2));
      setQuotePaymentProof(null);
    } finally {
      setLoading(null);
    }
  };

  const onBuy = async () => {
    if (!quoteSigned) return;
    const buyPayload = {
      signedQuote: quoteSigned,
    };

    setLoading("buy");
    setBuyResponse(null);
    setClaimResponse(null);
    setBuyRaw("");
    setClaimRaw("");
    setBuyPaymentProof(null);
    setClaimPaymentProof(null);
    setNftImportStatus("idle");
    setNftImportMessage("");

    try {
      const { data, raw, paymentProof } = await postPaid<BuyRouteResponse>("/api/buy", buyPayload);

      setBuyResponse(data);
      setBuyRaw(raw);
      setBuyPaymentProof(paymentProof);

      if (data.ok && data.action === "MINT") {
        if (data.policyId) setPolicyId(data.policyId);
        void loadWalletPolicies();
      }
    } catch (error) {
      const fallback = { ok: false, error: asErrorMessage(error) } as ProtocolError;
      setBuyResponse(fallback);
      setBuyRaw(JSON.stringify(fallback, null, 2));
      setBuyPaymentProof(null);
    } finally {
      setLoading(null);
    }
  };

  const onClaim = async () => {
    const normalizedPolicyId = policyId.trim();
    const canonicalClaimEventId =
      selectedWalletPolicy?.eventId && selectedWalletPolicy.eventId.trim().length > 0
        ? selectedWalletPolicy.eventId.trim()
        : claimEventId.trim();
    if (selectedWalletPolicy?.eventId && selectedWalletPolicy.eventId !== claimEventId) {
      setClaimEventId(selectedWalletPolicy.eventId);
    }

    const claimPayload = {
      policyId: normalizedPolicyId,
      eventId: canonicalClaimEventId,
    };

    setLoading("claim");
    setClaimResponse(null);
    setClaimRaw("");
    setClaimPaymentProof(null);

    try {
      const { data, raw, paymentProof } = await postPaid<ClaimRouteResponse>("/api/claim", claimPayload);

      setClaimResponse(data);
      setClaimRaw(raw);
      setClaimPaymentProof(paymentProof);
    } catch (error) {
      const fallback = { ok: false, error: asErrorMessage(error) } as ProtocolError;
      setClaimResponse(fallback);
      setClaimRaw(JSON.stringify(fallback, null, 2));
      setClaimPaymentProof(null);
    } finally {
      setLoading(null);
    }
  };

  const selectedWalletPolicy = useMemo(
    () => walletPolicies.find((item) => item.policyId === policyId) ?? null,
    [walletPolicies, policyId],
  );

  const selectedStatusLabel = selectedWalletPolicy
    ? toStatusLabel(selectedWalletPolicy.status)
    : "N/A";

  const quotePremiumBase =
    quoteResponse?.ok && quoteResponse.action === "QUOTE_CHECK"
      ? quoteResponse.signedQuote?.quote.premiumUSDC ?? quoteResponse.pricing?.premiumUSDC
      : undefined;
  const quotePayoutBase =
    quoteResponse?.ok && quoteResponse.action === "QUOTE_CHECK"
      ? quoteResponse.signedQuote?.quote.payoutUSDC ?? quoteResponse.pricing?.payoutUSDC
      : undefined;

  const mintedPolicyId =
    buyResponse?.ok && buyResponse.action === "MINT" ? (buyResponse.policyId ?? "N/A") : null;
  const mintedTokenId =
    buyResponse?.ok && buyResponse.action === "MINT"
      ? (buyResponse.tokenId ?? buyResponse.policyId ?? "")
      : "";
  const mintedPolicyNftAddress =
    buyResponse?.ok && buyResponse.action === "MINT"
      ? (buyResponse.policyNftAddress ?? config.policyNft ?? "")
      : "";
  const canImportMintedNft = Boolean(
    mintedTokenId && /^0x[0-9a-fA-F]{40}$/.test(mintedPolicyNftAddress) && hasMetaMaskProvider,
  );
  const canImportDetectedPolicyNfts = Boolean(
    /^0x[0-9a-fA-F]{40}$/.test(config.policyNft) && hasMetaMaskProvider,
  );

  const importPolicyNft = async (
    tokenId: string,
    nftAddress: string,
    sourceLabel = "NFT",
  ) => {
    if (!tokenId || !/^\d+$/.test(tokenId) || !/^0x[0-9a-fA-F]{40}$/.test(nftAddress)) {
      setNftImportStatus("unavailable");
      setNftImportMessage("Policy NFT address or token ID is not available yet.");
      return;
    }

    const provider = getMetaMaskProvider();
    if (!provider) {
      setNftImportStatus("unavailable");
      setNftImportMessage("MetaMask provider is not available in this browser session.");
      return;
    }

    try {
      const requestProvider = provider as {
        request: (args: { method: string; params?: unknown }) => Promise<unknown>;
      };
      const result = await requestProvider.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC721",
          options: {
            address: nftAddress as `0x${string}`,
            tokenId,
          },
        },
      });

      if (result === true) {
        setNftImportStatus("success");
        setNftImportMessage(`${sourceLabel} import request sent to MetaMask.`);
        return;
      }

      setNftImportStatus("failed");
      setNftImportMessage("MetaMask did not confirm NFT import.");
    } catch (error) {
      setNftImportStatus("failed");
      setNftImportMessage(`Failed to import NFT: ${asErrorMessage(error)}`);
    }
  };

  const onImportMintedNft = async () => {
    await importPolicyNft(mintedTokenId, mintedPolicyNftAddress, `Policy NFT #${mintedTokenId}`);
  };

  return (
    <main className={styles.page}>
      <section className={`${styles.glassPanel} ${styles.headerPanel}`}>
        <div className={styles.headerBlock}>
          <h1 className={styles.pageTitle}>CoverFi</h1>
          <p className={styles.pageSubtitle}>
            Quote, buy, and claim event cancellation coverage
          </p>
        </div>
        <ConnectButton />
      </section>

      <section className={`${styles.glassPanel} ${styles.statusPanel}`}>
        <p className={`${styles.statusMessage} ${readinessError ? styles.statusError : styles.statusOk}`}>
          {readinessError || "Wallet connected and ready."}
        </p>
      </section>

      <section className={`${styles.glassPanel} ${styles.flowRailPanel}`}>
        <p className={styles.flowRailLabel}>Workflow Stages</p>
        <div className={styles.flowRail}>
          {WORKFLOW_STAGE_ORDER.map((key) => {
            const stage = WORKFLOW_STAGE_CONTENT[key];
            const isActive = activeStage === key;
            return (
              <article
                key={stage.key}
                className={[
                  styles.flowNode,
                  stageCompleted[stage.key] ? styles.flowNodeDone : "",
                  isActive ? styles.flowNodeActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className={styles.flowNodeHead}>
                  <span className={styles.flowNodeIndex}>{String(stage.order).padStart(2, "0")}</span>
                  <h2 className={styles.flowNodeTitle}>{stage.navTitle}</h2>
                </div>
                <p className={styles.flowNodeSummary}>{stage.consoleSummary}</p>
              </article>
            );
          })}
        </div>
      </section>

      <div className={styles.twoColumnLayout}>
        <div className={styles.userPanel}>
          <div className={styles.currentStepBanner}>
            <p className={styles.currentStepLabel}>Current step</p>
            <p className={styles.currentStepValue}>{currentStepBannerText}</p>
            <button
              type="button"
              className={styles.advancedToggle}
              onClick={() => setShowAdvanced((current) => !current)}
            >
              {showAdvanced ? "Hide advanced fields" : "Show advanced fields"}
            </button>
          </div>

          {cachedQuotes.length > 0 ? (
            <div className={styles.cachedBanner}>
              <span className={styles.cachedDot} />
              {cachedQuotes.length} cached quote{cachedQuotes.length > 1 ? "s" : ""} · expires in{" "}
              {cachedQuotes[0].minutesLeft} min
            </div>
          ) : null}

          {showAdvanced ? (
            <div className={`${styles.subPanel} ${styles.advancedPanel}`}>
              <h3 className={styles.subPanelTitle}>Advanced Overrides</h3>
              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Insured Address</span>
                  <input
                    className={styles.input}
                    value={insured}
                    onChange={(event) => {
                      setInsuredOverridden(true);
                      setInsured(event.target.value);
                    }}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Quote Nonce (optional bytes32)</span>
                  <input
                    className={styles.input}
                    value={nonce}
                    placeholder="0x..."
                    onChange={(event) => setNonce(event.target.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Policy ID (manual override)</span>
                  <input
                    className={styles.input}
                    value={policyId}
                    onChange={(event) => setPolicyId(event.target.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Event ID (manual override)</span>
                  <input
                    className={styles.input}
                    value={claimEventId}
                    onChange={(event) => setClaimEventId(event.target.value)}
                  />
                </label>
              </div>

              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={() => {
                    setInsuredOverridden(false);
                    setInsured(address ?? "");
                  }}
                  disabled={!address}
                >
                  Use connected wallet
                </button>
              </div>
            </div>
          ) : null}

          <WorkflowStageCard
            step={quoteStage.order}
            title={quoteStage.navTitle}
            summary={quoteStage.consoleSummary}
            chips={quoteStage.explanation.chips}
            expanded={activeStage === "quote"}
            onOpenStage={() => setActiveStage("quote")}
          >
            <ExplanationBox
              label={quoteStage.explanation.label}
              title={quoteStage.explanation.title}
              body={quoteStage.explanation.body}
              checks={quoteStage.operatorChecks}
            />

            <p className={styles.inlineText}>Quote check fee: ${config.x402QuoteFeeUsd} USDC</p>

            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Event URL</span>
                <input
                  className={styles.input}
                  value={eventUrl}
                  placeholder="Paste an Eventbrite URL..."
                  onChange={(event) => setEventUrl(event.target.value)}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Policy Tier</span>
                <select
                  className={styles.input}
                  value={tier}
                  onChange={(event) => setTier(event.target.value as PolicyTier)}
                >
                  <option value="BASIC">BASIC ($10 payout)</option>
                  <option value="MEDIUM">MEDIUM ($100 payout)</option>
                  <option value="ADVANCED">ADVANCED ($1000 payout)</option>
                </select>
              </label>
            </div>

            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.primaryAction}
                onClick={onQuote}
                disabled={Boolean(readinessError) || !insured || loading !== null}
              >
                {loading === "quote" ? "Requesting quote..." : "Get Quote"}
              </button>
            </div>

            {quoteResponse?.ok && quoteResponse.action === "QUOTE_CHECK" ? (
              <div className={styles.outcomeCard}>
                <h3 className={styles.subPanelTitle}>Quote Summary</h3>
                <div className={styles.outcomeGrid}>
                  <div className={styles.outcomeItem}>
                    <span className={styles.outcomeLabel}>Approved</span>
                    <span className={styles.outcomeValue}>{quoteResponse.quoteValid ? "Yes" : "No"}</span>
                  </div>
                  <div className={styles.outcomeItem}>
                    <span className={styles.outcomeLabel}>Premium</span>
                    <span className={styles.outcomeValue}>
                      {quotePremiumBase ? formatUsdcAmount(quotePremiumBase) : "N/A"}
                    </span>
                  </div>
                  <div className={styles.outcomeItem}>
                    <span className={styles.outcomeLabel}>Payout</span>
                    <span className={styles.outcomeValue}>
                      {quotePayoutBase ? formatUsdcAmount(quotePayoutBase) : "N/A"}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </WorkflowStageCard>

          <WorkflowStageCard
            step={buyStage.order}
            title={buyStage.navTitle}
            summary={buyStage.consoleSummary}
            chips={buyStage.explanation.chips}
            expanded={activeStage === "buy"}
            onOpenStage={() => setActiveStage("buy")}
          >
            <ExplanationBox
              label={buyStage.explanation.label}
              title={buyStage.explanation.title}
              body={buyStage.explanation.body}
              checks={buyStage.operatorChecks}
            />

            <p className={styles.inlineText}>
              Premium due: {quotePremiumBase ? formatUsdcAmount(quotePremiumBase) : "Get a quote to price this step."}
            </p>

            <p
              className={`${styles.statusMessage} ${buyReadinessError ? styles.statusError : styles.statusOk}`}
            >
              {buyReadinessError || "Signed quote is ready. Buying will request an x402 wallet signature and then mint via the receiver."}
            </p>

            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.primaryAction}
                onClick={onBuy}
                disabled={Boolean(buyReadinessError) || !canBuy || loading !== null}
              >
                {loading === "buy" ? "Submitting mint..." : "Buy Coverage"}
              </button>
            </div>

            {buyResponse?.ok && buyResponse.action === "MINT" ? (
              <div className={styles.outcomeCard}>
                <h3 className={styles.subPanelTitle}>Coverage Activated</h3>
                <div className={styles.outcomeGrid}>
                  <div className={styles.outcomeItem}>
                    <span className={styles.outcomeLabel}>Policy ID</span>
                    <span className={styles.outcomeValue}>{mintedPolicyId}</span>
                  </div>
                  <div className={styles.outcomeItem}>
                    <span className={styles.outcomeLabel}>NFT ID</span>
                    <span className={styles.outcomeValue}>{mintedTokenId || "N/A"}</span>
                  </div>
                </div>

                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={styles.secondaryAction}
                    onClick={() => void onImportMintedNft()}
                    disabled={!canImportMintedNft || loading !== null}
                  >
                    Import NFT to Wallet
                  </button>
                </div>

                {nftImportStatus !== "idle" && nftImportMessage ? (
                  <p
                    className={
                      nftImportStatus === "success"
                        ? styles.inlineText
                        : nftImportStatus === "failed"
                          ? styles.inlineError
                          : styles.inlineText
                    }
                  >
                    {nftImportMessage}
                  </p>
                ) : null}
              </div>
            ) : null}

            {buyResponse?.ok && buyResponse.action === "MINT" && buyResponse.txHash ? (
              <a
                className={styles.inlineLink}
                href={`${config.basescan}/tx/${buyResponse.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction on Explorer →
              </a>
            ) : null}
          </WorkflowStageCard>

          <WorkflowStageCard
            step={claimStage.order}
            title={claimStage.navTitle}
            summary={claimStage.consoleSummary}
            chips={claimStage.explanation.chips}
            expanded={activeStage === "claim"}
            onOpenStage={() => setActiveStage("claim")}
          >
            <ExplanationBox
              label={claimStage.explanation.label}
              title={claimStage.explanation.title}
              body={claimStage.explanation.body}
              checks={claimStage.operatorChecks}
            />

            <p className={styles.inlineText}>Claim check fee: ${config.x402ClaimFeeUsd} USDC</p>

            <div className={styles.subPanel}>
              <div className={styles.policyPanelHeader}>
                <h3 className={styles.subPanelTitle}>Policy NFT Detector</h3>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={() => void loadWalletPolicies()}
                  disabled={!isConnected || isWrongNetwork || loading !== null || walletPoliciesLoading}
                >
                  {walletPoliciesLoading ? "Detecting..." : "Refresh"}
                </button>
              </div>

              {walletPoliciesTruncated ? (
                <p className={styles.inlineText}>Scanning latest {POLICY_SCAN_LIMIT} policy IDs.</p>
              ) : null}

              {walletPoliciesError ? <p className={styles.inlineError}>{walletPoliciesError}</p> : null}

              {walletPolicies.length > 0 ? (
                <div className={styles.policyCardGrid}>
                  {walletPolicies.map((item) => {
                    const isSelected = item.policyId === policyId;
                    return (
                      <article
                        key={item.policyId}
                        className={`${styles.policyCard} ${isSelected ? styles.policyCardSelected : ""}`}
                      >
                        <div className={styles.policyCardHead}>
                          <span className={styles.policyCardTitle}>Policy #{item.policyId}</span>
                          <span className="badge">{toStatusLabel(item.status)}</span>
                        </div>
                        <p className={styles.policyCardLine}>Event: {item.eventId || "N/A"}</p>
                        <p className={styles.policyCardLine}>Payout: {formatUsdcAmount(item.payoutUSDC)}</p>
                        <p className={styles.policyCardLine}>Premium: {formatUsdcAmount(item.premiumUSDC)}</p>
                        <p className={styles.policyCardLine}>
                          Coverage: {formatUnixSeconds(item.coverageStart)} to {formatUnixSeconds(item.coverageEnd)}
                        </p>
                        <div className={styles.actionRow}>
                          <button
                            type="button"
                            className={styles.secondaryAction}
                            onClick={() => {
                              setPolicyId(item.policyId);
                              if (item.eventId) setClaimEventId(item.eventId);
                            }}
                          >
                            {isSelected ? "Selected" : "Use for Claim"}
                          </button>
                          <button
                            type="button"
                            className={styles.secondaryAction}
                            onClick={() => void importPolicyNft(item.policyId, config.policyNft, `Policy NFT #${item.policyId}`)}
                            disabled={!canImportDetectedPolicyNfts || loading !== null}
                          >
                            Import NFT
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.emptyHint}>No policies detected for this wallet.</p>
              )}
            </div>

            <div className={styles.badgeRow}>
              <span className="badge">Policy ID: {policyId || "Not selected"}</span>
              <span className="badge">Event ID: {claimEventId || "Not selected"}</span>
              <span className="badge">Status: {selectedStatusLabel}</span>
            </div>

            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.primaryAction}
                onClick={onClaim}
                disabled={Boolean(readinessError) || !policyId || !claimEventId || loading !== null}
              >
                {loading === "claim" ? "Submitting claim..." : "Submit Claim"}
              </button>
            </div>

            {claimResponse?.ok && claimResponse.action === "CLAIM" ? (
              <div className={styles.outcomeCard}>
                <h3 className={styles.subPanelTitle}>
                  {claimDecisionCopy(claimResponse.decision).title}
                </h3>
                <p className={styles.inlineText}>
                  {claimDecisionCopy(claimResponse.decision).description}
                </p>
                <div className={styles.badgeRow}>
                  <span className="badge ok">Decision: {claimResponse.decision}</span>
                  {claimResponse.txHash ? <span className="badge ok">Tx confirmed</span> : null}
                </div>
              </div>
            ) : null}

            {claimResponse?.ok && claimResponse.action === "CLAIM" && claimResponse.txHash ? (
              <a
                className={styles.inlineLink}
                href={`${config.basescan}/tx/${claimResponse.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction on Explorer →
              </a>
            ) : null}
          </WorkflowStageCard>
        </div>

        <div className={styles.infoPanel}>
          <p className={styles.infoPanelHeader}>Workflow Details</p>

          <div className={styles.infoCard}>
            <h3 className={styles.infoCardTitle}>Network</h3>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>Chain</span>
              <span className={styles.infoDetailValue}>Base Sepolia ({config.chainId})</span>
            </div>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>x402 Quote Fee</span>
              <span className={styles.infoDetailValue}>${config.x402QuoteFeeUsd} USDC</span>
            </div>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>Quoted Premium</span>
              <span className={styles.infoDetailValue}>
                {quotePremiumBase ? formatUsdcAmount(quotePremiumBase) : "Get a quote first"}
              </span>
            </div>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>x402 Claim Fee</span>
              <span className={styles.infoDetailValue}>${config.x402ClaimFeeUsd} USDC</span>
            </div>
          </div>

          <div className={styles.infoCard}>
            <h3 className={styles.infoCardTitle}>Selected Policy</h3>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>Policy ID</span>
              <span className={styles.infoDetailValue}>{policyId || "N/A"}</span>
            </div>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>Event ID</span>
              <span className={styles.infoDetailValue}>{claimEventId || "N/A"}</span>
            </div>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>Status</span>
              <span className={styles.infoDetailValue}>{selectedStatusLabel}</span>
            </div>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>Payout</span>
              <span className={styles.infoDetailValue}>
                {selectedWalletPolicy ? formatUsdcAmount(selectedWalletPolicy.payoutUSDC) : "N/A"}
              </span>
            </div>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>Premium</span>
              <span className={styles.infoDetailValue}>
                {selectedWalletPolicy ? formatUsdcAmount(selectedWalletPolicy.premiumUSDC) : "N/A"}
              </span>
            </div>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>Coverage</span>
              <span className={styles.infoDetailValue}>
                {selectedWalletPolicy
                  ? `${formatUnixSeconds(selectedWalletPolicy.coverageStart)} to ${formatUnixSeconds(selectedWalletPolicy.coverageEnd)}`
                  : "N/A"}
              </span>
            </div>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>Quote Expiry</span>
              <span className={styles.infoDetailValue}>
                {selectedWalletPolicy ? formatUnixSeconds(selectedWalletPolicy.quoteExpiry) : "N/A"}
              </span>
            </div>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>Insured</span>
              <span className={styles.infoDetailValue}>{selectedWalletPolicy?.insured || insured || "N/A"}</span>
            </div>
          </div>

          <details className={styles.techDetails}>
            <summary className={styles.techSummary}>Payment Proofs</summary>
            <div className={styles.techBody}>
              {quotePaymentProof ? (
                <div className={styles.infoCard}>
                  <h3 className={styles.infoCardTitle}>Quote Payment</h3>
                  <div className={styles.badgeRow}>
                    <span className={`badge ${quotePaymentProof.success === false ? "bad" : "ok"}`}>
                      {quotePaymentProof.success === false ? "Failed" : "Settled"}
                    </span>
                    {quotePaymentProof.network ? <span className="badge">{quotePaymentProof.network}</span> : null}
                  </div>
                  {quotePaymentProof.transaction ? (
                    <a
                      className={styles.inlineLink}
                      href={`${config.basescan}/tx/${quotePaymentProof.transaction}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Payment tx →
                    </a>
                  ) : null}
                </div>
              ) : null}

              {buyPaymentProof ? (
                <div className={styles.infoCard}>
                  <h3 className={styles.infoCardTitle}>Buy Payment</h3>
                  <div className={styles.badgeRow}>
                    <span className={`badge ${buyPaymentProof.success === false ? "bad" : "ok"}`}>
                      {buyPaymentProof.success === false ? "Failed" : "Settled"}
                    </span>
                  </div>
                  {buyPaymentProof.transaction ? (
                    <a
                      className={styles.inlineLink}
                      href={`${config.basescan}/tx/${buyPaymentProof.transaction}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Payment tx →
                    </a>
                  ) : null}
                </div>
              ) : null}

              {claimPaymentProof ? (
                <div className={styles.infoCard}>
                  <h3 className={styles.infoCardTitle}>Claim Payment</h3>
                  <div className={styles.badgeRow}>
                    <span className={`badge ${claimPaymentProof.success === false ? "bad" : "ok"}`}>
                      {claimPaymentProof.success === false ? "Failed" : "Settled"}
                    </span>
                  </div>
                  {claimPaymentProof.transaction ? (
                    <a
                      className={styles.inlineLink}
                      href={`${config.basescan}/tx/${claimPaymentProof.transaction}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Payment tx →
                    </a>
                  ) : null}
                </div>
              ) : null}

              {!quotePaymentProof && !buyPaymentProof && !claimPaymentProof ? (
                <p className={styles.inlineText}>No payment proof yet.</p>
              ) : null}
            </div>
          </details>

          <details className={styles.techDetails}>
            <summary className={styles.techSummary}>Raw API Responses</summary>
            <div className={styles.techBody}>
              <ResultPanel title="Quote Response" raw={quoteRaw} />
              <ResultPanel title="Buy Response" raw={buyRaw} />
              <ResultPanel title="Claim Response" raw={claimRaw} />
              {!quoteRaw && !buyRaw && !claimRaw ? <p className={styles.inlineText}>No responses yet.</p> : null}
            </div>
          </details>
        </div>
      </div>
    </main>
  );
}
