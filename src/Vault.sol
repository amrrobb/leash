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

    address public immutable owner;
    address public immutable agent;
    address public immutable backend;
    IAqua public immutable aqua;
    IEAC public immutable ens;

    string public agentLabel;

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

    constructor(address owner_, address agent_, address backend_, IAqua aqua_, IEAC ens_, string memory agentLabel_) {
        owner = owner_;
        agent = agent_;
        backend = backend_;
        aqua = aqua_;
        ens = ens_;
        agentLabel = agentLabel_;
    }
}
