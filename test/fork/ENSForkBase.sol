// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IUserRegistry, IVerifiableFactory, Grant } from "../../src/interfaces/IENSv2.sol";
import { SepoliaENS } from "./SepoliaENS.sol";

/// Alice's own ENSv2 UserRegistry on a Sepolia fork: she owns `agent`, the agent holds the mandate,
/// the backend holds tier-admin at root. Skipped when SEPOLIA_RPC is unset.
abstract contract ENSForkBase is Test {
    uint256 constant ROLE_REGISTRAR = 1 << 0;
    uint256 constant ROLE_RENEW = 1 << 16;
    uint256 constant ROLE_MANDATE = 1 << 40;
    uint256 constant ROLE_ORB = 1 << 44;
    uint256 constant ROLE_DOCUMENT = 1 << 48;
    uint256 constant ROLE_SELFIE = 1 << 52;
    uint256 constant TIERS = ROLE_ORB | ROLE_DOCUMENT | ROLE_SELFIE;

    address alice = makeAddr("leash.alice");
    address agent = makeAddr("leash.agent");
    address backend = makeAddr("leash.backend");

    IUserRegistry reg;
    uint256 labelId = uint256(keccak256("agent"));

    function setUp() public virtual {
        string memory rpc = vm.envOr("SEPOLIA_RPC", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc, 11_781_047);

        // Alice's own registry: root admin over registration and the Leash role nybbles.
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(alice, ROLE_REGISTRAR | ROLE_RENEW | ((ROLE_REGISTRAR | ROLE_RENEW | ROLE_MANDATE | TIERS) << 128));
        vm.prank(alice);
        reg = IUserRegistry(
            IVerifiableFactory(SepoliaENS.VERIFIABLE_FACTORY).deployProxy(
                SepoliaENS.USER_REGISTRY_IMPL, uint256(keccak256("leash-test")), abi.encodeCall(IUserRegistry.initialize, (grants))
            )
        );

        vm.startPrank(alice);
        reg.register("agent", alice, address(0), address(0), 0, uint64(block.timestamp + 365 days));
        reg.grantRoles(labelId, ROLE_MANDATE, agent);
        reg.grantRootRoles(TIERS << 128, backend); // backend may set tiers, never the mandate
        vm.stopPrank();
    }
}
