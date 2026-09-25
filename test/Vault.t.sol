// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { Vault } from "../src/Vault.sol";
import { IEAC } from "../src/interfaces/IEAC.sol";
import { MockEAC } from "./mocks/MockEAC.sol";
import { TestToken } from "./mocks/TestToken.sol";

contract VaultTest is Test {
    address owner = makeAddr("alice");
    address agent = makeAddr("agent");
    address backend = makeAddr("backend");
    address app = makeAddr("router");

    Aqua aqua;
    MockEAC ens;
    Vault vault;
    TestToken usdc;
    TestToken hype;

    function setUp() public {
        aqua = new Aqua();
        ens = new MockEAC("agent");
        usdc = new TestToken("USDC");
        vault = _deploy(1);
        hype = new TestToken("HYPE");
        usdc.mint(address(vault), 10_000e6);
        hype.mint(address(vault), 1_000e18);

        ens.grantRoles(vault.ROLE_MANDATE() | vault.ROLE_SELFIE(), agent);
        vm.prank(owner);
        vault.setCap(type(uint256).max);
        vm.prank(backend);
        vault.verify();
    }

    function _deploy(uint256 speed) internal returns (Vault) {
        return new Vault(owner, agent, backend, IAqua(address(aqua)), IEAC(address(ens)), address(usdc), "agent", speed);
    }

    function _tokens() internal view returns (address[] memory t, uint256[] memory a) {
        t = new address[](2);
        a = new uint256[](2);
        (t[0], t[1]) = (address(usdc), address(hype));
        (a[0], a[1]) = (1_000e6, 100e18);
    }

    function _ship(bytes memory salt) internal returns (bytes32) {
        (address[] memory t, uint256[] memory a) = _tokens();
        vm.prank(agent);
        return vault.ship(app, salt, t, a);
    }

    function _bal(bytes32 h, address t) internal view returns (uint256 b) {
        (b,) = aqua.rawBalances(address(vault), app, h, t);
    }

    function test_capToken_isUsdc() public view {
        assertEq(vault.capToken(), address(usdc));
    }

    function test_ship_withRole() public {
        uint256 g = gasleft();
        bytes32 h = _ship("s1");
        emit log_named_uint("gas ship", g - gasleft());
        assertEq(_bal(h, address(usdc)), 1_000e6);
    }

    function test_ship_revertsWithoutRole() public {
        ens.revokeRoles(vault.ROLE_MANDATE(), agent);
        (address[] memory t, uint256[] memory a) = _tokens();
        vm.prank(agent);
        vm.expectRevert(Vault.NoMandate.selector);
        vault.ship(app, "s1", t, a);
    }

    function test_ship_revertsForNonAgent() public {
        address other = makeAddr("other");
        ens.grantRoles(vault.ROLE_MANDATE(), other);
        (address[] memory t, uint256[] memory a) = _tokens();
        vm.prank(other);
        vm.expectRevert(Vault.NotAgent.selector);
        vault.ship(app, "s1", t, a);
    }

    function test_capNow_zeroWhenMandateRevoked() public {
        ens.revokeRoles(vault.ROLE_MANDATE(), agent);
        assertEq(vault.capNow(), 0);
        assertEq(vault.baseCap(), 2_000e6);
    }

    function test_ship_revertsAtCapZero() public {
        vm.warp(block.timestamp + 3 days);
        (address[] memory t, uint256[] memory a) = _tokens();
        vm.prank(agent);
        vm.expectRevert(Vault.MandateEmpty.selector);
        vault.ship(app, "s1", t, a);
    }

    function test_dock_byAgent() public {
        bytes32 h = _ship("s1");
        uint256 g = gasleft();
        vm.prank(agent);
        vault.dock(h);
        emit log_named_uint("gas dock", g - gasleft());
        assertEq(_bal(h, address(usdc)), 0);
    }

    function test_withdraw_revertsForAgent() public {
        vm.prank(agent);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.withdraw(IERC20(address(usdc)), 1);
    }

    /// Aqua moves real tokens out of the Vault when the app pulls: the Vault is a working maker.
    function test_aquaPull_movesTokensFromVault() public {
        bytes32 h = _ship("s1");
        address taker = makeAddr("taker");
        vm.prank(app);
        aqua.pull(address(vault), h, address(usdc), 400e6, taker);
        assertEq(usdc.balanceOf(taker), 400e6);
        assertEq(usdc.balanceOf(address(vault)), 9_600e6);
        assertEq(_bal(h, address(usdc)), 600e6);
    }

    function test_dock_worksAfterRevokeAndDecay() public {
        bytes32 h = _ship("s1");
        ens.revokeRoles(vault.ROLE_MANDATE() | vault.ROLE_SELFIE(), agent);
        vm.warp(block.timestamp + 10 days);
        assertEq(vault.capNow(), 0);
        vm.prank(agent);
        vault.dock(h);
        assertEq(_bal(h, address(usdc)), 0);
    }

    function test_dock_byOwner() public {
        bytes32 h = _ship("s1");
        vm.prank(owner);
        vault.dock(h);
    }

    function test_dock_revertsForStranger() public {
        bytes32 h = _ship("s1");
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(Vault.NotAgentOrOwner.selector);
        vault.dock(h);
    }

    function test_dock_revertsTwice() public {
        bytes32 h = _ship("s1");
        vm.startPrank(agent);
        vault.dock(h);
        vm.expectRevert(Vault.UnknownStrategy.selector);
        vault.dock(h);
    }

    /// Aqua strategies are immutable: re-opening needs a fresh salt, same bytes revert.
    function test_reship_needsNewSalt() public {
        bytes32 h = _ship("s1");
        vm.prank(agent);
        vault.dock(h);
        (address[] memory t, uint256[] memory a) = _tokens();
        vm.prank(agent);
        vm.expectRevert();
        vault.ship(app, "s1", t, a);
        _ship("s2");
    }

    function test_limitAt_curve() public view {
        uint256 b = 2_000e6;
        assertEq(vault.limitAt(b, 0), 2_000e6);
        assertEq(vault.limitAt(b, 12 hours), 1_500e6);
        assertEq(vault.limitAt(b, 24 hours), 1_000e6);
        assertEq(vault.limitAt(b, 36 hours), 750e6);
        assertEq(vault.limitAt(b, 48 hours), 500e6);
        assertEq(vault.limitAt(b, 72 hours - 1), 250_002_894); // ~b/8 just before the cutoff, then a cliff to 0
        assertEq(vault.limitAt(b, 72 hours), 0);
        assertEq(vault.limitAt(b, type(uint256).max), 0);
    }

    function test_capNow_byTier() public {
        assertEq(vault.capNow(), 2_000e6);
        ens.grantRoles(vault.ROLE_DOCUMENT(), agent);
        assertEq(vault.capNow(), 7_500e6);
        ens.grantRoles(vault.ROLE_ORB(), agent);
        assertEq(vault.capNow(), 15_000e6);
    }

    function test_capNow_ownerCapOnlyLowers() public {
        vm.prank(owner);
        vault.setCap(500e6);
        assertEq(vault.capNow(), 500e6);
        vm.prank(owner);
        vault.setCap(0);
        assertEq(vault.capNow(), 0);
    }

    function test_capNow_zeroUntilFirstVerify() public {
        Vault fresh = _deploy(1);
        vm.prank(owner);
        fresh.setCap(type(uint256).max);
        assertEq(fresh.capNow(), 0);
    }

    /// Demo clock on real 12s Sepolia blocks: speed 1_440 makes one block = 4.8h of decay.
    function test_capNow_demoSpeed_on12sBlocks() public {
        Vault demo = _deploy(1_440);
        vm.startPrank(owner);
        demo.setCap(type(uint256).max);
        vm.stopPrank();
        vm.prank(backend);
        demo.verify();

        _blocks(1);
        assertEq(demo.capNow(), 1_800e6); // 4.8h
        _blocks(4);
        assertEq(demo.capNow(), 1_000e6); // 24h, one minute in
        _blocks(9);
        assertEq(demo.capNow(), 300e6); // 67.2h
        _blocks(1);
        assertEq(demo.capNow(), 0); // 72h, three minutes in
    }

    /// The agent still has runway to open a position well after verification.
    function test_demoSpeed_agentCanShipTenBlocksAfterVerify() public {
        Vault demo = _deploy(1_440);
        usdc.mint(address(demo), 1_000e6);
        hype.mint(address(demo), 100e18);
        vm.prank(owner);
        demo.setCap(type(uint256).max);
        vm.prank(backend);
        demo.verify();
        _blocks(10);
        (address[] memory t, uint256[] memory a) = _tokens();
        vm.prank(agent);
        demo.ship(app, "late", t, a);
    }

    function _blocks(uint256 n) internal {
        vm.roll(block.number + n);
        vm.warp(block.timestamp + 12 * n);
    }

    function test_reverify_restoresCap() public {
        vm.warp(block.timestamp + 5 days);
        assertEq(vault.capNow(), 0);
        vm.prank(backend);
        vault.verify();
        assertEq(vault.capNow(), 2_000e6);
        _ship("s1");
    }

    function test_verify_onlyBackend() public {
        vm.prank(agent);
        vm.expectRevert(Vault.NotBackend.selector);
        vault.verify();
    }

    function test_setCap_onlyOwner() public {
        vm.prank(agent);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.setCap(1);
    }

    function test_withdraw_byOwner() public {
        vm.prank(owner);
        vault.withdraw(IERC20(address(usdc)), 1_000e6);
        assertEq(usdc.balanceOf(owner), 1_000e6);
    }

    // ---- bookkeeping across several positions ----

    function test_twoPositions_dockOneKeepsOther() public {
        bytes32 h1 = _ship("s1");
        bytes32 h2 = _ship("s2");
        vm.prank(agent);
        vault.dock(h1);
        assertEq(_bal(h1, address(usdc)), 0);
        assertEq(_bal(h2, address(usdc)), 1_000e6);
        vm.prank(owner);
        vault.dock(h2);
        assertEq(_bal(h2, address(usdc)), 0);
    }

    function test_dock_unknownHashReverts() public {
        vm.prank(agent);
        vm.expectRevert(Vault.UnknownStrategy.selector);
        vault.dock(keccak256("never shipped"));
    }

    // ---- events ----

    function test_events_shipDockVerifyCapWithdraw() public {
        (address[] memory t, uint256[] memory a) = _tokens();
        bytes32 h = keccak256("s1");
        vm.expectEmit(address(vault));
        emit Vault.Shipped(h, app, t, a);
        vm.prank(agent);
        vault.ship(app, "s1", t, a);

        vm.expectEmit(address(vault));
        emit Vault.Docked(h);
        vm.prank(agent);
        vault.dock(h);

        vm.expectEmit(address(vault));
        emit Vault.Verified(uint64(block.timestamp));
        vm.prank(backend);
        vault.verify();

        vm.expectEmit(address(vault));
        emit Vault.CapSet(123);
        vm.prank(owner);
        vault.setCap(123);

        vm.expectEmit(address(vault));
        emit Vault.Withdrawn(address(usdc), 1);
        vm.prank(owner);
        vault.withdraw(IERC20(address(usdc)), 1);
    }

    // ---- approvals ----

    function test_approval_setOnceAndReused() public {
        _ship("s1");
        assertEq(usdc.allowance(address(vault), address(aqua)), type(uint256).max);
        assertEq(hype.allowance(address(vault), address(aqua)), type(uint256).max);
        _ship("s2");
        assertEq(usdc.allowance(address(vault), address(aqua)), type(uint256).max);
    }

    function test_approval_neverGrantedToApp() public {
        _ship("s1");
        assertEq(usdc.allowance(address(vault), app), 0);
    }

    // ---- withdraw while a position is open ----

    /// Aqua balances are virtual: if the owner pulls the real tokens, fills fail but closing still works.
    function test_withdrawWhileShipped_fillsFailDockWorks() public {
        bytes32 h = _ship("s1");
        vm.prank(owner);
        vault.withdraw(IERC20(address(usdc)), 10_000e6);
        vm.prank(app);
        vm.expectRevert();
        aqua.pull(address(vault), h, address(usdc), 1e6, makeAddr("taker"));
        vm.prank(agent);
        vault.dock(h);
    }

    // ---- verify and cap interplay ----

    function testFuzz_capNow_neverAboveBase(uint256 dt) public {
        dt = bound(dt, 0, 10 days);
        vm.warp(block.timestamp + dt);
        assertLe(vault.capNow(), vault.baseCap());
    }

    function test_setCap_midDecay_scalesImmediately() public {
        vm.warp(block.timestamp + 1 days);
        assertEq(vault.capNow(), 1_000e6);
        vm.prank(owner);
        vault.setCap(400e6);
        assertEq(vault.capNow(), 200e6);
    }

    function test_verify_resetsClockNotTier() public {
        vm.warp(block.timestamp + 2 days);
        vm.prank(backend);
        vault.verify();
        assertEq(vault.lastVerified(), block.timestamp);
        assertEq(vault.capNow(), 2_000e6);
    }
}
