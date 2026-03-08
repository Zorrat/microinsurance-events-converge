import { describe, expect, it } from "bun:test";
import type { EVMClient, HTTPClient, Runtime } from "@chainlink/cre-sdk";
import { encodeFunctionResult, hexToBytes } from "viem";

import { CREReceiverABI, PolicyNFTABI } from "../src/abi";
import { handleClaim } from "../src/actions/claim";
import type { Config } from "../src/types";

const RECEIVER = "0x6163eADd9E190b1fAda7f9a3624AaBae963905C5";
const POLICY_NFT = "0x1000000000000000000000000000000000000001";
const POLICY_ID = "2";
const EVENT_ID = "1980292361762";
const INSURED = "0x15d265Dc32a575755ACA19b5EcEAB8018CdD26F1";
const EVENT_HASH = `0x${"11".repeat(32)}` as `0x${string}`;

const baseConfig: Config = {
  chainFamily: "evm",
  chainSelectorName: "ethereum-testnet-sepolia-base-1",
  isTestnet: true,
  receiver: RECEIVER,
  authorizedKeys: [],
  eventbriteApiBaseUrl: "https://www.eventbriteapi.com/v3",
  eventbriteApiTokenSecretName: "EVENTBRITE_API_TOKEN",
  quoteSignerPrivateKeySecretName: "QUOTE_SIGNER_PK",
  secretsNamespace: "env",
  quoteVersion: 1,
};

const mkRuntime = (nowIso: string): Runtime<Config> => {
  return {
    config: baseConfig,
    now: () => new Date(nowIso),
    log: () => {},
    callCapability: () => {
      throw new Error("not used in unit tests");
    },
    runInNodeMode: () => {
      throw new Error("not used in unit tests");
    },
    report: () => ({
      result: () => ({ report: hexToBytes(`0x${"aa".repeat(32)}`) }),
    }),
    getSecret: ({ id }) => ({
      result: () => ({
        id: id ?? "",
        namespace: "env",
        owner: "test",
        value: id === "EVENTBRITE_API_TOKEN" ? "test-eventbrite-token" : "",
      }),
    }),
  } as unknown as Runtime<Config>;
};

type PolicyTuple = {
  eventIdHash: `0x${string}`;
  eventId: string;
  eventStart: bigint;
  coverageStart: bigint;
  coverageEnd: bigint;
  quoteExpiry: bigint;
  payoutUSDC: bigint;
  premiumUSDC: bigint;
  insured: `0x${string}`;
  status: number;
};

const mkEvmClient = (
  policy: PolicyTuple,
  counters: { writes: number },
): EVMClient => {
  const responses: Array<`0x${string}`> = [
    encodeFunctionResult({
      abi: CREReceiverABI,
      functionName: "policyNft",
      result: POLICY_NFT,
    }),
    encodeFunctionResult({
      abi: PolicyNFTABI,
      functionName: "getPolicy",
      result: policy,
    }),
  ];
  let idx = 0;

  return {
    callContract: () => ({
      result: () => {
        if (idx >= responses.length) throw new Error("unexpected callContract call");
        const data = hexToBytes(responses[idx]);
        idx += 1;
        return { data };
      },
    }),
    writeReport: () => ({
      result: () => {
        counters.writes += 1;
        return { txHash: hexToBytes(`0x${"12".repeat(32)}`) };
      },
    }),
  } as unknown as EVMClient;
};

type MockHttpInput = {
  eventPayload: Record<string, unknown>;
  counters: { eventFetches: number; lastUrl?: string };
};

const mkHttpClient = (input: MockHttpInput): HTTPClient => {
  const requester = {
    sendRequest: (req: any) => ({
      result: () => {
        if (typeof req.url !== "string") throw new Error("request url missing");
        if (!req.url.includes("/events/")) throw new Error(`unexpected url ${req.url}`);

        input.counters.eventFetches += 1;
        input.counters.lastUrl = req.url;
        return {
          statusCode: 200,
          body: new TextEncoder().encode(JSON.stringify(input.eventPayload)),
        };
      },
    }),
  };

  return {
    sendRequest: (_runtime: Runtime<Config>, fn: any) => (arg: any) => ({
      result: () => fn(requester, arg),
    }),
  } as unknown as HTTPClient;
};

