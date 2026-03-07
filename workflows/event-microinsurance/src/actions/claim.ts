import {
  LAST_FINALIZED_BLOCK_NUMBER,
  bytesToHex,
  encodeCallMsg,
  prepareReportRequest,
  type EVMClient,
  type HTTPClient,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeFunctionData, zeroAddress } from "viem";

import type { ClaimInput, Config, WorkflowResult } from "../types";
import { CREReceiverABI, PolicyNFTABI } from "../abi";
import { emptyMintData, encodeReportBytes } from "../reports";
import { fetchEventbriteEvent } from "../services/eventbrite";
import { mustHexAddress, nowSec } from "../utils";

export const handleClaim = async (
  runtime: Runtime<Config>,
  httpClient: HTTPClient,
  evm: EVMClient,
  input: ClaimInput,
  config: Config,
): Promise<WorkflowResult> => {
  try {
    const receiver = mustHexAddress(config.receiver, "receiver");
    const policyId = BigInt(input.policyId);
    const receiverReadData = encodeFunctionData({
      abi: CREReceiverABI,
      functionName: "policyNft",
      args: [],
    });
    const receiverRead = evm
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: receiver,
          data: receiverReadData,
        }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result();
    const policyNft = decodeFunctionResult({
      abi: CREReceiverABI,
      functionName: "policyNft",
      data: bytesToHex(receiverRead.data),
    });

    const policyReadData = encodeFunctionData({
      abi: PolicyNFTABI,
      functionName: "getPolicy",
      args: [policyId],
    });
    const policyRead = evm
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: policyNft,
          data: policyReadData,
        }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result();

    const policy = decodeFunctionResult({
      abi: PolicyNFTABI,
      functionName: "getPolicy",
      data: bytesToHex(policyRead.data),
    });
    const canonicalEventId = policy.eventId;
    if (canonicalEventId !== input.eventId) return { ok: false, error: "EVENT_ID_MISMATCH" };

    const event = fetchEventbriteEvent(runtime, httpClient, canonicalEventId, config);

    const tNow = nowSec(runtime);
    const policyCoverageEndSec =
      typeof policy.coverageEnd === "bigint"
        ? Number(policy.coverageEnd)
        : typeof policy.coverageEnd === "number"
          ? policy.coverageEnd
          : undefined;
    const eventOverBoundarySec = event.eventEnd ?? policyCoverageEndSec;

    let decision: "PAY" | "RESOLVE_NO_PAYOUT" | "NO_OP" = "NO_OP";
    if (event.canceled === true) decision = "PAY";
    else if (eventOverBoundarySec !== undefined && tNow > eventOverBoundarySec) decision = "RESOLVE_NO_PAYOUT";

    if (decision === "NO_OP") {
      return {
        ok: true,
        action: "CLAIM",
        decision,
        note: "No settlement yet.",
        event,
      };
    }

    const reportBytes =
      decision === "PAY"
        ? encodeReportBytes({ action: 1, policyId, mint: emptyMintData() })
        : encodeReportBytes({ action: 2, policyId, mint: emptyMintData() });

    // All state mutation is routed through CREReceiver.onReport (no direct PolicyNFT/PolicyVault writes).
    const report = runtime.report(prepareReportRequest(reportBytes)).result();
    const write = evm
      .writeReport(runtime, {
        receiver,
        report,
        gasConfig: { gasLimit: "800000" },
      })
      .result();

    const txHash = write.txHash ? bytesToHex(write.txHash) : undefined;
    runtime.log(`CLAIM decision=${decision} txHash=${txHash ?? "n/a"}`);

    return {
      ok: true,
      action: "CLAIM",
      decision,
      ...(txHash ? { txHash } : {}),
      note: decision === "PAY" ? "Submitted PAY report." : "Submitted RESOLVE_NO_PAYOUT report.",
      event,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "CLAIM_FAILED" };
  }
};
