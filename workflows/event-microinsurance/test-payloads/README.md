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
- Expected: `ok: true`, `action: "QUOTE_CHECK"`, `quoteValid: true`, `signedQuote` present.

2. `quote-check-name-mismatch.json`
- Expected: `ok: true`, `quoteValid: true`, `warnings` contains `EVENT_NAME_MISMATCH`.

3. `quote-check-invalid-url.json`
- Expected: `ok: false`, `error: "INVALID_EVENTBRITE_URL"`.

4. `quote-check-invalid-insured.json`
- Expected: `ok: false`, `error` contains `insured is not a valid EVM address`.

5. `quote-check-direct-id.json`
- Expected: same as `quote-check.json` (event ID-only input path).

6. `mint-not-approved.json`
- Expected: `ok: false`, `error: "NOT_APPROVED"`.

7. `claim-event-id-mismatch.json`
- Expected: `ok: false`, `error: "EVENT_ID_MISMATCH"` (assuming `policyId` exists and has a different canonical event ID).
