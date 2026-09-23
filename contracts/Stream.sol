// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Guarded.sol";

/// @dev What the stream needs from a holder collection: a live weight per token (zero once burned), the token's
///      owner, how many tokens were ever minted (ids are 1..total), and the running sum of the live weights (kept by
///      the collection on mint and burn, so a pour costs the same at the first soul and at the last).
interface IWeighted {
    function weight(uint256 id) external view returns (uint256);
    function ownerOf(uint256 id) external view returns (address);
    function total() external view returns (uint256);
    function totalWeight() external view returns (uint256);
}

/// @notice The Cauldron's steam. The treasury pours ETH in; every pour opens an epoch, and each token of the holder
///         collection claims its share of that epoch by weight: share = pour x weight / sum of weights at the pour.
///         Claims open once the collection has at least `openAt` tokens (the hundredth soul); until then the pours
///         accumulate and are all claimable at once when the gate opens. A token claims an epoch once; a burned
///         token (a soul that became an alchemist) can no longer claim. The owner (the timelock) can point the stream
///         at a new collection for the main act and can drain unclaimed ETH after a long grace period.
///         Only the pourer (the treasury Safe) or the owner may pour: an open pour let anyone flood the epoch list with
///         dust until claims ran out of gas. Claims can also advance in bounded steps (`claimUpTo`), so a token is
///         never stuck however many epochs pile up.
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
    mapping(uint256 => bool) public drained; // epoch index -> its unclaimed rest went back to the treasury; no more claims
    address public pourer; // the treasury Safe
    uint256 public constant GRACE = 365 days; // unclaimed ETH of an epoch may be drained after this

    event Poured(uint256 indexed epoch, uint256 amount, uint256 totalWeight, uint32 collection);
    event Claimed(uint32 indexed collection, uint256 indexed id, address indexed to, uint256 fromEpoch, uint256 toEpoch, uint256 amount);
    event CollectionAdded(uint32 index, address collection);
    event CurrentSet(uint32 index, uint256 openAt);
    event Drained(uint256 indexed epoch, uint256 amount, address to);
    event PourerSet(address pourer);

    constructor(IWeighted souls, uint256 openAt_, address pourer_) Ownable(msg.sender) {
        collections.push(souls);
        openAt = openAt_;
        pourer = pourer_;
        emit CollectionAdded(0, address(souls));
        emit CurrentSet(0, openAt_);
        emit PourerSet(pourer_);
    }

    function setPourer(address p) external onlyOwner {
        pourer = p;
        emit PourerSet(p);
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
    ///         A drained epoch is closed for good: claims skip it, so nobody is paid twice out of the others' share.
    function drain(uint256 epoch, address to) external onlyOwner nonReentrant {
        Epoch memory e = epochs[epoch];
        require(block.timestamp >= e.at + GRACE, "Stream: grace");
        require(!drained[epoch], "Stream: drained");
        drained[epoch] = true;
        uint256 left = uint256(e.amount) - claimedOf[epoch];
        claimedOf[epoch] = e.amount;
        (bool ok, ) = to.call{value: left}("");
        require(ok, "Stream: drain");
        emit Drained(epoch, left, to);
    }

    // ---------------------------------------------------------------- pours
    /// @notice The treasury pours ETH; it opens one epoch for the current collection with a snapshot of the sum of
    ///         weights. A pour with nobody to claim it is refused. A plain transfer from the pourer pours as well.
    function pour() external payable whenNotPaused {
        _pour();
    }

    receive() external payable whenNotPaused {
        _pour();
    }

    function _pour() internal {
        require(msg.sender == pourer || msg.sender == owner(), "Stream: not pourer");
        require(msg.value > 0, "Stream: empty");
        uint256 tw = totalWeight(current);
        require(tw > 0, "Stream: no weight");
        epochs.push(Epoch(uint128(msg.value), uint128(tw), uint64(block.timestamp), current, uint32(collections[current].total())));
        emit Poured(epochs.length - 1, msg.value, tw, current);
    }

    function totalWeight(uint32 idx) public view returns (uint256) {
        return collections[idx].totalWeight();
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
        uint256 w = collections[idx].weight(id);
        if (w == 0) return 0;
        amount = _sum(idx, id, w, claimedUpTo[idx][id], epochs.length);
    }

    /// @notice Claim for one token; the ETH goes to the token's current owner. Anyone may trigger it.
    function claim(uint32 idx, uint256 id) external nonReentrant whenNotPaused returns (uint256 amount) {
        return _claim(idx, id, epochs.length);
    }

    /// @notice Claim at most `maxEpochs` epochs for one token, oldest first; call again to go on. The way out if a
    ///         token ever has more epochs behind it than one transaction can walk.
    function claimUpTo(uint32 idx, uint256 id, uint256 maxEpochs) external nonReentrant whenNotPaused returns (uint256 amount) {
        uint256 from = claimedUpTo[idx][id];
        uint256 n = epochs.length;
        return _claim(idx, id, maxEpochs < n - from ? from + maxEpochs : n);
    }

    /// @notice Claim for many tokens of one collection in one transaction (a holder's whole rack). Released tokens are
    ///         skipped, they do not spoil the batch.
    function claimMany(uint32 idx, uint256[] calldata ids) external nonReentrant whenNotPaused returns (uint256 amount) {
        require(isOpen() || idx != current, "Stream: not open yet");
        IWeighted c = collections[idx];
        uint256 n = epochs.length;
        for (uint256 k = 0; k < ids.length; k++) {
            uint256 id = ids[k];
            uint256 w = c.weight(id);
            if (w == 0) continue;
            address to = c.ownerOf(id);
            uint256 from = claimedUpTo[idx][id];
            uint256 sum = _book(idx, id, w, from, n);
            claimedUpTo[idx][id] = n;
            if (sum > 0) {
                (bool ok, ) = to.call{value: sum}("");
                require(ok, "Stream: send");
            }
            amount += sum;
            emit Claimed(idx, id, to, from, n, sum);
        }
    }

    function _claim(uint32 idx, uint256 id, uint256 upTo) internal returns (uint256 amount) {
        require(isOpen() || idx != current, "Stream: not open yet");
        IWeighted c = collections[idx];
        uint256 w = c.weight(id);
        require(w > 0, "Stream: no weight");
        address to = c.ownerOf(id);
        uint256 from = claimedUpTo[idx][id];
        amount = _book(idx, id, w, from, upTo);
        claimedUpTo[idx][id] = upTo;
        if (amount > 0) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "Stream: send");
        }
        emit Claimed(idx, id, to, from, upTo, amount);
    }

    /// @dev The share of token `id` (weight `w`) over epochs [from, upTo): only epochs of its collection, poured after
    ///      it existed, and not drained.
    function _sum(uint32 idx, uint256 id, uint256 w, uint256 from, uint256 upTo) internal view returns (uint256 amount) {
        for (uint256 i = from; i < upTo; i++) {
            Epoch memory e = epochs[i];
            if (e.collection != idx || id > e.minted || drained[i]) continue;
            amount += uint256(e.amount) * w / e.totalWeight;
        }
    }

    /// @dev Like `_sum`, and books each part against its epoch.
    function _book(uint32 idx, uint256 id, uint256 w, uint256 from, uint256 upTo) internal returns (uint256 amount) {
        for (uint256 i = from; i < upTo; i++) {
            Epoch memory e = epochs[i];
            if (e.collection != idx || id > e.minted || drained[i]) continue;
            uint256 part = uint256(e.amount) * w / e.totalWeight;
            claimedOf[i] += part;
            amount += part;
        }
    }
}
