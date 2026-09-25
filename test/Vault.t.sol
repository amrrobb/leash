// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { Vault } from "../src/Vault.sol";
import { IEAC } from "../src/interfaces/IEAC.sol";
import { MockEAC } from "./mocks/MockEAC.sol";

contract TestToken is ERC20 {
    constructor(string memory s) ERC20(s, s) { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

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
        vault = new Vault(owner, agent, backend, IAqua(address(aqua)), IEAC(address(ens)), "agent", 1);
        usdc = new TestToken("USDC");
        hype = new TestToken("HYPE");
        usdc.mint(address(vault), 10_000e6);
        hype.mint(address(vault), 1_000e18);

        ens.grantRoles(vault.ROLE_MANDATE() | vault.ROLE_SELFIE(), agent);
        vm.prank(owner);
        vault.setCap(type(uint256).max);
        vm.prank(backend);
        vault.verify();
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
}
