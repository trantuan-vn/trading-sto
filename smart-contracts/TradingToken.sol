// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract TradingToken {
    string public name = "TradingSTO Token";
    string public symbol = "TVT";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;

    constructor(uint256 initialSupply) {
        totalSupply = initialSupply * 10 ** uint256(decimals);
        balanceOf[msg.sender] = totalSupply;
    }
}
