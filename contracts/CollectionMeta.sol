// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";

/// @notice What marketplaces read about a collection as a whole, and who may change what. Two roles (owner's decision
///         2026-09-26):
///         - the owner (Ownable) is the collection's face. Marketplaces hand the collection page to owner() (OpenSea
///           Studio), so it is a plain wallet that can sign in. On chain it may only move contractURI (ERC-7572), whose
///           event makes marketplaces re-read the collection JSON the site serves.
///         - the admin (the Safe) holds everything that touches tokens, money or rules: minters, the workshop, the
///           summoner, metadata URIs, royalties (ERC-2981, 5 % to the Safe at launch) and the pause. It can also take
///           the owner role back (reassignOwner), for a lost or leaked owner key.
///         The deployer is both until the deploy script hands the admin role to the Safe.
abstract contract CollectionMeta is Ownable, ERC2981 {
    string public contractURI;
    address public admin;

    event ContractURIUpdated();
    event AdminSet(address admin);

    error NotAdmin(address account);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin(msg.sender);
        _;
    }

    constructor() {
        admin = msg.sender;
        emit AdminSet(msg.sender);
    }

    function setContractURI(string calldata u) external onlyOwner {
        contractURI = u;
        emit ContractURIUpdated();
    }

    function setDefaultRoyalty(address receiver, uint96 bps) external onlyAdmin {
        _setDefaultRoyalty(receiver, bps);
    }

    function setAdmin(address a) external onlyAdmin {
        require(a != address(0), "CollectionMeta: admin");
        admin = a;
        emit AdminSet(a);
    }

    /// @notice The admin's way back to the collection page: moves the owner role to `o`.
    function reassignOwner(address o) external onlyAdmin {
        require(o != address(0), "CollectionMeta: owner");
        _transferOwnership(o);
    }
}
