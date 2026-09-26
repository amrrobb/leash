// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { Vault } from "./Vault.sol";
import { IEAC } from "./interfaces/IEAC.sol";
import { IUserRegistry } from "./interfaces/IENSv2.sol";

/// @title VaultFactory
/// @notice Anyone with a wallet gets their own Vault in one transaction: the Vault is deployed with the
/// caller as owner, `<label>.leash.eth` is registered to the caller (with the admin bits so only they can
/// revoke or restore), and the chosen agent receives the MANDATE role. Needs root REGISTRAR and
/// MANDATE-admin on the registry; the backend keeps tier-admin and is the only caller of verify().
contract VaultFactory {
    uint256 public constant ROLE_MANDATE = 1 << 40;
    uint256 public constant TIERS = (1 << 44) | (1 << 48) | (1 << 52);

    IAqua public immutable aqua;
    IUserRegistry public immutable registry;
    address public immutable backend;
    address public immutable capToken;
    uint256 public immutable speed;
    uint64 public immutable nameDuration;

    mapping(address owner => address vault) public vaultOf;
    mapping(address vault => bool) public isVault;
    address[] public vaults;

    event VaultCreated(address indexed owner, address indexed vault, address indexed agent, string label);

    error AlreadyHasVault(address owner, address vault);
    error EmptyLabel();
    error ZeroAgent();

    constructor(IAqua aqua_, IUserRegistry registry_, address backend_, address capToken_, uint256 speed_, uint64 nameDuration_) {
        aqua = aqua_;
        registry = registry_;
        backend = backend_;
        capToken = capToken_;
        speed = speed_;
        nameDuration = nameDuration_;
    }

    /// @param agent the address that will run the position (holds MANDATE on the new name)
    /// @param label the ENS label under leash.eth for this mandate, e.g. "alice-agent"
    function createVault(address agent, string calldata label) external returns (address vault) {
        require(agent != address(0), ZeroAgent());
        require(bytes(label).length != 0, EmptyLabel());
        require(vaultOf[msg.sender] == address(0), AlreadyHasVault(msg.sender, vaultOf[msg.sender]));

        vault = address(new Vault(msg.sender, agent, backend, aqua, IEAC(address(registry)), capToken, label, speed));
        vaultOf[msg.sender] = vault;
        isVault[vault] = true;
        vaults.push(vault);

        // The name belongs to the caller; the admin bits let them grant and revoke MANDATE and tiers.
        registry.register(label, msg.sender, address(0), address(0), (ROLE_MANDATE | TIERS) << 128, uint64(block.timestamp) + nameDuration);
        registry.grantRoles(uint256(keccak256(bytes(label))), ROLE_MANDATE, agent);

        emit VaultCreated(msg.sender, vault, agent, label);
    }

    function count() external view returns (uint256) {
        return vaults.length;
    }
}