const mkPolicy = (status: number, coverageEnd: bigint, eventId = EVENT_ID): PolicyTuple => ({
  eventIdHash: EVENT_HASH,
  eventId,
  eventStart: 1_700_000_000n,
  coverageStart: 1_700_000_100n,
  coverageEnd,
  quoteExpiry: 1_900_000_000n,
  payoutUSDC: 10_000_000n,
  premiumUSDC: 400_000n,
  insured: INSURED,
  status,
});

describe("claim guard behavior", () => {
  it("claimAutoApprove submits PAY report without policy/event prechecks", async () => {
    const counters = { writes: 0, eventFetches: 0 };
    const evm = {
      callContract: () => ({
        result: () => {
          throw new Error("callContract should not be used when claimAutoApprove is enabled");
        },
      }),
      writeReport: () => ({
        result: () => {
          counters.writes += 1;
          return { txHash: hexToBytes(`0x${"34".repeat(32)}`) };
        },
      }),
    } as unknown as EVMClient;
    const http = mkHttpClient({
      counters,
      eventPayload: { id: EVENT_ID, status: "live" },
    });
    const runtime = mkRuntime("2033-05-18T09:00:00Z");

    const result = await handleClaim(
      runtime,
      http,
      evm,
      { action: "CLAIM", policyId: POLICY_ID, eventId: EVENT_ID },
      { ...baseConfig, claimAutoApprove: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.action !== "CLAIM") throw new Error("unexpected result type");
    expect(result.decision).toBe("PAY");
    expect(counters.eventFetches).toBe(0);
    expect(counters.writes).toBe(1);
  });

  it("keeps ACTIVE policy claim checks working when event is not canceled and not ended", async () => {
    const counters = { writes: 0, eventFetches: 0 };
    const evm = mkEvmClient(mkPolicy(1, 2_000_000_000n), counters);
    const http = mkHttpClient({
      counters,
      eventPayload: {
        id: EVENT_ID,
        status: "live",
        start: { utc: "2033-05-18T10:00:00Z" },
        end: { utc: "2033-05-18T12:00:00Z" },
      },
    });
    const runtime = mkRuntime("2033-05-18T09:00:00Z");

    const result = await handleClaim(
      runtime,
      http,
      evm,
      { action: "CLAIM", policyId: POLICY_ID, eventId: EVENT_ID },
      baseConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.action !== "CLAIM") throw new Error("unexpected result type");
    expect(result.decision).toBe("NO_OP");
    expect(counters.eventFetches).toBe(1);
    expect(counters.writes).toBe(0);
  });

  it("allows ACTIVE policy to PAY even days after event cancellation", async () => {
    const counters = { writes: 0, eventFetches: 0 };
    const evm = mkEvmClient(mkPolicy(1, 1_700_000_200n), counters);
    const http = mkHttpClient({
      counters,
      eventPayload: {
        id: EVENT_ID,
        status: "canceled",
        canceled_at: "2033-05-12T09:00:00Z",
        start: { utc: "2033-05-10T10:00:00Z" },
        end: { utc: "2033-05-10T12:00:00Z" },
      },
    });
    const runtime = mkRuntime("2033-05-18T09:00:00Z");

    const result = await handleClaim(
      runtime,
      http,
      evm,
      { action: "CLAIM", policyId: POLICY_ID, eventId: EVENT_ID },
      baseConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.action !== "CLAIM") throw new Error("unexpected result type");
    expect(result.decision).toBe("PAY");
    expect(counters.eventFetches).toBe(1);
    expect(counters.writes).toBe(1);
  });

  it("returns RESOLVE_NO_PAYOUT for ACTIVE policy after event end when not canceled", async () => {
    const counters = { writes: 0, eventFetches: 0 };
    const evm = mkEvmClient(mkPolicy(1, 1_700_000_200n), counters);
    const http = mkHttpClient({
      counters,
      eventPayload: {
        id: EVENT_ID,
        status: "live",
        start: { utc: "2033-05-10T10:00:00Z" },
        end: { utc: "2033-05-10T12:00:00Z" },
      },
    });
    const runtime = mkRuntime("2033-05-18T09:00:00Z");

    const result = await handleClaim(
      runtime,
      http,
      evm,
      { action: "CLAIM", policyId: POLICY_ID, eventId: EVENT_ID },
      baseConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.action !== "CLAIM") throw new Error("unexpected result type");
    expect(result.decision).toBe("RESOLVE_NO_PAYOUT");
    expect(counters.eventFetches).toBe(1);
    expect(counters.writes).toBe(1);
  });

  it("short-circuits already PAID policy without event fetch or tx", async () => {
    const counters = { writes: 0, eventFetches: 0 };
    const evm = mkEvmClient(mkPolicy(2, 1_700_000_200n), counters);
    const http = mkHttpClient({
      counters,
      eventPayload: { id: EVENT_ID, status: "live" },
    });
    const runtime = mkRuntime("2033-05-18T09:00:00Z");

    const result = await handleClaim(
      runtime,
      http,
      evm,
      { action: "CLAIM", policyId: POLICY_ID, eventId: EVENT_ID },
      baseConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.action !== "CLAIM") throw new Error("unexpected result type");
    expect(result.decision).toBe("PAY");
    expect(counters.eventFetches).toBe(0);
    expect(counters.writes).toBe(0);
  });

  it("short-circuits already RESOLVED policy without event fetch or tx", async () => {
    const counters = { writes: 0, eventFetches: 0 };
    const evm = mkEvmClient(mkPolicy(3, 1_700_000_200n), counters);
    const http = mkHttpClient({
      counters,
      eventPayload: { id: EVENT_ID, status: "live" },
    });
    const runtime = mkRuntime("2033-05-18T09:00:00Z");

    const result = await handleClaim(
      runtime,
      http,
      evm,
      { action: "CLAIM", policyId: POLICY_ID, eventId: EVENT_ID },
      baseConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.action !== "CLAIM") throw new Error("unexpected result type");
    expect(result.decision).toBe("RESOLVE_NO_PAYOUT");
    expect(counters.eventFetches).toBe(0);
    expect(counters.writes).toBe(0);
  });

  it("returns POLICY_NOT_FOUND_OR_NOT_MINTED when policy event id is empty", async () => {
    const counters = { writes: 0, eventFetches: 0 };
    const evm = mkEvmClient(mkPolicy(0, 1_700_000_200n, ""), counters);
    const http = mkHttpClient({
      counters,
      eventPayload: { id: EVENT_ID, status: "live" },
    });
    const runtime = mkRuntime("2033-05-18T09:00:00Z");

    const result = await handleClaim(
      runtime,
      http,
      evm,
      { action: "CLAIM", policyId: POLICY_ID, eventId: EVENT_ID },
      baseConfig,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unexpected result type");
    expect(result.error).toBe("POLICY_NOT_FOUND_OR_NOT_MINTED");
    expect(counters.eventFetches).toBe(0);
    expect(counters.writes).toBe(0);
  });

  it("uses claimEventbriteApiBaseUrl override for claim event lookup", async () => {
    const counters = { writes: 0, eventFetches: 0, lastUrl: "" };
    const evm = mkEvmClient(mkPolicy(1, 2_000_000_000n), counters);
    const http = mkHttpClient({
      counters,
      eventPayload: {
        id: EVENT_ID,
        status: "live",
        start: { utc: "2033-05-18T10:00:00Z" },
        end: { utc: "2033-05-18T12:00:00Z" },
      },
    });
    const runtime = mkRuntime("2033-05-18T09:00:00Z");

    const result = await handleClaim(
      runtime,
      http,
      evm,
      { action: "CLAIM", policyId: POLICY_ID, eventId: EVENT_ID },
      { ...baseConfig, claimEventbriteApiBaseUrl: "http://127.0.0.1:8787/v3" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.action !== "CLAIM") throw new Error("unexpected result type");
    expect(result.decision).toBe("NO_OP");
    expect(counters.lastUrl.startsWith("http://127.0.0.1:8787/v3/events/")).toBe(true);
  });
});
