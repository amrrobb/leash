// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { Vault } from "../src/Vault.sol";
import { DemoToken } from "../src/DemoToken.sol";
import { IEAC } from "../src/interfaces/IEAC.sol";
import { IUserRegistry, IVerifiableFactory, Grant } from "../src/interfaces/IENSv2.sol";
import { SepoliaENS } from "../test/fork/SepoliaENS.sol";

/// Deploys Alice's ENSv2 UserRegistry, registers `agent` to her, grants the mandate to the agent and
/// tier-admin to the backend, then deploys Aqua and the Vault.
/// env: ALICE_KEY, AGENT, BACKEND, [SPEED=1440], [AQUA] (reuse an existing Aqua), [USDC], [ROUTER], [SALT], [OUT] (write addresses as JSON)
contract DeployLeash is Script {
    uint256 constant ROLE_REGISTRAR = 1 << 0;
    uint256 constant ROLE_RENEW = 1 << 16;
    uint256 constant ROLE_MANDATE = 1 << 40;
    uint256 constant TIERS = (1 << 44) | (1 << 48) | (1 << 52);

    function run() external {
        uint256 aliceKey = vm.envUint("ALICE_KEY");
        address alice = vm.addr(aliceKey);
        address agent = vm.envAddress("AGENT");
        address backend = vm.envAddress("BACKEND");
        uint256 speed = vm.envOr("SPEED", uint256(1_440));
        uint256 salt = vm.envOr("SALT", uint256(keccak256(abi.encode("leash", alice))));

        vm.startBroadcast(aliceKey);

        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(alice, ROLE_REGISTRAR | ROLE_RENEW | ((ROLE_REGISTRAR | ROLE_RENEW | ROLE_MANDATE | TIERS) << 128));
        IUserRegistry reg = IUserRegistry(
            IVerifiableFactory(SepoliaENS.VERIFIABLE_FACTORY).deployProxy(
                SepoliaENS.USER_REGISTRY_IMPL, salt, abi.encodeCall(IUserRegistry.initialize, (grants))
            )
        );
        uint256 labelId = uint256(keccak256("agent"));
        reg.register("agent", alice, address(0), address(0), 0, uint64(block.timestamp + 365 days));
        reg.grantRoles(labelId, ROLE_MANDATE, agent);
        reg.grantRootRoles(TIERS << 128, backend);

        address aqua = vm.envOr("AQUA", address(0));
        if (aqua == address(0)) aqua = address(new Aqua());
        address usdc = vm.envOr("USDC", address(0));
        address hype;
        if (usdc == address(0)) {
            usdc = address(new DemoToken("Leash Demo USD", "USDC", 6));
            hype = address(new DemoToken("Leash Demo HYPE", "HYPE", 18));
        }
        // The router is deployed by script/deploy.sh with `forge create`: creating it inside a forge
        // script breaks forge's constructor-argument decoding for this via-IR contract.
        address router = vm.envOr("ROUTER", address(0));
        Vault vault = new Vault(alice, agent, backend, IAqua(aqua), IEAC(address(reg)), usdc, "agent", speed);

        vm.stopBroadcast();

        string memory out = vm.envOr("OUT", string(""));
        if (bytes(out).length > 0) {
            string memory j = "deployment";
            vm.serializeUint(j, "chainId", block.chainid);
            vm.serializeUint(j, "deployBlock", block.number);
            vm.serializeString(j, "agentLabel", "agent");
            vm.serializeAddress(j, "alice", alice);
            vm.serializeAddress(j, "agent", agent);
            vm.serializeAddress(j, "backend", backend);
            vm.serializeAddress(j, "userRegistry", address(reg));
            vm.serializeAddress(j, "aqua", aqua);
            vm.serializeAddress(j, "router", router);
            vm.serializeAddress(j, "usdc", usdc);
            vm.serializeAddress(j, "hype", hype);
            vm.serializeUint(j, "speed", speed);
            vm.writeJson(vm.serializeAddress(j, "vault", address(vault)), out);
        }

        console.log("USER_REGISTRY", address(reg));
        console.log("AQUA", aqua);
        console.log("ROUTER", router);
        console.log("USDC", usdc);
        console.log("HYPE", hype);
        console.log("VAULT", address(vault));
        console.log("SPEED", speed);
    }
}
