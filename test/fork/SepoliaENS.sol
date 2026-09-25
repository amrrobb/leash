// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice ENSv2 Sepolia deployment from the 2026-09-15 re-migration
/// (ensdomains/contracts-v2 @ deploy/sepolia-migration-20260915, contracts/deployments/sepolia).
library SepoliaENS {
    address internal constant ETH_REGISTRY = 0x1BD29E26f09b4c68c623141673e5F0a5d02709f6;
    address internal constant ETH_REGISTRAR = 0xE097D00257e80b96df8Bace0dbCD50019De3B95d;
    address internal constant USER_REGISTRY_IMPL = 0xb146A81b83Ac63065aeAFA16F25971f70176143E;
    address internal constant VERIFIABLE_FACTORY = 0xd1E4b08aE3Fd896d3E1990C6a73D4320940F3CdB;
    address internal constant PERMISSIONED_RESOLVER_IMPL = 0x742B36Ef4c9f0d8B9af99A1be555200e09d6eCc0;
    address internal constant MOCK_USDC = 0xF9A8540590bc66a2b98692Cd6D20F122d947c752;
}
