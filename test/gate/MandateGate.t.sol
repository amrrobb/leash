// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ISwapVM } from "swap-vm/interfaces/ISwapVM.sol";
import { TakerTraitsLib } from "swap-vm/libs/TakerTraits.sol";
import { XYCSwap } from "swap-vm/instructions/XYCSwap.sol";
import { Salt } from "swap-vm/instructions/Controls.sol";
import { MandateGate } from "../../src/MandateGate.sol";
import { IEAC } from "../../src/interfaces/IEAC.sol";
import { MockEAC } from "../mocks/MockEAC.sol";
import { GateBase } from "./GateBase.sol";

/// Selfie tier: cap 2,000 USDC. Pool: 10,000 USDC / 1,000 HYPE.
contract MandateGateTest is GateBase {
    MockEAC ens;

    function _registry() internal override returns (IEAC) {
        ens = new MockEAC("agent");
        return IEAC(address(ens));
    }

    function _grantMandateAndSelfie() internal override {
        ens.grantRoles((1 << 40) | (1 << 52), agent);
    }

    function setUp() public {
        _setUpPool(1);
    }

    // ---- USDC in ----

    function test_exactIn_usdcIn_underCap_fullFill() public {
        (uint256 amountIn, uint256 amountOut) = _swap(order, 1_000e6, true, true, false);
        assertEq(amountIn, 1_000e6);
        assertEq(amountOut, 1_000e6 * POOL_HYPE / (POOL_USDC + 1_000e6));
        assertEq(hype.balanceOf(address(taker)), amountOut, "tokens actually moved");
    }

    function test_exactIn_usdcIn_overCap_trimmedToCap() public {
        (uint256 amountIn,) = _swap(order, 10_000e6, true, true, true);
        assertEq(amountIn, 2_000e6);
    }

    function test_exactIn_overCap_withoutPartialFill_reverts() public {
        hype.mint(address(taker), 0);
        usdc.mint(address(taker), 10_000e6);
        bytes memory td = _takerData(true, true, false);
        vm.expectRevert(abi.encodeWithSelector(TakerTraitsLib.TakerTraitsTakerAmountInMismatch.selector, 10_000e6, 2_000e6));
        taker.swap(order, 10_000e6, td);
    }

    function test_exactOut_usdcIn_trimsHypeOutSoUsdcInFitsCap() public {
        (uint256 amountIn, uint256 amountOut) = _swap(order, 500e18, false, true, true);
        assertLe(amountIn, 2_000e6, "USDC paid in stays within cap");
        assertEq(amountOut, 2_000e6 * POOL_HYPE / (POOL_USDC + 2_000e6));
    }

    // ---- USDC out ----

    function test_exactIn_usdcOut_trimsHypeInSoUsdcOutFitsCap() public {
        (uint256 amountIn, uint256 amountOut) = _swap(order, 500e18, true, false, true);
        assertLe(amountOut, 2_000e6, "USDC taken out stays within cap");
        assertEq(amountIn, 2_000e6 * POOL_HYPE / (POOL_USDC - 2_000e6));
        assertEq(usdc.balanceOf(address(taker)) >= amountOut, true);
    }

    function test_exactOut_usdcOut_trimmedToCap() public {
        (, uint256 amountOut) = _swap(order, 3_000e6, false, false, true);
        assertEq(amountOut, 2_000e6);
    }

    function test_exactIn_usdcOut_underCap_fullFill() public {
        (uint256 amountIn, uint256 amountOut) = _swap(order, 10e18, true, false, false);
        assertEq(amountIn, 10e18);
        assertEq(amountOut, 10e18 * POOL_USDC / (POOL_HYPE + 10e18));
    }

    // ---- decay, revoke, empty ----

    function test_afterOneDay_capHalves() public {
        vm.warp(block.timestamp + 1 days);
        (uint256 amountIn,) = _swap(order, 10_000e6, true, true, true);
        assertEq(amountIn, 1_000e6);
    }

    function test_revoked_reverts() public {
        ens.revokeRoles(1 << 40, agent);
        usdc.mint(address(taker), 1_000e6);
        bytes memory td = _takerData(true, true, true);
        vm.expectRevert(abi.encodeWithSelector(MandateGate.MandateRevoked.selector, address(vault)));
        taker.swap(order, 1_000e6, td);
    }

    function test_empty_reverts() public {
        vm.warp(block.timestamp + 3 days);
        usdc.mint(address(taker), 1_000e6);
        bytes memory td = _takerData(true, true, true);
        vm.expectRevert(abi.encodeWithSelector(MandateGate.MandateEmpty.selector, address(vault)));
        taker.swap(order, 1_000e6, td);
    }

    function test_reverify_restores() public {
        vm.warp(block.timestamp + 3 days);
        vm.prank(backend);
        vault.verify();
        (uint256 amountIn,) = _swap(order, 10_000e6, true, true, true);
        assertEq(amountIn, 2_000e6);
    }

    // ---- quote matches swap (static context) ----

    function test_quote_matchesSwap() public {
        (uint256 qIn, uint256 qOut) = _quote(order, 10_000e6, true, true, true);
        (uint256 sIn, uint256 sOut) = _swap(order, 10_000e6, true, true, true);
        assertEq(qIn, sIn);
        assertEq(qOut, sOut);
    }

    // ---- gas: same pool with and without the gate ----

    function test_gas_gateOverhead() public {
        ISwapVM.Order memory plain = _order(bytes.concat(XYCSwap.build(), Salt.build(uint64(2))));
        _ship(plain);
        // Warm both paths identically, then measure.
        _swap(order, 1e6, true, true, false);
        _swap(plain, 1e6, true, true, false);
        uint256 g = gasleft();
        _swap(order, 100e6, true, true, false);
        uint256 withGate = g - gasleft();
        g = gasleft();
        _swap(plain, 100e6, true, true, false);
        uint256 without = g - gasleft();
        emit log_named_uint("swap with gate", withGate);
        emit log_named_uint("swap without gate", without);
        emit log_named_uint("gate overhead (warm)", withGate - without);
    }

    // ---- property: the USDC leg never exceeds what the mandate allows ----

    function testFuzz_usdcLegNeverExceedsCap(uint256 amount, bool isExactIn, bool usdcIn, uint256 dt) public {
        dt = bound(dt, 0, 3 days - 1);
        vm.warp(block.timestamp + dt);
        uint256 cap = vault.capNow();
        // Keep requests inside what the pool can serve; the gate is what we are testing.
        if (isExactIn) amount = bound(amount, 1, usdcIn ? 50_000e6 : 5_000e18);
        else amount = bound(amount, 1, usdcIn ? 900e18 : 9_000e6);

        try this.swapExternal(amount, isExactIn, usdcIn) returns (uint256 amountIn, uint256 amountOut) {
            assertLe(usdcIn ? amountIn : amountOut, cap);
        } catch {
            // Dust trades may round to zero output and be rejected by SwapVM: acceptable.
        }
    }

    function swapExternal(uint256 amount, bool isExactIn, bool usdcIn) external returns (uint256, uint256) {
        return _swap(order, amount, isExactIn, usdcIn, true);
    }
}
