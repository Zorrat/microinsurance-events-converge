#!/usr/bin/env bash
set -euo pipefail

# --- Config ---
WORKFLOWS_ROOT="${WORKFLOWS_ROOT:-$(pwd)/workflows}"
WF_REL="./event-microinsurance"
WF_DIR="$WORKFLOWS_ROOT/event-microinsurance"
TARGET="${TARGET:-staging-settings}"
ENV_FILE="${ENV_FILE:-$WORKFLOWS_ROOT/.env}"
TRIGGER_INDEX="${TRIGGER_INDEX:-0}"
BROADCAST="${BROADCAST:-false}"   # set BROADCAST=true to actually write txs
POLICY_ID="${POLICY_ID:-}"        # optional: required for claim checks

# --- Preconditions ---
command -v cre >/dev/null || { echo "cre CLI not found"; exit 1; }
command -v jq >/dev/null || { echo "jq not found"; exit 1; }
command -v python3 >/dev/null || { echo "python3 not found"; exit 1; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

sim() {
  local payload="$1"
  local out_file="$2"

  local cmd=(
    cre workflow simulate "$WF_REL"
    --project-root "$WORKFLOWS_ROOT"
    --env "$ENV_FILE"
    --target "$TARGET"
    --non-interactive
    --trigger-index "$TRIGGER_INDEX"
    --http-payload "$payload"
  )

  if [[ "$BROADCAST" == "true" ]]; then
    cmd+=(--broadcast)
  fi

  "${cmd[@]}" | tee "$out_file"
}

extract_result_json() {
  local out_file="$1"
  local json_file="$2"

  python3 - "$out_file" "$json_file" <<'PY'
import sys, json
inp, outp = sys.argv[1], sys.argv[2]
lines = open(inp, "r", encoding="utf-8", errors="ignore").read().splitlines()

capture = False
buf = []
for line in lines:
    if "Workflow Simulation Result:" in line:
        capture = True
        continue
    if capture:
        if line.strip() == "" and buf:
            break
        buf.append(line)

text = "\n".join(buf).strip()
if not text:
    print("Could not extract Workflow Simulation Result JSON")
    sys.exit(1)

try:
    obj = json.loads(text)
except Exception as e:
    print("Failed to parse result JSON:", e)
    print(text)
    sys.exit(1)

with open(outp, "w", encoding="utf-8") as f:
    json.dump(obj, f, indent=2)
PY
}

run_payload() {
  local name="$1"
  local payload="$WF_DIR/test-payloads/$name"
  local out_file="$TMP_DIR/$name.out"
  local json_file="$TMP_DIR/$name.result.json"

  echo
  echo "=== Running $name ==="
  sim "$payload" "$out_file"
  extract_result_json "$out_file" "$json_file"
  jq . "$json_file"
}

echo "Using WORKFLOWS_ROOT=$WORKFLOWS_ROOT"
echo "Using TARGET=$TARGET"
echo "Using ENV_FILE=$ENV_FILE"
echo "Using BROADCAST=$BROADCAST"

# 1) Quote scenarios (static payloads)
run_payload "quote-check.json"
run_payload "quote-check-invalid-url.json"
run_payload "quote-check-invalid-insured.json"
run_payload "quote-check-direct-id.json"

# 2) MINT negative path (no signature check needed, should fail fast)
run_payload "mint-not-approved-from-quote.json"

# 3) MINT positive path using fresh CRE-signed quote from quote-check.json
QUOTE_RESULT="$TMP_DIR/quote-check.json.result.json"
jq -e '.ok == true and .action == "QUOTE_CHECK" and .quoteValid == true and (.signedQuote != null)' "$QUOTE_RESULT" >/dev/null \
  || { echo "quote-check did not return a valid signedQuote"; exit 1; }

jq -r '.canonicalEventId' "$QUOTE_RESULT" > "$TMP_DIR/canonical_event_id.txt"
jq '.signedQuote' "$QUOTE_RESULT" > "$TMP_DIR/signed_quote.json"

jq -n \
  --slurpfile sq "$TMP_DIR/signed_quote.json" \
  '{action:"MINT", approved:true, signedQuote:$sq[0]}' > "$TMP_DIR/mint-approved.json"

echo
echo "=== Running mint-approved.json (generated from fresh signed quote) ==="
MINT_OUT="$TMP_DIR/mint-approved.out"
MINT_JSON="$TMP_DIR/mint-approved.result.json"
sim "$TMP_DIR/mint-approved.json" "$MINT_OUT"
extract_result_json "$MINT_OUT" "$MINT_JSON"
jq . "$MINT_JSON"

# 4) CLAIM checks (optional: requires POLICY_ID for meaningful run)
if [[ -n "$POLICY_ID" ]]; then
  CANONICAL_EVENT_ID="$(cat "$TMP_DIR/canonical_event_id.txt")"

  jq -n --arg pid "$POLICY_ID" --arg eid "$CANONICAL_EVENT_ID" \
    '{action:"CLAIM", policyId:$pid, eventId:$eid}' > "$TMP_DIR/claim-canonical.json"

  jq -n --arg pid "$POLICY_ID" \
    '{action:"CLAIM", policyId:$pid, eventId:"999999999999"}' > "$TMP_DIR/claim-mismatch.json"

  echo
  echo "=== Running claim-canonical.json (generated) ==="
  CLAIM_CAN_OUT="$TMP_DIR/claim-canonical.out"
  CLAIM_CAN_JSON="$TMP_DIR/claim-canonical.result.json"
  sim "$TMP_DIR/claim-canonical.json" "$CLAIM_CAN_OUT"
  extract_result_json "$CLAIM_CAN_OUT" "$CLAIM_CAN_JSON"
  jq . "$CLAIM_CAN_JSON"

  echo
  echo "=== Running claim-mismatch.json (generated) ==="
  CLAIM_MIS_OUT="$TMP_DIR/claim-mismatch.out"
  CLAIM_MIS_JSON="$TMP_DIR/claim-mismatch.result.json"
  sim "$TMP_DIR/claim-mismatch.json" "$CLAIM_MIS_OUT"
  extract_result_json "$CLAIM_MIS_OUT" "$CLAIM_MIS_JSON"
  jq . "$CLAIM_MIS_JSON"
else
  echo
  echo "Skipping CLAIM checks (set POLICY_ID=<existing minted policy id> to enable)."
fi

echo
echo "Done."
