// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";

/// @notice What marketplaces read about a collection as a whole. `contractURI` (ERC-7572) points at a JSON the site
///         serves: name, description, logo, banner, links and the collaborators who may edit the collection page, so
///         the page changes without a transaction; the owner (the timelock) can move the URI itself. ERC-2981 carries
///         the creator earnings on secondary sales (5 % to the Safe at launch), changeable only by the owner.
abstract contract CollectionMeta is Ownable, ERC2981 {
    string public contractURI;

    event ContractURIUpdated();

    function setContractURI(string calldata u) external onlyOwner {
        contractURI = u;
        emit ContractURIUpdated();
    }

    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        _setDefaultRoyalty(receiver, bps);
    }
}
