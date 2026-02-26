# 🎟 Event Cancellation Micro-Insurance  
### Powered by Chainlink CRE + x402 Micropayments

> Parametric, programmable micro-insurance for event cancellations.  
> Users submit an event link, receive a premium quote, purchase a non-transferable policy NFT, and receive automated payout if the event is cancelled.

---

## 🚀 Problem

Event organizers and attendees face financial loss when events are cancelled.

Traditional insurance:
- Slow claims processing  
- Manual verification  
- Opaque pricing  
- High minimum premiums  

Web3 event ecosystems (Luma, crypto conferences, community meetups) lack lightweight, automated risk coverage.

---

## 💡 Solution

This project provides:

- 📎 Event link submission (e.g., Luma)
- 💰 Micropayment-based quote assessment via **x402**
- 🧠 Risk evaluation using external APIs + Gemini
- 🎟 Non-transferable Policy NFT issuance
- ⚡ Automated claim resolution via **Chainlink CRE**
- 🔐 Secure onchain payout or resolution

All claim decisions are verified through a CRE workflow that integrates:

- External event APIs
- LLM-based assessment
- Onchain execution via secure report delivery

---

## 🏗 Architecture

### High-Level Flow

1. **Assess**
   - User submits event link
   - Pays assessment fee via x402
   - CRE fetches event data + evaluates risk
   - Returns premium quote

2. **Buy**
   - User pays premium via x402
   - CRE mints non-transferable Policy NFT onchain

3. **Claim**
   - User pays small claim-check fee
   - CRE verifies event status
   - If cancelled → payout
   - If not cancelled → mark resolved

---

## 🔁 Core 3-Endpoint Workflow

| Endpoint | Purpose |
|----------|----------|
| `/assess` | Evaluate event + return premium quote |
| `/buy` | Mint Policy NFT |
| `/claim` | Verify cancellation + resolve |

---

## 🔗 Chainlink CRE Usage

This project builds and simulates a **CRE Workflow** that:

- Integrates blockchain + external APIs + LLM
- Uses HTTP triggers
- Writes secure reports onchain
- Demonstrates successful simulation via CRE CLI

### Chainlink Files

- `cre/workflows/event_microinsurance.ts`
- `contracts/src/CREReceiver.sol`
- `contracts/src/PolicyNFT.sol`

---

## 🧾 Smart Contracts

### PolicyNFT
- Non-transferable ERC721
- Stores:
  - Event hash
  - Coverage window
  - Payout amount
  - Status (ACTIVE / PAID / RESOLVED)

### CREReceiver
- Receives secure reports
- Calls mint / markPaid / markResolved

---

## 🌐 Stack

| Layer | Tech |
|--------|------|
| Frontend + API | Next.js (Vercel) |
| Micropayments | x402 |
| Oracle + Workflow | Chainlink CRE |
| External APIs | Luma API |
| LLM | Gemini |
| Contracts | Solidity (Foundry) |
| Network | Sepolia |

---

## 📂 Repository Structure
