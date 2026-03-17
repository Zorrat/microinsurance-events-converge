require("dotenv").config({ override: true });
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

function mustAddr(name, value) {
  if (!value || !hre.ethers.isAddress(value) || value === hre.ethers.ZeroAddress) {
    throw new Error(`Missing/invalid ${name}: ${value}`);
  }
  return value;
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

async function main() {
  const net = await hre.ethers.provider.getNetwork();
  const filePath = getNetworkFilePath(net.name);
  const deployments = loadJsonFile(filePath);

  const receiverAddress = mustAddr(
    "RECEIVER_ADDRESS",
    process.env.RECEIVER_ADDRESS || process.env.POLICY_RECEIVER || deployments.CREReceiver,
  );
  const relayAddress = mustAddr(
    "RELAY_FORWARDER",
    process.env.RELAY_FORWARDER || process.env.RELAY_ADDRESS || deployments.RelayForwarder || deployments.CREForwarder,
  );

  const [signer] = await hre.ethers.getSigners();
  console.log("Using owner account:", signer.address);
  console.log("Network:", net.name, "ChainId:", net.chainId.toString());
  console.log("Receiver:", receiverAddress);
  console.log("Target forwarder:", relayAddress);

  const receiverAbi = [
    "function forwarder() view returns (address)",
    "function setForwarder(address forwarder_)",
  ];
  const receiver = new hre.ethers.Contract(receiverAddress, receiverAbi, signer);
  const currentForwarder = await receiver.forwarder();
  console.log("Current forwarder:", currentForwarder);

  if (currentForwarder.toLowerCase() === relayAddress.toLowerCase()) {
    console.log("Forwarder already matches relay signer. No transaction submitted.");
    return;
  }

  const tx = await receiver.setForwarder(relayAddress);
  console.log("Tx hash:", tx.hash);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`setForwarder failed: ${tx.hash}`);
  }

  const confirmedForwarder = await receiver.forwarder();
  if (confirmedForwarder.toLowerCase() !== relayAddress.toLowerCase()) {
    throw new Error(`Forwarder mismatch after tx. Expected ${relayAddress}, got ${confirmedForwarder}`);
  }

  const next = {
    ...deployments,
    CREReceiver: receiverAddress,
    RelayForwarder: relayAddress,
    CREForwarder: relayAddress,
    lastForwarderRotationTxHash: tx.hash,
    updatedAt: new Date().toISOString(),
  };
  saveJsonFile(filePath, next);
  console.log(`Updated deployment metadata: ${filePath}`);
  console.log("Forwarder rotation complete.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
