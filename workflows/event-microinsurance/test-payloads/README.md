# Quick Simulation Scenarios

Run from `workflows/`:

```bash
cre workflow simulate ./event-microinsurance \
  --target staging-settings \
  --non-interactive \
  --trigger-index 0 \
  --http-payload /ABS/PATH/TO/PAYLOAD.json \
  -v
```

Scenarios:

1. `quote-check.json`
- Expected: `ok: true`, `action: "QUOTE_CHECK"`, `quoteValid: true`, `signedQuote` present (`tier` required).

2. `quote-check-invalid-url.json`
- Expected: `ok: false`, `error: "INVALID_EVENTBRITE_URL"`.

3. `quote-check-invalid-insured.json`
- Expected: `ok: false`, `error` contains `insured is not a valid EVM address`.

4. `quote-check-direct-id.json`
- Expected: same as `quote-check.json` (event ID-only input path).

5. `mint-not-approved-from-quote.json`
- Expected: `ok: false`, `error: "NOT_APPROVED"`.

6. `claim.json`
- Expected: `ok: true`, `action: "CLAIM"` (result depends on policy/event status onchain).
