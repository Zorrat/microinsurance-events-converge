<div align="center">
  <h1>CoverFi</h1>
  <p><strong>Protect your event budget onchain.</strong></p>
  <p>
    Powered by <strong>Chainlink CRE</strong>, <strong>x402 Micropayments</strong>, <strong>USDC</strong>, and <strong>Gemini AI</strong>.<br/>
    Built for the Chainlink Convergence Hackathon.
  </p>
</div>

<br />


## 🚀 Overview

**Protect your event budget onchain.**
Quote it. Mint it. Claim it. If your event gets canceled, your coverage settles transparently on Base Sepolia.

Don't just gamble, insure. Protect against event risk without betting on outcomes. Built for indie organizers, collectives, and creator crews.

### ⚡ How It Hits (Fast cover flow for real-world event risk)
No giant process deck. Just clear terms before the event, wallet-owned policy state during, and deterministic settlement after.
- **Before event:** Lock your numbers. Get premium + payout terms up front so your downside is clear before doors open.
- **During event:** Hold active cover. Mint your policy NFT and keep your cover state tied to your wallet, not a hidden backend row.
- **After event:** Settle onchain. If cancellation rules hit, settlement routes to payout. If not, liability resolves cleanly.

### 💡 Who It Is For
Made for people actually running events (Independent promoters, Wedding and private event planners, Community festival crews).
If your crew fronts money before showtime, this helps cap cancellation downside for venue deposits, artist retainers, and paid marketing campaigns.

### 🔍 Stack Spotlight
CoverFi is designed for AI-agent use: deterministic paid APIs, verifiable workflow execution, and onchain settlement. No black-box backend state deciding policy outcomes.
- **x402 (Primary Access Rail):** Paid endpoint access for quote, mint, and claim so usage is machine-readable, metered, and agent-friendly.
- **Chainlink CRE (Primary Execution Layer):** Orchestrates deterministic quote/mint/claim actions and delivers signed reports into onchain settlement paths.
- **AI + Pricing Engine:** Blends AI risk signals with deterministic pricing math to produce fair premium and payout quotes.

---

## 🏗 Architecture

CoverFi is built around a single Chainlink CRE workflow that acts as the orchestrator, communicating with smart contracts strictly through a Forwarder.

![CoverFi Architecture Diagram](./client/arcdiag.png)

### Onchain Contracts (Base Sepolia)
- **PolicyNFT (ERC721):** Soulbound policy records. Transfer and approval paths are disabled. Mints and state transitions (ACTIVE → PAID / RESOLVED) are gatekept.
- **PolicyVault:** The financial engine. Holds USDC reserves. Solvency is mathematically enforced before any new liability is assumed (`balance >= (liability * reserveRatio)`). 
- **CREReceiver:** The entrypoint for the Chainlink CRE DON. It decodes secure offchain reports and routes minimal state transitions into the Vault and NFT.

### Offchain CRE Workflow
A single Chainlink CRE workflow handles three core actions:
1. `QUOTE_CHECK`: Validates the event, calculates the dynamic premium via Gemini + localized risk bands, and signs a deterministic quote.
2. `MINT`: Verifies the signed quote, enforces the reserve checks, and triggers the onchain policy mint.
3. `CLAIM`: Checks the canonical event status on resolution. Triggers `PAY` if canceled, or `RESOLVE_NO_PAYOUT` if the coverage window expires without cancellation.

<br/>

## 🔑 Security & Invariants
CoverFi is designed with a strict "Don't Trust, Verify" model:
- **No Backend Database:** State is derived entirely from the onchain PolicyVault and PolicyNFT.
- **Tamper-Resistant Signatures:** Quotes are cryptographically signed by the CRE DON, protecting against quote manipulation.
- **Forwarder-Gated Execution:** `CREReceiver` strictly requires `msg.sender == KeystoneForwarder` or `msg.sender == CREReceiver`.
- **Monotonic State Transitions:** Policies move strictly from `ACTIVE` to either `PAID` or `RESOLVED_NO_PAYOUT`.
- **Mathematical Solvency:** Policies cannot be minted if the Vault falls below the defined Reserve Ratio (e.g., 110%).

