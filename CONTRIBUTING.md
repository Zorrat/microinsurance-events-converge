# Contributing to CoverFi

We're excited you're interested in contributing to CoverFi! As an open-source Chainlink Converge Hackathon project, we aim for a collaborative and iterative development process.

## Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) to understand the principles of our community.

## How to Contribute

### 1. Reporting Bugs

If you find a bug, please check if it's already reported. If not, open a new issue with a clear description, steps to reproduce, and any relevant environment details (like your Base Sepolia RPC setup or CRE version).

### 2. Suggesting Features

We welcome feature requests! Please open an issue to discuss your idea before submitting a pull request. We are particularly interested in:
- New integrations for event providers (beyond Eventbrite/Luma)
- Refinements to the Gemini AI risk assessment payload
- UX improvements in the Next.js client

### 3. Submitting Pull Requests

*   Fork the repository and create a new branch for your changes (e.g., `feature/luma-integration`).
*   Make your changes and ensure they follow the project's coding standards.
*   Add tests for any new features or smart contract changes using Hardhat.
*   Verify your workflow changes with `cre-cli`.
*   Submit a pull request with a clear description of your changes and why they are valuable to the protocol.

## Development Setup

### Smart Contracts
1. Navigate to `/contracts`
2. Run `npm install`
3. Set your `.env` following `.env.example`
4. Compile: `npx hardhat compile`
5. Test: `npx hardhat test`

### CRE Workflows
1. Navigate to `/workflows`
2. Run `npm install`
3. Add your `secrets.yaml`
4. Test: `npm run test` or `npx cre-cli run ...`

### Frontend Client
1. Navigate to `/client`
2. Run `npm install`
3. Run `npm run dev`
