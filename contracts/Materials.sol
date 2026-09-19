// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Ingredients (40 types x 5 tiers), purification potions, sealed ritual items (8 kinds x 5 tiers)
///         and the 21 mythic keys, all in one ERC-1155. Game contracts are whitelisted minters.
contract Materials is ERC1155, Ownable {
    uint256 public constant TYPES = 40;
    uint256 public constant KINDS = 8;
    uint8 public constant KEYS = 21;

    uint256 public constant ING_BASE = 1; // id = 1 + type*8 + tier, tier 1..5
    uint256 public constant POTION_BASE = 1000; // id = 1000 + tier
    uint256 public constant ITEM_BASE = 2000; // id = 2000 + kind*8 + tier
    uint256 public constant KEY_BASE = 3000; // id = 3000 + keyIndex

    mapping(address => bool) public minters;
    mapping(uint256 => uint256) public circulating; // minted - burned, per id
    uint256 public minedTotal; // M: ingredients minted by the Mine
    uint256 public burnedIngredients; // B: ingredient units burned anywhere

    uint8[21] public keyKind;
    uint8[] private _unclaimed;
    mapping(uint8 => bool) public keyClaimed;

    event MinterSet(address indexed who, bool on);
    event KeyClaimed(uint8 indexed keyIndex, address indexed to, address indexed by);

    modifier onlyMinter() {
        require(minters[msg.sender], "Materials: not minter");
        _;
    }

    constructor(string memory uri_, uint8[21] memory kinds) ERC1155(uri_) Ownable(msg.sender) {
        for (uint8 i = 0; i < KEYS; i++) {
            require(kinds[i] < KINDS, "Materials: kind");
            keyKind[i] = kinds[i];
            _unclaimed.push(i);
        }
    }

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

    function keyId(uint8 idx) public pure returns (uint256) {
        return KEY_BASE + idx;
    }

    function isKey(uint256 id) public pure returns (bool) {
        return id >= KEY_BASE && id < KEY_BASE + KEYS;
    }

    function keyIndex(uint256 id) public pure returns (uint8) {
        return uint8(id - KEY_BASE);
    }

    // ---------------------------------------------------------------- mint / burn
    function mintMined(address to, uint256 id, uint256 amt) external onlyMinter {
        require(isIngredient(id), "Materials: mined must be ingredient");
        minedTotal += amt;
        circulating[id] += amt;
        _mint(to, id, amt, "");
    }

    function mintCrafted(address to, uint256 id, uint256 amt) external onlyMinter {
        require(!isKey(id), "Materials: keys via claim");
        circulating[id] += amt;
        _mint(to, id, amt, "");
    }

    function mintCraftedBatch(address to, uint256[] calldata ids, uint256[] calldata amts) external onlyMinter {
        require(ids.length == amts.length, "Materials: len");
        for (uint256 i = 0; i < ids.length; i++) {
            require(!isKey(ids[i]), "Materials: keys via claim");
            circulating[ids[i]] += amts[i];
        }
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

    // ---------------------------------------------------------------- mythic keys
    function unclaimedCount() public view returns (uint256) {
        return _unclaimed.length;
    }

    function unclaimedOfKind(uint8 kind) public view returns (uint256 c) {
        for (uint256 i = 0; i < _unclaimed.length; i++) if (keyKind[_unclaimed[i]] == kind) c++;
    }

    function claimAny(address to, uint256 rand) external onlyMinter returns (uint8 idx) {
        uint256 n = _unclaimed.length;
        require(n > 0, "Materials: no keys");
        uint256 p = rand % n;
        idx = _unclaimed[p];
        _take(p, idx, to);
    }

    function claimOfKind(address to, uint8 kind, uint256 rand) external onlyMinter returns (bool ok, uint8 idx) {
        uint256 c = unclaimedOfKind(kind);
        if (c == 0) return (false, 0);
        uint256 target = rand % c;
        uint256 seen;
        for (uint256 i = 0; i < _unclaimed.length; i++) {
            if (keyKind[_unclaimed[i]] != kind) continue;
            if (seen == target) {
                idx = _unclaimed[i];
                _take(i, idx, to);
                return (true, idx);
            }
            seen++;
        }
    }

    function _take(uint256 pos, uint8 idx, address to) internal {
        _unclaimed[pos] = _unclaimed[_unclaimed.length - 1];
        _unclaimed.pop();
        keyClaimed[idx] = true;
        circulating[KEY_BASE + idx] = 1;
        _mint(to, KEY_BASE + idx, 1, "");
        emit KeyClaimed(idx, to, msg.sender);
    }
}
