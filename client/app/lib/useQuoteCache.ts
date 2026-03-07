import { useCallback } from "react";

const CACHE_PREFIX = "coverfi_quote_";
const TTL_MS = 15 * 60 * 1000; // 15 minutes

type CachedEntry = {
    signedQuote: unknown;
    storedAt: number;
};

function storageKey(address: string, eventIdHash: string): string {
    return `${CACHE_PREFIX}${address.toLowerCase()}_${eventIdHash.toLowerCase()}`;
}

function allKeysKey(address: string): string {
    return `${CACHE_PREFIX}keys_${address.toLowerCase()}`;
}

function addKeyToIndex(address: string, key: string) {
    try {
        const idx = sessionStorage.getItem(allKeysKey(address));
        const keys: string[] = idx ? JSON.parse(idx) : [];
        if (!keys.includes(key)) keys.push(key);
        sessionStorage.setItem(allKeysKey(address), JSON.stringify(keys));
    } catch {
        // ignore
    }
}

function pruneExpired(address: string) {
    try {
        const idx = sessionStorage.getItem(allKeysKey(address));
        if (!idx) return;
        const keys: string[] = JSON.parse(idx);
        const now = Date.now();
        const alive: string[] = [];
        for (const key of keys) {
            const raw = sessionStorage.getItem(key);
            if (!raw) continue;
            const entry: CachedEntry = JSON.parse(raw);
            if (now - entry.storedAt > TTL_MS) {
                sessionStorage.removeItem(key);
            } else {
                alive.push(key);
            }
        }
        sessionStorage.setItem(allKeysKey(address), JSON.stringify(alive));
    } catch {
        // ignore
    }
}

export function useQuoteCache() {
    const cacheQuote = useCallback(
        (address: string, signedQuote: unknown) => {
            if (!address) return;
            const sq = signedQuote as { quote?: { eventIdHash?: string } } | undefined;
            const eventIdHash = sq?.quote?.eventIdHash;
            if (!eventIdHash) return;

            pruneExpired(address);

            const key = storageKey(address, eventIdHash);
            const entry: CachedEntry = { signedQuote, storedAt: Date.now() };
            try {
                sessionStorage.setItem(key, JSON.stringify(entry));
                addKeyToIndex(address, key);
            } catch {
                // storage full or unavailable
            }
        },
        [],
    );

    const getCachedQuote = useCallback(
        (address: string, eventIdHash: string): unknown | null => {
            if (!address || !eventIdHash) return null;
            pruneExpired(address);

            const key = storageKey(address, eventIdHash);
            try {
                const raw = sessionStorage.getItem(key);
                if (!raw) return null;
                const entry: CachedEntry = JSON.parse(raw);
                if (Date.now() - entry.storedAt > TTL_MS) {
                    sessionStorage.removeItem(key);
                    return null;
                }
                return entry.signedQuote;
            } catch {
                return null;
            }
        },
        [],
    );

    const getAllCachedQuotes = useCallback(
        (address: string): Array<{ signedQuote: unknown; minutesLeft: number }> => {
            if (!address) return [];
            pruneExpired(address);
            const results: Array<{ signedQuote: unknown; minutesLeft: number }> = [];
            try {
                const idx = sessionStorage.getItem(allKeysKey(address));
                if (!idx) return [];
                const keys: string[] = JSON.parse(idx);
                const now = Date.now();
                for (const key of keys) {
                    const raw = sessionStorage.getItem(key);
                    if (!raw) continue;
                    const entry: CachedEntry = JSON.parse(raw);
                    const elapsed = now - entry.storedAt;
                    if (elapsed < TTL_MS) {
                        results.push({
                            signedQuote: entry.signedQuote,
                            minutesLeft: Math.ceil((TTL_MS - elapsed) / 60000),
                        });
                    }
                }
            } catch {
                // ignore
            }
            return results;
        },
        [],
    );

    return { cacheQuote, getCachedQuote, getAllCachedQuotes };
}
