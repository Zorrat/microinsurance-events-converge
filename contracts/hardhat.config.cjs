require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ override: true });
require("@nomicfoundation/hardhat-verify");

const baseSepoliaRpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
console.log("Using Base Sepolia RPC URL:", baseSepoliaRpcUrl);

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  plugins: [
    "hardhat-verify"
  ],

  etherscan: {
    // Etherscan V2: use a single Etherscan API key for all supported chains.
    apiKey: process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || "",
  },
  solidity: "0.8.28",
  networks: {
    baseSepolia: {
      url: baseSepoliaRpcUrl,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [`0x${process.env.DEPLOYER_PRIVATE_KEY}`]
        : [],
    },
  },
};
