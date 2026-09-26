// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Powered by SwapVM — © Degensoft Ltd 2025

import { Context } from "swap-vm/libs/VM.sol";
import { Opcode } from "swap-vm/libs/OpcodeList.sol";

interface IMandateVault {
    function mandate() external view returns (bool alive, uint256 cap, address token);
}

/// @title MandateGate
/// @notice SwapVM instruction (opcode 0x2f) that caps what the market can take from a Leash Vault's
/// position to whatever the owner's decaying mandate still allows. The maker is the Vault.
/// @dev Encoding: [] (no args; everything is read from the maker).
/// Must sit immediately before XYCSwap: when the cap token is the leg the curve computes, the gate
/// trims the taker's leg with the inverse of x*y=k so the computed leg lands at or under the cap.
/// Read-only: runs inside quotes (static context).
library MandateGate {
    error MandateRevoked(address maker);
    error MandateEmpty(address maker);
    /// @notice The strategy has no leg in the cap token, so the cap could not bound it.
    error MandateTokenMissing(address maker, address capToken);

    Opcode constant opcode = Opcode._2f;

    function build() internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(opcode), uint8(0));
    }

    function exec(Context memory ctx, bytes calldata) internal view {
        address maker = ctx.query.maker;
        (bool alive, uint256 limit, address capToken) = IMandateVault(maker).mandate();
        require(alive, MandateRevoked(maker));
        require(limit > 0, MandateEmpty(maker));

        if (ctx.query.tokenIn == capToken) {
            if (ctx.query.isExactIn) {
                if (ctx.swap.amountIn > limit) ctx.swap.amountIn = limit;
            } else {
                // amountIn = amountOut * bIn / (bOut - amountOut) <= limit  <=>  amountOut <= limit * bOut / (bIn + limit)
                uint256 maxOut = limit * ctx.swap.balanceOut / (ctx.swap.balanceIn + limit);
                if (ctx.swap.amountOut > maxOut) ctx.swap.amountOut = maxOut;
            }
        } else if (ctx.query.tokenOut == capToken) {
            if (!ctx.query.isExactIn) {
                if (ctx.swap.amountOut > limit) ctx.swap.amountOut = limit;
            } else if (limit < ctx.swap.balanceOut) {
                // amountOut = amountIn * bOut / (bIn + amountIn) <= limit  <=>  amountIn <= limit * bIn / (bOut - limit)
                uint256 maxIn = limit * ctx.swap.balanceIn / (ctx.swap.balanceOut - limit);
                if (ctx.swap.amountIn > maxIn) ctx.swap.amountIn = maxIn;
            }
        
        } else {
            revert MandateTokenMissing(maker, capToken);
        }
    }
}
