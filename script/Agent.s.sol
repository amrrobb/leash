// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ISwapVM } from "swap-vm/interfaces/ISwapVM.sol";
import { TakerTraitsLib } from "swap-vm/libs/TakerTraits.sol";
import { Vault } from "../src/Vault.sol";
import { DemoToken } from "../src/DemoToken.sol";
import { LeashOrder } from "../src/LeashOrder.sol";

/// The agent and the market, as scripts.
///   ACTION=ship   AGENT_KEY  SALT            ship a 10,000 USDC / 1,000 HYPE pool from the Vault
///   ACTION=dock   AGENT_KEY  SALT            close that pool (works even when the mandate is dead)
///   ACTION=trade  TAKER_KEY  SALT  AMOUNT    a market trade: pay AMOUNT USDC (6 dec) for HYPE, partial fills allowed
/// env: DEPLOYMENT (JSON written by DeployLeash with OUT=...)
contract Agent is Script {
    uint256 constant POOL_USDC = 10_000e6;
    uint256 constant POOL_HYPE = 1_000e18;

    function run() external {
        string memory json = vm.readFile(vm.envString("DEPLOYMENT"));
        Vault vault = Vault(vm.parseJsonAddress(json, ".vault"));
        address router = vm.parseJsonAddress(json, ".router");
        address usdc = vm.parseJsonAddress(json, ".usdc");
        address hype = vm.parseJsonAddress(json, ".hype");
        uint64 salt = uint64(vm.envUint("SALT"));
        ISwapVM.Order memory order = LeashOrder.build(address(vault), usdc, hype, salt);
        bytes32 action = keccak256(bytes(vm.envString("ACTION")));

        if (action == keccak256("ship")) {
            vm.startBroadcast(vm.envUint("AGENT_KEY"));
            // Demo tokens mint freely; top the Vault up so the pool is always fundable.
            if (IERC20(usdc).balanceOf(address(vault)) < POOL_USDC) DemoToken(usdc).mint(address(vault), POOL_USDC);
            if (IERC20(hype).balanceOf(address(vault)) < POOL_HYPE) DemoToken(hype).mint(address(vault), POOL_HYPE);
            address[] memory t = new address[](2);
            uint256[] memory a = new uint256[](2);
            (t[0], t[1], a[0], a[1]) = (usdc, hype, POOL_USDC, POOL_HYPE);
            bytes32 h = vault.ship(router, abi.encode(order), t, a);
            vm.stopBroadcast();
            console.log("shipped");
            console.logBytes32(h);
        } else if (action == keccak256("dock")) {
            vm.startBroadcast(vm.envUint("AGENT_KEY"));
            vault.dock(keccak256(abi.encode(order)));
            vm.stopBroadcast();
            console.log("docked");
        } else if (action == keccak256("trade")) {
            uint256 amount = vm.envUint("AMOUNT");
            uint256 takerKey = vm.envUint("TAKER_KEY");
            address taker = vm.addr(takerKey);
            vm.startBroadcast(takerKey);
            DemoToken(usdc).mint(taker, amount);
            IERC20(usdc).approve(router, amount);
            (uint256 amountIn, uint256 amountOut,) = ISwapVM(router).swap(order, amount, _takerData(taker, usdc < hype));
            vm.stopBroadcast();
            // Printed from forge's pre-broadcast simulation, seconds before the block that mines the swap.
            // The mined fill can be smaller: the cap keeps decaying. The router's Swapped event is the truth.
            console.log("asked (USDC)", amount);
            console.log("simulated fill (USDC)", amountIn);
            console.log("simulated received (HYPE wei)", amountOut);
        } else {
            revert("ACTION must be ship, dock or trade");
        }
    }

    /// Exact-in USDC -> HYPE from a plain EOA: the router pulls from the taker and pushes into Aqua.
    function _takerData(address taker, bool usdcIsA) internal pure returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: taker,
            isExactIn: true,
            shouldUnwrapWeth: false,
            hasPreTransferInCallback: false,
            hasPreTransferOutCallback: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: true,
            useTransferFromAndAquaPush: true,
            isAToB: usdcIsA,
            allowPartialFill: true,
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
}
