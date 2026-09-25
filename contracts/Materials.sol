// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Ingredients (40 types x 5 tiers), purification potions and sealed ritual items (8 kinds x 5 tiers) in one
///         ERC-1155. The 21 mythic keys live in the Keys ERC-721. Game contracts are whitelisted minters.
contract Materials is ERC1155, Ownable {
    uint256 public constant TYPES = 40;
    uint256 public constant KINDS = 8;

    uint256 public constant ING_BASE = 1; // id = 1 + type*8 + tier, tier 1..5
    uint256 public constant POTION_BASE = 1000; // id = 1000 + tier
    uint256 public constant ITEM_BASE = 2000; // id = 2000 + kind*8 + tier

    mapping(address => bool) public minters;
    mapping(uint256 => uint256) public circulating; // minted - burned, per id
    uint256 public minedTotal; // M: ingredients minted by the Mine
    uint256 public burnedIngredients; // B: ingredient units burned anywhere


    event MinterSet(address indexed who, bool on);

    modifier onlyMinter() {
        require(minters[msg.sender], "Materials: not minter");
        _;
    }

    constructor(string memory uri_) ERC1155(uri_) Ownable(msg.sender) {}

    function setMinter(address who, bool on) external onlyOwner {
        minters[who] = on;
        emit MinterSet(who, on);
    }

    function setURI(string calldata u) external onlyOwner {
        _setURI(u);
    }

    // ---------------------------------------------------------------- id helpers
    function ingId(uint8 t, uint8 tier) public pure returns (uint256) {
        require(t < TYPES && tier >= 1 && tier <= 5, "Materials: ing");
        return ING_BASE + uint256(t) * 8 + tier;
    }

    function isIngredient(uint256 id) public pure returns (bool) {
        if (id <= ING_BASE || id >= ING_BASE + TYPES * 8) return false;
        uint256 r = (id - ING_BASE) % 8;
        return r >= 1 && r <= 5;
    }

    function ingType(uint256 id) public pure returns (uint8) {
        return uint8((id - ING_BASE) / 8);
    }

    function ingTier(uint256 id) public pure returns (uint8) {
        return uint8((id - ING_BASE) % 8);
    }

    function ingCategory(uint256 id) public pure returns (uint8) {
        return uint8((id - ING_BASE) / 64);
    }

    function potionId(uint8 tier) public pure returns (uint256) {
        require(tier >= 1 && tier <= 5, "Materials: potion");
        return POTION_BASE + tier;
    }

    function itemId(uint8 kind, uint8 tier) public pure returns (uint256) {
        require(kind < KINDS && tier >= 1 && tier <= 5, "Materials: item");
        return ITEM_BASE + uint256(kind) * 8 + tier;
    }

    function isItem(uint256 id) public pure returns (bool) {
        if (id <= ITEM_BASE || id >= ITEM_BASE + KINDS * 8) return false;
        uint256 r = (id - ITEM_BASE) % 8;
        return r >= 1 && r <= 5;
    }

    function itemKind(uint256 id) public pure returns (uint8) {
        return uint8((id - ITEM_BASE) / 8);
    }

    function itemTier(uint256 id) public pure returns (uint8) {
        return uint8((id - ITEM_BASE) % 8);
    }

    // ---------------------------------------------------------------- mint / burn
    /// @dev No receiver hook: anyone may reveal anyone's finds, and a contract miner must not be able to refuse the mint
    ///      to hold a find back until the supply of its pair suits it (the reveal reads the supply extras live).
    function mintMined(address to, uint256 id, uint256 amt) external onlyMinter {
        require(isIngredient(id), "Materials: mined must be ingredient");
        minedTotal += amt;
        _mintQuiet(to, id, amt);
    }

    /// @dev Also without the hook: a contract that commits a craft must not be able to refuse (or be unable to take)
    ///      its outcome, or the commit could never settle.
    function mintCrafted(address to, uint256 id, uint256 amt) external onlyMinter {
        _mintQuiet(to, id, amt);
    }

    function _mintQuiet(address to, uint256 id, uint256 amt) internal {
        require(to != address(0), "Materials: to");
        circulating[id] += amt;
        uint256[] memory ids = new uint256[](1);
        uint256[] memory amts = new uint256[](1);
        ids[0] = id;
        amts[0] = amt;
        _update(address(0), to, ids, amts);
    }

    function mintCraftedBatch(address to, uint256[] calldata ids, uint256[] calldata amts) external onlyMinter {
        require(ids.length == amts.length, "Materials: len");
        for (uint256 i = 0; i < ids.length; i++) circulating[ids[i]] += amts[i];
        _mintBatch(to, ids, amts, "");
    }

    function burn(address from, uint256 id, uint256 amt) public onlyMinter {
        _burnTracked(from, id, amt);
    }

    function burnBatch(address from, uint256[] calldata ids, uint256[] calldata amts) external onlyMinter {
        require(ids.length == amts.length, "Materials: len");
        for (uint256 i = 0; i < ids.length; i++) _burnTracked(from, ids[i], amts[i]);
    }

    function _burnTracked(address from, uint256 id, uint256 amt) internal {
        circulating[id] -= amt;
        if (isIngredient(id)) burnedIngredients += amt;
        _burn(from, id, amt);
    }
}
