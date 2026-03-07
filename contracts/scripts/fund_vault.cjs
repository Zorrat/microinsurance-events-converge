require("dotenv").config({ override: true });
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

// Usage:
//  FUND_AMOUNT_USDC=20 npx hardhat run scripts/fund_vault.cjs --network baseSepolia

function getNetworkFilePath(netName) {
    return path.join(__dirname, "..", `${netName}.json`);
}

function loadDeployments(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Deployment file not found: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) throw new Error(`Deployment file is empty: ${filePath}`);
    return JSON.parse(raw);
}

function saveDeployments(filePath, payload) {
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function mustAddr(name, value) {
    if (!value || !hre.ethers.isAddress(value) || value === hre.ethers.ZeroAddress) {
        throw new Error(`Missing/invalid ${name}: ${value}`);
    }
    return value;
}

async function main() {
    const net = await hre.ethers.provider.getNetwork();
    const filePath = getNetworkFilePath(net.name);
    const deployments = loadDeployments(filePath);

    // Prefer explicit env override, then deployments file.
    const usdcAddress = mustAddr("USDC address", process.env.USDC_ADDRESS || deployments.USDC);
    const vaultAddress = mustAddr("PolicyVault", deployments.PolicyVault);

    const [signer] = await hre.ethers.getSigners();
    console.log("Using deployer account:", signer.address);
    console.log("Network:", net.name, "ChainId:", net.chainId.toString());
    console.log("USDC:", usdcAddress);
    console.log("PolicyVault:", vaultAddress);

    const usdcAbi = [
        "function transfer(address to, uint256 amount) returns (bool)",
        "function decimals() view returns (uint8)",
        "function balanceOf(address account) view returns (uint256)"
    ];

    const usdc = new hre.ethers.Contract(usdcAddress, usdcAbi, signer);

    // Fetch decimals and check balance
    const decimals = await usdc.decimals();
    const balance = await usdc.balanceOf(signer.address);
    console.log("Current deployer USDC Balance:", hre.ethers.formatUnits(balance, decimals));

    const amountHuman = process.env.FUND_AMOUNT_USDC || "20";
    const amount = hre.ethers.parseUnits(amountHuman, decimals);

    if (balance < amount) {
        throw new Error("Not enough test USDC in deployer account to fund the vault.");
    }

    console.log(`Transferring ${amountHuman} USDC to the PolicyVault...`);
    const tx = await usdc.transfer(vaultAddress, amount);
    console.log("Tx hash:", tx.hash);

    await tx.wait(1);
    const vaultBalance = await usdc.balanceOf(vaultAddress);

    const updated = {
        ...deployments,
        USDC: usdcAddress,
        lastFundTxHash: tx.hash,
        lastFundAmountUSDC: amountHuman,
        lastFundedBy: signer.address,
        lastFundedAt: new Date().toISOString(),
        vaultUSDCBalance: hre.ethers.formatUnits(vaultBalance, decimals),
        updatedAt: new Date().toISOString(),
    };
    saveDeployments(filePath, updated);
    console.log(`Funding metadata saved to: ${filePath}`);
    console.log("✅ Vault funded successfully!");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
