// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IUserRegistry, IVerifiableFactory, Grant } from "../../src/interfaces/IENSv2.sol";
import { SepoliaENS } from "./SepoliaENS.sol";

/// Pins down how authority flows through a real ENSv2 UserRegistry on a Sepolia fork,
/// before the Vault relies on it.
contract ENSAuthorityForkTest is Test {
    uint256 constant ROLE_REGISTRAR = 1 << 0;
    uint256 constant ROLE_RENEW = 1 << 16;
    uint256 constant ROLE_MANDATE = 1 << 40;
    uint256 constant ROLE_ORB = 1 << 44;
    uint256 constant ROLE_DOCUMENT = 1 << 48;
    uint256 constant ROLE_SELFIE = 1 << 52;
    uint256 constant TIERS = ROLE_ORB | ROLE_DOCUMENT | ROLE_SELFIE;

    address alice = makeAddr("leash.alice");
    address agent = makeAddr("leash.agent");
    address backend = makeAddr("leash.backend");

    IUserRegistry reg;
    uint256 labelId = uint256(keccak256("agent"));

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc, 11_781_047);

        // Alice's own registry: root admin over registration and the Leash role nybbles.
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(alice, ROLE_REGISTRAR | ROLE_RENEW | ((ROLE_REGISTRAR | ROLE_RENEW | ROLE_MANDATE | TIERS) << 128));
        vm.prank(alice);
        reg = IUserRegistry(
            IVerifiableFactory(SepoliaENS.VERIFIABLE_FACTORY).deployProxy(
                SepoliaENS.USER_REGISTRY_IMPL, uint256(keccak256("leash-test")), abi.encodeCall(IUserRegistry.initialize, (grants))
            )
        );

        vm.startPrank(alice);
        reg.register("agent", alice, address(0), address(0), 0, uint64(block.timestamp + 365 days));
        reg.grantRoles(labelId, ROLE_MANDATE, agent);
        reg.grantRootRoles(TIERS << 128, backend); // backend may set tiers, never the mandate
        vm.stopPrank();
    }

    function test_aliceOwnsNameAgentHoldsMandate() public view {
        assertEq(reg.ownerOf(reg.findTokenId("agent")), alice);
        assertTrue(reg.hasRoles(labelId, ROLE_MANDATE, agent));
    }

    function test_backendGrantsTierOnly() public {
        vm.startPrank(backend);
        reg.grantRoles(labelId, ROLE_SELFIE, agent);
        vm.expectRevert();
        reg.grantRoles(labelId, ROLE_MANDATE, agent);
        vm.stopPrank();
        assertTrue(reg.hasRoles(labelId, ROLE_MANDATE | ROLE_SELFIE, agent));
    }

    function test_backendStillGrantsAfterIdChanges() public {
        uint256 before = reg.findTokenId("agent");
        vm.prank(alice);
        reg.revokeRoles(labelId, ROLE_MANDATE, agent);
        assertTrue(reg.findTokenId("agent") != before, "token id regenerates on revoke");
        uint256 fresh = reg.findTokenId("agent");
        vm.prank(backend);
        reg.grantRoles(fresh, ROLE_ORB, agent);
        assertTrue(reg.hasRoles(before, ROLE_ORB, agent), "stale id still resolves");
    }

    function test_rolesReadsTokenBitmapFromLabelHash() public {
        vm.prank(backend);
        reg.grantRoles(labelId, ROLE_DOCUMENT, agent);
        assertEq(reg.roles(labelId, agent), ROLE_MANDATE | ROLE_DOCUMENT);
        assertEq(reg.roles(reg.findTokenId("agent"), agent), ROLE_MANDATE | ROLE_DOCUMENT);
        assertEq(reg.roles(labelId, backend), 0, "root roles are not in token roles()");
    }

    function test_aliceRevokesMandate() public {
        vm.prank(alice);
        reg.revokeRoles(labelId, ROLE_MANDATE, agent);
        assertFalse(reg.hasRoles(labelId, ROLE_MANDATE, agent));
    }

    function test_agentCannotEscalate() public {
        vm.prank(agent);
        vm.expectRevert();
        reg.grantRoles(labelId, ROLE_ORB, agent);
    }

    function test_agentCannotTakeName() public {
        uint256 id = reg.findTokenId("agent");
        vm.prank(agent);
        vm.expectRevert();
        reg.safeTransferFrom(alice, agent, id, 1, "");
    }

    function test_expiryKillsRoles() public {
        vm.warp(block.timestamp + 366 days);
        assertFalse(reg.hasRoles(labelId, ROLE_MANDATE, agent));
        assertEq(reg.roles(labelId, agent), 0);
    }

    /// Each read measured cold in its own test (a swap pays cold access once per tx).
    function test_gas_roles() public {
        uint256 g = gasleft();
        reg.roles(labelId, agent);
        emit log_named_uint("gas roles() cold", g - gasleft());
    }

    function test_gas_hasRoles() public {
        uint256 g = gasleft();
        reg.hasRoles(labelId, ROLE_MANDATE, agent);
        emit log_named_uint("gas hasRoles() cold", g - gasleft());
    }

    function test_gas_findTokenId() public {
        uint256 g = gasleft();
        reg.findTokenId("agent");
        emit log_named_uint("gas findTokenId() cold", g - gasleft());
    }
}
