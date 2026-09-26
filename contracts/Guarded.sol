// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Ownable plus an emergency brake. The guardian (the Safe) can only pause user entry points; setting the
///         guardian and unpausing belong to the governor: the owner (the Safe) on the game contracts, the admin (also
///         the Safe) on the NFT collections, whose owner is only their marketplace face (CollectionMeta).
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

    modifier onlyGovernor() {
        if (!_isGovernor(msg.sender)) revert OwnableUnauthorizedAccount(msg.sender);
        _;
    }

    function _isGovernor(address a) internal view virtual returns (bool) {
        return a == owner();
    }

    function setGuardian(address g) external onlyGovernor {
        guardian = g;
        emit GuardianSet(g);
    }

    function pause() external {
        require(msg.sender == guardian || _isGovernor(msg.sender), "Guarded: not guardian");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyGovernor {
        paused = false;
        emit Unpaused(msg.sender);
    }
}
