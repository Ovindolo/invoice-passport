/**
 * Demo: pay a Billify invoice in USDG on Robinhood Chain (chain id 4663).
 *
 * The invoice page shows the seller's wallet and the exact amount ("Send exactly 15.004428");
 * the last digits identify the invoice, so Billify's wallet watcher marks it paid once the
 * transfer is final (about 15–20 minutes on Robinhood Chain).
 *
 *   PAYER_PRIVATE_KEY=0x… deno run --allow-net --allow-env examples/robinhood-usdg-pay-invoice.ts \
 *     --to 0xSellerWallet --amount 15.004428
 *
 * Only this example uses viem (deno.json imports); the library itself has no dependencies.
 * The key is read from the environment for this run only and never written anywhere. The payer
 * needs USDG and a little ETH for gas on Robinhood Chain.
 */
import { createWalletClient, defineChain, encodeFunctionData, http, parseUnits, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [Deno.env.get("RPC_URL_ROBINHOOD") || "https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const arg = (name: string) => {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 ? Deno.args[i + 1] : undefined;
};
const to = arg("to");
const amount = arg("amount");
const key = Deno.env.get("PAYER_PRIVATE_KEY");
if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to) || !amount || !/^\d+(\.\d{1,6})?$/.test(amount) || !key) {
  console.error("usage: PAYER_PRIVATE_KEY=0x… robinhood-usdg-pay-invoice.ts --to 0xSellerWallet --amount 15.004428");
  Deno.exit(2);
}

const account = privateKeyToAccount(key as `0x${string}`);
const client = createWalletClient({ account, chain: robinhood, transport: http() }).extend(publicActions);
const data = encodeFunctionData({
  abi: [{
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }],
    outputs: [{ type: "bool" }],
  }],
  functionName: "transfer",
  args: [to as `0x${string}`, parseUnits(amount, 6)],
});
console.log(`Paying ${amount} USDG from ${account.address} to ${to} on Robinhood Chain…`);
const hash = await client.sendTransaction({ to: USDG, data });
const receipt = await client.waitForTransactionReceipt({ hash });
console.log(`${receipt.status === "success" ? "Sent" : "FAILED"}: https://robinhoodchain.blockscout.com/tx/${hash}`);
console.log("Billify marks the invoice paid once the block is final (about 15–20 minutes).");
