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
- For gateway mode only: deployed CRE workflow ID and authorized trigger key
- MetaMask extension installed and enabled

## Environment

Copy env template and fill values:

```bash
cp .env.example .env
```

Key variables:

- `CRE_EXECUTION_MODE` (`gateway` or `simulate`)
- `CRE_WORKFLOW_ID` (required for `gateway`)
- `CRE_CLAIM_WORKFLOW_ID` (optional override for `POST /api/claim` in `gateway`)
- `CRE_TRIGGER_PRIVATE_KEY` (required for `gateway`)
- `CRE_GATEWAY_URL` (used in `gateway`)
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
- `CRE_LOCAL_ENV_FROM_PROCESS`
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

`npm run dev` runs local CRE staging first, so local simulation uses `client/.cre/workflows` by default.
It also installs staged workflow deps (`node_modules`) for local `cre workflow simulate` compilation.
If the CRE Javy plugin is missing, it automatically runs `bun x cre-setup` in the staged workflow.

Open:

- `http://localhost:3000/` for landing
- `http://localhost:3000/app` for workflow tester

## Production Publish (Direct Vercel)

Vercel is the deployment source of truth for production.
GitHub Actions is kept for CI checks only (`lint` + `build`) via:

- `.github/workflows/client-ci-deploy-vercel.yml`

No GitHub `VERCEL_*` secrets are required in this model.

### 1) Vercel project setup

In Vercel:

1. Import this repository.
2. Set **Root Directory** to `client`.
3. Set **Install Command** to:
   - `npm ci`
4. Set **Build Command** to:
   - `npm run build:vercel:sim`
   - Do not use a custom inline one-liner build command; this script now handles CRE install/version fallback.
5. Configure all required production env vars.

Required server vars for hosted simulate mode:

- `CRE_EXECUTION_MODE=simulate`
- `X402_PAY_TO`
- `X402_NETWORK`
- `X402_FACILITATOR_URL`
- `X402_FIXED_FEE_USD` / `X402_QUOTE_FEE_USD` / `X402_BUY_FEE_USD` / `X402_CLAIM_FEE_USD`
- `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` (required if using Coinbase facilitator URL)
- `CRE_LOCAL_CLI_BIN=./.cre/bin/cre`
- `CRE_LOCAL_PROJECT_ROOT=./.cre/workflows`
- `CRE_LOCAL_WORKFLOW_PATH=./event-microinsurance`
- `CRE_LOCAL_ENV_FROM_PROCESS=true`
- `CRE_LOCAL_TARGET=staging-settings`
- `CRE_LOCAL_TRIGGER_INDEX=0`
- `CRE_LOCAL_BROADCAST=true` (or `false` if you only want dry-run simulation)
- `CRE_LOCAL_TIMEOUT_MS`
- `CRE_LOCAL_MAX_BUFFER_BYTES`
- `CRE_LOCAL_CREDENTIALS_BASE64` (hosted simulate only; base64 of your local `~/.cre/cre.yaml`)
- Runtime secrets for simulation:
  - `CRE_ETH_PRIVATE_KEY` (required when `CRE_LOCAL_BROADCAST=true`)
  - `EVENTBRITE_API_TOKEN`
  - `QUOTE_SIGNER_PK`
  - `GEMINI_API_KEY` (when Gemini is enabled)

Also set required `NEXT_PUBLIC_*` vars (USDC/contract addresses, chain config, explorers).

### 2) No CRE deploy access path

This hosted path intentionally avoids `cre workflow deploy` and runs:

- `cre workflow simulate`

inside your hosted Node runtime for each paid request.

`build:vercel:sim` will:

1. Print host diagnostics (`uname -a`, `ldd --version`).
2. Stage a slim workflow bundle into `client/.cre/workflows` (without workflow `node_modules`/tests to fit serverless limits).
3. Try pinned CRE versions (`v1.3.0`, `v1.2.0`, `v1.1.0`, `v1.0.10`) through the official installer.
4. If a version fails to execute (for example glibc mismatch), try GitHub release fallback artifact `cre_linux_amd64_ldd2-35.tar.gz`.
5. Bundle Bun runtime into `client/.cre/bin/bun` so hosted TypeScript simulation can compile at request time.
6. If `GLIBCXX_3.4.30` is missing, bundle a compatible `libstdc++.so.6` into `client/.cre/lib` and wrap CRE execution with `LD_LIBRARY_PATH`.
7. Copy the first working binary into `client/.cre/bin/cre`, validate with `cre version`, then run `next build`.

