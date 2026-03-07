import { bytesToHex, encodeCallMsg, prepareReportRequest, type EVMClient, type HTTPClient, type Runtime } from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeFunctionData, isAddress, zeroAddress } from "viem";

import type { Config, MintInput, WorkflowResult } from "../types";
import { CREReceiverABI, PolicyNFTABI } from "../abi";
import { verifySignedQuote } from "../quotes";
import { encodeReportBytes } from "../reports";
import { fetchEventbriteEvent } from "../services/eventbrite";
import { mustHexAddress, nowSec, toUint64, toUint128 } from "../utils";

export const handleMint = async (
  runtime: Runtime<Config>,
  httpClient: HTTPClient,
  evm: EVMClient,
  input: MintInput,
  config: Config,
): Promise<WorkflowResult> => {
  try {
    if (!input.approved) return { ok: false, error: "NOT_APPROVED" };

    const receiver = mustHexAddress(config.receiver, "receiver");
    const { quote } = await verifySignedQuote(runtime, input.signedQuote, config);

    const event = fetchEventbriteEvent(runtime, httpClient, quote.eventId, config);
    if (event.canceled === true) return { ok: false, error: "EVENT_ALREADY_CANCELED" };
    if (quote.quoteExpiry <= nowSec(runtime)) return { ok: false, error: "QUOTE_EXPIRED" };

    const readAndDecode = (
      to: `0x${string}`,
      abi: any,
      functionName: string,
      args: readonly unknown[] = [],
    ): any => {
      const callData = encodeFunctionData({
        abi,
        functionName: functionName as any,
        args: args as any,
      });
      const read = evm
        .callContract(runtime, {
          call: encodeCallMsg({
            from: zeroAddress,
            to,
            data: callData,
          }),
        })
        .result();

      const dataHex = bytesToHex(read.data) as `0x${string}`;
      if (dataHex === "0x") throw new Error(`EVM_EMPTY_RESPONSE:${functionName}`);

      return decodeFunctionResult({
        abi,
        functionName: functionName as any,
        data: dataHex,
      });
    };

    const policyNft = readAndDecode(receiver, CREReceiverABI, "policyNft");
    if (!isAddress(policyNft) || policyNft.toLowerCase() === zeroAddress) {
      throw new Error("INVALID_POLICY_NFT_ADDRESS");
    }
    const nextPolicyIdBefore = BigInt(readAndDecode(policyNft, PolicyNFTABI, "nextPolicyId"));

    const reportBytes = encodeReportBytes({
      action: 0,
      policyId: 0n,
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

    // All state mutation is routed through CREReceiver.onReport (no direct PolicyNFT/PolicyVault writes).
    const report = runtime.report(prepareReportRequest(reportBytes)).result();
    const write = evm
      .writeReport(runtime, {
        receiver,
        report,
        gasConfig: { gasLimit: "1000000" },
      })
      .result();

    const txHash = write.txHash ? bytesToHex(write.txHash) : undefined;
    runtime.log(`MINT submitted txHash=${txHash ?? "n/a"}`);
    const nextPolicyIdAfter = BigInt(readAndDecode(policyNft, PolicyNFTABI, "nextPolicyId"));
    if (nextPolicyIdAfter !== nextPolicyIdBefore + 1n) {
      runtime.log(
        `MINT nextPolicyId advanced unexpectedly before=${nextPolicyIdBefore.toString()} after=${nextPolicyIdAfter.toString()}`,
      );
    }
    const mintedId = nextPolicyIdBefore.toString();

    return {
      ok: true,
      action: "MINT",
      ...(txHash ? { txHash } : {}),
      policyId: mintedId,
      tokenId: mintedId,
      policyNftAddress: policyNft,
      note: "Quote verified and MINT report submitted.",
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "MINT_FAILED" };
  }
};
