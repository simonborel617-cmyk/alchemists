// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./Guarded.sol";
import "./FixedMath.sol";
import "./Mine.sol";
import "./Materials.sol";
import "./Keys.sol";

/// @notice Summoning. Burns eight ritual items (five required, three enhancers), rank = floor(average tier),
///         appearance seed settled with the next minute's challenge. Hard quotas per rank, cap 5555.
contract Alchemists is ERC721, Guarded {
    Mine public immutable mine;
    Materials public immutable materials;
    Keys public immutable keys;

    uint256 public constant CAP = 5555;
    uint8 public constant SLOTS = 8;
    uint8 public constant REQUIRED = 5;
    uint8 public constant NO_NAME = 255;

    struct Data {
        uint8 rank; // 1..5, 6 = named 1/1
        uint16 avgTier100; // average tier * 100 (empty enhancer counts as 1)
        uint8 nameId; // key index or NO_NAME
        uint64 revealMinute;
        uint64 l1; // parent-chain block number at the summoning: it settles by mine.revealSeed(l1)
        bytes32 seed;
    }

    uint16[6] public quota = [0, 0, 1111, 833, 555, 277]; // by rank; rank 1 unlimited within the cap
    uint32[7] public mintedByRank; // index 1..6
    mapping(uint256 => Data) public data;
    uint256 public total;
    uint256 public summonFee;
    address public treasury;
    uint256 public escrowed;
    string public baseURI;

    event Summoned(uint256 indexed id, address indexed to, uint8 rank, uint16 avgTier100, uint8 nameId);
    event Revealed(uint256 indexed id, bytes32 seed);

    constructor(Mine m, Materials mat, Keys k, string memory baseURI_, uint256 fee, address treasury_)
        ERC721("Alchemists", "ALCH")
        Ownable(msg.sender)
    {
        mine = m;
        materials = mat;
        keys = k;
        baseURI = baseURI_;
        summonFee = fee;
        treasury = treasury_;
    }

    function setBaseURI(string calldata u) external onlyOwner {
        baseURI = u;
    }

    function setSummonFee(uint256 fee) external onlyOwner {
        summonFee = fee;
    }

    function setTreasury(address t) external onlyOwner {
        require(t != address(0), "Alchemists: treasury");
        treasury = t;
    }

    /// @notice Sweep fees the treasury refused and any other ETH that reached the contract: it holds nothing of its own.
    function sweepEscrow(address to) external onlyOwner {
        uint256 amt = address(this).balance;
        escrowed = 0;
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "Alchemists: sweep");
    }

    /// @param ids item ids by slot (kind index): 0 = empty, allowed only for enhancer slots 5..7, or for the slot the
    ///        key fills.
    /// @param keyIdx a mythic key offered in the slot of its kind (it counts as Legendary and names the alchemist),
    ///        or NO_NAME for none.
    function summon(uint256[8] calldata ids, uint8 keyIdx) external payable whenNotPaused returns (uint256 id) {
        require(msg.value >= summonFee, "Alchemists: fee");
        require(total < CAP, "Alchemists: cap");
        uint256 tierSum;
        uint8 nameId = NO_NAME;
        uint8 keySlot = NO_NAME;
        if (keyIdx != NO_NAME) {
            require(keyIdx < keys.KEYS(), "Alchemists: key");
            keySlot = keys.keyKind(keyIdx);
            require(ids[keySlot] == 0, "Alchemists: key slot taken");
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
                require(i >= REQUIRED, "Alchemists: required slot empty");
                tierSum += 1;
                continue;
            }
            require(materials.isItem(x) && materials.itemKind(x) == i, "Alchemists: item kind");
            tierSum += materials.itemTier(x);
            materials.burn(msg.sender, x, 1);
        }
        uint8 rank;
        if (nameId != NO_NAME) {
            rank = 6;
        } else {
            rank = uint8(tierSum / SLOTS);
            require(rank >= 1 && rank <= 5, "Alchemists: rank");
            if (rank >= 2) require(mintedByRank[rank] < quota[rank], "Alchemists: quota");
        }
        mintedByRank[rank] += 1;
        id = ++total;
        mine.tick();
        data[id] = Data(rank, uint16(tierSum * 100 / SLOTS), nameId, mine.currentMinute() + 1, uint64(block.number), bytes32(0));
        _mint(msg.sender, id);
        if (msg.value > 0) {
            (bool ok, ) = treasury.call{value: msg.value}("");
            if (!ok) escrowed += msg.value;
        }
        emit Summoned(id, msg.sender, rank, data[id].avgTier100, nameId);
    }

    function reveal(uint256 id) external {
        Data storage d = data[id];
        require(d.rank != 0, "Alchemists: no token");
        require(d.seed == bytes32(0), "Alchemists: revealed");
        mine.tick();
        bytes32 e = mine.revealSeed(d.l1);
        require(e != bytes32(0), "Alchemists: not yet");
        d.seed = e == mine.LOST_SEED() ? e : keccak256(abi.encodePacked(e, id)); // a lapsed summoning keeps the plain look
        emit Revealed(id, d.seed);
    }

    /// @notice Cauldron weight, 1e6 = 1.0: cohort (-4% per 100 summoned) x rarity (2^(avgTier-1), named = 16).
    function weight(uint256 id) external view returns (uint256) {
        Data memory d = data[id];
        require(d.rank != 0, "Alchemists: no token");
        uint256 cohort = 1e6;
        uint256 steps = (id - 1) / 100;
        for (uint256 i = 0; i < steps; i++) cohort = cohort * 96 / 100;
        uint256 rarity;
        if (d.rank == 6) {
            rarity = 16e6;
        } else {
            uint256 xQ8 = (uint256(d.avgTier100) - 100) * 256 / 100;
            rarity = (FixedMath.exp2Q8(xQ8) * 1e6) >> 64;
        }
        return cohort * rarity / 1e6;
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return string(abi.encodePacked(baseURI, Strings.toString(id)));
    }
}
