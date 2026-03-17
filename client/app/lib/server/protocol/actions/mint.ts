import type { MintInput, ProtocolResult } from "@/app/lib/protocol-types";

import { fetchEventbriteEvent } from "../eventbrite";
import type { ContractsGateway } from "../evm";
import { encodeReportBytes } from "../reports";
import { verifySignedQuote } from "../quotes";
import { nowSec, toUint128, toUint64 } from "../utils";

export type MintActionDeps = {
  gateway: ContractsGateway;
  eventbriteApiToken: string;
  eventbriteApiBaseUrl: string;
  quoteSignerPrivateKey: `0x${string}`;
  quoteSignerAddress?: `0x${string}`;
  getNowSec?: () => number;
  fetchEventbriteEventImpl?: typeof fetchEventbriteEvent;
  verifySignedQuoteImpl?: typeof verifySignedQuote;
};

export const handleMint = async (input: MintInput, deps: MintActionDeps): Promise<ProtocolResult> => {
  try {
    if (!input.approved) return { ok: false, error: "NOT_APPROVED" };

    const verifySignedQuoteImpl = deps.verifySignedQuoteImpl ?? verifySignedQuote;
    const { quote } = await verifySignedQuoteImpl(
      input.signedQuote,
      deps.quoteSignerPrivateKey,
      deps.quoteSignerAddress,
    );

    const fetchEventbriteEventImpl = deps.fetchEventbriteEventImpl ?? fetchEventbriteEvent;
    const event = await fetchEventbriteEventImpl(quote.eventId, deps.eventbriteApiToken, deps.eventbriteApiBaseUrl);
    if (event.canceled === true) return { ok: false, error: "EVENT_ALREADY_CANCELED" };
    if (quote.quoteExpiry <= (deps.getNowSec?.() ?? nowSec())) return { ok: false, error: "QUOTE_EXPIRED" };

    const mintContext = await deps.gateway.getMintContext();
    const reportBytes = encodeReportBytes({
      action: 0,
      policyId: BigInt(0),
      mint: {
        to: quote.insured,
        eventId: quote.eventId,
        eventIdHash: quote.eventIdHash,
        eventStart: toUint64(event.eventStart ?? quote.eventStart ?? 0),
        coverageStart: toUint64(quote.coverageStart),
        coverageEnd: toUint64(quote.coverageEnd),
        quoteExpiry: toUint64(quote.quoteExpiry),
        payoutUSDC: toUint128(quote.payoutUSDC),
        premiumUSDC: toUint128(quote.premiumUSDC),
      },
    });

    const { txHash } = await deps.gateway.submitReport(reportBytes);
    const policyId = mintContext.nextPolicyId.toString();

    return {
      ok: true,
      action: "MINT",
      txHash,
      policyId,
      tokenId: policyId,
      policyNftAddress: mintContext.policyNft,
      note: "Quote verified and mint submitted.",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "MINT_FAILED",
    };
  }
};
