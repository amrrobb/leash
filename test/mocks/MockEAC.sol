// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IEAC } from "../../src/interfaces/IEAC.sol";

/// @notice One-name stand-in for an ENSv2 PermissionedRegistry.
/// Mirrors the two behaviours Vault depends on: token ids change on every grant/revoke,
/// and hasRoles still accepts any id ever issued for the name.
contract MockEAC is IEAC {
    bytes32 public immutable labelHash;
    uint256 public version;
    mapping(address account => uint256 roles) public roles;
    mapping(uint256 id => bool) public issued;

    constructor(string memory label) {
        labelHash = keccak256(bytes(label));
        issued[_id()] = true;
    }

    function grantRoles(uint256 roleBitmap, address account) external {
        roles[account] |= roleBitmap;
        _bump();
    }

    function revokeRoles(uint256 roleBitmap, address account) external {
        roles[account] &= ~roleBitmap;
        _bump();
    }

    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool) {
        require(issued[resource], "unknown token id");
        return roles[account] & roleBitmap == roleBitmap;
    }

    function findTokenId(string calldata label) external view returns (uint256) {
        require(keccak256(bytes(label)) == labelHash, "unknown label");
        return _id();
    }

    function _id() internal view returns (uint256) {
        return (uint256(labelHash) << 32) | version;
    }

    function _bump() internal {
        version++;
        issued[_id()] = true;
    }
}
