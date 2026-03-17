import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MintResultOk } from "@/app/lib/protocol-types";

const mocks = vi.hoisted(() => ({
  parseRequestJson: vi.fn(),
  handleMint: vi.fn(),
  createRelayGateway: vi.fn(() => ({ kind: "gateway" })),
  makeBuyRouteConfig: vi.fn((premiumUSDC: string) => ({
    accepts: {
      scheme: "exact",
      network: "eip155:84532",
      payTo: "0xpayto",
      price: { asset: "USDC", amount: premiumUSDC },
    },
    description: "Mint a policy from a previously signed quote",
  })),
  withX402: vi.fn(),
}));

vi.mock("@x402/next", () => ({
  withX402: mocks.withX402,
}));

vi.mock("@/app/lib/server/protocol/actions/mint", () => ({
  handleMint: mocks.handleMint,
}));

vi.mock("@/app/lib/server/protocol/evm", () => ({
  createRelayGateway: mocks.createRelayGateway,
}));

vi.mock("@/app/lib/server/x402", () => ({
  makeBuyRouteConfig: mocks.makeBuyRouteConfig,
  x402Server: { kind: "x402-server" },
}));

vi.mock("@/app/lib/server/env", () => ({
  serverConfig: {
    relayPrivateKey: "0xrelay",
    quoteSignerPrivateKey: "0xquote",
    quoteSignerAddress: "0xquote-address",
    eventbriteApiToken: "eventbrite-token",
    eventbriteApiBaseUrl: "https://www.eventbriteapi.com/v3",
  },
}));

vi.mock("@/app/lib/validation", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/validation")>("@/app/lib/validation");
  return {
    ...actual,
    parseRequestJson: mocks.parseRequestJson,
  };
});

const validBody = {
  signedQuote: {
    quote: {
      quoteVersion: 1,
      insured: "0x15d265Dc32a575755ACA19b5EcEAB8018CdD26F1",
      eventId: "123456789012",
      eventIdHash: `0x${"11".repeat(32)}`,
      eventStart: 1800000000,
      coverageStart: 1800000000,
      coverageEnd: 1800007200,
      quoteExpiry: 1900000000,
      payoutUSDC: "10000000",
      premiumUSDC: "450000",
      nonce: `0x${"22".repeat(32)}`,
    },
    quoteHash: `0x${"33".repeat(32)}`,
    signature: `0x${"44".repeat(65)}`,
    signer: "0x04d0157e19A5C560b450471D9fB041b411b8E8aE",
  },
};

const loadRoute = async () => import("@/app/api/buy/route");

const buildRequest = (headers?: HeadersInit) =>
  new Request("http://localhost/api/buy", {
    method: "POST",
    headers,
    body: JSON.stringify(validBody),
  }) as NextRequest;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.withX402.mockImplementation(
    (handler: (request: NextRequest) => Promise<Response>, routeConfig: { accepts: { price: { amount: string } } }) =>
      async (request: NextRequest) => {
        if (request.headers.get("x-paid") !== "1") {
          return new Response(
            JSON.stringify({
              accepts: [{ amount: routeConfig.accepts.price.amount, payTo: "0xpayto", network: "eip155:84532" }],
            }),
            { status: 402, headers: { "Content-Type": "application/json" } },
          );
        }
        return handler(request);
      },
  );
});

describe("/api/buy", () => {
  it("returns 400 for malformed requests before x402 runs", async () => {
    mocks.parseRequestJson.mockResolvedValue({
      ok: false,
      status: 400,
      error: "INVALID_REQUEST_JSON",
    });

    const { POST } = await loadRoute();
    const response = await POST(buildRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "INVALID_REQUEST_JSON" });
    expect(mocks.withX402).not.toHaveBeenCalled();
    expect(mocks.handleMint).not.toHaveBeenCalled();
  });

  it("returns a 402 challenge using the quoted premium", async () => {
    mocks.parseRequestJson.mockResolvedValue({ ok: true, data: validBody });

    const { POST } = await loadRoute();
    const response = await POST(buildRequest());
    const payload = await response.json();

    expect(response.status).toBe(402);
    expect(payload.accepts[0].amount).toBe("450000");
    expect(mocks.makeBuyRouteConfig).toHaveBeenCalledWith("450000");
    expect(mocks.handleMint).not.toHaveBeenCalled();
  });

  it("returns the existing success payload on a paid mint", async () => {
    mocks.parseRequestJson.mockResolvedValue({ ok: true, data: validBody });
    const success: MintResultOk = {
      ok: true,
      action: "MINT",
      txHash: `0x${"12".repeat(32)}`,
      policyId: "7",
      tokenId: "7",
      policyNftAddress: "0x1000000000000000000000000000000000000001",
      note: "Quote verified and mint submitted.",
    };
    mocks.handleMint.mockResolvedValue(success);

    const { POST } = await loadRoute();
    const response = await POST(buildRequest({ "x-paid": "1" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(success);
    expect(mocks.handleMint).toHaveBeenCalledTimes(1);
    expect(mocks.createRelayGateway).toHaveBeenCalledTimes(1);
  });

  it("returns non-2xx on mint failure so premium settlement is not finalized", async () => {
    mocks.parseRequestJson.mockResolvedValue({ ok: true, data: validBody });
    mocks.handleMint.mockResolvedValue({ ok: false, error: "EVENT_ALREADY_CANCELED" });

    const { POST } = await loadRoute();
    const response = await POST(buildRequest({ "x-paid": "1" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "EVENT_ALREADY_CANCELED" });
  });
});
