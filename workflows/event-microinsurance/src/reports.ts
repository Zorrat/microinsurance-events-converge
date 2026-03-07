import { encodeAbiParameters } from "viem";
import type { MintData, ReportData } from "./types";

export const emptyMintData = (): MintData => ({
  to: "0x0000000000000000000000000000000000000000",
  eventId: "",
  eventIdHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  eventStart: 0n,
  coverageStart: 0n,
  coverageEnd: 0n,
  quoteExpiry: 0n,
  payoutUSDC: 0n,
  premiumUSDC: 0n,
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
    ] as any,
    [report] as any,
  );
};
