#!/usr/bin/env bash
# End-to-end check of contracts/InvoiceSettlement on a local anvil chain: deploy a 6-decimal test
# token and the contract, approve and pay with calldata from src/settlement.ts, then decode the
# InvoicePaid event with the library. Needs Foundry (forge, cast, anvil) and Deno.
set -euo pipefail
cd "$(dirname "$0")/../contracts"
RPC=http://127.0.0.1:8546
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # anvil's first test account
anvil --port 8546 --silent & ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT
sleep 2
lib() { deno eval --no-lock "import * as s from '$(pwd)/../src/settlement.ts'; console.log(await ($1))"; }
deploy() { forge create "$1" --rpc-url $RPC --private-key $PK --broadcast | awk '/Deployed to/ {print $3}'; }
PAYER=$(cast wallet address $PK)
SELLER=0x000000000000000000000000000000000000B0b0
TOKEN=$(deploy test/InvoiceSettlement.t.sol:Token)
SETTLE=$(deploy src/InvoiceSettlement.sol:InvoiceSettlement)
cast send "$TOKEN" "mint(address,uint256)" "$PAYER" 100000000 --rpc-url $RPC --private-key $PK >/dev/null
REF=$(lib "s.invoiceRef('demo-invoice-token')")
cast send "$TOKEN" "$(lib "s.encodeApprove('$SETTLE', 2n ** 256n - 1n)")" --rpc-url $RPC --private-key $PK >/dev/null
TX=$(cast send "$SETTLE" "$(lib "s.encodePay('$REF', '$TOKEN', '$SELLER', 15004428n)")" --rpc-url $RPC --private-key $PK --json |
  deno eval --no-lock "console.log(JSON.parse(await new Response(Deno.stdin.readable).text()).transactionHash)")
echo "seller balance:   $(cast call "$TOKEN" "balanceOf(address)(uint256)" $SELLER --rpc-url $RPC)"
echo "contract balance: $(cast call "$TOKEN" "balanceOf(address)(uint256)" "$SETTLE" --rpc-url $RPC)"
cast receipt "$TX" --rpc-url $RPC --json | deno eval --no-lock "
  import { decodeInvoicePaid } from '$(pwd)/../src/settlement.ts';
  const r = JSON.parse(await new Response(Deno.stdin.readable).text());
  const paid = r.logs.map(decodeInvoicePaid).filter(Boolean);
  console.log(paid);
  if (paid.length !== 1 || paid[0].invoiceRef !== '$REF' || paid[0].amount !== 15004428n ||
      paid[0].seller !== '$SELLER'.toLowerCase() || paid[0].payer !== '$PAYER'.toLowerCase()) { console.error('MISMATCH'); Deno.exit(1); }
  console.log('ok: InvoicePaid decoded and matched');"