The staged workflow must include `.cre_build_tmp.js` (bundled workflow artifact). If missing, build fails with an explicit error.

For hosted simulate auth, you must also provide CLI credentials:

1. On your local machine, run `cre whoami` and confirm you are logged in.
2. Encode your credential file:
   - macOS/Linux: `base64 -i ~/.cre/cre.yaml | tr -d '\n'`
3. Set Vercel env var:
   - `CRE_LOCAL_CREDENTIALS_BASE64=<output-from-step-2>`
4. Redeploy.

### 3) Post-deploy validation

After deploy:

1. Open `/` and `/app`.
2. Verify unpaid `/api/quote` returns x402 payment challenge.
3. Verify paid quote/buy/claim requests return CRE workflow results.
4. Confirm responses are from `simulate` mode.
5. If simulation errors, verify runtime secrets and `CRE_LOCAL_*` paths.

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
- Default local path is `CRE_LOCAL_PROJECT_ROOT=./.cre/workflows` (staged automatically on `npm run dev`)
- Keep `CRE_LOCAL_ENV_FILE=../workflows/.env` unless you intentionally move secrets

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
- Gateway mode: `CRE_TRIGGER_PRIVATE_KEY` must map to an address configured in the workflow HTTP trigger `authorizedKeys`.
- Gateway mode: `CRE_WORKFLOW_ID` must be the 64-char workflow id (no `0x` prefix).
- Gateway mode: if `CRE_CLAIM_WORKFLOW_ID` is set, `/api/claim` uses that workflow while quote/buy keep using `CRE_WORKFLOW_ID`.

## Troubleshooting

- If wallet connect fails and the app shows a provider readiness error, install/enable MetaMask and reload.
- Gateway mode: if CRE returns auth failure, the signer for `CRE_TRIGGER_PRIVATE_KEY` is not in workflow `authorizedKeys`.
- `Failed to initialize: no supported payment kinds loaded from any facilitator`:
  - Verify `X402_FACILITATOR_URL` and `X402_NETWORK=eip155:84532`.
  - If using Coinbase CDP facilitator, verify `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are valid and not expired.
- `CRE_TRIGGER_FAILED:SIMULATION_EXEC_ERROR:CRE_CLI_NOT_FOUND`:
  - Install CRE CLI and confirm `cre` is in your shell `PATH`.
- `CRE_TRIGGER_FAILED:SIMULATION_EXIT_1:...you are not logged in...`:
  - Set `CRE_LOCAL_CREDENTIALS_BASE64` in Vercel to base64 content of your local `~/.cre/cre.yaml`.
  - If credentials expire, refresh locally with `cre login`, regenerate base64, update Vercel env, and redeploy.
- `CRE_TRIGGER_FAILED:SIMULATION_EXIT_1:...bun is required...`:
  - Ensure deploy uses `npm run build:vercel:sim`; this build script bundles Bun into `client/.cre/bin`.
  - Redeploy with clear build cache so bundled runtime artifacts refresh.
- Vercel build fails with glibc/libstdc++ errors for CRE:
  - Use `npm run build:vercel:sim` as the project build command.
  - Check the deployment logs for fallback attempts across pinned CRE versions.
  - If all attempts fail, the Vercel image is incompatible with available CRE binaries for that deployment.
- Simulation failing on secret reads:
  - Confirm `workflows/.env` has `CRE_ETH_PRIVATE_KEY`, `EVENTBRITE_API_TOKEN`, and `QUOTE_SIGNER_PK`.
- Broadcasted simulation tx fails:
  - Fund `CRE_ETH_PRIVATE_KEY` with Base Sepolia ETH.
