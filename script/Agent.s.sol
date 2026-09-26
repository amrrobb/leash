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
///   ACTION=ship   AGENT_KEY  SALT            ship a USDC / OTHER pool from the Vault
///   ACTION=dock   AGENT_KEY  SALT            close that pool (works even when the mandate is dead)
///   ACTION=trade  TAKER_KEY  SALT  AMOUNT    a market trade: pay AMOUNT USDC (6 dec) for OTHER, partial fills allowed
/// env: DEPLOYMENT (JSON written by DeployLeash with OUT=...)
///      [OTHER]      the non-USDC token (default: the deployment's demo HYPE); any ERC20 the Vault holds
///      [POOL_USDC]  [POOL_OTHER]  pool sizes in token units (default 10,000 USDC / 1,000 OTHER)
/// The strategy is the same program for every pair (MandateGate -> XYCSwap -> Salt); SALT names the position.
contract Agent is Script {

    function run() external {
        string memory json = vm.readFile(vm.envString("DEPLOYMENT"));
        // VAULT overrides the deployment's demo vault: with the factory every user has their own.
        Vault vault = Vault(vm.envOr("VAULT", vm.parseJsonAddress(json, ".vault")));
        address router = vm.parseJsonAddress(json, ".router");
        address usdc = vm.parseJsonAddress(json, ".usdc");
        address hype = vm.envOr("OTHER", vm.parseJsonAddress(json, ".hype"));
        uint256 poolUsdc = vm.envOr("POOL_USDC", uint256(10_000e6));
        uint256 poolOther = vm.envOr("POOL_OTHER", uint256(1_000e18));
        uint64 salt = uint64(vm.envUint("SALT"));
        ISwapVM.Order memory order = LeashOrder.build(address(vault), usdc, hype, salt);
        bytes32 action = keccak256(bytes(vm.envString("ACTION")));

        if (action == keccak256("ship")) {
            vm.startBroadcast(vm.envUint("AGENT_KEY"));
            // Demo tokens mint freely; real tokens must already sit in the Vault (Alice deposits them).
            _topUp(usdc, address(vault), poolUsdc);
            _topUp(hype, address(vault), poolOther);
            address[] memory t = new address[](2);
            uint256[] memory a = new uint256[](2);
            (t[0], t[1], a[0], a[1]) = (usdc, hype, poolUsdc, poolOther);
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
            _topUp(usdc, taker, amount);
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

    function _topUp(address token, address to, uint256 amount) internal {
        if (IERC20(token).balanceOf(to) >= amount) return;
        try DemoToken(token).mint(to, amount) { }
        catch {
            revert(string.concat("vault holds too little of ", vm.toString(token), " and it is not mintable"));
        }
    }

    /// Exact-in USDC -> OTHER from a plain EOA: the router pulls from the taker and pushes into Aqua.
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
