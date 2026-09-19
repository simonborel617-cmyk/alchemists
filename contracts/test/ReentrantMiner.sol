// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

interface IMine {
    function submit(uint64 forMinute, uint256 nonce) external payable;
    function reveal(address miner) external;
}

/// @dev Test-only attacker: a contract miner whose ERC-1155 receive hook re-enters Mine.reveal.
contract ReentrantMiner is ERC165, IERC1155Receiver {
    IMine public immutable mine;
    uint256 public hookCalls;
    uint256 public reentryFailures;
    bool public reenter = true;

    constructor(IMine m) {
        mine = m;
    }

    receive() external payable {}

    function attackSubmit(uint64 forMinute, uint256 nonce) external payable {
        mine.submit{value: msg.value}(forMinute, nonce);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external override returns (bytes4) {
        hookCalls++;
        if (reenter) {
            reenter = false; // one attempt per settle; the guard must stop it regardless
            try mine.reveal(address(this)) {} catch {
                reentryFailures++;
            }
            reenter = true;
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure override returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || super.supportsInterface(interfaceId);
    }
}

/// @dev Test-only treasury that refuses plain ETH.
contract RejectingTreasury {
    fallback() external payable {
        revert("no");
    }
}
