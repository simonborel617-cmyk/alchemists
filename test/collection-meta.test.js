// Collections on marketplaces (owner's decision 2026-09-26): every NFT contract carries contractURI (ERC-7572), set at
// deploy to the site's collection JSON, and 5 % creator earnings to the treasury (ERC-2981); both change only by the
// owner. Materials also has a name and a symbol, so marketplaces do not list it as an unnamed contract.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployAll } = require("../scripts/lib/deploy-all");
const P = require("../deploy/params.local.json");

async function fixture() {
  const [owner, alice, , treasury] = await ethers.getSigners();
  const d = await deployAll(ethers, P, treasury.address);
  return { ...d, owner, alice, treasury };
}

describe("Collection metadata and royalties", function () {
  it("sets contractURI and 5 % royalties to the treasury on all five collections at deploy", async function () {
    const d = await loadFixture(fixture);
    for (const [file, c] of [["materials", d.materials], ["keys", d.keys], ["furnaces", d.furnaces], ["souls", d.souls], ["alchemists", d.alchemists]]) {
      expect(await c.contractURI()).to.equal(`${P.collectionsURI}${file}.json`);
      const [to, amt] = await c.royaltyInfo(7, ethers.parseEther("1"));
      expect(to).to.equal(d.treasury.address);
      expect(amt).to.equal(ethers.parseEther("0.05"));
      expect(await c.supportsInterface("0x2a55205a")).to.equal(true); // ERC-2981
      expect(await c.supportsInterface("0x01ffc9a7")).to.equal(true); // ERC-165
    }
    for (const c of [d.keys, d.furnaces, d.souls, d.alchemists]) expect(await c.supportsInterface("0x80ac58cd")).to.equal(true); // ERC-721
    expect(await d.materials.supportsInterface("0xd9b67a26")).to.equal(true); // ERC-1155
    expect(await d.materials.name()).to.equal("Alchemists Materials");
    expect(await d.materials.symbol()).to.equal("AMAT");
  });

  it("only the owner changes the URI (with the ERC-7572 event) or the royalty", async function () {
    const { souls, owner, alice } = await loadFixture(fixture);
    await expect(souls.connect(alice).setContractURI("https://evil/x.json")).to.be.revertedWithCustomError(souls, "OwnableUnauthorizedAccount");
    await expect(souls.connect(alice).setDefaultRoyalty(alice.address, 1000)).to.be.revertedWithCustomError(souls, "OwnableUnauthorizedAccount");
    await expect(souls.connect(owner).setContractURI("https://alchemist-mine.com/metadata/collections/souls-v2.json")).to.emit(souls, "ContractURIUpdated");
    expect(await souls.contractURI()).to.equal("https://alchemist-mine.com/metadata/collections/souls-v2.json");
    await souls.connect(owner).setDefaultRoyalty(alice.address, 250);
    const [to, amt] = await souls.royaltyInfo(1, 10000n);
    expect(to).to.equal(alice.address);
    expect(amt).to.equal(250n);
  });
});
