/**
 * An AI agent pays a Billify invoice privately: every request (the invoice, the Base RPC, the proof)
 * goes through the Anyone network, so neither Billify nor the RPC provider sees the agent's IP.
 *
 *   1. GET the payable invoice → 402 with an MPP challenge (evm charge, USDC on Base)
 *   2. send exactly the requested USDC to the seller (only with PAYER_PRIVATE_KEY; otherwise dry run)
 *   3. retry with Authorization: Payment <hash credential> → 200 + Payment-Receipt
 *   4. fetch the signed Invoice Passport and verify it
 *
 *   npx @anyone-protocol/anyone-client      # in another terminal (SOCKS on 9050)
 *   deno run --allow-net --allow-env examples/agent-pay-over-anyone.ts --token <public invoice token>
 *   PAYER_PRIVATE_KEY=0x… deno run --allow-net --allow-env examples/agent-pay-over-anyone.ts --token …
 *
 * The key is read from the environment for this run only. The payer needs USDC and a little ETH on Base.
 */
import { createWalletClient, encodeFunctionData, http, publicActions } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { anyoneFetch, anyoneHttpClient, anyoneReachable } from "../src/anyone.ts";
import { fromBase64url, mppCredential, parseMppChallenges } from "../src/mpp.ts";
import { verifyPassport } from "../src/passport.ts";
import type { EvmChargeRequest } from "../src/mpp.ts";
import type { Jwks } from "../src/jws.ts";

const FUNCTIONS = Deno.env.get("BILLIFY_FUNCTIONS") || "https://brrstlblwhnfyirwcgoh.supabase.co/functions/v1";
const i = Deno.args.indexOf("--token");
const token = i >= 0 ? Deno.args[i + 1] : undefined;
if (!token) {
  console.error("usage: agent-pay-over-anyone.ts --token <public invoice token>");
  Deno.exit(2);
}
if (!(await anyoneReachable())) {
  console.error("Start an Anyone client first: npx @anyone-protocol/anyone-client");
  Deno.exit(2);
}
const anon = anyoneFetch();
const invoiceUrl = `${FUNCTIONS}/x402-invoice?token=${token}`;

// 1. Ask for the invoice.
const first = await anon(invoiceUrl, { signal: AbortSignal.timeout(60_000) });
if (first.status !== 402) {
  console.log(`Invoice answered ${first.status}:`, await first.text());
  Deno.exit(0);
}
const challenge = parseMppChallenges(first.headers.get("WWW-Authenticate")).find((c) =>
  c.method === "evm" && c.intent === "charge"
);
if (!challenge) throw new Error("No MPP evm charge challenge offered");
const req = JSON.parse(fromBase64url(challenge.request)) as EvmChargeRequest;
console.log(`Invoice asks ${Number(req.amount) / 1e6} USDC to ${req.recipient} on chain ${req.methodDetails.chainId}`);

const key = Deno.env.get("PAYER_PRIVATE_KEY");
if (!key) {
  console.log("Dry run: set PAYER_PRIVATE_KEY to pay. Everything above went through Anyone.");
  Deno.exit(0);
}

// 2. Pay, with the RPC traffic through Anyone too.
const account = privateKeyToAccount(key as `0x${string}`);
const wallet = createWalletClient({
  account,
  chain: base,
  transport: http(Deno.env.get("RPC_URL_BASE") || "https://mainnet.base.org", {
    fetchOptions: { client: anyoneHttpClient() } as RequestInit,
  }),
}).extend(publicActions);
const hash = await wallet.sendTransaction({
  to: req.currency as `0x${string}`,
  data: encodeFunctionData({
    abi: [{
      type: "function",
      name: "transfer",
      stateMutability: "nonpayable",
      inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }],
      outputs: [{ type: "bool" }],
    }],
    functionName: "transfer",
    args: [req.recipient as `0x${string}`, BigInt(req.amount)],
  }),
});
await wallet.waitForTransactionReceipt({ hash });
console.log(`Paid: https://basescan.org/tx/${hash}`);

// 3. Prove it to Billify.
const paid = await anon(invoiceUrl, {
  headers: {
    Authorization: mppCredential(challenge, { type: "hash", hash }, `did:pkh:eip155:8453:${account.address}`),
  },
  signal: AbortSignal.timeout(120_000),
});
console.log(`Billify answered ${paid.status}:`, await paid.json());
const receipt = paid.headers.get("Payment-Receipt");
if (receipt) console.log("Payment-Receipt:", JSON.parse(fromBase64url(receipt)));

// 4. Verify the signed proof that ties the invoice to this payment.
const passport = await (await anon(`${FUNCTIONS}/invoice-passport?token=${token}`)).json();
const jwks = await (await anon(`${FUNCTIONS}/invoice-passport?jwks=1`)).json() as Jwks;
const verdict = await verifyPassport(passport.proof?.jws ?? passport.jws, jwks);
console.log("Invoice Passport:", verdict.ok ? `valid, signed by ${verdict.kid}` : `INVALID (${verdict.reason})`);
