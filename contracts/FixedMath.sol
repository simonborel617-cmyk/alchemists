// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Q8 fixed-point helpers (value * 256) for fractional-bit thresholds.
library FixedMath {
    /// @dev floor(log2(x) * 256), x >= 1.
    function log2Q8(uint256 x) internal pure returns (uint256) {
        require(x > 0, "log2(0)");
        uint256 n = Math.log2(x);
        uint256 m = n >= 127 ? x >> (n - 127) : x << (127 - n); // mantissa in [2^127, 2^128)
        uint256 frac;
        for (uint256 i = 0; i < 8; i++) {
            m = (m * m) >> 127;
            frac <<= 1;
            if (m >= (1 << 128)) {
                frac |= 1;
                m >>= 1;
            }
        }
        return (n << 8) | frac;
    }

    /// @dev 2^(xQ8 / 256) as Q64. Requires xQ8 < 128 * 256.
    function exp2Q8(uint256 xQ8) internal pure returns (uint256) {
        require(xQ8 < 128 * 256, "exp2 range");
        uint256 r = uint256(1) << 64;
        uint256 f = xQ8 & 255;
        if (f & 128 != 0) r = (r * 26087635650665564425) >> 64;
        if (f & 64 != 0) r = (r * 21936999301089678047) >> 64;
        if (f & 32 != 0) r = (r * 20116317054877281742) >> 64;
        if (f & 16 != 0) r = (r * 19263451207323153962) >> 64;
        if (f & 8 != 0) r = (r * 18850675170876015534) >> 64;
        if (f & 4 != 0) r = (r * 18647615946650685159) >> 64;
        if (f & 2 != 0) r = (r * 18546908069882975960) >> 64;
        if (f & 1 != 0) r = (r * 18496758270674070881) >> 64;
        return r << (xQ8 >> 8);
    }

    /// @dev Leading-zero bits of a hash with 8 fractional bits: 256*256 - log2Q8(h).
    function workQ8(bytes32 h) internal pure returns (uint32) {
        uint256 x = uint256(h);
        if (x == 0) return 65535;
        return uint32(65536 - log2Q8(x));
    }
}
