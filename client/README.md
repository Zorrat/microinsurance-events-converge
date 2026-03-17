# Converge Event Insurance Client

Next.js app for quoting, buying, and claiming event cancellation coverage on Base Sepolia with:

- `x402` for paid API access
- direct server-side quote/mint/claim logic in Next.js
- a relay signer that submits the receiver contract report directly

## What Changed

- All client-side Chainlink CRE gateway and simulate code has been removed.
- `quote`, `buy`, and `claim` now run inside Next.js server modules under `app/lib/server/protocol`.
- `/api/buy` charges the exact quoted premium via x402.
- `/api/buy` uses non-2xx responses on failed mint attempts so the premium is not settled on failure.

## Routes

- `POST /api/quote`
  - fixed x402 operational fee
  - returns quote eligibility, pricing, and a signed quote
- `POST /api/buy`
  - x402 amount is the exact `signedQuote.quote.premiumUSDC`
  - successful mint returns the existing `MINT` payload
  - unsuccessful mint returns `{ ok:false, error }` with non-2xx status
- `POST /api/claim`
  - fixed x402 operational fee
  - returns `PAY`, `RESOLVE_NO_PAYOUT`, or `NO_OP`

## Environment

Copy the template:

```bash
cp .env.example .env
```

Required server variables:

- `POLICY_RECEIVER`
- `RELAY_PRIVATE_KEY`
- `QUOTE_SIGNER_PK`
- `EVENTBRITE_API_TOKEN`
- `X402_PAY_TO`
- `X402_NETWORK`

Optional:

- `QUOTE_SIGNER_ADDRESS`
- `EVENTBRITE_API_BASE_URL`
- `CLAIM_EVENTBRITE_API_BASE_URL`
- `GEMINI_*`
- `PRICING_CONFIG_JSON`
- `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`

Public UI variables:

- `NEXT_PUBLIC_CHAIN_ID`
- `NEXT_PUBLIC_BASESCAN`
- `NEXT_PUBLIC_BASE_RPC_URL`
- `NEXT_PUBLIC_USDC_ADDRESS`
- `NEXT_PUBLIC_POLICY_NFT`
- `NEXT_PUBLIC_POLICY_VAULT`
- `NEXT_PUBLIC_POLICY_RECEIVER`
- `NEXT_PUBLIC_X402_*`

## Run

```bash
npm install
npm run dev
```

Open:

- `http://localhost:3000/`
- `http://localhost:3000/app`

## Tests

```bash
npm test
npm run lint
```

## Operational Rollout

1. Deploy the client with `RELAY_PRIVATE_KEY` set to the backend relay signer.
2. Update the deployed receiver contract so `forwarder == relay signer`.
3. Verify the receiver targets before enabling traffic:
   - `forwarder`
   - `policyNft`
   - `policyVault`
4. Run quote -> buy -> claim smoke checks on Base Sepolia.
