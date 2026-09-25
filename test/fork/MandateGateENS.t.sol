// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ISwapVM } from "swap-vm/interfaces/ISwapVM.sol";
import { XYCSwap } from "swap-vm/instructions/XYCSwap.sol";
import { Salt } from "swap-vm/instructions/Controls.sol";
import { MandateGate } from "../../src/MandateGate.sol";
import { IEAC } from "../../src/interfaces/IEAC.sol";
import { IUserRegistry, IVerifiableFactory, Grant } from "../../src/interfaces/IENSv2.sol";
import { GateBase } from "../gate/GateBase.sol";
import { SepoliaENS } from "./SepoliaENS.sol";

/// The full path on a Sepolia fork: taker -> MandateAquaRouter -> MandateGate -> Vault.mandate()
/// -> Alice's real ENSv2 UserRegistry.
contract MandateGateENSForkTest is GateBase {
    uint256 constant ROLE_MANDATE = 1 << 40;
    uint256 constant ROLE_SELFIE = 1 << 52;
    uint256 constant TIERS = (1 << 44) | (1 << 48) | (1 << 52);
    uint256 constant LABEL_ID = uint256(keccak256("agent"));

    IUserRegistry reg;

    function _registry() internal override returns (IEAC) {
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(owner, 1 | (1 << 16) | ((1 | (1 << 16) | ROLE_MANDATE | TIERS) << 128));
        reg = IUserRegistry(
            IVerifiableFactory(SepoliaENS.VERIFIABLE_FACTORY).deployProxy(
                SepoliaENS.USER_REGISTRY_IMPL, uint256(keccak256("leash-gate")), abi.encodeCall(IUserRegistry.initialize, (grants))
            )
        );
        vm.startPrank(owner);
        reg.register("agent", owner, address(0), address(0), 0, uint64(block.timestamp + 365 days));
        reg.grantRootRoles(TIERS << 128, backend);
        vm.stopPrank();
        return IEAC(address(reg));
    }

    function _grantMandateAndSelfie() internal override {
        vm.prank(owner);
        reg.grantRoles(LABEL_ID, ROLE_MANDATE, agent);
        vm.prank(backend);
        reg.grantRoles(LABEL_ID, ROLE_SELFIE, agent);
    }

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc, 11_781_047);
        _setUpPool(1);
    }

    function test_trimmedByRealENS() public {
        (uint256 amountIn,) = _swap(order, 10_000e6, true, true, true);
        assertEq(amountIn, 2_000e6);
    }

    function test_aliceRevokes_swapReverts() public {
        vm.prank(owner);
        reg.revokeRoles(LABEL_ID, ROLE_MANDATE, agent);
        usdc.mint(address(taker), 1_000e6);
        bytes memory td = _takerData(true, true, true);
        vm.expectRevert(abi.encodeWithSelector(MandateGate.MandateRevoked.selector, address(vault)));
        taker.swap(order, 1_000e6, td);
    }

    function test_orbTier_raisesCap() public {
        vm.prank(backend);
        reg.grantRoles(LABEL_ID, 1 << 44, agent);
        (uint256 amountIn,) = _swap(order, 10_000e6, true, true, true);
        assertEq(amountIn, 10_000e6, "orb cap 15,000 does not bind a 10,000 trade");
    }

    /// Cold per-swap cost of the gate against the real registry (first swap in the tx).
    function test_gas_gateOverheadCold() public {
        ISwapVM.Order memory plain = _order(bytes.concat(XYCSwap.build(), Salt.build(uint64(2))));
        _ship(plain);
        usdc.mint(address(taker), 10_000e6);
        bytes memory td = _takerData(true, true, false);

        uint256 snap = vm.snapshotState();
        uint256 g = gasleft();
        taker.swap(order, 100e6, td);
        uint256 withGate = g - gasleft();
        vm.revertToState(snap);
        g = gasleft();
        taker.swap(plain, 100e6, td);
        uint256 without = g - gasleft();
        emit log_named_uint("swap with gate (real ENS)", withGate);
        emit log_named_uint("swap without gate", without);
        emit log_named_uint("gate overhead", withGate - without);
    }
}
