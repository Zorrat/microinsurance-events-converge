require("dotenv").config({ override: true });
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

function getNetworkFilePath(netName) {
  return path.join(__dirname, "..", `${netName}.json`);
}

function loadJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function mustAddr(name, value) {
  if (!value || !hre.ethers.isAddress(value) || value === hre.ethers.ZeroAddress) {
    throw new Error(`Missing/invalid ${name}: ${value}`);
  }
  return value;
}

function optionalAddr(name, value) {
  if (!value) return undefined;
  return mustAddr(name, value);
}

async function main() {
  const net = await hre.ethers.provider.getNetwork();
  const filePath = getNetworkFilePath(net.name);
  const deployments = loadJsonFile(filePath);

  const receiverAddress = mustAddr(
    "RECEIVER_ADDRESS",
    process.env.RECEIVER_ADDRESS || process.env.POLICY_RECEIVER || deployments.CREReceiver,
  );
  const expectedForwarder = optionalAddr(
    "EXPECTED_FORWARDER",
    process.env.EXPECTED_FORWARDER || process.env.RELAY_FORWARDER || deployments.RelayForwarder || deployments.CREForwarder,
  );
  const expectedPolicyNft = optionalAddr(
    "EXPECTED_POLICY_NFT",
    process.env.EXPECTED_POLICY_NFT || process.env.POLICY_NFT || deployments.PolicyNFT,
  );
  const expectedPolicyVault = optionalAddr(
    "EXPECTED_POLICY_VAULT",
    process.env.EXPECTED_POLICY_VAULT || process.env.POLICY_VAULT || deployments.PolicyVault,
  );

  const receiverAbi = [
    "function forwarder() view returns (address)",
    "function policyNft() view returns (address)",
    "function policyVault() view returns (address)",
  ];
  const receiver = new hre.ethers.Contract(receiverAddress, receiverAbi, hre.ethers.provider);

  const [forwarder, policyNft, policyVault] = await Promise.all([
    receiver.forwarder(),
    receiver.policyNft(),
    receiver.policyVault(),
  ]);

  console.log("Network:", net.name, "ChainId:", net.chainId.toString());
  console.log("Receiver:", receiverAddress);
  console.log("forwarder:", forwarder);
  console.log("policyNft:", policyNft);
  console.log("policyVault:", policyVault);

  const failures = [];
  if (expectedForwarder && forwarder.toLowerCase() !== expectedForwarder.toLowerCase()) {
    failures.push(`forwarder mismatch: expected ${expectedForwarder}, got ${forwarder}`);
  }
  if (expectedPolicyNft && policyNft.toLowerCase() !== expectedPolicyNft.toLowerCase()) {
    failures.push(`policyNft mismatch: expected ${expectedPolicyNft}, got ${policyNft}`);
  }
  if (expectedPolicyVault && policyVault.toLowerCase() !== expectedPolicyVault.toLowerCase()) {
    failures.push(`policyVault mismatch: expected ${expectedPolicyVault}, got ${policyVault}`);
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(failure);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Receiver wiring looks healthy.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
