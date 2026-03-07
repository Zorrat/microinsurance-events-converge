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
- Input requires `eventUrl` and `eventName`
- Workflow extracts canonical Eventbrite event ID from URL
- Event name mismatches are non-blocking warnings
- Workflow computes `payoutUSDC` and `premiumUSDC` dynamically
- Workflow sets `coverageStart` at request time
- Workflow sets `coverageEnd` to 24h after Eventbrite event boundary (`eventEnd`, or fallback `eventStart`)
- Workflow sets `quoteExpiry` to 1h after request time
- Pricing uses a single deterministic path for all users

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
  "eventName": "My Event Name",
  "insured": "0x15d265Dc32a575755ACA19b5EcEAB8018CdD26F1"
}
```

Any missing event risk variable falls back to the lowest tier/ordinal in pricing.

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
