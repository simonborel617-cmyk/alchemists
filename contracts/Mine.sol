// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Guarded.sol";
import "./FixedMath.sol";
import "./Materials.sol";
import "./Keys.sol";

/// @notice One-minute PoW sessions that mint random ingredients. GAME_DESIGN.md section 2.
///         Preimage: sha256(miner ‖ nonce ‖ challenge[minute]). A hash only has to clear the minute's threshold: the
///         find's tier, type, upgrade and mythic-key rolls are all settled at reveal with a seed nobody can know when the
///         find is paid for and nobody can choose afterwards (revealSeed), so the miner pays for every find before
///         learning what it is. Workshop crafts and summons draw on the same seeds.
contract Mine is Guarded, ReentrancyGuard {
    struct Config {
        uint32 floorBitsQ8; // 30 * 256
        uint32 ceilBitsQ8; // 43 * 256
        uint32 kPerHour; // K0: target mints per hour at full ore
        uint64 oreR0; // ore reserve of the season
        uint128 refHashrate; // H/s, farm multiplier reference (5 TH/s)
        uint32 mCapQ8; // 4 * 256
        uint128 price0; // wei
        uint64 priceD; // 50 000
        uint64[4] unlockFinds; // finds of the season (submittedTotal) that open Uncommon, Rare, Epic, Legendary
        uint32[4] extraK; // circulating units of a (type,tier) pair per +1 bit, for U, R, E, L
        uint32 keyChance; // 1 in N per revealed mint
        uint32 upgradeChance; // 1 in N, single step
        uint32 firstHourSec; // 3600
        uint32 windowSec; // 120
        uint32 windowSecEarly; // 60
        uint32 maxStepQ8; // 2 * 256
        uint32 maxStepEarlyQ8; // 3 * 256
        uint8 estCapBits; // hashrate estimator: cap one submission at 2^(minute threshold + estCapBits), 6
        uint16 estDivX10; // hashrate estimator: divide the window sum by estDivX10/10, 34 = 3.4
    }

    struct Pending {
        bytes32 hash;
        uint64 revealMinute;
        uint32 tQ8;
        uint32 workQ8;
        uint8 unlockedTier;
        uint64 l1; // parent-chain block number at submit: the find settles by revealSeed(l1)
    }

    Materials public immutable materials;
    Keys public immutable keys;
    address public treasury;
    uint64 public immutable genesisTime;
    uint32 public immutable sessionSec; // 60 on mainnet; shorter only for test deployments
    Config internal cfg;
    uint16[5] internal stepQ8 = [0, 512, 1024, 1792, 2560]; // tier 1..5: bits the reveal roll must clear, * 256

    mapping(uint64 => bytes32) public challenge;
    mapping(uint64 => uint32) public minuteThreshold; // Common threshold fixed together with the minute's challenge
    bytes32 public findAcc; // running hash of every submitted find; mixed into each new challenge so no single actor picks it
    uint256 public escrowed; // mint fees the treasury could not receive; owner sweeps
    uint64 public lastChallengeMinute;

    /// @dev Reveal seeds by parent-chain block, see revealSeed. Every tick() notes its parent block (every commit ticks
    ///      first, so every commit's block is noted) and records the seeds of noted blocks once final, so a commit can
    ///      still be settled after the chain's 256-block blockhash window has moved past it.
    uint64 internal constant SEED_SPAN = 4;
    /// @notice The seed of a commit whose parent block was never recorded within the window (nobody touched the mine for
    ///         ~50 minutes after it): it settles as the worst outcome, so waiting for it never pays.
    bytes32 public constant LOST_SEED = bytes32(uint256(1));
    mapping(uint64 => bytes32) internal _parentSeed;
    uint64[] internal _noted; // parent blocks in which the mine was ticked, each once, in order
    uint256 public notedHead; // _noted before this index are recorded or were lost

    /// @dev Hashrate estimator: each submission contributes 2^floor(bits), capped at 2^(minute threshold + estCapBits),
    ///      and the sum is divided by estDivX10/10. Best-of-N hashes have a heavy tail; cap 6 and divisor 3.4 make
    ///      log2(estimate) unbiased for tens of miners (simulation: +0.0 bits at 50 miners, -0.8 solo). Tunable.

    mapping(address => mapping(uint64 => bool)) public submitted;
    mapping(address => Pending[]) internal _pending;
    mapping(address => uint256) public pendingHead;

    uint32 public tQ8; // Common threshold, bits * 256
    uint64 public windowStart;
    uint256 public windowSum; // sum of 2^floor(bits) over submitted hashes in the window
    uint32 public windowMints;
    uint128 public emaHashrate; // H/s, smoothed over ~5 windows
    uint8 public unlockedTier = 1;
    uint64 public oreRemaining;
    uint64 public submittedTotal; // S: mints counted at submit (ore pressure)
    uint128 public netPressure = 1e6; // network pressure multiplier, 1e6 = 1.0
    uint32 public mQ8 = 256; // farm multiplier, Q8

    event Tick(uint64 indexed minute, bytes32 challenge);
    event Submitted(address indexed miner, uint64 indexed forMinute, uint32 workQ8, uint256 price);
    event Mined(address indexed miner, uint8 indexed typeId, uint8 indexed tier, uint256 id, bool upgraded);
    event KeyMined(address indexed miner, uint8 keyIndex);
    event Retarget(uint32 tQ8, uint256 hashrate, uint32 mints, uint256 kWindow3, uint128 netPressure, uint32 mQ8, uint8 unlockedTier);
    event Unlocked(uint8 tier, uint64 finds);
    event TreasurySet(address treasury);
    event Escrowed(uint256 amount);
    event EscrowSwept(address to, uint256 amount);

    constructor(Materials m, Keys k, address treasury_, Config memory c, uint32 sessionSec_) Ownable(msg.sender) {
        _checkConfig(c);
        require(c.oreR0 > 0, "Mine: ore");
        require(sessionSec_ >= 5 && sessionSec_ <= 3600, "Mine: session");
        sessionSec = sessionSec_;
        materials = m;
        keys = k;
        treasury = treasury_;
        cfg = c;
        genesisTime = uint64(block.timestamp);
        uint64 mnt = currentMinute();
        challenge[mnt] = keccak256(abi.encodePacked(blockhash(block.number - 1), mnt, address(this)));
        minuteThreshold[mnt] = c.floorBitsQ8;
        lastChallengeMinute = mnt;
        tQ8 = c.floorBitsQ8;
        windowStart = uint64(block.timestamp - (block.timestamp % c.windowSecEarly)); // windows aligned to minutes
        oreRemaining = c.oreR0;
        _unlock();
    }

    function _checkConfig(Config memory c) internal pure {
        require(c.floorBitsQ8 <= c.ceilBitsQ8 && c.ceilBitsQ8 <= 255 * 256, "Mine: corridor");
        require(c.kPerHour > 0 && c.priceD > 0, "Mine: k/d");
        require(c.upgradeChance > 0 && c.keyChance > 0, "Mine: chances");
        require(c.windowSec > 0 && c.windowSecEarly > 0, "Mine: windows");
        require(c.estCapBits >= 1 && c.estCapBits <= 32 && c.estDivX10 >= 10, "Mine: estimator");
        for (uint256 i = 0; i < 4; i++) require(c.extraK[i] > 0, "Mine: extraK");
        for (uint256 i = 1; i < 4; i++) require(c.unlockFinds[i] >= c.unlockFinds[i - 1], "Mine: unlocks");
    }

    /// @dev Opens every tier whose find count the season has reached. Tiers never close again.
    function _unlock() internal {
        uint8 u = unlockedTier;
        uint64 s = submittedTotal;
        while (u < 5 && s >= cfg.unlockFinds[u - 1]) {
            u += 1;
            emit Unlocked(u, s);
        }
        unlockedTier = u;
    }

    // ---------------------------------------------------------------- admin
    function config() external view returns (Config memory) {
        return cfg;
    }

    function setTreasury(address t) external onlyOwner {
        require(t != address(0), "Mine: treasury");
        treasury = t;
        emit TreasurySet(t);
    }

    /// @dev Tunables only: ore reserve and start price are fixed for the season.
    function setConfig(Config calldata c) external onlyOwner {
        _checkConfig(c);
        require(c.oreR0 == cfg.oreR0 && c.price0 == cfg.price0, "Mine: immutable fields");
        cfg = c;
        if (tQ8 < c.floorBitsQ8) tQ8 = c.floorBitsQ8;
        if (tQ8 > c.ceilBitsQ8) tQ8 = c.ceilBitsQ8;
        _unlock();
    }

    // ---------------------------------------------------------------- time & challenges
    /// @notice Session index. A session is `sessionSec` seconds; on mainnet that is one minute.
    function currentMinute() public view returns (uint64) {
        return uint64(block.timestamp / sessionSec);
    }

    /// @notice Records the reveal seeds that became final, runs a due retarget, then fixes challenge and threshold for
    ///         every minute up to now (bounded back-fill).
    function tick() public {
        _recordSeeds();
        uint64 here = uint64(block.number);
        uint256 nn = _noted.length;
        if (nn == 0 || _noted[nn - 1] != here) _noted.push(here);
        _maybeRetarget();
        uint64 nowM = currentMinute();
        if (lastChallengeMinute < nowM) {
            bytes32 bh = blockhash(block.number - 1);
            uint64 from = lastChallengeMinute + 1;
            if (nowM - from >= 120) from = nowM - 119;
            bytes32 prev = challenge[from - 1];
            uint32 t = tQ8;
            bytes32 acc = findAcc;
            for (uint64 k = from; k <= nowM; k++) {
                prev = keccak256(abi.encodePacked(bh, k, prev, acc));
                challenge[k] = prev;
                minuteThreshold[k] = t;
            }
            lastChallengeMinute = nowM;
            emit Tick(nowM, prev);
        }
    }

    // ---------------------------------------------------------------- reveal randomness
    /// @notice Randomness for anything committed at parent-chain block `l1` (a find, a craft, a summon); zero until parent
    ///         block l1 + 4 has begun.
    /// @dev On this chain block.number is the parent-chain (L1) block number, and blockhash(n) is written when the chain
    ///      moves past parent block n: the hash of the last L2 block before the move. When the chain jumps several numbers
    ///      at once, ArbOS writes the last one with that hash and fills the skipped ones from it, while the number it
    ///      jumped from keeps a stale value. So among blockhash(l1 .. l1+3) at least one value comes from the last L2 block
    ///      of parent block l1, which is at or after the commit's own block and so unknown when the commit is sent. Once parent block l1 + 4 has begun the four values are final and the same
    ///      for every caller at any moment, so neither a ticker nor anyone else can choose among candidates (the old seed,
    ///      the next minute's challenge, was readable in the last seconds of a minute and fixed by whoever ticked). The
    ///      value is read straight from blockhash while it is in the 256-block window (~51 minutes of 12 s parent blocks)
    ///      and recorded by the first tick after it is final; a commit whose block nobody recorded within the window (no
    ///      transaction to the mine or the workshop for the whole window after the commit) gets LOST_SEED, which every
    ///      settle path turns into its worst outcome, so letting a commit lapse never beats the real seed.
    function revealSeed(uint64 l1) public view returns (bytes32) {
        bytes32 s = _parentSeed[l1];
        if (s != bytes32(0)) return s;
        uint256 top = block.number;
        if (top < uint256(l1) + SEED_SPAN) return bytes32(0);
        if (top <= uint256(l1) + 256) return _seedAt(l1);
        return LOST_SEED;
    }

    function _seedAt(uint64 p) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), p, blockhash(p), blockhash(p + 1), blockhash(p + 2), blockhash(p + 3)));
    }

    /// @dev Records the seeds of the noted parent blocks that became final, oldest first, at most 16 per call. A tick
    ///      notes at most one block, so the queue never falls behind; a noted block past the window is lost.
    function _recordSeeds() internal {
        uint256 top = block.number;
        uint256 h = notedHead;
        uint256 end = _noted.length;
        if (end > h + 16) end = h + 16;
        for (; h < end; h++) {
            uint64 p = _noted[h];
            if (uint256(p) + SEED_SPAN > top) break; // not final yet
            if (top <= uint256(p) + 256 && _parentSeed[p] == bytes32(0)) _parentSeed[p] = _seedAt(p);
        }
        notedHead = h;
    }

    // ---------------------------------------------------------------- views
    /// @dev Position of the Common threshold in the corridor, 0..256.
    function heatQ8() public view returns (uint256) {
        uint256 span = uint256(cfg.ceilBitsQ8) - cfg.floorBitsQ8;
        if (span == 0) return 0;
        return (uint256(tQ8) - cfg.floorBitsQ8) * 256 / span;
    }

    function halvings() public view returns (uint256) {
        uint256 rem = oreRemaining == 0 ? 1 : oreRemaining;
        return Math.log2(uint256(cfg.oreR0) / rem);
    }

    /// @dev Target mints for a window of wsec seconds, times 1000. Never below one mint per window:
    ///      deep halvings make the tail scarce, but a K below one would turn every submit into overshoot.
    function kWindow3(uint32 wsec) public view returns (uint256) {
        uint256 base = uint256(cfg.kPerHour) * 1000 * wsec / 3600;
        uint256 k = (base >> halvings()) * mQ8 / 256;
        return k < 1000 ? 1000 : k;
    }

    function currentPrice() public view returns (uint256) {
        uint256 b = materials.burnedIngredients();
        uint256 s = submittedTotal;
        uint256 e = s > b / 2 ? s - b / 2 : 0;
        uint256 oreQ = 1e6 + Math.sqrt(e * 1e12 / cfg.priceD);
        return uint256(cfg.price0) * oreQ / 1e6 * netPressure / 1e6;
    }

    /// @notice Bits (Q8) the reveal roll must clear for a (type, tier) pair right now: the tier step plus the pair's
    ///         saturation extra. Before the 1/16 upgrade, P(tier >= k) = 2^-(tierRollQ8 / 256) while tier k is open.
    function tierRollQ8(uint8 typeId, uint8 tier) public view returns (uint256) {
        require(tier >= 1 && tier <= 5, "Mine: tier");
        uint256 thr = stepQ8[tier - 1];
        if (tier >= 2) thr += materials.circulating(materials.ingId(typeId, tier)) * 256 / cfg.extraK[tier - 2];
        return thr;
    }

    function pendingCount(address miner) external view returns (uint256) {
        return _pending[miner].length - pendingHead[miner];
    }

    function pendingAt(address miner, uint256 i) external view returns (Pending memory) {
        return _pending[miner][pendingHead[miner] + i];
    }

    // ---------------------------------------------------------------- mining
    /// @notice Submit the best hash of minute `forMinute` during minute `forMinute + 1`. Pays the current price.
    function submit(uint64 forMinute, uint256 nonce) external payable whenNotPaused nonReentrant {
        uint256 price = currentPrice(); // priced before this transaction's own retarget, so the price a client read holds
        tick();
        uint64 nowM = currentMinute();
        require(forMinute + 1 == nowM, "Mine: submit in the next minute");
        require(!submitted[msg.sender][forMinute], "Mine: one per minute");
        bytes32 c = challenge[forMinute];
        require(c != bytes32(0), "Mine: no challenge");
        require(oreRemaining > 0, "Mine: vein exhausted");
        submitted[msg.sender][forMinute] = true;

        bytes32 h = sha256(abi.encodePacked(msg.sender, nonce, c));
        uint32 w = FixedMath.workQ8(h);
        uint32 tm = minuteThreshold[forMinute]; // the threshold the miner was mining against
        require(w >= tm, "Mine: below threshold");
        require(msg.value >= price, "Mine: price");

        uint256 bits = w >> 8;
        uint256 cap = (uint256(tm) >> 8) + cfg.estCapBits;
        if (bits > cap) bits = cap;
        windowSum += uint256(1) << bits;
        windowMints += 1;
        oreRemaining -= 1;
        submittedTotal += 1;
        _unlock();
        _pending[msg.sender].push(Pending(h, nowM + 1, tm, w, unlockedTier, uint64(block.number)));
        findAcc = keccak256(abi.encodePacked(findAcc, h));
        emit Submitted(msg.sender, forMinute, w, price);

        if (price > 0) {
            (bool ok, ) = treasury.call{value: price}("");
            if (!ok) {
                escrowed += price; // a treasury that cannot take ETH must not stop the season
                emit Escrowed(price);
            }
        }
        if (msg.value > price) {
            (bool ok2, ) = msg.sender.call{value: msg.value - price}("");
            require(ok2, "Mine: refund");
        }
        _revealFor(msg.sender);
    }

    /// @notice Settle any revealable pending finds of `miner`. Anyone may call.
    function reveal(address miner) external nonReentrant {
        tick();
        _revealFor(miner);
    }

    /// @notice Sweep mint fees that the treasury refused (see Escrowed) and any other ETH that reached the mine: between
    ///         transactions the mine holds nothing of its own, so the whole balance goes. Part of the emergency exit.
    function sweepEscrow(address to) external onlyOwner {
        uint256 amt = address(this).balance;
        escrowed = 0;
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "Mine: sweep");
        emit EscrowSwept(to, amt);
    }

    function _revealFor(address miner) internal {
        Pending[] storage q = _pending[miner];
        uint256 head = pendingHead[miner];
        uint256 n;
        while (head < q.length && n < 8) {
            Pending memory pd = q[head];
            bytes32 e = revealSeed(pd.l1);
            if (e == bytes32(0)) break;
            delete q[head]; // effects first: the slot is gone before any token hook can run
            head++;
            n++;
            pendingHead[miner] = head;
            _settle(miner, pd, e);
        }
        pendingHead[miner] = head;
    }

    function _settle(address miner, Pending memory pd, bytes32 e) internal {
        if (e == LOST_SEED) {
            // a lapsed find: a Common of the type its own hash names, no upgrade, no key
            uint8 lt = uint8(uint256(pd.hash) % 40);
            uint256 lid = materials.ingId(lt, 1);
            materials.mintMined(miner, lid, 1);
            emit Mined(miner, lt, 1, lid, false);
            return;
        }
        uint256 r = uint256(keccak256(abi.encodePacked(pd.hash, e)));
        uint8 t = uint8(r % 40);
        uint8 tier = _tierFor(pd.unlockedTier, t, FixedMath.workQ8(keccak256(abi.encodePacked(r))));
        bool upgraded;
        if (tier < 5 && ((r >> 8) % cfg.upgradeChance) == 0) {
            tier += 1;
            upgraded = true;
        }
        if (((r >> 16) % cfg.keyChance) == 0 && keys.unclaimedCount() > 0) {
            uint8 k = keys.claimAny(miner, r >> 32);
            emit KeyMined(miner, k);
            return;
        }
        uint256 id = materials.ingId(t, tier);
        materials.mintMined(miner, id, 1);
        emit Mined(miner, t, tier, id, upgraded);
    }

    /// @dev Highest tier the reveal roll clears. The roll is the work of a fresh random hash, P(roll >= x bits) = 2^-x: the
    ///      odds a single small miner's best hash would have over the threshold, the same for every find whatever the
    ///      network load or the miner's size. Per-pair extras are read at reveal time; the unlocks are those at submit time.
    function _tierFor(uint8 unlocked, uint8 t, uint256 rollQ8) internal view returns (uint8 tier) {
        tier = 1;
        for (uint8 k = 2; k <= 5; k++) {
            if (k > unlocked) break;
            uint256 thr = stepQ8[k - 1] + materials.circulating(materials.ingId(t, k)) * 256 / cfg.extraK[k - 2];
            if (rollQ8 >= thr) tier = k;
        }
    }

    // ---------------------------------------------------------------- retarget
    function _windowParams() internal view returns (uint32 wsec, uint32 maxStep) {
        if (block.timestamp < uint256(genesisTime) + cfg.firstHourSec) return (cfg.windowSecEarly, cfg.maxStepEarlyQ8);
        return (cfg.windowSec, cfg.maxStepQ8);
    }

    function _maybeRetarget() internal {
        (uint32 wsec, uint32 maxStep) = _windowParams();
        if (block.timestamp < uint256(windowStart) + wsec) return;
        uint256 elapsed = block.timestamp - windowStart;
        uint256 work = windowSum * 10 / cfg.estDivX10; // corrected total work in the window
        uint256 hPerSec = work / elapsed;

        emaHashrate = uint128((uint256(emaHashrate) * 4 + hPerSec) / 5);
        if (cfg.refHashrate > 0 && emaHashrate > cfg.refHashrate) {
            uint256 mm = 256 + FixedMath.log2Q8(emaHashrate) - FixedMath.log2Q8(cfg.refHashrate);
            if (mm > cfg.mCapQ8) mm = cfg.mCapQ8;
            mQ8 = uint32(mm);
        } else {
            mQ8 = 256;
        }

        uint256 kW3 = kWindow3(wsec);
        if (kW3 > 0) {
            int256 ratio = (int256(uint256(windowMints)) * 1000 - int256(kW3)) * 1e6 / int256(kW3);
            if (ratio > 1e6) ratio = 1e6;
            if (ratio < -1e6) ratio = -1e6;
            int256 np = int256(uint256(netPressure)) * (1e6 + ratio / 8) / 1e6;
            if (np < 1e6) np = 1e6;
            if (np > 1e9) np = 1e9; // x1000 ceiling: keeps the multiplier far from uint128 limits
            netPressure = uint128(uint256(np));
        }

        uint256 t = tQ8;
        uint256 newT;
        if (windowMints == 0 || kW3 == 0) {
            // an empty window says little (one quiet miner, a missed minute): ease down by one bit, not a full step
            newT = t > uint256(cfg.floorBitsQ8) + 256 ? t - 256 : cfg.floorBitsQ8;
        } else {
            uint256 hashesPerSession = work * wsec * 1000 / (elapsed * kW3); // K is per window; a session's share of it
            uint256 desired = hashesPerSession > 0 ? FixedMath.log2Q8(hashesPerSession) : 0;
            if (desired > t + maxStep) newT = t + maxStep;
            else if (desired + maxStep < t) newT = t - maxStep;
            else newT = desired;
        }
        if (newT < cfg.floorBitsQ8) newT = cfg.floorBitsQ8;
        if (newT > cfg.ceilBitsQ8) newT = cfg.ceilBitsQ8;
        tQ8 = uint32(newT);

        emit Retarget(tQ8, hPerSec, windowMints, kW3, netPressure, mQ8, unlockedTier);
        windowStart = uint64(block.timestamp - (block.timestamp % wsec)); // keep windows aligned to wsec boundaries
        windowSum = 0;
        windowMints = 0;
    }
}
