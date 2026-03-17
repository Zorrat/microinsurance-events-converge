import { encodeAbiParameters } from "viem";

import type { MintData, ReportData } from "@/app/lib/protocol-types";

export const emptyMintData = (): MintData => ({
  to: "0x0000000000000000000000000000000000000000",
  eventId: "",
  eventIdHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  eventStart: BigInt(0),
  coverageStart: BigInt(0),
  coverageEnd: BigInt(0),
  quoteExpiry: BigInt(0),
  payoutUSDC: BigInt(0),
  premiumUSDC: BigInt(0),
});

export const encodeReportBytes = (report: ReportData): `0x${string}` => {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "action", type: "uint8" },
          { name: "policyId", type: "uint256" },
          {
            name: "mint",
            type: "tuple",
            components: [
              { name: "to", type: "address" },
              { name: "eventId", type: "string" },
              { name: "eventIdHash", type: "bytes32" },
              { name: "eventStart", type: "uint64" },
              { name: "coverageStart", type: "uint64" },
              { name: "coverageEnd", type: "uint64" },
              { name: "quoteExpiry", type: "uint64" },
              { name: "payoutUSDC", type: "uint128" },
              { name: "premiumUSDC", type: "uint128" },
            ],
          },
        ],
      },
    ] as const,
    [report],
  );
};
