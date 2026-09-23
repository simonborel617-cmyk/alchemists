// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./Guarded.sol";
import "./FixedMath.sol";
import "./Mine.sol";
import "./Materials.sol";
import "./Keys.sol";

/// @notice The soul of an alchemist: the closing piece of the opening act. Eight ritual items (five required, three
///         enhancers, a mythic key in its slot) are sealed into a soul for free; rank and average tier follow the
///         summoning rules, quotas per rank, cap 5555. Souls carry the Cauldron weight until the alchemists come:
///         weight = rarity x early, rarity = 2^(avgTier-1) (named = 16), early = 2.0 for the first soul down to 1.0
///         for the hundredth and 1.0 after. The summoning of the main act burns a soul and inherits its data.
contract Souls is ERC721, Guarded {
    Mine public immutable mine;
    Materials public immutable materials;
    Keys public immutable keys;

    uint256 public constant CAP = 5555;
    uint8 public constant SLOTS = 8;
    uint8 public constant REQUIRED = 5;
    uint8 public constant NO_NAME = 255;
    uint256 public constant EARLY_N = 100; // the first hundred souls carry the early multiplier

    struct Data {
        uint8 rank; // 1..5, 6 = named 1/1
        uint16 avgTier100; // average tier * 100 (empty enhancer counts as 1)
        uint8 nameId; // key index or NO_NAME
        uint64 mintedMinute;
    }

    uint16[6] public quota = [0, 0, 1111, 833, 555, 277]; // by rank; rank 1 unlimited within the cap
    uint32[7] public mintedByRank; // index 1..6
    mapping(uint256 => Data) public data;
    uint256 public total;
    uint256 public burned;
    uint256 public totalWeight; // sum of the weights of the live souls, kept on seal and release for the stream
    string public baseURI;
    address public summoner; // the main-act contract allowed to burn a soul into an alchemist

    event Sealed(uint256 indexed id, address indexed to, uint8 rank, uint16 avgTier100, uint8 nameId);
    event Released(uint256 indexed id, address indexed by);
    event SummonerSet(address summoner);

    constructor(Mine m, Materials mat, Keys k, string memory baseURI_) ERC721("Alchemist Souls", "SOUL") Ownable(msg.sender) {
        mine = m;
        materials = mat;
        keys = k;
        baseURI = baseURI_;
    }

    function setBaseURI(string calldata u) external onlyOwner {
        baseURI = u;
    }

    function setSummoner(address s) external onlyOwner {
        summoner = s;
        emit SummonerSet(s);
    }

    /// @param ids item ids by slot (kind index): 0 = empty, allowed only for enhancer slots 5..7, or for the slot the
    ///        key fills.
    /// @param keyIdx a mythic key offered in the slot of its kind (it counts as Legendary and names the soul), or
    ///        NO_NAME for none.
    function seal(uint256[8] calldata ids, uint8 keyIdx) external whenNotPaused returns (uint256 id) {
        require(total < CAP, "Souls: cap");
        uint256 tierSum;
        uint8 nameId = NO_NAME;
        uint8 keySlot = NO_NAME;
        if (keyIdx != NO_NAME) {
            require(keyIdx < keys.KEYS(), "Souls: key");
            keySlot = keys.keyKind(keyIdx);
            require(ids[keySlot] == 0, "Souls: key slot taken");
            nameId = keyIdx;
            keys.burn(msg.sender, keyIdx);
        }
        for (uint8 i = 0; i < SLOTS; i++) {
            uint256 x = ids[i];
            if (i == keySlot) {
                tierSum += 5;
                continue;
            }
            if (x == 0) {
                require(i >= REQUIRED, "Souls: required slot empty");
                tierSum += 1;
                continue;
            }
            require(materials.isItem(x) && materials.itemKind(x) == i, "Souls: item kind");
            tierSum += materials.itemTier(x);
            materials.burn(msg.sender, x, 1);
        }
        uint8 rank;
        if (nameId != NO_NAME) {
            rank = 6;
        } else {
            rank = uint8(tierSum / SLOTS);
            require(rank >= 1 && rank <= 5, "Souls: rank");
            if (rank >= 2) require(mintedByRank[rank] < quota[rank], "Souls: quota");
        }
        mintedByRank[rank] += 1;
        id = ++total;
        data[id] = Data(rank, uint16(tierSum * 100 / SLOTS), nameId, mine.currentMinute());
        totalWeight += _weight(id);
        _mint(msg.sender, id);
        emit Sealed(id, msg.sender, rank, data[id].avgTier100, nameId);
    }

    /// @notice The main act's summoning consumes a soul; only the summoner contract may do it, and only for the owner.
    function release(address from, uint256 id) external returns (Data memory d) {
        require(msg.sender == summoner && summoner != address(0), "Souls: not summoner");
        require(ownerOf(id) == from, "Souls: not owner");
        d = data[id];
        burned += 1;
        totalWeight -= _weight(id);
        _burn(id);
        emit Released(id, msg.sender);
    }

    function exists(uint256 id) external view returns (bool) {
        return _ownerOf(id) != address(0);
    }

    /// @notice The early multiplier, 1e6 = 1.0: 2.0 for soul #1, linearly down to 1.0 for soul #100, 1.0 after.
    function early(uint256 id) public pure returns (uint256) {
        if (id >= EARLY_N) return 1e6;
        return 2e6 - (id - 1) * 1e6 / (EARLY_N - 1);
    }

    /// @notice Rarity, 1e6 = 1.0: 2^(avgTier-1) on the unrounded average tier, a named soul = 16.
    function rarity(uint256 id) public view returns (uint256) {
        Data memory d = data[id];
        require(d.rank != 0, "Souls: no token");
        if (d.rank == 6) return 16e6;
        uint256 xQ8 = (uint256(d.avgTier100) - 100) * 256 / 100;
        return (FixedMath.exp2Q8(xQ8) * 1e6) >> 64;
    }

    /// @notice Cauldron weight, 1e6 = 1.0: rarity x early. Zero for a released (burned) soul.
    function weight(uint256 id) external view returns (uint256) {
        if (_ownerOf(id) == address(0)) return 0;
        return _weight(id);
    }

    function _weight(uint256 id) internal view returns (uint256) {
        return rarity(id) * early(id) / 1e6;
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        if (bytes(baseURI).length == 0) return "";
        return string.concat(baseURI, Strings.toString(data[id].rank), ".json");
    }
}
