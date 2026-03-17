import { randomBytes } from "node:crypto";

import { encodePacked, isAddress, keccak256, toHex } from "viem";

const BIGINT_ZERO = BigInt(0);
const UINT64_MAX = BigInt("18446744073709551615");
const UINT128_MAX = BigInt("340282366920938463463374607431768211455");

export const mustHexAddress = (value: string, label: string): `0x${string}` => {
  if (!isAddress(value)) throw new Error(`${label} is not a valid EVM address`);
  return value as `0x${string}`;
};

export const nowSec = (): number => Math.floor(Date.now() / 1000);

export const toUint64 = (value: number | bigint): bigint => {
  const v = BigInt(value);
  if (v < BIGINT_ZERO || v > UINT64_MAX) {
    throw new Error(`uint64 overflow: ${v.toString()}`);
  }
  return v;
};

export const toUint128 = (value: string | number | bigint): bigint => {
  const v = BigInt(value);
  if (v < BIGINT_ZERO || v > UINT128_MAX) {
    throw new Error(`uint128 overflow: ${v.toString()}`);
  }
  return v;
};

export const parseTimestampSec = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return Math.floor(value / 1000);
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const asNum = Number(value);
    if (Number.isFinite(asNum)) {
      if (asNum > 1e12) return Math.floor(asNum / 1000);
      return Math.floor(asNum);
    }

    const asDate = Date.parse(value);
    if (!Number.isNaN(asDate)) return Math.floor(asDate / 1000);
  }

  return undefined;
};

export const randomNonceHex = (): `0x${string}` => {
  return toHex(randomBytes(32));
};

export const hashEventId = (eventId: string): `0x${string}` => keccak256(encodePacked(["string"], [eventId]));

export const parseEventbriteEventIdFromUrl = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (/^[0-9]{6,}$/.test(trimmed)) return trimmed;

  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  const withoutHash = withScheme.split("#")[0] ?? withScheme;
  const urlMatch = withoutHash.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)([^?#]*)?(\?[^#]*)?$/);
  if (!urlMatch) throw new Error("INVALID_EVENTBRITE_URL");

  const authority = urlMatch[1] ?? "";
  const hostPort = authority.split("@").pop() ?? "";
  const host = hostPort.split(":")[0].toLowerCase().replace(/\.$/, "");
  if (!host) throw new Error("INVALID_EVENTBRITE_URL");

  const hostParts = host.split(".").filter(Boolean);
  const isEventbriteHost =
    host === "eventbrite.com" ||
    host.endsWith(".eventbrite.com") ||
    /^eventbrite\.[a-z]{2,}(?:\.[a-z]{2,})?$/.test(host) ||
    hostParts.some((part, idx) => part === "eventbrite" && idx < hostParts.length - 1);

  if (!isEventbriteHost) throw new Error("INVALID_EVENTBRITE_URL");

  const decodeSafe = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const rawPath = urlMatch[2] ?? "";
  const path = decodeSafe(rawPath);
  const pathParts = path.split("/").filter(Boolean);
  const query = (urlMatch[3] ?? "").replace(/^\?/, "");
  const queryCandidates: string[] = [];

  if (query.length > 0) {
    for (const pair of query.split("&")) {
      if (!pair) continue;
      const [kRaw, vRaw = ""] = pair.split("=", 2);
      const k = decodeSafe(kRaw);
      const v = decodeSafe(vRaw);
      if (k === "eid" || k === "event_id" || k === "eventId") queryCandidates.push(v);
    }
  }

  const pathCandidates = [path, ...pathParts];
  const idCandidates = [...queryCandidates, ...pathCandidates];

  let bestMatch = "";
  for (const candidate of idCandidates) {
    const matches = candidate.match(/[0-9]{6,}/g) ?? [];
    for (const match of matches) {
      if (match.length > bestMatch.length) bestMatch = match;
    }
  }

  if (bestMatch) return bestMatch;
  throw new Error("INVALID_EVENTBRITE_URL");
};
