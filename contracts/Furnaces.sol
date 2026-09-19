// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Multi-use furnaces. Tier 1..4 = clay / iron / brass / athanor; a tier-t furnace refines up to tier t+1.
contract Furnaces is ERC721, Ownable {
    address public workshop;
    uint256 public nextId = 1;
    mapping(uint256 => uint8) public tier;
    mapping(uint256 => uint64) public lastFired;
    string public baseURI;

    modifier onlyWorkshop() {
        require(msg.sender == workshop, "Furnaces: not workshop");
        _;
    }

    constructor() ERC721("Alchemists Furnace", "FURNACE") Ownable(msg.sender) {}

    function setWorkshop(address w) external onlyOwner {
        workshop = w;
    }

    function setBaseURI(string calldata u) external onlyOwner {
        baseURI = u;
    }

    function mint(address to, uint8 t) external onlyWorkshop returns (uint256 id) {
        require(t >= 1 && t <= 4, "Furnaces: tier");
        id = nextId++;
        tier[id] = t;
        _mint(to, id);
    }

    function fire(uint256 id, uint64 cooldown) external onlyWorkshop {
        require(block.timestamp >= uint256(lastFired[id]) + cooldown, "Furnaces: cooling");
        lastFired[id] = uint64(block.timestamp);
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }
}
