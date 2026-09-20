// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @notice The 21 mythic keys, one ERC-721 each (token id = key index 0..20). Every key is bound to one ritual item
///         kind and belongs to one named alchemist. Keys are never minted directly: the Mine claims a random unclaimed
///         key on a lucky reveal, the Workshop claims one of the crafted kind on a lucky craft. The summoning burns
///         the key offered in its slot. Metadata is per key: `<baseURI><id>.json`.
contract Keys is ERC721, Ownable {
    uint8 public constant KEYS = 21;
    uint8 public constant KINDS = 8;

    uint8[21] public keyKind;
    uint8[] private _unclaimed;
    mapping(uint8 => bool) public keyClaimed;
    mapping(address => bool) public minters;
    string public baseURI;

    event MinterSet(address indexed who, bool on);
    event KeyClaimed(uint8 indexed keyIndex, address indexed to, address indexed by);

    modifier onlyMinter() {
        require(minters[msg.sender], "Keys: not minter");
        _;
    }

    constructor(uint8[21] memory kinds) ERC721("Alchemists Mythic Keys", "AKEY") Ownable(msg.sender) {
        for (uint8 i = 0; i < KEYS; i++) {
            require(kinds[i] < KINDS, "Keys: kind");
            keyKind[i] = kinds[i];
            _unclaimed.push(i);
        }
    }

    function setMinter(address who, bool on) external onlyOwner {
        minters[who] = on;
        emit MinterSet(who, on);
    }

    function setBaseURI(string calldata u) external onlyOwner {
        baseURI = u;
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        if (bytes(baseURI).length == 0) return "";
        return string.concat(baseURI, Strings.toString(id), ".json");
    }

    // ---------------------------------------------------------------- claims
    function unclaimedCount() public view returns (uint256) {
        return _unclaimed.length;
    }

    function unclaimedOfKind(uint8 kind) public view returns (uint256 c) {
        for (uint256 i = 0; i < _unclaimed.length; i++) if (keyKind[_unclaimed[i]] == kind) c++;
    }

    /// @dev A random unclaimed key of any kind (the Mine's roll).
    function claimAny(address to, uint256 rand) external onlyMinter returns (uint8 idx) {
        uint256 n = _unclaimed.length;
        require(n > 0, "Keys: none left");
        uint256 p = rand % n;
        idx = _unclaimed[p];
        _take(p, idx, to);
    }

    /// @dev A random unclaimed key of one kind (the Workshop's roll); (false, 0) when that kind is exhausted.
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

    /// @dev The summoning consumes the key offered in its slot; only a minter (the Alchemists contract) may burn.
    function burn(address from, uint8 idx) external onlyMinter {
        require(ownerOf(idx) == from, "Keys: not owner");
        _burn(idx);
    }

    function _take(uint256 pos, uint8 idx, address to) internal {
        _unclaimed[pos] = _unclaimed[_unclaimed.length - 1];
        _unclaimed.pop();
        keyClaimed[idx] = true;
        _safeMint(to, idx);
        emit KeyClaimed(idx, to, msg.sender);
    }
}
