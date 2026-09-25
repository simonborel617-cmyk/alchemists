// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Guarded.sol";

interface IKettleStream {
    function pour() external payable;
    function isOpen() external view returns (bool);
}

/// @notice The Kettle: the Mine's treasury (Mine.treasury = this). Once per clock hour anyone may tick it (the keeper
///         does, at the top of the hour). A tick first sends the brew (40 % of the fees that arrived since the last
///         tick) to the Safe, then adds the steam (60 %) to the pot and pours `dripBps` of the pot into the Stream,
///         which opens that hour's epoch. Nothing is poured while the Stream's gate is closed (fewer than `openAt`
///         tokens of its current collection); the steam waits and then flows out at the same rate. A Stream that
///         refuses a pour (paused, closed) never holds back the brew: the steam stays in the pot. The ticker has no
///         power over the ETH: the Safe is fixed, the Stream and the rates change only through the owner (the
///         timelock). Emergency: the guardian pauses, the owner returns everything to the Safe and the Kettle closes.
contract Kettle is Guarded, ReentrancyGuard {
    address public immutable safe;
    IKettleStream public stream;
    uint256 public steamBps; // share of fresh fees that becomes steam (6000)
    uint256 public dripBps; // share of the pot poured per hour (417 ~ 1/24)
    uint256 public constant MIN_POUR = 0.01 ether; // every pour is at least this: no dust epochs for the Stream to walk
    uint256 public constant MIN_GAS = 300_000; // a starved tick reverts instead of skipping the hour's pour

    uint256 public pot; // steam waiting; everything above pot + brewOwed in the balance is fresh fees
    uint256 public brewOwed; // brew the Safe did not take (never expected; retried every tick)
    uint256 public lastHour;
    bool public closed;

    event Ticked(uint256 indexed hour, uint256 brew, uint256 poured, uint256 pot);
    event Funded(address indexed from, uint256 amount);
    event PourRefused(uint256 indexed hour, uint256 amount);
    event Set(address stream, uint256 steamBps, uint256 dripBps);
    event Rescued(address to, uint256 amount);

    constructor(address safe_, IKettleStream stream_, uint256 steamBps_, uint256 dripBps_) Ownable(msg.sender) {
        require(safe_ != address(0), "Kettle: safe");
        safe = safe_;
        _set(stream_, steamBps_, dripBps_);
    }

    function set(IKettleStream stream_, uint256 steamBps_, uint256 dripBps_) external onlyOwner {
        _set(stream_, steamBps_, dripBps_);
    }

    function _set(IKettleStream stream_, uint256 steamBps_, uint256 dripBps_) internal {
        require(address(stream_).code.length > 0, "Kettle: stream");
        require(steamBps_ <= 10_000, "Kettle: steam");
        require(dripBps_ >= 100 && dripBps_ <= 10_000, "Kettle: drip");
        stream = stream_;
        steamBps = steamBps_;
        dripBps = dripBps_;
        emit Set(address(stream_), steamBps_, dripBps_);
    }

    /// @notice Mint fees (and any plain transfer): split at the next tick. No storage writes: the Mine's submit pays
    ///         the same gas as with a plain address.
    receive() external payable {
        require(!closed, "Kettle: closed");
    }

    /// @notice Steam only, no brew cut (a top-up from the Safe, e.g. if fees are routed through the Safe).
    function fund() external payable {
        require(!closed, "Kettle: closed");
        pot += msg.value;
        emit Funded(msg.sender, msg.value);
    }

    function tick() external nonReentrant whenNotPaused {
        require(!closed, "Kettle: closed");
        uint256 hour = block.timestamp / 1 hours;
        require(hour > lastHour, "Kettle: once an hour");
        require(gasleft() >= MIN_GAS, "Kettle: gas");
        lastHour = hour;
        uint256 fresh = address(this).balance - pot - brewOwed;
        uint256 steam = (fresh * steamBps) / 10_000;
        uint256 brew = fresh - steam + brewOwed;
        pot += steam;
        brewOwed = 0;
        uint256 sent;
        if (brew > 0) {
            (bool ok, ) = safe.call{value: brew}("");
            if (ok) sent = brew;
            else brewOwed = brew;
        }
        uint256 amount;
        if (pot >= MIN_POUR && _open()) {
            amount = _drip(pot);
            try stream.pour{value: amount}() {
                pot -= amount;
            } catch {
                emit PourRefused(hour, amount);
                amount = 0;
            }
        }
        emit Ticked(hour, sent, amount, pot);
    }

    /// @dev The hour's pour: dripBps of the pot, at least MIN_POUR, and the whole pot rather than a remainder below
    ///      MIN_POUR. A pot below MIN_POUR waits for more fees (or fund()), so no epoch ever carries dust.
    function _drip(uint256 p) internal view returns (uint256 amount) {
        amount = (p * dripBps) / 10_000;
        if (amount < MIN_POUR) amount = MIN_POUR;
        if (p - amount < MIN_POUR) amount = p;
    }

    /// @dev A low-level call, so a Stream that reverts or answers garbage counts as closed instead of blocking the tick
    ///      (and with it the Safe's brew).
    function _open() internal view returns (bool) {
        (bool ok, bytes memory ret) = address(stream).staticcall(abi.encodeWithSelector(IKettleStream.isOpen.selector));
        return ok && ret.length >= 32 && abi.decode(ret, (uint256)) == 1;
    }

    /// @notice What the next tick would send to the Safe and pour, for the site.
    function preview() external view returns (uint256 brew, uint256 pour, uint256 potAfter) {
        uint256 fresh = address(this).balance - pot - brewOwed;
        uint256 steam = (fresh * steamBps) / 10_000;
        brew = fresh - steam + brewOwed;
        uint256 p = pot + steam;
        if (p >= MIN_POUR && _open()) pour = _drip(p);
        potAfter = p - pour;
    }

    /// @notice Emergency exit: while paused, the owner (the timelock) returns everything to the Safe; closed for good.
    function rescue() external onlyOwner nonReentrant {
        require(paused, "Kettle: pause first");
        require(!closed, "Kettle: closed");
        closed = true;
        pot = 0;
        brewOwed = 0;
        uint256 amount = address(this).balance;
        (bool ok, ) = safe.call{value: amount}("");
        require(ok, "Kettle: rescue");
        emit Rescued(safe, amount);
    }
}
