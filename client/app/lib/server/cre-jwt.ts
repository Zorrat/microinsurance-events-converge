import { createHash, randomUUID } from "node:crypto";
import { hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const sortValue = (value: unknown): Json => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, Json> = {};

    for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
      const v = record[key];
      if (v === undefined) continue;
      out[key] = sortValue(v);
    }

    return out;
  }

  return String(value);
};

const toBase64Url = (value: string | Uint8Array): string => {
  const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const sha256Hex = (value: string): `0x${string}` => {
  return `0x${createHash("sha256").update(value, "utf8").digest("hex")}`;
};

export type CreJwtContext = {
  token: string;
  issuer: `0x${string}`;
  digest: `0x${string}`;
};

export const createCreJwt = async (
  requestBody: unknown,
  signerPk: `0x${string}`,
): Promise<CreJwtContext> => {
  const account = privateKeyToAccount(signerPk);
  const sortedJson = JSON.stringify(sortValue(requestBody));
  const digest = sha256Hex(sortedJson);

  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "ETH",
    typ: "JWT",
  } as const;

  const payload = {
    digest,
    iss: account.address,
    iat: now,
    exp: now + 300,
    jti: randomUUID(),
  } as const;

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const message = `${encodedHeader}.${encodedPayload}`;

  const signatureHex = await account.signMessage({ message });
  const encodedSignature = toBase64Url(hexToBytes(signatureHex));

  return {
    token: `${message}.${encodedSignature}`,
    issuer: account.address,
    digest,
  };
};
