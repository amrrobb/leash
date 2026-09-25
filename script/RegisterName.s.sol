// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { IETHRegistrar, IRegistryRead, IMintable } from "../src/interfaces/IENSv2.sol";
import { SepoliaENS } from "../test/fork/SepoliaENS.sol";

/// Registers <NAME>.eth to Alice with her UserRegistry as subregistry, via ENSv2 commit-reveal.
/// Run twice, at least MIN_COMMITMENT_AGE (60s) apart:
///   STEP=commit   forge script script/RegisterName.s.sol --broadcast ...
///   STEP=register forge script script/RegisterName.s.sol --broadcast ...
/// env: ALICE_KEY, USER_REGISTRY, STEP, [NAME=leash]
contract RegisterName is Script {
    uint64 constant DURATION = 365 days;

    function run() external {
        uint256 aliceKey = vm.envUint("ALICE_KEY");
        address alice = vm.addr(aliceKey);
        address sub = vm.envAddress("USER_REGISTRY");
        string memory name = vm.envOr("NAME", string("leash"));
        bytes32 step = keccak256(bytes(vm.envString("STEP")));
        bytes32 secret = keccak256(abi.encode("leash-commit", alice, name));
        IETHRegistrar registrar = IETHRegistrar(SepoliaENS.ETH_REGISTRAR);

        vm.startBroadcast(aliceKey);
        if (step == keccak256("commit")) {
            require(registrar.isAvailable(name), "name taken");
            registrar.commit(registrar.makeCommitment(name, alice, secret, sub, address(0), DURATION, bytes32(0)));
            console.log("committed; wait 60s then STEP=register");
        } else if (step == keccak256("register")) {
            (uint256 base, uint256 premium) = registrar.getRegisterPrice(name, DURATION, SepoliaENS.MOCK_USDC);
            IMintable(SepoliaENS.MOCK_USDC).mint(alice, base + premium);
            IMintable(SepoliaENS.MOCK_USDC).approve(address(registrar), base + premium);
            registrar.register(name, alice, secret, sub, address(0), DURATION, SepoliaENS.MOCK_USDC, bytes32(0));
            console.log("subregistry", IRegistryRead(SepoliaENS.ETH_REGISTRY).getSubregistry(name));
        } else {
            revert("STEP must be commit or register");
        }
        vm.stopBroadcast();
    }
}
