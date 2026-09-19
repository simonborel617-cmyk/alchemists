// Furnace metadata is per tier: tokenURI(id) = baseURI + tier + ".json".
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Furnaces metadata", function () {
  it("resolves tokenURI by tier and only for minted tokens", async function () {
    const [owner, alice] = await ethers.getSigners();
    const furnaces = await ethers.deployContract("Furnaces", []);
    await furnaces.setWorkshop(owner.address); // the test acts as the workshop
    await furnaces.mint(alice.address, 3);
    expect(await furnaces.tokenURI(1)).to.equal("");
    await furnaces.setBaseURI("https://host/metadata/furnace/");
    expect(await furnaces.tokenURI(1)).to.equal("https://host/metadata/furnace/3.json");
    await furnaces.mint(alice.address, 1);
    expect(await furnaces.tokenURI(2)).to.equal("https://host/metadata/furnace/1.json");
    await expect(furnaces.tokenURI(3)).to.be.revertedWithCustomError(furnaces, "ERC721NonexistentToken");
    await expect(furnaces.connect(alice).setBaseURI("x")).to.be.revertedWithCustomError(furnaces, "OwnableUnauthorizedAccount");
  });
});
