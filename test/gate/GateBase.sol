// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "swap-vm/interfaces/ISwapVM.sol";
import { SwapVM } from "swap-vm/SwapVM.sol";
import { MakerTraitsLib } from "swap-vm/libs/MakerTraits.sol";
import { TakerTraitsLib } from "swap-vm/libs/TakerTraits.sol";
import { XYCSwap } from "swap-vm/instructions/XYCSwap.sol";
import { Salt } from "swap-vm/instructions/Controls.sol";
import { MockTaker } from "swap-vm-test/mocks/MockTaker.sol";
import { MandateAquaRouter } from "../../src/MandateAquaRouter.sol";
import { MandateGate } from "../../src/MandateGate.sol";
import { Vault } from "../../src/Vault.sol";
import { IEAC } from "../../src/interfaces/IEAC.sol";
import { DemoToken } from "../../src/DemoToken.sol";

/// Real Aqua + real MandateAquaRouter, with a Leash Vault as the maker of a USDC/HYPE XYC pool.
/// Subclasses provide the ENS registry (mock or a fork of the real one).
abstract contract GateBase is Test {
    uint256 constant POOL_USDC = 10_000e6;
    uint256 constant POOL_HYPE = 1_000e18; // 10 USDC per HYPE

    address owner = makeAddr("leash.owner");
    address agent = makeAddr("leash.agent");
    address backend = makeAddr("leash.backend");

    Aqua aqua;
    MandateAquaRouter router;
    MockTaker taker;
    Vault vault;
    DemoToken usdc;
    DemoToken hype;
    ISwapVM.Order order;
    bytes32 orderHash;

    function _registry() internal virtual returns (IEAC);
    function _grantMandateAndSelfie() internal virtual;

    function _setUpPool(uint256 speed) internal {
        aqua = new Aqua();
        router = new MandateAquaRouter(address(aqua), address(0), address(this), "SwapVM", "1.0.0");
        taker = new MockTaker(aqua, SwapVM(payable(address(router))), address(this));
        usdc = new DemoToken("USD", "USDC", 6);
        hype = new DemoToken("HYPE", "HYPE", 18);
        vault = new Vault(owner, agent, backend, IAqua(address(aqua)), _registry(), address(usdc), "agent", speed);
        usdc.mint(address(vault), POOL_USDC);
        hype.mint(address(vault), POOL_HYPE);

        _grantMandateAndSelfie();
        vm.prank(owner);
        vault.setCap(type(uint256).max);
        vm.prank(backend);
        vault.verify();

        order = _order(bytes.concat(MandateGate.build(), XYCSwap.build(), Salt.build(uint64(1))));
        orderHash = _ship(order);
    }

    function _order(bytes memory program) internal view returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: address(vault),
            tokenA: address(usdc),
            tokenB: address(hype),
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: true,
            usePermit2: false,
            allowZeroAmountIn: false,
            receiver: address(0),
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: program
        }));
    }

    function _ship(ISwapVM.Order memory o) internal returns (bytes32 h) {
        address[] memory t = new address[](2);
        uint256[] memory a = new uint256[](2);
        (t[0], t[1]) = (address(usdc), address(hype));
        (a[0], a[1]) = (POOL_USDC, POOL_HYPE);
        vm.prank(agent);
        h = vault.ship(address(router), abi.encode(o), t, a);
        assertEq(h, router.hash(o), "Aqua strategy hash must equal the SwapVM order hash");
    }

    function _takerData(bool isExactIn, bool usdcIn, bool partialFill) internal view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(taker),
            isExactIn: isExactIn,
            shouldUnwrapWeth: false,
            hasPreTransferInCallback: true,
            hasPreTransferOutCallback: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: false,
            useTransferFromAndAquaPush: false,
            isAToB: usdcIn,
            allowPartialFill: partialFill,
            usePermit2: false,
            threshold: "",
            to: address(0),
            deadline: 0,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: "",
            signature: ""
        }));
    }

    /// Mints the taker enough of tokenIn and swaps. Returns (amountIn, amountOut).
    function _swap(ISwapVM.Order memory o, uint256 amount, bool isExactIn, bool usdcIn, bool partialFill)
        internal
        returns (uint256, uint256)
    {
        DemoToken tokenIn = usdcIn ? usdc : hype;
        tokenIn.mint(address(taker), usdcIn ? 1_000_000e6 : 1_000_000e18);
        return taker.swap(o, amount, _takerData(isExactIn, usdcIn, partialFill));
    }

    function _quote(ISwapVM.Order memory o, uint256 amount, bool isExactIn, bool usdcIn, bool partialFill)
        internal
        view
        returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut,) = router.asView().quote(o, amount, _takerData(isExactIn, usdcIn, partialFill));
    }
}
