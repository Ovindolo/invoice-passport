// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {InvoiceSettlement} from "../src/InvoiceSettlement.sol";

/// Minimal cheatcode interface (no forge-std dependency).
interface Vm {
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool, address) external;
}

/// 6-decimal token like USDC / USDG.
contract Token {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        return true;
    }

    function transferFrom(address f, address t, uint256 v) external returns (bool) {
        require(allowance[f][msg.sender] >= v && balanceOf[f] >= v, "insufficient");
        allowance[f][msg.sender] -= v;
        balanceOf[f] -= v;
        balanceOf[t] += v;
        return true;
    }
}

/// Token whose transferFrom returns nothing, like USDT.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
    }

    function transferFrom(address f, address t, uint256 v) external {
        require(balanceOf[f] >= v, "insufficient");
        balanceOf[f] -= v;
        balanceOf[t] += v;
    }
}

/// Token that signals failure with false instead of reverting.
contract FalseToken {
    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

contract InvoiceSettlementTest {
    event InvoicePaid(
        bytes32 indexed invoiceRef, address indexed payer, address indexed seller, address token, uint256 amount
    );

    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    InvoiceSettlement s;
    Token usdg;
    address payer = address(0xA11CE);
    address seller = address(0xB0B);
    bytes32 ref = keccak256("INV-1");

    function setUp() public {
        s = new InvoiceSettlement();
        usdg = new Token();
        usdg.mint(payer, 100e6);
        vm.prank(payer);
        usdg.approve(address(s), type(uint256).max);
    }

    function test_pay_moves_tokens_straight_to_seller_and_emits() public {
        vm.expectEmit(true, true, true, true, address(s));
        emit InvoicePaid(ref, payer, seller, address(usdg), 15_004_428);
        vm.prank(payer);
        s.pay(ref, address(usdg), seller, 15_004_428);
        require(usdg.balanceOf(seller) == 15_004_428, "seller paid");
        require(usdg.balanceOf(payer) == 100e6 - 15_004_428, "payer debited");
        require(usdg.balanceOf(address(s)) == 0, "contract holds nothing");
    }

    function test_batch_pays_each_invoice() public {
        bytes32[] memory refs = new bytes32[](2);
        address[] memory sellers = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        refs[0] = keccak256("A");
        refs[1] = keccak256("B");
        sellers[0] = seller;
        sellers[1] = address(0xCAFE);
        amounts[0] = 1e6;
        amounts[1] = 2e6;
        vm.prank(payer);
        s.payBatch(refs, address(usdg), sellers, amounts);
        require(usdg.balanceOf(seller) == 1e6 && usdg.balanceOf(address(0xCAFE)) == 2e6, "batch");
    }

    function test_rejects_zero_amount_and_zero_seller() public {
        vm.expectRevert(InvoiceSettlement.ZeroAmount.selector);
        vm.prank(payer);
        s.pay(ref, address(usdg), seller, 0);
        vm.expectRevert(InvoiceSettlement.ZeroSeller.selector);
        vm.prank(payer);
        s.pay(ref, address(usdg), address(0), 1);
    }

    function test_rejects_mismatched_batch() public {
        vm.expectRevert(InvoiceSettlement.LengthMismatch.selector);
        s.payBatch(new bytes32[](1), address(usdg), new address[](2), new uint256[](1));
    }

    function test_rejects_failed_transfers() public {
        FalseToken bad = new FalseToken();
        vm.expectRevert(abi.encodeWithSelector(InvoiceSettlement.TransferFailed.selector, address(bad)));
        s.pay(ref, address(bad), seller, 1);
        vm.expectRevert(abi.encodeWithSelector(InvoiceSettlement.TransferFailed.selector, address(0xDEAD)));
        s.pay(ref, address(0xDEAD), seller, 1); // not a contract
        vm.expectRevert(abi.encodeWithSelector(InvoiceSettlement.TransferFailed.selector, address(usdg)));
        vm.prank(address(0xBEEF)); // no allowance, no balance
        s.pay(ref, address(usdg), seller, 1);
    }

    function test_accepts_tokens_without_return_value() public {
        NoReturnToken usdt = new NoReturnToken();
        usdt.mint(payer, 5e6);
        vm.prank(payer);
        s.pay(ref, address(usdt), seller, 5e6);
        require(usdt.balanceOf(seller) == 5e6, "usdt-like paid");
    }
}
