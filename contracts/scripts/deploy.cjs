// scripts/deploy.cjs
//
// Deploys + wires:
//  - PolicyNFT
//  - PolicyVault (USDC reserves)
//  - CREReceiver (forwarder-gated receiver)
//
// Usage:
//  USDC_ADDRESS=0x... CRE_FORWARDER=0x... npx hardhat run scripts/deploy.cjs --network baseSepolia

require("dotenv").config({ override: true });
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");


function mustAddr(name, v) {
    if (!v || !hre.ethers.isAddress(v) || v === hre.ethers.ZeroAddress) {
        throw new Error(`Missing/invalid ${name}: ${v}`);
    }
    return v;
}

function getNetworkFilePath(netName) {
    return path.join(__dirname, "..", `${netName}.json`);
}

function loadJsonFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
}

function saveJsonFile(filePath, payload) {
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitSuccessfulTx(tx, label) {
    const receipt = await tx.wait();
    if (!receipt) throw new Error(`${label} tx receipt missing: ${tx.hash}`);
    if (receipt.status !== 1) {
        throw new Error(`${label} tx reverted: ${tx.hash}`);
    }
    return receipt;
}

async function readWiringWithRetry(policyNFT, policyVault, maxAttempts = 8, delayMs = 1500) {
    let last = {
        nftReceiver: hre.ethers.ZeroAddress,
        vaultReceiver: hre.ethers.ZeroAddress,
        vaultNft: hre.ethers.ZeroAddress,
    };

    for (let i = 1; i <= maxAttempts; i++) {
        const [nftReceiver, vaultReceiver, vaultNft] = await Promise.all([
            policyNFT.receiver(),
            policyVault.creReceiver(),
            policyVault.policyNft(),
        ]);

        last = { nftReceiver, vaultReceiver, vaultNft };
        const allSet = [
            nftReceiver,
            vaultReceiver,
            vaultNft,
        ].every((v) => v !== hre.ethers.ZeroAddress);

        if (allSet) return last;
        if (i < maxAttempts) await sleep(delayMs);
    }

    return last;
}

function updateWorkflowReceiver(filePath, receiver) {
    if (!fs.existsSync(filePath)) return { updated: false, reason: "missing" };
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return { updated: false, reason: "empty" };

    const parsed = JSON.parse(raw);
    if (parsed.receiver === receiver) return { updated: false, reason: "unchanged" };

    const next = { ...parsed, receiver };
    saveJsonFile(filePath, next);
    return { updated: true, reason: "ok" };
}

async function main() {
    const [baseSigner] = await hre.ethers.getSigners();
    const deployer = new hre.ethers.NonceManager(baseSigner);
    const deployerAddress = await deployer.getAddress();
    const net = await hre.ethers.provider.getNetwork();

    console.log("\n=== Deploying Event Micro-Insurance ===");
    console.log("Network:", net.name, "ChainId:", net.chainId.toString());
    console.log("Deployer:", deployerAddress);

    const USDC_ADDRESS = mustAddr("USDC_ADDRESS", process.env.USDC_ADDRESS);
    const CRE_FORWARDER = mustAddr("CRE_FORWARDER", process.env.CRE_FORWARDER);

    const MIN_RESERVE_BPS = Number(process.env.MIN_RESERVE_BPS || "11000");
    if (!Number.isFinite(MIN_RESERVE_BPS) || MIN_RESERVE_BPS < 10000 || MIN_RESERVE_BPS > 20000) {
        throw new Error(`Invalid MIN_RESERVE_BPS: ${MIN_RESERVE_BPS} (expected 10000..20000)`);
    }

    const NFT_NAME = process.env.NFT_NAME || "Event Policy";
    const NFT_SYMBOL = process.env.NFT_SYMBOL || "EPOL";

    console.log("\nConfig:");
    console.log(" USDC_ADDRESS   :", USDC_ADDRESS);
    console.log(" CRE_FORWARDER  :", CRE_FORWARDER);
    console.log(" MIN_RESERVE_BPS:", MIN_RESERVE_BPS);
    console.log(" NFT_NAME       :", NFT_NAME);
    console.log(" NFT_SYMBOL     :", NFT_SYMBOL);

    // --- Deploy PolicyNFT ---
    const PolicyNFT = await hre.ethers.getContractFactory("PolicyNFT", deployer);
    const policyNFT = await PolicyNFT.deploy(NFT_NAME, NFT_SYMBOL, deployerAddress);
    await policyNFT.waitForDeployment();
    const policyNFTAddr = await policyNFT.getAddress();
    console.log("\nPolicyNFT deployed:", policyNFTAddr);

    // --- Deploy PolicyVault ---
    const PolicyVault = await hre.ethers.getContractFactory("PolicyVault", deployer);
    const policyVault = await PolicyVault.deploy(USDC_ADDRESS, MIN_RESERVE_BPS, deployerAddress);
    await policyVault.waitForDeployment();
    const policyVaultAddr = await policyVault.getAddress();
    console.log("PolicyVault deployed:", policyVaultAddr);

    // --- Deploy CREReceiver ---
    const CREReceiver = await hre.ethers.getContractFactory("CREReceiver", deployer);
    const creReceiver = await CREReceiver.deploy(deployerAddress, CRE_FORWARDER, policyNFTAddr, policyVaultAddr);
    await creReceiver.waitForDeployment();
    const creReceiverAddr = await creReceiver.getAddress();
    console.log("CREReceiver deployed:", creReceiverAddr);

    // --- Wire contracts ---
    console.log("\nWiring...");

    {
        const tx = await policyNFT.setReceiver(creReceiverAddr);
        console.log(" PolicyNFT.setReceiver tx:", tx.hash);
        await waitSuccessfulTx(tx, "PolicyNFT.setReceiver");
    }
    {
        const tx1 = await policyVault.setCREReceiver(creReceiverAddr);
        console.log(" PolicyVault.setCREReceiver tx:", tx1.hash);
        await waitSuccessfulTx(tx1, "PolicyVault.setCREReceiver");

        const tx2 = await policyVault.setPolicyNFT(policyNFTAddr);
        console.log(" PolicyVault.setPolicyNFT tx:", tx2.hash);
        await waitSuccessfulTx(tx2, "PolicyVault.setPolicyNFT");
    }

    // --- Verify wiring ---
    console.log("\nVerifying wiring...");
    const { nftReceiver, vaultReceiver, vaultNft } = await readWiringWithRetry(policyNFT, policyVault);
    console.log(" PolicyNFT.receiver     :", nftReceiver);
    console.log(" PolicyVault.creReceiver:", vaultReceiver);
    console.log(" PolicyVault.policyNft  :", vaultNft);

    if (nftReceiver.toLowerCase() !== creReceiverAddr.toLowerCase())
        throw new Error("WIRING ERROR: PolicyNFT.receiver mismatch");
    if (vaultReceiver.toLowerCase() !== creReceiverAddr.toLowerCase())
        throw new Error("WIRING ERROR: PolicyVault.creReceiver mismatch");
    if (vaultNft.toLowerCase() !== policyNFTAddr.toLowerCase())
        throw new Error("WIRING ERROR: PolicyVault.policyNft mismatch");

    console.log("\n=== Deployment Summary ===");
    console.log("PolicyNFT        :", policyNFTAddr);
    console.log("PolicyVault      :", policyVaultAddr);
    console.log("CREReceiver      :", creReceiverAddr);

    const filePath = getNetworkFilePath(net.name);
    const previous = loadJsonFile(filePath);
    const next = {
        ...previous,
        network: net.name,
        chainId: Number(net.chainId),
        deployer: deployerAddress,
        USDC: USDC_ADDRESS,
        CREForwarder: CRE_FORWARDER,
        minReserveBps: MIN_RESERVE_BPS,
        nftName: NFT_NAME,
        nftSymbol: NFT_SYMBOL,
        PolicyNFT: policyNFTAddr,
        PolicyVault: policyVaultAddr,
        CREReceiver: creReceiverAddr,
        updatedAt: new Date().toISOString(),
    };
    saveJsonFile(filePath, next);
    console.log(`Deployment addresses saved to: ${filePath}`);

    const workflowConfigPaths = [
        path.join(__dirname, "..", "..", "workflows", "event-microinsurance", "config.staging.json"),
        path.join(__dirname, "..", "..", "workflows", "event-microinsurance", "config.production.json"),
    ];
    for (const workflowConfigPath of workflowConfigPaths) {
        const sync = updateWorkflowReceiver(workflowConfigPath, creReceiverAddr);
        if (sync.updated) {
            console.log(`Updated workflow receiver in: ${workflowConfigPath}`);
        }
    }

    console.log("\nNext steps:");
    console.log(" 1) Fund PolicyVault with USDC.");
    console.log(" 2) Set CRE workflow to call CREReceiver.onReport() via forwarder:", CRE_FORWARDER);
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
