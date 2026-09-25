// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Powered by SwapVM — © Degensoft Ltd 2025

import { Context } from "swap-vm/libs/VM.sol";
import { SwapVM } from "swap-vm/SwapVM.sol";
import { AquaOpcodes } from "swap-vm/opcodes/AquaOpcodes.sol";
import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import { MandateGate } from "./MandateGate.sol";

/// @title MandateAquaRouter
/// @notice The stock Aqua SwapVM router plus one instruction: MandateGate (0x2f).
contract MandateAquaRouter is Simulator, SwapVM, AquaOpcodes {
    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version)
    { }

    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        _runOpcode(ctx, opcode, args);
    }

    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == uint8(MandateGate.opcode)) MandateGate.exec(ctx, args);
        else super._runOpcode(ctx, opcode, args);
    }
}
