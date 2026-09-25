// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice The two ENSv2 PermissionedRegistry reads Leash needs.
/// Declared locally: contracts-v2 builds on solc 0.8.25 and cannot share a compile with swap-vm.
interface IEAC {
    /// @dev Accepts stale token ids; the registry resolves the current version.
    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool);

    /// @dev Token ids change after grant/revoke. Call this every time, never cache.
    function findTokenId(string calldata label) external view returns (uint256);
}
