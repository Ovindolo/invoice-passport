# InvoiceSettlement

A minimal contract that pays an invoice in an ERC-20 stablecoin and records which invoice the payment settles:
`pay(invoiceRef, token, seller, amount)` moves the tokens straight from the payer to the seller and emits
`InvoicePaid(invoiceRef, payer, seller, token, amount)`. It never holds funds, has no owner, no fees and no upgrade
path. `payBatch` settles several invoices at once.

`invoiceRef` is 32 bytes chosen by the issuer; [`src/settlement.ts`](../src/settlement.ts) derives it
(`invoiceRef(id)`), encodes the calls (`encodeApprove`, `encodePay`) and decodes the event (`decodeInvoicePaid`), so an
invoicing system matches payments by reference rather than by amount.

```sh
forge test                       # unit tests (no dependencies)
../scripts/settlement-e2e.sh     # deploy + approve + pay on a local anvil chain, decode with the library
```

Deploy to Robinhood Chain (chain id 4663) with your own funded key; the payer pays in USDG
(`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`):

```sh
forge create src/InvoiceSettlement.sol:InvoiceSettlement --broadcast \
  --rpc-url https://rpc.mainnet.chain.robinhood.com --private-key "$DEPLOYER_KEY" \
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```

The same bytecode works on any EVM chain (Base, Arbitrum, Ethereum).
