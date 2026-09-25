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

/// @notice ENSv2 .eth registrar (commit-reveal, paid in a whitelisted ERC20).
interface IETHRegistrar {
    function MIN_COMMITMENT_AGE() external view returns (uint64);
    function isAvailable(string calldata label) external view returns (bool);
    function getRegisterPrice(string calldata label, uint64 duration, address paymentToken)
        external
        view
        returns (uint256 base, uint256 premium);
    function makeCommitment(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        bytes32 referrer
    ) external pure returns (bytes32);
    function commit(bytes32 commitment) external;
    function register(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        address paymentToken,
        bytes32 referrer
    ) external returns (uint256 tokenId);
}

interface IRegistryRead {
    function getSubregistry(string calldata label) external view returns (address);
}

interface IMintable {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
}
