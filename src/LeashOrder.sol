// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Powered by SwapVM — © Degensoft Ltd 2025

import { ISwapVM } from "swap-vm/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "swap-vm/libs/MakerTraits.sol";
import { XYCSwap } from "swap-vm/instructions/XYCSwap.sol";
import { Salt } from "swap-vm/instructions/Controls.sol";
import { MandateGate } from "./MandateGate.sol";

/// @notice The one strategy Leash ships: an Aqua XYC pool on USDC/HYPE with the Vault as maker,
/// gated by MandateGate. The salt makes every re-ship a new, immutable Aqua strategy.
library LeashOrder {
    function program(uint64 salt) internal pure returns (bytes memory) {
        return bytes.concat(MandateGate.build(), XYCSwap.build(), Salt.build(salt));
    }

    /// @dev SwapVM requires tokenA < tokenB; takers pass isAToB = (tokenIn == tokenA).
    function sorted(address x, address y) internal pure returns (address tokenA, address tokenB) {
        (tokenA, tokenB) = x < y ? (x, y) : (y, x);
    }

    function build(address vault, address usdc, address hype, uint64 salt) internal pure returns (ISwapVM.Order memory) {
        (address tokenA, address tokenB) = sorted(usdc, hype);
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: vault,
            tokenA: tokenA,
            tokenB: tokenB,
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
            program: program(salt)
        }));
    }
}
