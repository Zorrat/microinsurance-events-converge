require("dotenv").config({ override: true });
const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

// Usage:
//  npx hardhat run scripts/verify.cjs --network baseSepolia

function getNetworkFilePath(netName) {
  return path.join(__dirname, "..", `${netName}.json`);
}

function loadDeployments(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Deployment file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) throw new Error(`Deployment file is empty: ${filePath}`);
  const withoutComments = raw.replace(/\/\/.*$/gm, "");
  return JSON.parse(withoutComments);
}

function mustAddr(name, value) {
  if (!value || !hre.ethers.isAddress(value) || value === hre.ethers.ZeroAddress) {
    throw new Error(`Missing/invalid ${name}: ${value}`);
  }
  return value;
}

async function verifyOne({ label, address, contract, args }) {
  console.log(`\nVerifying ${label} at ${address} ...`);
  try {
    await hre.run("verify:verify", {
      address,
      contract,
      constructorArguments: args,
    });
    console.log(`Verified ${label}`);
  } catch (error) {
    const message = error?.message || String(error);
    if (message.toLowerCase().includes("already verified")) {
      console.log(`${label} is already verified`);
      return;
    }
    throw error;
  }
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const networkName = hre.network.name;
  const filePath = getNetworkFilePath(networkName);
  const deployments = loadDeployments(filePath);
  console.log(`Using deployment file: ${filePath}`);

  const policyNFT = mustAddr("PolicyNFT", deployments.PolicyNFT);
  const policyVault = mustAddr("PolicyVault", deployments.PolicyVault);
  const creReceiver = mustAddr("CREReceiver", deployments.CREReceiver);

  const owner = mustAddr(
    "owner/deployer",
    process.env.DEPLOYER_ADDRESS || deployments.deployer || deployer.address,
  );
  const usdcAddress = mustAddr("USDC_ADDRESS", process.env.USDC_ADDRESS || deployments.USDC);
  const creForwarder = mustAddr("CRE_FORWARDER", process.env.CRE_FORWARDER || deployments.CREForwarder);

  const nftName = process.env.NFT_NAME || deployments.nftName || "Event Policy";
  const nftSymbol = process.env.NFT_SYMBOL || deployments.nftSymbol || "EPOL";
  const minReserveBps = Number(process.env.MIN_RESERVE_BPS || deployments.minReserveBps || "11000");

  if (!Number.isFinite(minReserveBps) || minReserveBps < 10000 || minReserveBps > 20000) {
    throw new Error(`Invalid MIN_RESERVE_BPS: ${minReserveBps} (expected 10000..20000)`);
  }

  console.log("Using network:", networkName);
  console.log("Owner         :", owner);
  console.log("PolicyNFT     :", policyNFT);
  console.log("PolicyVault   :", policyVault);
  console.log("CREReceiver   :", creReceiver);

  await verifyOne({
    label: "PolicyNFT",
    address: policyNFT,
    contract: "contracts/PolicyNFT.sol:PolicyNFT",
    args: [nftName, nftSymbol, owner],
  });

  await verifyOne({
    label: "PolicyVault",
    address: policyVault,
    contract: "contracts/PolicyVault.sol:PolicyVault",
    args: [usdcAddress, minReserveBps, owner],
  });

  await verifyOne({
    label: "CREReceiver",
    address: creReceiver,
    contract: "contracts/CREReciever.sol:CREReceiver",
    args: [owner, creForwarder, policyNFT, policyVault],
  });

  console.log("\nAll verification calls completed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
