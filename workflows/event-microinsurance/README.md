# Event Micro-Insurance CRE Workflow

This workflow supports three HTTP actions:
- `QUOTE_CHECK`
- `MINT`
- `CLAIM`

It integrates:
- Eventbrite event status lookup (`GET /events/{event_id}/`)
- CRE EVM write reports to `CREReceiver.onReport()`
- Signed quote verification for minting

Quote creation is Eventbrite-first:
- Input requires `eventUrl` and `tier` (`BASIC | MEDIUM | ADVANCED`)
- Workflow extracts canonical Eventbrite event ID from URL
- Workflow computes `payoutUSDC`, `premiumUSDC`, `pCancelBps`, and risk/load breakdowns
- Workflow sets `coverageStart` at request time
- Workflow sets `coverageEnd` to 24h after Eventbrite event boundary (`eventEnd`, or fallback `eventStart`)
- Workflow sets `quoteExpiry` to 1h after request time
- Pricing uses deterministic category/capacity/venue/organizer + Gemini stub bands

## Prerequisites

1. Install dependencies:
```bash
cd workflows/event-microinsurance
bun install
```

2. Provide required secrets in your CRE target:
- `EVENTBRITE_API_TOKEN`
- `QUOTE_SIGNER_PK` (32-byte hex private key, `0x...`)

3. Ensure `config.staging.json` / `config.production.json` values are correct:
- `chainSelectorName`
- `receiver`
- `authorizedKeys`
- `eventbriteApiBaseUrl`
- Optional demo-only override: `claimEventbriteApiBaseUrl` (applies only to `CLAIM`)

`authorizedKeys` may be empty in local simulation, but must include at least one key before deployment.
For deployment, each entry in `authorizedKeys` is an EVM public address allowed to trigger the HTTP workflow.
The private key used by your trigger client (for example `CRE_TRIGGER_PRIVATE_KEY` in `client/.env`) must derive
to one of these addresses.

## Type-check

```bash
cd workflows/event-microinsurance
npx tsc --noEmit
```

## Simulate

Run from the `workflows/` project root:

```bash
cre workflow simulate ./event-microinsurance --target=staging-settings
```

## Example HTTP payloads

`QUOTE_CHECK`
```json
{
  "action": "QUOTE_CHECK",
  "eventUrl": "https://www.eventbrite.com/e/my-event-name-45263283700",
  "insured": "0x15d265Dc32a575755ACA19b5EcEAB8018CdD26F1",
  "tier": "MEDIUM"
}
```

Missing category/subcategory falls back to the default category risk (`200 bps`).

`MINT`
```json
{
  "action": "MINT",
  "approved": true,
  "signedQuote": {
    "quote": {},
    "quoteHash": "0x...",
    "signature": "0x...",
    "signer": "0x..."
  }
}
```

`CLAIM`
```json
{
  "action": "CLAIM",
  "eventId": "45263283700",
  "policyId": "1"
}
```

`CLAIM` enforces that the provided `eventId` matches the canonical `eventId`
stored in the policy NFT; mismatches return `EVENT_ID_MISMATCH`.

## Demo-only claim mock

For demo recordings, you can keep real Eventbrite for `QUOTE_CHECK` and `MINT`, while routing only `CLAIM`
event status checks to a mock endpoint:

1. Start mock server:
```bash
node workflows/mock/mock-eventbrite.cjs
```
2. Set `claimEventbriteApiBaseUrl` in workflow config (for example `http://127.0.0.1:8787/v3`).
3. Leave `eventbriteApiBaseUrl` pointed at real Eventbrite (`https://www.eventbriteapi.com/v3`).
