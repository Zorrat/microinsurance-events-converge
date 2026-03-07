import { encodePacked, hexToBytes, isAddress, keccak256, recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Runtime } from "@chainlink/cre-sdk";

import { nowSec } from "./utils";
import type { Config, Quote, SignedQuote } from "./types";
import { getSecretValue } from "./services/secrets";

export const hashEventId = (eventId: string): `0x${string}` => {
  return keccak256(encodePacked(["string"], [eventId]));
};

export const normalizeNonce = (nonce: `0x${string}`): `0x${string}` => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) {
    throw new Error("nonce must be 32-byte hex");
  }
  return nonce;
};

export const randomNonceHex = (runtime: Runtime<Config>): `0x${string}` => {
  const t = BigInt(nowSec(runtime));
  const jitter = BigInt(Math.floor(Math.random() * 1_000_000_000));
  return keccak256(encodePacked(["uint256", "uint256"], [t, jitter]));
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

const getQuoteSigner = (runtime: Runtime<Config>, config: Config) => {
  const pk = getSecretValue(runtime, config.quoteSignerPrivateKeySecretName, config);

  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("quote signer private key must be 32-byte hex");
  }

  return privateKeyToAccount(pk as `0x${string}`);
};

export const signQuote = async (
  runtime: Runtime<Config>,
  quote: Quote,
  config: Config,
): Promise<SignedQuote> => {
  const account = getQuoteSigner(runtime, config);
  const quoteHash = computeQuoteHash(quote);
  const signature = (await account.signMessage({ message: { raw: hexToBytes(quoteHash) } })) as `0x${string}`;

  if (
    config.quoteSignerAddress &&
    account.address.toLowerCase() !== config.quoteSignerAddress.toLowerCase()
  ) {
    throw new Error("Configured quoteSignerAddress does not match signer private key");
  }

  return {
    quote,
    quoteHash,
    signature,
    signer: account.address,
  };
};

export const verifySignedQuote = async (
  runtime: Runtime<Config>,
  signedQuote: SignedQuote,
  config: Config,
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

  const expectedSigner = getQuoteSigner(runtime, config).address;
  if (
    config.quoteSignerAddress &&
    expectedSigner.toLowerCase() !== config.quoteSignerAddress.toLowerCase()
  ) {
    throw new Error("Configured quoteSignerAddress does not match signer private key");
  }

  if (recovered.toLowerCase() !== expectedSigner.toLowerCase()) {
    throw new Error("BAD_QUOTE_SIGNATURE");
  }

  if (signedQuote.quote.quoteExpiry <= nowSec(runtime)) {
    throw new Error("QUOTE_EXPIRED");
  }

  return { quote: signedQuote.quote, signer: recovered };
};
