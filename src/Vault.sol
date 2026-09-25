// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { IEAC } from "./interfaces/IEAC.sol";

/// @title Leash Vault
/// @notice Holds the owner's tokens and is the Aqua maker. The agent may open positions only
/// while its ENS mandate is alive and the decaying cap is above zero; closing is always allowed.
contract Vault {
    using SafeERC20 for IERC20;

    uint256 public constant ROLE_MANDATE = 1 << 40;
    uint256 public constant ROLE_ORB = 1 << 44;
    uint256 public constant ROLE_DOCUMENT = 1 << 48;
    uint256 public constant ROLE_SELFIE = 1 << 52;

    uint256 public constant PERIOD = 1 days;
    uint256 public constant CUTOFF = 3 days;

    /// @dev Caps in USDC units (6 decimals), by World credential tier.
    uint256 public constant CAP_ORB = 15_000e6;
    uint256 public constant CAP_DOCUMENT = 7_500e6;
    uint256 public constant CAP_SELFIE = 2_000e6;

    address public immutable owner;
    address public immutable agent;
    address public immutable backend;
    IAqua public immutable aqua;
    IEAC public immutable ens;
    /// @notice Token the cap is denominated in (USDC). MandateGate trims only this leg of a trade.
    address public immutable capToken;
    /// @notice Demo clock multiplier on elapsed time: 1 in production, 1_440 on the demo Vault
    /// (one 12s Sepolia block = 4.8h, cap reaches zero in ~3 min).
    uint256 public immutable speed;

    string public agentLabel;
    uint64 public lastVerified;
    /// @notice Owner-chosen ceiling; the effective base is min(ownerCap, tier cap). Zero = no mandate yet.
    uint256 public ownerCap;

    struct Position {
        address app;
        address[] tokens;
    }

    /// @notice What dock() needs back: Aqua requires the app and the full token list.
    mapping(bytes32 strategyHash => Position) internal _positions;

    event Verified(uint64 at);
    event Withdrawn(address indexed token, uint256 amount);
    event Docked(bytes32 indexed strategyHash);
    event Shipped(bytes32 indexed strategyHash, address indexed app, address[] tokens, uint256[] amounts);
    event CapSet(uint256 cap);

    error NotOwner();
    error NotBackend();
    error NotAgentOrOwner();
    error NoMandate();
    error MandateEmpty();
    error UnknownStrategy();

    modifier onlyOwner() {
        require(msg.sender == owner, NotOwner());
        _;
    }

    modifier onlyBackend() {
        require(msg.sender == backend, NotBackend());
        _;
    }

    constructor(
        address owner_,
        address agent_,
        address backend_,
        IAqua aqua_, IEAC ens_,
        address capToken_,
        string memory agentLabel_,
        uint256 speed_
    ) {
        owner = owner_;
        agent = agent_;
        backend = backend_;
        aqua = aqua_;
        ens = ens_;
        capToken = capToken_;
        agentLabel = agentLabel_;
        speed = speed_;
    }

    /// @notice Stamped by the backend after a server-side World ID verification.
    function verify() external onlyBackend {
        lastVerified = uint64(block.timestamp);
        emit Verified(lastVerified);
    }

    function setCap(uint256 cap) external onlyOwner {
        ownerCap = cap;
        emit CapSet(cap);
    }

    /// @notice Opens an Aqua position with this Vault as maker. Needs a live ENS mandate and cap > 0.
    function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts)
        external
        returns (bytes32 strategyHash)
    {
        require(ens.hasRoles(ens.findTokenId(agentLabel), ROLE_MANDATE, msg.sender), NoMandate());
        require(capNow() > 0, MandateEmpty());

        for (uint256 i = 0; i < tokens.length; i++) {
            // Aqua.pull() transfers from the maker, so Aqua (not the app) needs the allowance.
            if (IERC20(tokens[i]).allowance(address(this), address(aqua)) < amounts[i]) {
                IERC20(tokens[i]).forceApprove(address(aqua), type(uint256).max);
            }
        }
        strategyHash = aqua.ship(app, strategy, tokens, amounts);
        _positions[strategyHash] = Position(app, tokens);
        emit Shipped(strategyHash, app, tokens, amounts);
    }

    /// @notice Closes a position. Deliberately reads no ENS state: closing must work after revoke or decay.
    function dock(bytes32 strategyHash) external {
        require(msg.sender == agent || msg.sender == owner, NotAgentOrOwner());
        Position memory p = _positions[strategyHash];
        require(p.app != address(0), UnknownStrategy());
        delete _positions[strategyHash];
        aqua.dock(p.app, strategyHash, p.tokens);
        emit Docked(strategyHash);
    }

    function withdraw(IERC20 token, uint256 amount) external onlyOwner {
        token.safeTransfer(owner, amount);
        emit Withdrawn(address(token), amount);
    }

    /// @notice Highest tier the agent currently holds on its ENS name, capped by the owner.
    function baseCap() public view returns (uint256) {
        uint256 id = ens.findTokenId(agentLabel);
        uint256 tier;
        if (ens.hasRoles(id, ROLE_ORB, agent)) tier = CAP_ORB;
        else if (ens.hasRoles(id, ROLE_DOCUMENT, agent)) tier = CAP_DOCUMENT;
        else if (ens.hasRoles(id, ROLE_SELFIE, agent)) tier = CAP_SELFIE;
        return tier < ownerCap ? tier : ownerCap;
    }

    /// @notice What the mandate still allows right now. Zero if never verified.
    function capNow() public view returns (uint256) {
        if (lastVerified == 0) return 0;
        return limitAt(baseCap(), (block.timestamp - lastVerified) * speed);
    }

    /// @notice Halves every PERIOD, interpolates linearly inside a period, zero from CUTOFF on.
    function limitAt(uint256 base, uint256 elapsed) public pure returns (uint256) {
        if (elapsed >= CUTOFF) return 0;
        uint256 halved = base >> (elapsed / PERIOD);
        return halved - halved * (elapsed % PERIOD) / (2 * PERIOD);
    }
}
