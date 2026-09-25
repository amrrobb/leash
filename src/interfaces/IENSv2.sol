// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IEAC } from "./IEAC.sol";

struct Grant {
    address account;
    uint256 roleBitmap;
}

/// @notice Subset of ENSv2 UserRegistry (PermissionedRegistry + initializer) used by scripts and fork tests.
interface IUserRegistry is IEAC {
    function initialize(Grant[] calldata grants) external;

    function register(
        string calldata label,
        address owner,
        address registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);

    function grantRoles(uint256 anyId, uint256 roleBitmap, address account) external returns (bool);
    function revokeRoles(uint256 anyId, uint256 roleBitmap, address account) external returns (bool);
    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);
    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool);
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
}

interface IVerifiableFactory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data) external returns (address);
}
