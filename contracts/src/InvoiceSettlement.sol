// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @title InvoiceSettlement
/// @notice Pays an invoice in an ERC-20 stablecoin and records which invoice the payment settles.
/// The tokens go straight from the payer to the seller in the same call: this contract never holds
/// funds, has no owner, no fees and cannot be upgraded. The `InvoicePaid` event is the on-chain
/// link between an invoice reference (see invoice-passport `invoiceRef()`) and the transfer, so an
/// invoicing system can match payments without unique amounts.
contract InvoiceSettlement {
    /// @param invoiceRef 32-byte invoice reference chosen by the issuer
    event InvoicePaid(
        bytes32 indexed invoiceRef, address indexed payer, address indexed seller, address token, uint256 amount
    );

    error ZeroAmount();
    error ZeroSeller();
    error LengthMismatch();
    error TransferFailed(address token);

    /// @notice Pays one invoice. The payer must have approved this contract for `amount` of `token`.
    function pay(bytes32 invoiceRef, address token, address seller, uint256 amount) external {
        _pay(invoiceRef, token, seller, amount);
    }

    /// @notice Pays several invoices in one transaction, e.g. an agent settling a month of usage.
    function payBatch(
        bytes32[] calldata invoiceRefs,
        address token,
        address[] calldata sellers,
        uint256[] calldata amounts
    ) external {
        uint256 n = invoiceRefs.length;
        if (sellers.length != n || amounts.length != n) revert LengthMismatch();
        for (uint256 i = 0; i < n; ++i) {
            _pay(invoiceRefs[i], token, sellers[i], amounts[i]);
        }
    }

    function _pay(bytes32 invoiceRef, address token, address seller, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        if (seller == address(0)) revert ZeroSeller();
        // Accepts tokens that return true, and tokens that return nothing (e.g. USDT).
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, msg.sender, seller, amount)); // transferFrom
        if (!ok || (data.length != 0 && !abi.decode(data, (bool))) || token.code.length == 0) {
            revert TransferFailed(token);
        }
        emit InvoicePaid(invoiceRef, msg.sender, seller, token, amount);
    }
}
