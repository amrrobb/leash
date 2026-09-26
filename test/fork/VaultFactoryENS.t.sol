// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { Vault } from "../../src/Vault.sol";
import { VaultFactory } from "../../src/VaultFactory.sol";
import { TestToken } from "../mocks/TestToken.sol";
import { ENSForkBase } from "./ENSForkBase.sol";

/// Any wallet gets its own Vault + name + agent mandate in one call, on a real ENSv2 UserRegistry.
contract VaultFactoryENSForkTest is ENSForkBase {
    address bob = makeAddr("leash.bob");
    address bobAgent = makeAddr("leash.bob-agent");
    address carol = makeAddr("leash.carol");

    VaultFactory factory;
    TestToken usdc;

    function setUp() public override {
        super.setUp();
        usdc = new TestToken("USDC");
        factory = new VaultFactory(IAqua(address(new Aqua())), reg, backend, address(usdc), 1_440, 365 days);
        // Alice (registry root admin) lets the factory register names and hand out MANDATE. Nothing else.
        vm.prank(alice);
        reg.grantRootRoles(ROLE_REGISTRAR | (ROLE_MANDATE << 128), address(factory));
    }

    function test_createVault_oneTx() public {
        vm.prank(bob);
        address v = factory.createVault(bobAgent, "bob-agent");
        Vault vault = Vault(v);
        uint256 id = uint256(keccak256("bob-agent"));

        assertEq(vault.owner(), bob);
        assertEq(vault.agent(), bobAgent);
        assertEq(vault.backend(), backend);
        assertEq(vault.labelId(), id);
        assertEq(factory.vaultOf(bob), v);
        assertTrue(factory.isVault(v));
        assertEq(reg.ownerOf(reg.findTokenId("bob-agent")), bob, "the name belongs to Bob");
        assertTrue(reg.hasRoles(id, ROLE_MANDATE, bobAgent), "agent holds MANDATE");
        (bool alive, uint256 cap,) = vault.mandate();
        assertTrue(alive);
        assertEq(cap, 0, "nothing until Bob sets a cap and verifies");
    }

    function test_ownerRevokesAndRestores_backendSetsTiers() public {
        vm.prank(bob);
        Vault vault = Vault(factory.createVault(bobAgent, "bob-agent"));
        uint256 id = uint256(keccak256("bob-agent"));

        vm.prank(backend);
        reg.grantRoles(id, ROLE_SELFIE, bobAgent); // after a World proof
        vm.prank(backend);
        vault.verify();
        vm.prank(bob);
        vault.setCap(type(uint256).max);
        assertEq(vault.capNow(), 2_000e6);

        vm.prank(bob);
        reg.revokeRoles(id, ROLE_MANDATE, bobAgent);
        assertEq(vault.capNow(), 0);
        vm.prank(bob);
        reg.grantRoles(id, ROLE_MANDATE, bobAgent);
        assertEq(vault.capNow(), 2_000e6);
    }

    function test_strangersCannotTouchBobsName() public {
        vm.prank(bob);
        factory.createVault(bobAgent, "bob-agent");
        uint256 id = uint256(keccak256("bob-agent"));
        vm.prank(carol);
        vm.expectRevert();
        reg.revokeRoles(id, ROLE_MANDATE, bobAgent);
        vm.prank(bobAgent);
        vm.expectRevert();
        reg.grantRoles(id, ROLE_ORB, bobAgent);
        vm.prank(backend);
        vm.expectRevert();
        reg.grantRoles(id, ROLE_MANDATE, carol); // backend can never hand out MANDATE
    }

    function test_guards() public {
        vm.prank(bob);
        address existing = factory.createVault(bobAgent, "bob-agent");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(VaultFactory.AlreadyHasVault.selector, bob, existing));
        factory.createVault(bobAgent, "bob-second");
        vm.prank(carol);
        vm.expectRevert(); // LabelAlreadyRegistered
        factory.createVault(bobAgent, "bob-agent");
        vm.prank(carol);
        vm.expectRevert(VaultFactory.ZeroAgent.selector);
        factory.createVault(address(0), "carol-agent");
        vm.prank(carol);
        vm.expectRevert(VaultFactory.EmptyLabel.selector);
        factory.createVault(bobAgent, "");
    }

    function test_twoUsersTwoVaults() public {
        vm.prank(bob);
        address vb = factory.createVault(bobAgent, "bob-agent");
        vm.prank(carol);
        address vc = factory.createVault(bobAgent, "carol-agent");
        assertTrue(vb != vc);
        assertEq(factory.count(), 2);
        assertEq(Vault(vc).owner(), carol);
    }
}
