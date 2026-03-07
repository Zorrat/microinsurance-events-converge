"use client";

import { useEffect, useMemo, useState } from "react";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { decodePaymentResponseHeader } from "@x402/fetch";
import { formatUnits } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { ExplanationBox } from "@/app/components/workflow/explanation-box";
import { PaymentPreviewPanel } from "@/app/components/workflow/payment-preview-panel";
import { ResultPanel } from "@/app/components/workflow/result-panel";
import { WorkflowStageCard } from "@/app/components/workflow/workflow-stage-card";
import type {
  ClaimWorkflowOk,
  MintWorkflowOk,
  QuoteWorkflowOk,
  WorkflowError,
} from "@/app/lib/cre-types";
import { config } from "@/app/lib/config";
import { WORKFLOW_STAGE_CONTENT } from "@/app/lib/workflow-content";
import { usePaidFetch } from "@/app/lib/usePaidFetch";
import { useQuoteCache } from "@/app/lib/useQuoteCache";
import { workflowResultSchema } from "@/app/lib/validation";
import { getMetaMaskProvider } from "@/app/lib/wallet/metaMaskProvider";

import styles from "@/app/app/page.module.css";

type QuoteRouteResponse = QuoteWorkflowOk | WorkflowError;
type BuyRouteResponse = MintWorkflowOk | WorkflowError;
type ClaimRouteResponse = ClaimWorkflowOk | WorkflowError;
type PreviewKey = "quote" | "buy" | "claim";

type PaymentProof = {
  rawHeader: string;
  success?: boolean;
  network?: string;
  transaction?: string;
  decodeError?: string;
};

type PaymentPreview = {
  endpoint: string;
  status: number;
  network?: string;
  payTo?: string;
  asset?: string;
  amount?: string;
  amountDisplay?: string;
  description?: string;
  error?: string;
};

type WalletPolicy = {
  policyId: string;
  eventId: string;
  status: number;
};

const CRE_UI_WORKFLOWS_URL = "https://cre.chain.link/workflows";
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
  if (status === 3) return "RESOLVED";
  return "UNKNOWN";
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

