import { encodePacked, hexToBytes, isAddress, keccak256, recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Quote, SignedQuote } from "@/app/lib/protocol-types";

import { hashEventId, nowSec } from "./utils";

export const normalizeNonce = (nonce: `0x${string}`): `0x${string}` => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) {
    throw new Error("nonce must be 32-byte hex");
  }
  return nonce;
};

export const computeQuoteHash = (quote: Quote): `0x${string}` => {
  if (!isAddress(quote.insured)) throw new Error("quote.insured invalid");
  if (!/^0x[0-9a-fA-F]{64}$/.test(quote.eventIdHash)) throw new Error("quote.eventIdHash invalid");
  if (!/^0x[0-9a-fA-F]{64}$/.test(quote.nonce)) throw new Error("quote.nonce invalid");

  return keccak256(
    encodePacked(
      [
        "uint256",
        "address",
        "bytes32",
        "uint64",
        "uint64",
        "uint64",
        "uint64",
        "uint128",
        "uint128",
        "bytes32",
      ],
      [
        BigInt(quote.quoteVersion),
        quote.insured,
        quote.eventIdHash,
        BigInt(quote.eventStart),
        BigInt(quote.coverageStart),
        BigInt(quote.coverageEnd),
        BigInt(quote.quoteExpiry),
        BigInt(quote.payoutUSDC),
        BigInt(quote.premiumUSDC),
        quote.nonce,
      ],
    ),
  );
};

export const signQuote = async (
  quote: Quote,
  signerPrivateKey: `0x${string}`,
  expectedSignerAddress?: `0x${string}`,
): Promise<SignedQuote> => {
  const account = privateKeyToAccount(signerPrivateKey);
  const quoteHash = computeQuoteHash(quote);
  const signature = (await account.signMessage({ message: { raw: hexToBytes(quoteHash) } })) as `0x${string}`;

  if (expectedSignerAddress && account.address.toLowerCase() !== expectedSignerAddress.toLowerCase()) {
    throw new Error("Configured quote signer address does not match signer private key");
  }

  return {
    quote,
    quoteHash,
    signature,
    signer: account.address,
  };
};

export const verifySignedQuote = async (
  signedQuote: SignedQuote,
  signerPrivateKey: `0x${string}`,
  expectedSignerAddress?: `0x${string}`,
): Promise<{ quote: Quote; signer: `0x${string}` }> => {
  const expectedEventIdHash = hashEventId(signedQuote.quote.eventId);
  if (expectedEventIdHash.toLowerCase() !== signedQuote.quote.eventIdHash.toLowerCase()) {
    throw new Error("EVENT_ID_HASH_MISMATCH");
  }

  const recomputed = computeQuoteHash(signedQuote.quote);
  if (recomputed.toLowerCase() !== signedQuote.quoteHash.toLowerCase()) {
    throw new Error("QUOTE_HASH_MISMATCH");
  }

  const recovered = (await recoverMessageAddress({
    message: { raw: hexToBytes(signedQuote.quoteHash) },
    signature: signedQuote.signature,
  })) as `0x${string}`;

  const expectedSigner = privateKeyToAccount(signerPrivateKey).address;
  if (expectedSignerAddress && expectedSigner.toLowerCase() !== expectedSignerAddress.toLowerCase()) {
    throw new Error("Configured quote signer address does not match signer private key");
  }
  if (recovered.toLowerCase() !== expectedSigner.toLowerCase()) {
    throw new Error("BAD_QUOTE_SIGNATURE");
  }
  if (signedQuote.quote.quoteExpiry <= nowSec()) {
    throw new Error("QUOTE_EXPIRED");
  }

  return { quote: signedQuote.quote, signer: recovered };
};

