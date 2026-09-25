// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IEAC } from "../../src/interfaces/IEAC.sol";

/// @notice One-name stand-in for an ENSv2 PermissionedRegistry, modelled on its source:
/// token id = keccak256(label) with the low 32 bits replaced by a version that bumps on every
/// grant/revoke (_regenerate), and role reads accept any version of the id (getResource).
contract MockEAC is IEAC {
    uint256 public immutable labelId;
    uint32 public version;
    mapping(address account => uint256 roles) internal _roles;

    constructor(string memory label) {
        labelId = uint256(keccak256(bytes(label)));
    }

    function grantRoles(uint256 roleBitmap, address account) external {
        _roles[account] |= roleBitmap;
        version++;
    }

    function revokeRoles(uint256 roleBitmap, address account) external {
        _roles[account] &= ~roleBitmap;
        version++;
    }

    function hasRoles(uint256 anyId, uint256 roleBitmap, address account) external view returns (bool) {
        _check(anyId);
        return _roles[account] & roleBitmap == roleBitmap;
    }

    function roles(uint256 anyId, address account) external view returns (uint256) {
        _check(anyId);
        return _roles[account];
    }

    function findTokenId(string calldata label) external view returns (uint256) {
        require(uint256(keccak256(bytes(label))) == labelId, "unknown label");
        return _withVersion(labelId, version);
    }

    function _check(uint256 anyId) internal view {
        require(_withVersion(anyId, 0) == _withVersion(labelId, 0), "unknown token id");
    }

    function _withVersion(uint256 anyId, uint32 v) internal pure returns (uint256) {
        return anyId ^ uint32(anyId) ^ v;
    }
}
