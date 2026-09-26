// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { VaultFactory } from "../src/VaultFactory.sol";
import { IUserRegistry } from "../src/interfaces/IENSv2.sol";

/// Deploys the VaultFactory against an existing registry/Aqua/USDC and, as the registry's root admin,
/// grants it root REGISTRAR + MANDATE-admin so createVault can register names and hand out mandates.
/// env: ADMIN_KEY (registry root admin: Alice/deployer), USER_REGISTRY, AQUA, USDC, BACKEND, [SPEED=1440],
///      [NAME_DURATION=365 days], [OUT] (JSON with the factory address)
contract DeployFactory is Script {
    uint256 constant ROLE_REGISTRAR = 1 << 0;
    uint256 constant ROLE_MANDATE = 1 << 40;

    function run() external {
        uint256 adminKey = vm.envUint("ADMIN_KEY");
        IUserRegistry reg = IUserRegistry(vm.envAddress("USER_REGISTRY"));
        vm.startBroadcast(adminKey);
        VaultFactory factory = new VaultFactory(
            IAqua(vm.envAddress("AQUA")),
            reg,
            vm.envAddress("BACKEND"),
            vm.envAddress("USDC"),
            vm.envOr("SPEED", uint256(1_440)),
            uint64(vm.envOr("NAME_DURATION", uint256(365 days)))
        );
        reg.grantRootRoles(ROLE_REGISTRAR | (ROLE_MANDATE << 128), address(factory));
        vm.stopBroadcast();

        string memory out = vm.envOr("OUT", string(""));
        if (bytes(out).length > 0) {
            string memory j = "factory";
            vm.serializeUint(j, "factoryBlock", block.number);
            vm.writeJson(vm.serializeAddress(j, "factory", address(factory)), out);
        }
        console.log("FACTORY", address(factory));
    }
}
