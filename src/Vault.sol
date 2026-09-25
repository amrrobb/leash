// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { IEAC } from "./interfaces/IEAC.sol";

/// @title Leash Vault
/// @notice Holds the owner's tokens and is the Aqua maker. The agent may open positions only
/// while its ENS mandate is alive and the decaying cap is above zero; closing is always allowed.
contract Vault {
    uint256 public constant ROLE_MANDATE = 1 << 40;
    uint256 public constant ROLE_ORB = 1 << 44;
    uint256 public constant ROLE_DOCUMENT = 1 << 48;
    uint256 public constant ROLE_SELFIE = 1 << 52;

    uint256 public constant PERIOD = 1 days;
    uint256 public constant CUTOFF = 3 days;

    address public immutable owner;
    address public immutable agent;
    address public immutable backend;
    IAqua public immutable aqua;
    IEAC public immutable ens;
    /// @notice Demo clock multiplier on elapsed time: 1 in tests, 14_400 for "1s = 4h".
    uint256 public immutable speed;

    string public agentLabel;
    uint64 public lastVerified;

    event Verified(uint64 at);

    error NotOwner();
    error NotBackend();
    error NotAgentOrOwner();

    modifier onlyOwner() {
        require(msg.sender == owner, NotOwner());
        _;
    }

    modifier onlyBackend() {
        require(msg.sender == backend, NotBackend());
        _;
    }

    constructor(address owner_, address agent_, address backend_, IAqua aqua_, IEAC ens_, string memory agentLabel_, uint256 speed_) {
        owner = owner_;
        agent = agent_;
        backend = backend_;
        aqua = aqua_;
        ens = ens_;
        agentLabel = agentLabel_;
        speed = speed_;
    }

    /// @notice Stamped by the backend after a server-side World ID verification.
    function verify() external onlyBackend {
        lastVerified = uint64(block.timestamp);
        emit Verified(lastVerified);
    }

    /// @notice Halves every PERIOD, interpolates linearly inside a period, zero from CUTOFF on.
    function limitAt(uint256 base, uint256 elapsed) public pure returns (uint256) {
        if (elapsed >= CUTOFF) return 0;
        uint256 halved = base >> (elapsed / PERIOD);
        return halved - halved * (elapsed % PERIOD) / (2 * PERIOD);
    }
}
