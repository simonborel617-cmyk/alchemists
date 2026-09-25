// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test double for the stream's holder collection: ids 1..total, a fixed weight per id, one owner.
contract MockWeighted {
    mapping(uint256 => uint256) public w;
    mapping(uint256 => address) public own;
    uint256 public total;
    uint256 public totalWeight;

    function mint(address to, uint256 n, uint256 weight_) external {
        for (uint256 i = 0; i < n; i++) {
            total += 1;
            w[total] = weight_;
            own[total] = to;
            totalWeight += weight_;
        }
    }

    function weight(uint256 id) external view returns (uint256) { return w[id]; }
    function ownerOf(uint256 id) external view returns (address) { return own[id]; }
}
