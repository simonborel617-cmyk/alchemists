// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Guarded.sol";

/// @dev What the stream needs from a holder collection: a live weight per token (zero once burned), the token's
///      owner, and how many tokens were ever minted (ids are 1..total).
interface IWeighted {
    function weight(uint256 id) external view returns (uint256);
    function ownerOf(uint256 id) external view returns (address);
    function total() external view returns (uint256);
}

/// @notice The Cauldron's steam. The treasury pours ETH in; every pour opens an epoch, and each token of the holder
///         collection claims its share of that epoch by weight: share = pour x weight / sum of weights at the pour.
///         Claims open once the collection has at least `openAt` tokens (the hundredth soul); until then the pours
///         accumulate and are all claimable at once when the gate opens. A token claims an epoch once; a burned
///         token (a soul that became an alchemist) can no longer claim. The owner (the timelock) can point the stream
///         at a new collection for the main act and can drain unclaimed ETH after a long grace period.
contract Stream is Guarded, ReentrancyGuard {
    struct Epoch {
        uint128 amount;
        uint128 totalWeight;
        uint64 at;
        uint32 collection; // index into collections
        uint32 minted; // tokens of the collection that existed at the pour: ids above it were not in the snapshot
    }

    IWeighted[] public collections; // 0 = souls, later the alchemists
    uint32 public current; // the collection new epochs are minted for
    uint256 public openAt; // claims open once collections[current].total() >= openAt
    Epoch[] public epochs;
    mapping(uint32 => mapping(uint256 => uint256)) public claimedUpTo; // collection -> token id -> epochs claimed (index + 1)
    mapping(uint256 => uint256) public claimedOf; // epoch index -> amount claimed so far
    uint256 public constant GRACE = 365 days; // unclaimed ETH of an epoch may be drained after this

    event Poured(uint256 indexed epoch, uint256 amount, uint256 totalWeight, uint32 collection);
    event Claimed(uint32 indexed collection, uint256 indexed id, address indexed to, uint256 fromEpoch, uint256 toEpoch, uint256 amount);
    event CollectionAdded(uint32 index, address collection);
    event CurrentSet(uint32 index, uint256 openAt);
    event Drained(uint256 indexed epoch, uint256 amount, address to);

    constructor(IWeighted souls, uint256 openAt_) Ownable(msg.sender) {
        collections.push(souls);
        openAt = openAt_;
        emit CollectionAdded(0, address(souls));
        emit CurrentSet(0, openAt_);
    }

    // ---------------------------------------------------------------- admin (the timelock)
    function addCollection(IWeighted c) external onlyOwner returns (uint32 idx) {
        collections.push(c);
        idx = uint32(collections.length - 1);
        emit CollectionAdded(idx, address(c));
    }

    /// @notice Switch new epochs to another collection (the alchemists of the main act). Past epochs stay claimable
    ///         by the tokens they were minted for.
    function setCurrent(uint32 idx, uint256 openAt_) external onlyOwner {
        require(idx < collections.length, "Stream: collection");
        current = idx;
        openAt = openAt_;
        emit CurrentSet(idx, openAt_);
    }

    /// @notice What an epoch's holders never claimed, a year after the pour, goes back to the treasury.
    function drain(uint256 epoch, address to) external onlyOwner nonReentrant {
        Epoch memory e = epochs[epoch];
        require(block.timestamp >= e.at + GRACE, "Stream: grace");
        uint256 left = uint256(e.amount) - claimedOf[epoch];
        claimedOf[epoch] = e.amount;
        (bool ok, ) = to.call{value: left}("");
        require(ok, "Stream: drain");
        emit Drained(epoch, left, to);
    }

    // ---------------------------------------------------------------- pours
    /// @notice The treasury (or anyone) pours ETH; it opens one epoch for the current collection with a snapshot of
    ///         the sum of weights. A pour with nobody to claim it is refused.
    function pour() external payable whenNotPaused {
        require(msg.value > 0, "Stream: empty");
        _pour();
    }

    receive() external payable {
        require(msg.value > 0, "Stream: empty");
        _pour();
    }

    function _pour() internal {
        uint256 tw = totalWeight(current);
        require(tw > 0, "Stream: no weight");
        epochs.push(Epoch(uint128(msg.value), uint128(tw), uint64(block.timestamp), current, uint32(collections[current].total())));
        emit Poured(epochs.length - 1, msg.value, tw, current);
    }

    function totalWeight(uint32 idx) public view returns (uint256 tw) {
        IWeighted c = collections[idx];
        uint256 n = c.total();
        for (uint256 id = 1; id <= n; id++) tw += c.weight(id);
    }

    function epochCount() external view returns (uint256) {
        return epochs.length;
    }

    function isOpen() public view returns (bool) {
        return collections[current].total() >= openAt;
    }

    // ---------------------------------------------------------------- claims
    /// @notice What token `id` of collection `idx` can claim right now over all the epochs it has not claimed yet.
    function claimable(uint32 idx, uint256 id) public view returns (uint256 amount) {
        IWeighted c = collections[idx];
        uint256 w = c.weight(id);
        if (w == 0) return 0;
        for (uint256 i = claimedUpTo[idx][id]; i < epochs.length; i++) {
            Epoch memory e = epochs[i];
            if (e.collection != idx || id > e.minted) continue;
            amount += uint256(e.amount) * w / e.totalWeight;
        }
    }

    /// @notice Claim for one token; the ETH goes to the token's current owner. Anyone may trigger it.
    function claim(uint32 idx, uint256 id) external nonReentrant whenNotPaused returns (uint256 amount) {
        require(isOpen() || idx != current, "Stream: not open yet");
        IWeighted c = collections[idx];
        address to = c.ownerOf(id);
        uint256 w = c.weight(id);
        require(w > 0, "Stream: no weight");
        uint256 from = claimedUpTo[idx][id];
        for (uint256 i = from; i < epochs.length; i++) {
            Epoch memory e = epochs[i];
            if (e.collection != idx || id > e.minted) continue;
            uint256 part = uint256(e.amount) * w / e.totalWeight;
            claimedOf[i] += part;
            amount += part;
        }
        claimedUpTo[idx][id] = epochs.length;
        if (amount > 0) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "Stream: send");
        }
        emit Claimed(idx, id, to, from, epochs.length, amount);
    }

    /// @notice Claim for many tokens of one collection in one transaction (a holder's whole rack).
    function claimMany(uint32 idx, uint256[] calldata ids) external nonReentrant whenNotPaused returns (uint256 amount) {
        require(isOpen() || idx != current, "Stream: not open yet");
        IWeighted c = collections[idx];
        uint256 n = epochs.length;
        for (uint256 k = 0; k < ids.length; k++) {
            uint256 id = ids[k];
            address to = c.ownerOf(id);
            uint256 w = c.weight(id);
            if (w == 0) continue;
            uint256 from = claimedUpTo[idx][id];
            uint256 sum;
            for (uint256 i = from; i < n; i++) {
                Epoch memory e = epochs[i];
                if (e.collection != idx || id > e.minted) continue;
                uint256 part = uint256(e.amount) * w / e.totalWeight;
                claimedOf[i] += part;
                sum += part;
            }
            claimedUpTo[idx][id] = n;
            if (sum > 0) {
                (bool ok, ) = to.call{value: sum}("");
                require(ok, "Stream: send");
            }
            amount += sum;
            emit Claimed(idx, id, to, from, n, sum);
        }
    }
}
