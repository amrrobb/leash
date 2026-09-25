// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IETHRegistrar, IRegistryRead, IMintable } from "../../src/interfaces/IENSv2.sol";
import { IEAC as IUserRegistryRoles } from "../../src/interfaces/IEAC.sol";
import { ENSForkBase } from "./ENSForkBase.sol";
import { SepoliaENS } from "./SepoliaENS.sol";

/// leash.eth registered through the real ENSv2 registrar, with Alice's UserRegistry as its
/// subregistry, so agent.leash.eth is discoverable from the ETH registry with no hardcoded address.
contract EthNameForkTest is ENSForkBase {
    IETHRegistrar registrar = IETHRegistrar(SepoliaENS.ETH_REGISTRAR);
    uint64 constant DURATION = 365 days;

    function test_registerLeashEth_pointsAtAliceRegistry() public {
        assertTrue(registrar.isAvailable("leash"));
        bytes32 secret = keccak256("leash-secret");
        bytes32 c = registrar.makeCommitment("leash", alice, secret, address(reg), address(0), DURATION, bytes32(0));

        (uint256 base, uint256 premium) = registrar.getRegisterPrice("leash", DURATION, SepoliaENS.MOCK_USDC);
        emit log_named_uint("price leash.eth / 1y (MockUSDC)", base + premium);

        vm.startPrank(alice);
        IMintable(SepoliaENS.MOCK_USDC).mint(alice, base + premium);
        IMintable(SepoliaENS.MOCK_USDC).approve(address(registrar), base + premium);
        registrar.commit(c);
        vm.warp(block.timestamp + registrar.MIN_COMMITMENT_AGE() + 1);
        registrar.register("leash", alice, secret, address(reg), address(0), DURATION, SepoliaENS.MOCK_USDC, bytes32(0));
        vm.stopPrank();

        IRegistryRead eth = IRegistryRead(SepoliaENS.ETH_REGISTRY);
        address sub = eth.getSubregistry("leash");
        assertEq(sub, address(reg));
        // agent.leash.eth's authority, found purely by walking from the ETH registry.
        assertTrue(IUserRegistryRoles(sub).hasRoles(uint256(keccak256("agent")), ROLE_MANDATE, agent));
    }
}
