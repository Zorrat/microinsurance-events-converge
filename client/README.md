# Converge Event Insurance Client

Lightweight Next.js demo app for **CRE + x402** on **Base Sepolia**.

## What This App Includes

- Landing page (`/`) with feature summary and architecture flow.
- Demo page (`/app`) to run:
  - `POST /api/quote`
  - `POST /api/buy`
  - `POST /api/claim`
- x402 route protection using `withX402`.
- CRE execution in dual mode:
  - `gateway`: deployed HTTP trigger via JWT auth (`workflows.execute`)
  - `simulate`: local `cre workflow simulate` per paid request
- Strict workflow response typing aligned to `workflows/event-microinsurance/src/types.ts`.

## Prerequisites

- Node.js 18+
- Wallet funded on Base Sepolia:
  - ETH for gas
  - USDC for x402 payment calls
- Deployed CRE workflow ID and authorized trigger key
- MetaMask extension installed and enabled

## Environment

Copy env template and fill values:

```bash
cp .env.example .env
```

Key variables:

- `CRE_EXECUTION_MODE` (`gateway` or `simulate`)
- `CRE_WORKFLOW_ID`
- `CRE_TRIGGER_PRIVATE_KEY`
- `CRE_GATEWAY_URL`
- `X402_PAY_TO`
- `X402_RECEIVER_ADDRESS` (optional alias for `X402_PAY_TO`)
- `X402_NETWORK` (`eip155:84532`)
- `X402_FACILITATOR_URL` (default: `https://api.cdp.coinbase.com/platform/v2/x402`)
- `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` (required when using Coinbase CDP facilitator)

Optional polling (deployment-specific):

- `CRE_EXECUTION_POLL_URL`
- `CRE_EXECUTION_POLL_METHOD`
- `CRE_POLL_MAX_MS`
- `CRE_POLL_INTERVAL_MS`

If polling is not configured and gateway returns only `ACCEPTED`, API returns:

- `{ "ok": false, "error": "CRE_ACCEPTED:<executionId>" }`

Local simulation mode variables:

- `CRE_LOCAL_CLI_BIN`
- `CRE_LOCAL_PROJECT_ROOT`
- `CRE_LOCAL_WORKFLOW_PATH`
- `CRE_LOCAL_ENV_FILE`
- `CRE_LOCAL_TARGET`
- `CRE_LOCAL_TRIGGER_INDEX`
- `CRE_LOCAL_BROADCAST`
- `CRE_LOCAL_TIMEOUT_MS`
- `CRE_LOCAL_MAX_BUFFER_BYTES`

## Run

```bash
npm install
npm run dev
```

Open:

- `http://localhost:3000/` for landing
- `http://localhost:3000/app` for workflow tester

## Local Demo Mode (No CRE Deploy Access Required)

Use this mode when you cannot deploy workflows yet.

1. Ensure workflow deps/secrets are ready:
- `workflows/event-microinsurance` dependencies installed
- `workflows/.env` contains:
  - `CRE_ETH_PRIVATE_KEY` (funded with Base Sepolia ETH for `--broadcast`)
  - `EVENTBRITE_API_TOKEN`
  - `QUOTE_SIGNER_PK`
  - `GEMINI_API_KEY` (if Gemini is enabled)

2. Set mode/env in `client/.env`:
- `CRE_EXECUTION_MODE=simulate`
- Keep x402 settings valid (`X402_PAY_TO`, `X402_NETWORK`, facilitator URL)
- Adjust `CRE_LOCAL_*` paths only if your repo layout differs from defaults

3. Run app:
- `cd client`
- `npm run dev`

4. Demo:
- Open `http://localhost:3000/app`
- Connect MetaMask on Base Sepolia
- Run quote -> buy -> claim
- Each paid route settles x402 first, then executes local CRE simulation

## Route Response Policy

- Validation failures: `400` + `WorkflowError`
- Business / workflow outcomes (including `CRE_ACCEPTED:*`): `200`
- Infra failures prefixed with `CRE_TRIGGER_FAILED:`: `502`

## Notes

- Base network target for v1 demo is Base Sepolia only.
- Wallet connectivity is MetaMask injected provider only (using RainbowKit UI, no WalletConnect Cloud).
- x402 payment proof header is surfaced in UI (`PAYMENT-RESPONSE` / `X-PAYMENT-RESPONSE`).
- Raw CRE JSON responses are displayed unchanged in the tester.
- `CRE_TRIGGER_PRIVATE_KEY` must map to an address configured in the workflow HTTP trigger `authorizedKeys`.
- `CRE_WORKFLOW_ID` must be the 64-char workflow id (no `0x` prefix).

## Troubleshooting

- If wallet connect fails and the app shows a provider readiness error, install/enable MetaMask and reload.
- If CRE returns auth failure, the signer for `CRE_TRIGGER_PRIVATE_KEY` is not in workflow `authorizedKeys`.
- `Failed to initialize: no supported payment kinds loaded from any facilitator`:
  - Verify `X402_FACILITATOR_URL` and `X402_NETWORK=eip155:84532`.
  - If using Coinbase CDP facilitator, verify `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are valid and not expired.
- `CRE_TRIGGER_FAILED:SIMULATION_EXEC_ERROR:CRE_CLI_NOT_FOUND`:
  - Install CRE CLI and confirm `cre` is in your shell `PATH`.
- Simulation failing on secret reads:
  - Confirm `workflows/.env` has `CRE_ETH_PRIVATE_KEY`, `EVENTBRITE_API_TOKEN`, and `QUOTE_SIGNER_PK`.
- Broadcasted simulation tx fails:
  - Fund `CRE_ETH_PRIVATE_KEY` with Base Sepolia ETH.
