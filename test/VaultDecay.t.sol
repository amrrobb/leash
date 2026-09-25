// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { Vault } from "../src/Vault.sol";
import { IEAC } from "../src/interfaces/IEAC.sol";

/// Properties of the decay curve, independent of ENS and Aqua.
contract VaultDecayTest is Test {
    Vault vault;
    uint256 constant MAX_BASE = 1e30; // far above any tier cap (15_000e6)

    function setUp() public {
        vault = new Vault(address(1), address(2), address(3), IAqua(address(4)), IEAC(address(5)), address(6), "agent", 1);
    }

    function testFuzz_limitAt_neverExceedsBase(uint256 base, uint256 elapsed) public view {
        base = bound(base, 0, MAX_BASE);
        assertLe(vault.limitAt(base, elapsed), base);
    }

    function testFuzz_limitAt_nonIncreasing(uint256 base, uint256 e1, uint256 e2) public view {
        base = bound(base, 0, MAX_BASE);
        e1 = bound(e1, 0, 4 days);
        e2 = bound(e2, e1, 4 days);
        assertGe(vault.limitAt(base, e1), vault.limitAt(base, e2));
    }

    function testFuzz_limitAt_zeroFromCutoff(uint256 base, uint256 elapsed) public view {
        base = bound(base, 0, MAX_BASE);
        elapsed = bound(elapsed, vault.CUTOFF(), type(uint256).max);
        assertEq(vault.limitAt(base, elapsed), 0);
    }

    function testFuzz_limitAt_fullAtZero(uint256 base) public view {
        base = bound(base, 0, MAX_BASE);
        assertEq(vault.limitAt(base, 0), base);
    }

    /// Before the cutoff the curve never falls below an eighth of base (minus rounding).
    function testFuzz_limitAt_aboveEighthBeforeCutoff(uint256 base, uint256 elapsed) public view {
        base = bound(base, 8, MAX_BASE);
        elapsed = bound(elapsed, 0, vault.CUTOFF() - 1);
        assertGe(vault.limitAt(base, elapsed), base / 8);
    }

    /// Halving points are exact.
    function testFuzz_limitAt_halvesEachPeriod(uint256 base) public view {
        base = bound(base, 0, MAX_BASE);
        assertEq(vault.limitAt(base, 1 days), base >> 1);
        assertEq(vault.limitAt(base, 2 days), base >> 2);
    }
}
