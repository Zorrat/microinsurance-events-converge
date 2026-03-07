export const CREReceiverABI = [
  {
    type: "function",
    name: "policyNft",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "policyVault",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "onReport",
    stateMutability: "nonpayable",
    inputs: [
      { name: "metadata", type: "bytes" },
      { name: "report", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const PolicyNFTABI = [
  {
    type: "function",
    name: "nextPolicyId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getPolicy",
    stateMutability: "view",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "eventIdHash", type: "bytes32" },
          { name: "eventId", type: "string" },
          { name: "eventStart", type: "uint64" },
          { name: "coverageStart", type: "uint64" },
          { name: "coverageEnd", type: "uint64" },
          { name: "quoteExpiry", type: "uint64" },
          { name: "payoutUSDC", type: "uint128" },
          { name: "premiumUSDC", type: "uint128" },
          { name: "insured", type: "address" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
] as const;

export const PolicyVaultABI = [
  {
    type: "function",
    name: "requiredReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalActiveLiabilityUSDC",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "minReserveRatioBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const ERC20ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
