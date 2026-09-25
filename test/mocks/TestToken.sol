// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    constructor(string memory s) ERC20(s, s) { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
