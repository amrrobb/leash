// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { Vault } from "../../src/Vault.sol";
import { IEAC } from "../../src/interfaces/IEAC.sol";
import { TestToken } from "../mocks/TestToken.sol";
import { ENSForkBase } from "./ENSForkBase.sol";

/// The Vault reading a real ENSv2 UserRegistry on a Sepolia fork.
contract VaultENSForkTest is ENSForkBase {
    address app = makeAddr("leash.router");
    Aqua aqua;
    Vault vault;
    TestToken usdc;
    TestToken hype;

    function setUp() public override {
        super.setUp();
        aqua = new Aqua();
        usdc = new TestToken("USDC");
        hype = new TestToken("HYPE");
        vault = new Vault(alice, agent, backend, IAqua(address(aqua)), IEAC(address(reg)), address(usdc), "agent", 1);
        usdc.mint(address(vault), 10_000e6);
        hype.mint(address(vault), 1_000e18);

        vm.prank(alice);
        vault.setCap(type(uint256).max);
        // What the backend does after a World selfie verification: two transactions.
        vm.startPrank(backend);
        reg.grantRoles(labelId, ROLE_SELFIE, agent);
        vault.verify();
        vm.stopPrank();
    }

    function _ship(bytes memory salt) internal returns (bytes32) {
        address[] memory t = new address[](2);
        uint256[] memory a = new uint256[](2);
        (t[0], t[1]) = (address(usdc), address(hype));
        (a[0], a[1]) = (1_000e6, 100e18);
        vm.prank(agent);
        return vault.ship(app, salt, t, a);
    }

    function test_ship_withRealRegistry() public {
        uint256 g = gasleft();
        _ship("s1");
        emit log_named_uint("gas ship (real ENS)", g - gasleft());
    }

    function test_capNow_gasRealRegistry() public {
        uint256 g = gasleft();
        uint256 cap = vault.capNow();
        emit log_named_uint("gas capNow cold (real ENS)", g - gasleft());
        assertEq(cap, 2_000e6);
    }

    function test_aliceRevoke_blocksShip_dockStillWorks() public {
        bytes32 h = _ship("s1");
        vm.prank(alice);
        reg.revokeRoles(labelId, ROLE_MANDATE, agent);
        assertEq(vault.capNow(), 0);

        vm.expectRevert(Vault.NoMandate.selector);
        _ship("s2");

        vm.prank(agent);
        vault.dock(h);
    }

    function test_backendUpgradesTier() public {
        vm.prank(backend);
        reg.grantRoles(labelId, ROLE_ORB, agent);
        assertEq(vault.capNow(), 15_000e6);
    }

    function test_backendRemovesTier_capZero() public {
        vm.prank(backend);
        reg.revokeRoles(labelId, ROLE_SELFIE, agent);
        assertEq(vault.capNow(), 0);
        vm.expectRevert(Vault.MandateEmpty.selector);
        _ship("s1");
    }

    function test_nameExpiry_capZero_dockStillWorks() public {
        bytes32 h = _ship("s1");
        vm.warp(block.timestamp + 366 days);
        vm.prank(backend);
        vault.verify(); // even a fresh verification cannot revive an expired name
        assertEq(vault.capNow(), 0);
        vm.prank(agent);
        vault.dock(h);
    }
}
