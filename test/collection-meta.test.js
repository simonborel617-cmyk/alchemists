// Collections on marketplaces (owner's decisions 2026-09-26): every NFT contract carries contractURI (ERC-7572), set at
// deploy to the site's collection JSON, and 5 % creator earnings to the treasury (ERC-2981). Two roles: the owner is
// the collection's face (OpenSea gives owner() the collection page) and may only move contractURI; the admin (the
// Safe) holds everything else and can take the owner role back. Materials also has a name and a symbol, so
// marketplaces do not list it as an unnamed contract.
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

  it("the owner moves only the contractURI (with the ERC-7572 event); the royalty is the admin's", async function () {
    const { souls, owner, alice } = await loadFixture(fixture);
    await expect(souls.connect(alice).setContractURI("https://evil/x.json")).to.be.revertedWithCustomError(souls, "OwnableUnauthorizedAccount");
    await expect(souls.connect(alice).setDefaultRoyalty(alice.address, 1000)).to.be.revertedWithCustomError(souls, "NotAdmin");
    await expect(souls.connect(owner).setContractURI("https://alchemist-mine.com/metadata/collections/souls-v2.json")).to.emit(souls, "ContractURIUpdated");
    expect(await souls.contractURI()).to.equal("https://alchemist-mine.com/metadata/collections/souls-v2.json");
    await souls.connect(owner).setDefaultRoyalty(alice.address, 250); // the deployer is still the admin here
    const [to, amt] = await souls.royaltyInfo(1, 10000n);
    expect(to).to.equal(alice.address);
    expect(amt).to.equal(250n);
  });

  it("splits the face from the admin: the face cannot touch minters, URIs, royalties or the brake", async function () {
    const [deployer, face, safe, alice] = await ethers.getSigners();
    const { materials, keys, furnaces, souls } = await deployAll(ethers, P, safe.address);
    for (const c of [materials, keys, furnaces, souls]) {
      await c.setAdmin(safe.address);
      await c.transferOwnership(face.address);
      expect(await c.owner()).to.equal(face.address);
      expect(await c.admin()).to.equal(safe.address);
      await expect(c.connect(face).setDefaultRoyalty(face.address, 1000)).to.be.revertedWithCustomError(c, "NotAdmin");
      await expect(c.connect(face).setAdmin(face.address)).to.be.revertedWithCustomError(c, "NotAdmin");
      await expect(c.connect(face).reassignOwner(alice.address)).to.be.revertedWithCustomError(c, "NotAdmin");
      await expect(c.connect(deployer).setContractURI("x")).to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount");
      await expect(c.connect(face).setContractURI("https://alchemist-mine.com/metadata/collections/x.json")).to.emit(c, "ContractURIUpdated");
    }
    await expect(materials.connect(face).setMinter(face.address, true)).to.be.revertedWithCustomError(materials, "NotAdmin");
    await expect(materials.connect(face).setURI("x")).to.be.revertedWithCustomError(materials, "NotAdmin");
    await expect(keys.connect(face).setMinter(face.address, true)).to.be.revertedWithCustomError(keys, "NotAdmin");
    await expect(keys.connect(face).setBaseURI("x")).to.be.revertedWithCustomError(keys, "NotAdmin");
    await expect(furnaces.connect(face).setWorkshop(face.address)).to.be.revertedWithCustomError(furnaces, "NotAdmin");
    await expect(furnaces.connect(face).setBaseURI("x")).to.be.revertedWithCustomError(furnaces, "NotAdmin");
    await expect(souls.connect(face).setSummoner(face.address)).to.be.revertedWithCustomError(souls, "NotAdmin");
    await expect(souls.connect(face).setBaseURI("x")).to.be.revertedWithCustomError(souls, "NotAdmin");
    // the brake of Souls follows the admin, not the owner
    await expect(souls.connect(face).pause()).to.be.revertedWith("Guarded: not guardian");
    await expect(souls.connect(face).setGuardian(face.address)).to.be.revertedWithCustomError(souls, "OwnableUnauthorizedAccount");
    await souls.connect(safe).pause();
    await expect(souls.connect(face).unpause()).to.be.revertedWithCustomError(souls, "OwnableUnauthorizedAccount");
    await souls.connect(safe).unpause();
    expect(await souls.paused()).to.equal(false);
    // the admin acts at once and can take the collection page back
    await materials.connect(safe).setMinter(alice.address, true);
    expect(await materials.minters(alice.address)).to.equal(true);
    await expect(materials.connect(safe).reassignOwner(ethers.ZeroAddress)).to.be.revertedWith("CollectionMeta: owner");
    await expect(materials.connect(safe).setAdmin(ethers.ZeroAddress)).to.be.revertedWith("CollectionMeta: admin");
    await materials.connect(safe).reassignOwner(alice.address);
    expect(await materials.owner()).to.equal(alice.address);
    await expect(materials.connect(face).setContractURI("x")).to.be.revertedWithCustomError(materials, "OwnableUnauthorizedAccount");
  });
});
