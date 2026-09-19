// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Ownable plus an emergency brake. The owner is meant to be a TimelockController (proposer = Safe),
///         so every parameter change is visible before it lands. The guardian (the Safe itself, no delay)
///         can only pause user entry points; unpausing goes through the owner, i.e. the timelock.
abstract contract Guarded is Ownable {
    address public guardian;
    bool public paused;

    event GuardianSet(address guardian);
    event Paused(address by);
    event Unpaused(address by);

    modifier whenNotPaused() {
        require(!paused, "Guarded: paused");
        _;
    }

    function setGuardian(address g) external onlyOwner {
        guardian = g;
        emit GuardianSet(g);
    }

    function pause() external {
        require(msg.sender == guardian || msg.sender == owner(), "Guarded: not guardian");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }
}
