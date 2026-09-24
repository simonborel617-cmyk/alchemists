require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" },
  },
  networks: {
    hardhat: { accounts: { count: 64 } },
    robinhoodTestnet: {
      url: process.env.ROBINHOOD_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com/rpc",
      chainId: 46630,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    // mainnet signs only with MAINNET_KEY (the mainnet deployer and keeper), never with the testnet DEPLOYER_KEY
    robinhood: {
      url: process.env.ROBINHOOD_RPC || "https://robinhood-rpc.publicnode.com",
      chainId: 4663,
      accounts: process.env.MAINNET_KEY ? [process.env.MAINNET_KEY] : [],
    },
  },
  mocha: { timeout: 120000 },
};
