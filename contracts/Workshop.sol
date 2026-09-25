// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Guarded.sol";
import "./Mine.sol";
import "./Materials.sol";
import "./Keys.sol";
import "./Furnaces.sol";

/// @notice Refining (tier up), reroll (type shuffle), ritual item / potion / furnace crafting.
///         Random outcomes are committed and settled with the challenge of the next minute.
contract Workshop is Guarded, ReentrancyGuard {
    Mine public immutable mine;
    Materials public immutable materials;
    Keys public immutable keys;
    Furnaces public immutable furnaces;

    uint8 public constant OP_REFINE = 1;
    uint8 public constant OP_REROLL = 2;
    uint8 public constant OP_CRAFT = 3;
    uint8 public constant CATEGORY_ANY = 255;

    struct Commit {
        address user;
        uint8 op;
        uint8 a; // refine: type, reroll: tier, craft: kind
        uint8 b; // refine: tier, reroll: category, craft: the highest input tier
        uint8 c; // refine: furnace bonus flag
        bool settled;
        uint64 revealMinute;
        uint64 l1; // parent-chain block number at the commit: it settles by mine.revealSeed(l1)
        uint256 furnace; // refine: the furnace; craft: how many inputs of each tier, one byte per tier (tier 1 lowest)
    }

    Commit[] public commits;

    uint8[5][8] public itemRecipe; // itemRecipe[kind][category]
    uint8[5] public furnaceRecipe; // per category, ingredients of tier == furnace tier
    uint64 public furnaceCooldown = 600;
    uint8[4] public refineSuccess = [90, 80, 65, 50];
    uint8 public furnaceBonus = 5;
    uint8 public refineBaseInputs = 10;
    uint8 public refineInputDrop = 4;
    uint8[5] public rerollOutCategory = [5, 5, 5, 4, 3];
    uint8 public rerollOutAny = 5;
    uint8 public rerollUpPct = 5;
    uint16 public rerollUp2PerMille = 5;
    uint8[5] public rerollDown = [0, 5, 10, 20, 30];
    uint32[5] public keyChance = [1000000, 100000, 10000, 1000, 100];
    uint8 public craftUpgradePct = 5;
    uint8 public mixFailStep = 5; // a ritual mixing tiers fails with this many percent per tier beyond the first (max 4 x 5 = 20)

    event Committed(uint256 indexed id, address indexed user, uint8 op, uint8 a, uint8 b, uint64 revealMinute);
    event Refined(uint256 indexed id, address indexed user, uint8 typeId, uint8 tier, bool success, uint256 inputs);
    event Rerolled(uint256 indexed id, address indexed user, uint8 tier, uint8 category, uint256[] outIds);
    event Crafted(uint256 indexed id, address indexed user, uint8 kind, uint8 tier, uint8 outTier, uint8 keyIndex);
    event PotionCrafted(address indexed user, uint8 tier);
    event MixFailSet(uint8 step);
    event FurnaceCrafted(address indexed user, uint8 tier, uint256 furnaceId);

    constructor(Mine m, Materials mat, Keys k, Furnaces f, uint8[5][8] memory recipes, uint8[5] memory fr) Ownable(msg.sender) {
        mine = m;
        materials = mat;
        keys = k;
        furnaces = f;
        for (uint256 k = 0; k < 8; k++) {
            uint256 sum;
            for (uint256 c = 0; c < 5; c++) sum += recipes[k][c];
            require(sum == 5, "Workshop: recipe must use 5");
        }
        itemRecipe = recipes;
        furnaceRecipe = fr;
    }

    // ---------------------------------------------------------------- admin
    function setRefine(uint64 cooldown, uint8[4] calldata success, uint8 bonus, uint8 baseInputs, uint8 drop) external onlyOwner {
        require(baseInputs > drop && baseInputs <= 50, "Workshop: inputs");
        furnaceCooldown = cooldown;
        refineSuccess = success;
        furnaceBonus = bonus;
        refineBaseInputs = baseInputs;
        refineInputDrop = drop;
    }

    function setReroll(uint8[5] calldata outCat, uint8 outAny, uint8 upPct, uint16 up2PerMille, uint8[5] calldata down) external onlyOwner {
        for (uint256 i = 0; i < 5; i++) require(outCat[i] >= 1 && outCat[i] <= 10, "Workshop: out");
        require(outAny >= 1 && outAny <= 10, "Workshop: outAny");
        rerollOutCategory = outCat;
        rerollOutAny = outAny;
        rerollUpPct = upPct;
        rerollUp2PerMille = up2PerMille;
        rerollDown = down;
    }

    function setCraft(uint32[5] calldata chances, uint8 upgradePct) external onlyOwner {
        for (uint256 i = 0; i < 5; i++) require(chances[i] > 0, "Workshop: chance");
        keyChance = chances;
        craftUpgradePct = upgradePct;
    }

    /// @notice Instability of a mixed ritual: percent of failure per tier beyond the first. At most 5 (a ritual of all
    ///         five tiers fails at most one time in five).
    function setMixFail(uint8 step) external onlyOwner {
        require(step <= 5, "Workshop: mix fail");
        mixFailStep = step;
        emit MixFailSet(step);
    }

    function commitCount() external view returns (uint256) {
        return commits.length;
    }

    // ---------------------------------------------------------------- refining
    /// @dev Inputs per attempt: 10 at the corridor floor, 6 at the ceiling (heat = position in corridor).
    function refineInputs() public view returns (uint256) {
        uint256 heat = mine.heatQ8();
        return (uint256(refineBaseInputs) * 256 - uint256(refineInputDrop) * heat + 128) / 256;
    }

    function refine(uint256 furnaceId, uint8 typeId, uint8 tier) external whenNotPaused nonReentrant returns (uint256 commitId) {
        require(tier >= 1 && tier <= 4, "Workshop: tier");
        require(furnaces.ownerOf(furnaceId) == msg.sender, "Workshop: not your furnace");
        uint8 ft = furnaces.tier(furnaceId);
        require(ft >= tier, "Workshop: furnace too weak");
        furnaces.fire(furnaceId, furnaceCooldown);
        uint256 n = refineInputs();
        materials.burn(msg.sender, materials.ingId(typeId, tier), n);
        materials.burn(msg.sender, materials.potionId(tier), 1);
        mine.tick();
        commitId = _commit(msg.sender, OP_REFINE, typeId, tier, ft > tier ? 1 : 0, furnaceId);
        emit Refined(commitId, msg.sender, typeId, tier, false, n);
    }

    // ---------------------------------------------------------------- reroll
    function reroll(uint8 tier, uint8 category, uint256[] calldata ids, uint256[] calldata amts) external whenNotPaused nonReentrant returns (uint256 commitId) {
        require(tier >= 1 && tier <= 5, "Workshop: tier");
        require(category == CATEGORY_ANY || category < 5, "Workshop: category");
        require(ids.length == amts.length && ids.length > 0, "Workshop: len");
        uint256 total;
        for (uint256 i = 0; i < ids.length; i++) {
            require(materials.isIngredient(ids[i]) && materials.ingTier(ids[i]) == tier, "Workshop: input");
            total += amts[i];
        }
        require(total == 10, "Workshop: need 10");
        materials.burnBatch(msg.sender, ids, amts);
        mine.tick();
        commitId = _commit(msg.sender, OP_REROLL, tier, category, 0, 0);
    }

    // ---------------------------------------------------------------- crafting
    /// @notice Seal five ingredients into a ritual item. The categories follow the recipe; the tiers may be mixed. The
    ///         item's tier is the tier of one of the five drawn at the reveal, so each tier comes out in proportion to how
    ///         many of the inputs carry it; a ritual of more than one tier can fail (mixFailStep percent per extra tier),
    ///         and a failed ritual yields nothing. All five inputs burn at once, as always.
    function craftItem(uint8 kind, uint256[] calldata ids, uint256[] calldata amts) external whenNotPaused nonReentrant returns (uint256 commitId) {
        require(kind < 8, "Workshop: kind/tier");
        (uint256 packed, uint8 top) = _checkMixed(itemRecipe[kind], ids, amts);
        materials.burnBatch(msg.sender, ids, amts);
        mine.tick();
        commitId = _commit(msg.sender, OP_CRAFT, kind, top, 0, packed);
    }

    function craftPotion(uint8 tier, uint256 herbA, uint256 herbB) external whenNotPaused nonReentrant {
        require(tier >= 1 && tier <= 5, "Workshop: tier");
        require(_isHerb(herbA, tier) && _isHerb(herbB, tier), "Workshop: two herbs of the tier");
        if (herbA == herbB) {
            materials.burn(msg.sender, herbA, 2);
        } else {
            materials.burn(msg.sender, herbA, 1);
            materials.burn(msg.sender, herbB, 1);
        }
        materials.mintCrafted(msg.sender, materials.potionId(tier), 1);
        emit PotionCrafted(msg.sender, tier);
    }

    function craftFurnace(uint8 tier, uint256[] calldata ids, uint256[] calldata amts) external whenNotPaused nonReentrant returns (uint256 furnaceId) {
        require(tier >= 1 && tier <= 4, "Workshop: tier");
        _checkRecipe(furnaceRecipe, tier, ids, amts);
        materials.burnBatch(msg.sender, ids, amts);
        furnaceId = furnaces.mint(msg.sender, tier);
        emit FurnaceCrafted(msg.sender, tier, furnaceId);
    }

    function _isHerb(uint256 id, uint8 tier) internal view returns (bool) {
        return materials.isIngredient(id) && materials.ingCategory(id) == 2 && materials.ingTier(id) == tier;
    }

    function _checkRecipe(uint8[5] memory recipe, uint8 tier, uint256[] calldata ids, uint256[] calldata amts) internal view {
        require(ids.length == amts.length && ids.length > 0, "Workshop: len");
        uint256[5] memory got;
        for (uint256 i = 0; i < ids.length; i++) {
            require(materials.isIngredient(ids[i]) && materials.ingTier(ids[i]) == tier, "Workshop: input");
            got[materials.ingCategory(ids[i])] += amts[i];
        }
        for (uint256 c = 0; c < 5; c++) require(got[c] == recipe[c], "Workshop: recipe");
    }

    /// @dev A recipe check that lets tiers mix: returns the count of inputs per tier (one byte each, tier 1 lowest) and
    ///      the highest tier. The per-category totals must match the recipe, which caps every count at 5.
    function _checkMixed(uint8[5] memory recipe, uint256[] calldata ids, uint256[] calldata amts) internal view returns (uint256 packed, uint8 top) {
        require(ids.length == amts.length && ids.length > 0, "Workshop: len");
        uint256[5] memory got;
        uint256[6] memory perTier;
        for (uint256 i = 0; i < ids.length; i++) {
            require(materials.isIngredient(ids[i]), "Workshop: input");
            uint8 t = materials.ingTier(ids[i]);
            got[materials.ingCategory(ids[i])] += amts[i];
            perTier[t] += amts[i];
        }
        for (uint256 c = 0; c < 5; c++) require(got[c] == recipe[c], "Workshop: recipe");
        for (uint8 t = 1; t <= 5; t++) {
            if (perTier[t] == 0) continue;
            packed |= perTier[t] << (8 * (t - 1));
            top = t;
        }
    }

    // ---------------------------------------------------------------- commit / reveal
    function _commit(address user, uint8 op, uint8 a, uint8 b, uint8 c, uint256 furnace) internal returns (uint256 id) {
        uint64 rm = mine.currentMinute() + 1;
        commits.push(Commit(user, op, a, b, c, false, rm, uint64(block.number), furnace));
        id = commits.length - 1;
        emit Committed(id, user, op, a, b, rm);
    }

    function reveal(uint256 id) external nonReentrant {
        _reveal(id);
    }

    function revealMany(uint256[] calldata ids) external nonReentrant {
        for (uint256 i = 0; i < ids.length; i++) _reveal(ids[i]);
    }

    function _reveal(uint256 id) internal {
        Commit storage c = commits[id];
        require(!c.settled, "Workshop: settled");
        mine.tick();
        bytes32 e = mine.revealSeed(c.l1);
        require(e != bytes32(0), "Workshop: not yet");
        c.settled = true;
        Commit memory cm = c;
        if (e == mine.LOST_SEED()) {
            // lapsed: nobody touched the mine for the whole seed window after the commit; the worst outcome, so letting a
            // commit lapse never pays (the inputs are already gone)
            if (cm.op == OP_REFINE) emit Refined(id, cm.user, cm.a, cm.b, false, 0);
            else if (cm.op == OP_REROLL) emit Rerolled(id, cm.user, cm.a, cm.b, new uint256[](0));
            else emit Crafted(id, cm.user, cm.a, 0, 0, 255);
            return;
        }
        uint256 r = uint256(keccak256(abi.encodePacked(e, id, c.user)));
        if (cm.op == OP_REFINE) _settleRefine(id, cm, r);
        else if (cm.op == OP_REROLL) _settleReroll(id, cm, r);
        else _settleCraft(id, cm, r);
    }

    function _settleRefine(uint256 id, Commit memory c, uint256 r) internal {
        uint8 tier = c.b;
        uint256 p = uint256(refineSuccess[tier - 1]) + (c.c == 1 ? furnaceBonus : 0);
        bool success = r % 100 < p;
        if (success) materials.mintCrafted(c.user, materials.ingId(c.a, tier + 1), 1);
        emit Refined(id, c.user, c.a, tier, success, 0);
    }

    function _settleReroll(uint256 id, Commit memory c, uint256 r) internal {
        uint8 tier = c.a;
        uint8 cat = c.b;
        uint256 n = cat == CATEGORY_ANY ? rerollOutAny : rerollOutCategory[tier - 1];
        uint8[] memory types = new uint8[](n);
        uint8[] memory tiers = new uint8[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 rr = uint256(keccak256(abi.encodePacked(r, i)));
            types[i] = cat == CATEGORY_ANY ? uint8(rr % 40) : uint8(uint256(cat) * 8 + (rr % 8));
            tiers[i] = tier;
        }
        if ((r >> 64) % 100 < rerollUpPct) {
            uint256 i = (r >> 72) % n;
            if (tiers[i] < 5) tiers[i] += 1;
        }
        if ((r >> 80) % 1000 < rerollUp2PerMille) {
            uint256 i = (r >> 88) % n;
            tiers[i] = tiers[i] + 2 > 5 ? 5 : tiers[i] + 2;
        }
        if ((r >> 96) % 100 < rerollDown[tier - 1]) {
            uint256 i = (r >> 104) % n;
            if (tiers[i] > 1) tiers[i] -= 1;
        }
        uint256[] memory outIds = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            outIds[i] = materials.ingId(types[i], tiers[i]);
            materials.mintCrafted(c.user, outIds[i], 1);
        }
        emit Rerolled(id, c.user, tier, cat, outIds);
    }

    function _settleCraft(uint256 id, Commit memory c, uint256 r) internal {
        uint8 kind = c.a;
        uint256 packed = c.furnace;
        uint256 distinct;
        for (uint8 t = 1; t <= 5; t++) if ((packed >> (8 * (t - 1))) & 0xff != 0) distinct++;
        // the instability of a mixed ritual: it fails outright, and the inputs are already gone
        if ((r >> 128) % 100 < uint256(mixFailStep) * (distinct - 1)) {
            emit Crafted(id, c.user, kind, 0, 0, 255);
            return;
        }
        // the tier of one of the five inputs, drawn evenly
        uint256 pick = (r >> 160) % 5;
        uint8 tier;
        for (uint8 t = 1; t <= 5; t++) {
            uint256 n = (packed >> (8 * (t - 1))) & 0xff;
            if (pick < n) {
                tier = t;
                break;
            }
            pick -= n;
        }
        if (r % keyChance[tier - 1] == 0) {
            (bool ok, uint8 idx) = keys.claimOfKind(c.user, kind, r >> 32);
            if (ok) {
                emit Crafted(id, c.user, kind, tier, 6, idx);
                return;
            }
        }
        uint8 outTier = tier;
        if (tier < 5 && (r >> 64) % 100 < craftUpgradePct) outTier = tier + 1;
        materials.mintCrafted(c.user, materials.itemId(kind, outTier), 1);
        emit Crafted(id, c.user, kind, tier, outTier, 255);
    }
}