const formatPaymentAmount = (asset?: string, amount?: string): string | undefined => {
  if (!asset || !amount) return undefined;
  if (!/^\d+$/.test(amount)) return `${amount} ${asset}`;

  if (asset.toLowerCase() === config.usdc.toLowerCase()) {
    try {
      return `${formatUnits(BigInt(amount), 6)} USDC`;
    } catch {
      return `${amount} USDC base units`;
    }
  }

  return `${amount} base units`;
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

const extractAcceptedExecutionId = (
  result: QuoteRouteResponse | BuyRouteResponse | ClaimRouteResponse | null,
): string | null => {
  if (!result || result.ok !== false) return null;
  if (typeof result.error !== "string") return null;
  const prefix = "CRE_ACCEPTED:";
  if (!result.error.startsWith(prefix)) return null;

  const executionId = result.error.slice(prefix.length).trim();
  return executionId.length > 0 ? executionId : null;
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

export default function WorkflowDemoPage() {
  const { isConnected, chainId, address } = useAccount();
  const publicClient = usePublicClient({ chainId: config.chainId });
  const paidFetch = usePaidFetch();
  const { cacheQuote, getAllCachedQuotes } = useQuoteCache();
  const [hasMetaMaskProvider, setHasMetaMaskProvider] = useState<boolean | null>(null);

  const [eventUrl, setEventUrl] = useState(
    "https://www.eventbrite.com/e/jay-jay-present-big-apple-brunch-day-party-each-n-every-sunday-tickets-896748186967",
  );
  const [eventName, setEventName] = useState("Jay Jay Present Big Apple Brunch & Day Party Each n Every Sunday");
  const [insured, setInsured] = useState("0x5125E6b78b5Cf53248EcB5A22Ce539341FE90Cd8");

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
  const [paymentPreviews, setPaymentPreviews] = useState<Record<PreviewKey, PaymentPreview | null>>({
    quote: null,
    buy: null,
    claim: null,
  });

  const [loading, setLoading] = useState<"quote" | "buy" | "claim" | null>(null);
  const [previewLoading, setPreviewLoading] = useState<PreviewKey | null>(null);
  const [walletPolicies, setWalletPolicies] = useState<WalletPolicy[]>([]);
  const [walletPoliciesLoading, setWalletPoliciesLoading] = useState(false);
  const [walletPoliciesError, setWalletPoliciesError] = useState<string | null>(null);
  const [walletPoliciesTruncated, setWalletPoliciesTruncated] = useState(false);

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

  // Check cached quotes for current wallet
  const cachedQuotes = useMemo(() => {
    if (!address) return [];
    return getAllCachedQuotes(address);
  }, [address, getAllCachedQuotes, quoteResponse]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setHasMetaMaskProvider(Boolean(getMetaMaskProvider()));
  }, []);

  const readinessError = useMemo(() => {
    if (hasMetaMaskProvider === null) return "Checking wallet provider...";
    if (!hasMetaMaskProvider) return "Install or enable MetaMask to use this demo.";
    if (!isConnected) return "Connect MetaMask to run paid x402 endpoints.";
    if (isWrongNetwork) return `Switch wallet to Base Sepolia (${config.chainId}).`;
    if (!paidFetch) return "Wallet signer not ready for x402 payment signing.";
    return null;
  }, [hasMetaMaskProvider, isConnected, isWrongNetwork, paidFetch]);

  const quoteAcceptedExecutionId = extractAcceptedExecutionId(quoteResponse);
  const buyAcceptedExecutionId = extractAcceptedExecutionId(buyResponse);
  const claimAcceptedExecutionId = extractAcceptedExecutionId(claimResponse);
  const quotePreview = paymentPreviews.quote;
  const buyPreview = paymentPreviews.buy;
  const claimPreview = paymentPreviews.claim;

  const quoteStage = WORKFLOW_STAGE_CONTENT.quote;
  const buyStage = WORKFLOW_STAGE_CONTENT.buy;
  const claimStage = WORKFLOW_STAGE_CONTENT.claim;
  const stageRail = [quoteStage, buyStage, claimStage] as const;
  const stageCompleted = {
    quote: Boolean(quoteResponse && quoteResponse.ok && quoteResponse.action === "QUOTE_CHECK"),
    buy: Boolean(buyResponse && buyResponse.ok && buyResponse.action === "MINT"),
    claim: Boolean(claimResponse && claimResponse.ok && claimResponse.action === "CLAIM"),
  } as const;

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

  const loadPaymentPreview = async (
    key: PreviewKey,
    url: string,
    payload: unknown,
  ): Promise<PaymentPreview> => {
    setPreviewLoading(key);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const paymentRequired = await readPaymentRequiredFromResponse(response);
      const asRecord =
        paymentRequired && typeof paymentRequired === "object"
          ? (paymentRequired as Record<string, unknown>)
          : null;
      const accepts = Array.isArray(asRecord?.accepts)
        ? (asRecord.accepts as Array<Record<string, unknown>>)
        : [];
      const first = accepts[0];

      let preview: PaymentPreview;
      if (!first) {
        preview = {
          endpoint: url,
          status: response.status,
          error: `No x402 challenge payload found (status ${response.status}).`,
        };
      } else {
        const asset = typeof first.asset === "string" ? first.asset : undefined;
        const amount =
          typeof first.amount === "string"
            ? first.amount
            : typeof first.maxAmountRequired === "string"
              ? first.maxAmountRequired
              : undefined;
        const resource =
          asRecord?.resource && typeof asRecord.resource === "object"
            ? (asRecord.resource as Record<string, unknown>)
            : null;

        preview = {
          endpoint: url,
          status: response.status,
          network: typeof first.network === "string" ? first.network : undefined,
          payTo: typeof first.payTo === "string" ? first.payTo : undefined,
          asset,
          amount,
          amountDisplay: formatPaymentAmount(asset, amount),
          description: typeof resource?.description === "string" ? resource.description : undefined,
        };
      }

      setPaymentPreviews((prev) => ({ ...prev, [key]: preview }));
      return preview;
    } catch (error) {
      const preview: PaymentPreview = {
        endpoint: url,
        status: 0,
        error: `Failed to load preview: ${asErrorMessage(error)}`,
      };
      setPaymentPreviews((prev) => ({ ...prev, [key]: preview }));
      return preview;
    } finally {
      setPreviewLoading((current) => (current === key ? null : current));
    }
  };

  const onQuote = async () => {
    const quotePayload = {
      eventUrl,
      eventName,
      insured,
    };

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

    try {
      if (!paymentPreviews.quote) {
        await loadPaymentPreview("quote", "/api/quote", quotePayload);
      }

      const { data, raw, paymentProof } = await postPaid<QuoteRouteResponse>("/api/quote", quotePayload);

      setQuoteResponse(data);
      setQuoteRaw(raw);
      setQuotePaymentProof(paymentProof);

      if (data.ok && data.action === "QUOTE_CHECK") {
        const canonicalId = data.canonicalEventId || data.signedQuote?.quote.eventId || "";
        if (canonicalId) setClaimEventId(canonicalId);

        // Cache the signed quote for this wallet
        if (address && data.signedQuote) {
          cacheQuote(address, data.signedQuote);
        }
      }
    } catch (error) {
      const fallback = { ok: false, error: asErrorMessage(error) } as WorkflowError;
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

    try {
      if (!paymentPreviews.buy) {
        await loadPaymentPreview("buy", "/api/buy", buyPayload);
      }

      const { data, raw, paymentProof } = await postPaid<BuyRouteResponse>("/api/buy", buyPayload);

      setBuyResponse(data);
      setBuyRaw(raw);
      setBuyPaymentProof(paymentProof);

      if (data.ok && data.action === "MINT" && data.policyId) {
        setPolicyId(data.policyId);
      }
    } catch (error) {
      const fallback = { ok: false, error: asErrorMessage(error) } as WorkflowError;
      setBuyResponse(fallback);
      setBuyRaw(JSON.stringify(fallback, null, 2));
      setBuyPaymentProof(null);
    } finally {
      setLoading(null);
    }
  };

  const onClaim = async () => {
    const claimPayload = {
      policyId,
      eventId: claimEventId,
    };

    setLoading("claim");
    setClaimResponse(null);
    setClaimRaw("");
    setClaimPaymentProof(null);

    try {
      if (!paymentPreviews.claim) {
        await loadPaymentPreview("claim", "/api/claim", claimPayload);
      }

      const { data, raw, paymentProof } = await postPaid<ClaimRouteResponse>("/api/claim", claimPayload);

      setClaimResponse(data);
      setClaimRaw(raw);
      setClaimPaymentProof(paymentProof);
    } catch (error) {
      const fallback = { ok: false, error: asErrorMessage(error) } as WorkflowError;
      setClaimResponse(fallback);
      setClaimRaw(JSON.stringify(fallback, null, 2));
      setClaimPaymentProof(null);
    } finally {
      setLoading(null);
    }
  };

  const loadWalletPolicies = async () => {
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
          const policy = result.result as { eventId?: unknown; status?: unknown } | undefined;
          const eventId = typeof policy?.eventId === "string" ? policy.eventId : "";
          const statusNum = Number(policy?.status ?? 0);
          found.push({
            policyId: ownedIds[i].toString(),
            eventId,
            status: Number.isFinite(statusNum) ? statusNum : 0,
          });
        }
      }

      found.sort((a, b) => Number(b.policyId) - Number(a.policyId));
      setWalletPolicies(found);

      if (found.length > 0) {
        const selected =
          found.find((item) => item.status === 1) ||
          found.find((item) => item.eventId.length > 0) ||
          found[0];
        if (selected) {
          setPolicyId(selected.policyId);
          if (selected.eventId) setClaimEventId(selected.eventId);
        }
      }
    } catch (error) {
      setWalletPolicies([]);
      setWalletPoliciesError(`Failed to detect policies: ${asErrorMessage(error)}`);
    } finally {
      setWalletPoliciesLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      {/* ─── Header ─── */}
      <section className={`${styles.glassPanel} ${styles.headerPanel}`}>
        <div className={styles.headerBlock}>
          <h1 className={styles.pageTitle}>CoverFi</h1>
          <p className={styles.pageSubtitle}>
            Quote, buy, and claim event cancellation coverage
          </p>
        </div>
        <ConnectButton />
      </section>

      {/* ─── Wallet Status ─── */}
      <section className={`${styles.glassPanel} ${styles.statusPanel}`}>
        <p className={`${styles.statusMessage} ${readinessError ? styles.statusError : styles.statusOk}`}>
          {readinessError || "Wallet connected and ready."}
        </p>
      </section>

      {/* ─── Stepper ─── */}
      <section className={`${styles.glassPanel} ${styles.flowRailPanel}`}>
        <p className={styles.flowRailLabel}>Workflow Stages</p>
        <div className={styles.flowRail}>
          {stageRail.map((stage) => (
            <article
              key={stage.key}
              className={`${styles.flowNode} ${stageCompleted[stage.key] ? styles.flowNodeDone : ""}`.trim()}
            >
              <div className={styles.flowNodeHead}>
                <span className={styles.flowNodeIndex}>{String(stage.order).padStart(2, "0")}</span>
                <h2 className={styles.flowNodeTitle}>{stage.navTitle}</h2>
              </div>
              <p className={styles.flowNodeSummary}>{stage.consoleSummary}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ─── Two-Column Layout ─── */}
      <div className={styles.twoColumnLayout}>
        {/* ─── LEFT: User Actions ─── */}
        <div className={styles.userPanel}>
          {/* Cached Quotes Banner */}
          {cachedQuotes.length > 0 && (
            <div className={styles.cachedBanner}>
              <span className={styles.cachedDot} />
              {cachedQuotes.length} cached quote{cachedQuotes.length > 1 ? "s" : ""} · expires in{" "}
              {cachedQuotes[0].minutesLeft} min
            </div>
          )}

          {/* Quote Stage */}
          <WorkflowStageCard
            step={quoteStage.order}
            title={quoteStage.navTitle}
            summary={quoteStage.consoleSummary}
            chips={quoteStage.explanation.chips}
          >
            <ExplanationBox
              label={quoteStage.explanation.label}
              title={quoteStage.explanation.title}
              body={quoteStage.explanation.body}
              checks={quoteStage.operatorChecks}
            />

            <PaymentPreviewPanel
              endpointLabel="POST /api/quote"
              amountLabel={quotePreview?.amountDisplay || `$${config.x402FixedFeeUsd} USDC`}
              networkLabel={quotePreview?.network || config.chainCaip2}
              receiverLabel={quotePreview?.payTo || config.x402PayTo || "Not configured"}
              assetLabel={quotePreview?.asset}
              descriptionLabel={quotePreview?.description}
              errorLabel={quotePreview?.error}
              onRefresh={() => void loadPaymentPreview("quote", "/api/quote", { eventUrl, eventName, insured })}
              loading={previewLoading === "quote"}
              disabled={loading !== null}
            />

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
                <span className={styles.fieldLabel}>Event Name</span>
                <input
                  className={styles.input}
                  value={eventName}
                  placeholder="Event name..."
                  onChange={(event) => setEventName(event.target.value)}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Insured Address</span>
                <input className={styles.input} value={insured} onChange={(event) => setInsured(event.target.value)} />
              </label>
            </div>

            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.primaryAction}
                onClick={onQuote}
                disabled={Boolean(readinessError) || loading !== null}
              >
                {loading === "quote" ? "Requesting quote..." : "Get Quote"}
              </button>
            </div>

            {quoteResponse?.ok && quoteResponse.action === "QUOTE_CHECK" ? (
              <div className={styles.badgeRow}>
                <span className={`badge ${quoteResponse.quoteValid ? "ok" : "warn"}`}>
                  {quoteResponse.quoteValid ? "✓ Quote valid" : "✗ Quote invalid"}
                </span>
                {quoteResponse.reason ? <span className="badge warn">reason: {quoteResponse.reason}</span> : null}
                {quoteResponse.warnings?.map((warning) => (
                  <span key={warning} className="badge warn">
                    {warning}
                  </span>
                ))}
              </div>
            ) : null}
          </WorkflowStageCard>

          {/* Buy Stage */}
          <WorkflowStageCard
            step={buyStage.order}
            title={buyStage.navTitle}
            summary={buyStage.consoleSummary}
            chips={buyStage.explanation.chips}
          >
            <ExplanationBox
              label={buyStage.explanation.label}
              title={buyStage.explanation.title}
              body={buyStage.explanation.body}
              checks={buyStage.operatorChecks}
            />

            <PaymentPreviewPanel
              endpointLabel="POST /api/buy"
              amountLabel={buyPreview?.amountDisplay || `$${config.x402FixedFeeUsd} USDC`}
              networkLabel={buyPreview?.network || config.chainCaip2}
              receiverLabel={buyPreview?.payTo || config.x402PayTo || "Not configured"}
              assetLabel={buyPreview?.asset}
              descriptionLabel={buyPreview?.description}
              errorLabel={buyPreview?.error}
              onRefresh={() => {
                if (!quoteSigned) return;
                void loadPaymentPreview("buy", "/api/buy", { signedQuote: quoteSigned });
              }}
              loading={previewLoading === "buy"}
              disabled={!quoteSigned || loading !== null}
            />

            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.primaryAction}
                onClick={onBuy}
                disabled={Boolean(readinessError) || !canBuy || loading !== null}
              >
                {loading === "buy" ? "Submitting mint..." : "Buy Coverage"}
              </button>
            </div>

            {buyResponse?.ok && buyResponse.action === "MINT" ? (
              <div className={styles.badgeRow}>
                {buyResponse.policyId ? <span className="badge ok">Policy #{buyResponse.policyId}</span> : null}
                {buyResponse.txHash ? <span className="badge ok">Tx confirmed</span> : null}
              </div>
            ) : null}

            {buyResponse?.ok && buyResponse.action === "MINT" && buyResponse.txHash ? (
              <a className={styles.inlineLink} href={`${config.basescan}/tx/${buyResponse.txHash}`} target="_blank" rel="noreferrer">
                View transaction on Explorer →
              </a>
            ) : null}
          </WorkflowStageCard>

          {/* Claim Stage */}
          <WorkflowStageCard
            step={claimStage.order}
            title={claimStage.navTitle}
            summary={claimStage.consoleSummary}
            chips={claimStage.explanation.chips}
          >
            <ExplanationBox
              label={claimStage.explanation.label}
              title={claimStage.explanation.title}
              body={claimStage.explanation.body}
              checks={claimStage.operatorChecks}
            />

            <PaymentPreviewPanel
              endpointLabel="POST /api/claim"
              amountLabel={claimPreview?.amountDisplay || `$${config.x402FixedFeeUsd} USDC`}
              networkLabel={claimPreview?.network || config.chainCaip2}
              receiverLabel={claimPreview?.payTo || config.x402PayTo || "Not configured"}
              assetLabel={claimPreview?.asset}
              descriptionLabel={claimPreview?.description}
              errorLabel={claimPreview?.error}
              onRefresh={() => void loadPaymentPreview("claim", "/api/claim", { policyId, eventId: claimEventId })}
              loading={previewLoading === "claim"}
              disabled={!policyId || !claimEventId || loading !== null}
            />

            <div className={styles.subPanel}>
              <h3 className={styles.subPanelTitle}>Policy NFT Detector</h3>
              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={() => void loadWalletPolicies()}
                  disabled={!isConnected || isWrongNetwork || loading !== null || walletPoliciesLoading}
                >
                  {walletPoliciesLoading ? "Detecting..." : "Detect Policies"}
                </button>
              </div>

              {walletPoliciesTruncated ? (
                <p className={styles.inlineText}>
                  Scanning latest {POLICY_SCAN_LIMIT} policy IDs.
                </p>
              ) : null}

              {walletPoliciesError ? <p className={styles.inlineError}>{walletPoliciesError}</p> : null}

              {walletPolicies.length > 0 ? (
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Select Policy</span>
                  <select
                    className={styles.select}
                    value={policyId}
                    onChange={(event) => {
                      const selectedPolicyId = event.target.value;
                      setPolicyId(selectedPolicyId);
                      const selected = walletPolicies.find((item) => item.policyId === selectedPolicyId);
                      if (selected?.eventId) setClaimEventId(selected.eventId);
                    }}
                  >
                    {walletPolicies.map((item) => (
                      <option key={item.policyId} value={item.policyId}>
                        #{item.policyId} - {toStatusLabel(item.status)} - {item.eventId || "N/A"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className={styles.emptyHint}>No policies detected for this wallet.</p>
              )}
            </div>

            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Policy ID</span>
                <input className={styles.input} value={policyId} onChange={(event) => setPolicyId(event.target.value)} />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Event ID</span>
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
                className={styles.primaryAction}
                onClick={onClaim}
                disabled={Boolean(readinessError) || !policyId || !claimEventId || loading !== null}
              >
                {loading === "claim" ? "Submitting claim..." : "Submit Claim"}
              </button>
            </div>

            {claimResponse?.ok && claimResponse.action === "CLAIM" ? (
              <div className={styles.badgeRow}>
                <span className="badge ok">Decision: {claimResponse.decision}</span>
                {claimResponse.txHash ? <span className="badge ok">Tx confirmed</span> : null}
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

        {/* ─── RIGHT: Developer Info ─── */}
        <div className={styles.infoPanel}>
          <p className={styles.infoPanelHeader}>Developer Info</p>

          {/* Network & Config */}
          <div className={styles.infoCard}>
            <h3 className={styles.infoCardTitle}>Network</h3>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>Chain</span>
              <span className={styles.infoDetailValue}>Base Sepolia ({config.chainId})</span>
            </div>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>CRE Mode</span>
              <span className={styles.infoDetailValue}>{config.creExecutionMode}</span>
            </div>
            <div className={styles.infoDetail}>
              <span className={styles.infoDetailLabel}>x402 Fee</span>
              <span className={styles.infoDetailValue}>${config.x402FixedFeeUsd} USDC</span>
            </div>
          </div>

          {/* Payment Proofs */}
          {quotePaymentProof && (
            <div className={styles.infoCard}>
              <h3 className={styles.infoCardTitle}>Quote Payment</h3>
              <div className={styles.badgeRow}>
                <span className={`badge ${quotePaymentProof.success === false ? "bad" : "ok"}`}>
                  {quotePaymentProof.success === false ? "Failed" : "Settled"}
                </span>
                {quotePaymentProof.network && <span className="badge">{quotePaymentProof.network}</span>}
              </div>
              {quotePaymentProof.transaction && (
                <a
                  className={styles.inlineLink}
                  href={`${config.basescan}/tx/${quotePaymentProof.transaction}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Payment tx →
                </a>
              )}
            </div>
          )}

          {buyPaymentProof && (
            <div className={styles.infoCard}>
              <h3 className={styles.infoCardTitle}>Buy Payment</h3>
              <div className={styles.badgeRow}>
                <span className={`badge ${buyPaymentProof.success === false ? "bad" : "ok"}`}>
                  {buyPaymentProof.success === false ? "Failed" : "Settled"}
                </span>
              </div>
              {buyPaymentProof.transaction && (
                <a
                  className={styles.inlineLink}
                  href={`${config.basescan}/tx/${buyPaymentProof.transaction}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Payment tx →
                </a>
              )}
            </div>
          )}

          {claimPaymentProof && (
            <div className={styles.infoCard}>
              <h3 className={styles.infoCardTitle}>Claim Payment</h3>
              <div className={styles.badgeRow}>
                <span className={`badge ${claimPaymentProof.success === false ? "bad" : "ok"}`}>
                  {claimPaymentProof.success === false ? "Failed" : "Settled"}
                </span>
              </div>
              {claimPaymentProof.transaction && (
                <a
                  className={styles.inlineLink}
                  href={`${config.basescan}/tx/${claimPaymentProof.transaction}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Payment tx →
                </a>
              )}
            </div>
          )}

          {/* CRE Execution Tracking */}
          {quoteAcceptedExecutionId && (
            <div className={styles.infoCard}>
              <h3 className={styles.infoCardTitle}>CRE Execution (Quote)</h3>
              <p className={styles.inlineText}>{quoteAcceptedExecutionId}</p>
              <a className={styles.inlineLink} href={CRE_UI_WORKFLOWS_URL} target="_blank" rel="noreferrer">
                Track in CRE UI →
              </a>
            </div>
          )}

          {buyAcceptedExecutionId && (
            <div className={styles.infoCard}>
              <h3 className={styles.infoCardTitle}>CRE Execution (Buy)</h3>
              <p className={styles.inlineText}>{buyAcceptedExecutionId}</p>
              <a className={styles.inlineLink} href={CRE_UI_WORKFLOWS_URL} target="_blank" rel="noreferrer">
                Track in CRE UI →
              </a>
            </div>
          )}

          {claimAcceptedExecutionId && (
            <div className={styles.infoCard}>
              <h3 className={styles.infoCardTitle}>CRE Execution (Claim)</h3>
              <p className={styles.inlineText}>{claimAcceptedExecutionId}</p>
              <a className={styles.inlineLink} href={CRE_UI_WORKFLOWS_URL} target="_blank" rel="noreferrer">
                Track in CRE UI →
              </a>
            </div>
          )}

          {/* Raw JSON Responses */}
          <ResultPanel title="Quote Response" raw={quoteRaw} />
          <ResultPanel title="Buy Response" raw={buyRaw} />
          <ResultPanel title="Claim Response" raw={claimRaw} />
        </div>
      </div>
    </main>
  );
}
