// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ENSForkBase } from "./ENSForkBase.sol";

/// Pins down how authority flows through a real ENSv2 UserRegistry before the Vault relies on it.
contract ENSAuthorityForkTest is ENSForkBase {
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