---

## 🌐 Tech Stack & Integrations

- **Oracle & Workflow:** [Chainlink CRE](https://docs.chain.link/cre) (Cross-Chain Relay Environment)
- **Smart Contracts:** Solidity (Hardhat)
- **Network:** Base Sepolia *(Sponsor Prize Candidate)*
- **Micropayments:** x402 Protocol
- **Risk AI:** Google Gemini API (`gemini-2.0-flash`) *(Sponsor Prize Candidate)*
- **Frontend:** Next.js, React, HeroUI, Tailwind CSS
- **APIs:** Eventbrite API (Extensible to Luma, etc.)


## 🎥 Demo Video

[![CoverFi Demo Video]](https://youtu.be/QnkSvXrcPig)
> *Watch our demo showcasing the Chainlink CRE workflow simulated via CLI and integrated into the CoverFi web application.*

---

### ⛓️ Chainlink CRE Files
This project specifically fulfills the requirement to build and simulate a CRE Workflow. The workflow integrates a blockchain (Base Sepolia) with an external API (Eventbrite) and an LLM (Gemini). The core Chainlink files are:
- [`workflows/event-microinsurance/main.ts`](./workflows/event-microinsurance/main.ts): The primary entry point for the Chainlink CRE workflow.
- [`workflows/event-microinsurance/actions/quote.ts`](./workflows/event-microinsurance/actions/quote.ts) & related actions: Invoked by CRE to fetch external API data, assess risk with Gemini, and interact onchain.
- [`contracts/src/CREReceiver.sol`](./contracts/src/CREReceiver.sol): The smart contract designed to receive secure `onReport` transactions from the Chainlink Forwarder.

---

## 📂 Repository Structure

```text
├── client/                 # Next.js web application
├── contracts/              # Hardhat project (PolicyNFT, Vault, Receiver)
├── workflows/              # Chainlink CRE workflow definitions & TS logic
│   └── event-microinsurance/ # Core CRE workflow implementation
└── docs/                   # Architecture and model documentation
```

---

## 🚀 Quick Start (Local & Testnet)

*(Detailed setup instructions for developers looking to run CoverFi locally or deploy their own instance.)*

### Prerequisites
- Node.js >= 18
- Hardhat
- A Base Sepolia RPC & testnet USDC

### 1. Smart Contracts
```bash
cd contracts
npm install
# Deploy the protocol (NFT, Vault, Receiver)
npx hardhat run scripts/deploy.cjs --network baseSepolia
# Fund the vault with USDC (Required for solvency)
npx hardhat run scripts/fund_vault.cjs --network baseSepolia
```

### 2. CRE Workflow Simulation
As per hackathon requirements, this workflow can be successfully simulated via the CRE CLI. It integrates onchain logic with Gemini AI and external event APIs.

```bash
cd workflows
npm install
# Test the workflow locally via Chainlink CRE CLI
npx cre-cli run event-microinsurance --payload test-payloads/quote-check.json
```

### 3. Frontend
```bash
cd client
npm install
npm run dev
```

### 4. Hosted Deploy (Direct Vercel)

For low-cost hosted deployment of the Next.js app:

- GitHub Actions CI workflow (no deploy): `.github/workflows/client-ci-deploy-vercel.yml`
- Deployment guide: `client/README.md` -> `Production Publish (Direct Vercel)`

Production deploys are handled directly by Vercel Git integration using `npm run build:vercel:sim` as the build command.

---

## 🤝 Contributing
We welcome contributions! As a hackathon project, we embrace rapid iteration and community feedback. Feel free to open issues, submit PRs, and suggest architectural improvements.

---

## 🛡 Disclaimer
CoverFi is a hackathon prototype built for educational and demonstrative purposes within the Chainlink Convergence hackathon. It is not audited and should not be used in production with real funds. 

---

<div align="center">
  Built with 💙 for <b>Chainlink Convergence</b>
</div>
