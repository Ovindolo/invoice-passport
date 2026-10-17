import {
  addressTopic,
  decodeTransfer,
  formatMicros,
  matchTransfers,
  onchainEvidence,
  type OnchainTransfer,
  parseChain,
  type RpcLog,
  transferAmount,
  uniquePayAmount,
  uniquePayMicros,
} from "../src/onchain.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const real = JSON.parse(await Deno.readTextFile(new URL("../vectors/onchain-logs.json", import.meta.url))) as {
  chain: "base" | "bsc";
  log: RpcLog;
}[];

Deno.test("decodes real Base USDC and BNB Chain USDT Transfer logs (captured 2026-10-17)", () => {
  const base = decodeTransfer("base", real[0].log)!;
  assert(base.asset === "USDC" && base.value === 647906770n && base.micros === 647906770n, String(base.value));
  assert(transferAmount(base) === "647.90677", transferAmount(base));
  assert(base.to === "0xabe0db2386551471c655a8c21f2107d071be50c5" && base.logIndex === 1, base.to);
  const bsc = decodeTransfer("bsc", real[1].log)!;
  assert(bsc.asset === "USDT" && bsc.value === 6909098025666781291n, String(bsc.value));
  assert(bsc.micros === null, "18-decimal value with sub-micro precision has no exact micros");
  assert(transferAmount(bsc) === "6.909098025666781291", transferAmount(bsc));
});

Deno.test("unknown tokens, other events and removed logs are ignored", () => {
  const log = real[0].log;
  assert(decodeTransfer("ethereum", log) === null, "same address on another chain is not that token");
  assert(decodeTransfer("base", { ...log, address: "0x0000000000000000000000000000000000000001" }) === null, "fake");
  assert(decodeTransfer("base", { ...log, topics: [log.topics[0], log.topics[1]] }) === null, "not ERC-20 Transfer");
  assert(decodeTransfer("base", { ...log, removed: true }) === null, "reorged");
});

Deno.test("unique pay amounts are stable, add 0.000001–0.009999 and keep cents", () => {
  const a = uniquePayAmount("6f1c9a52-0000-4000-8000-000000000001", 100);
  assert(a === uniquePayAmount("6f1c9a52-0000-4000-8000-000000000001", 100), "deterministic");
  assert(/^100\.00\d{4}$/.test(a) && a !== "100.000000", a);
  assert(formatMicros(1n) === "0.000001" && formatMicros(15_004_213n) === "15.004213", "format");
  const ids = Array.from({ length: 200 }, (_, i) => `invoice-${i}`);
  const tags = new Set(ids.map((id) => uniquePayMicros(id, 10)));
  assert(tags.size >= 195, `few collisions among 200 invoices: ${200 - tags.size}`);
});

Deno.test("network labels map to chains", () => {
  assert(parseChain("base") === "base" && parseChain("USDC on Base") === "base", "base");
  assert(parseChain("USDT / ERC20") === "ethereum" && parseChain("Ethereum") === "ethereum", "eth");
  assert(parseChain("BEP20") === "bsc" && parseChain("BNB Chain") === "bsc", "bsc");
  assert(parseChain("TRC20") === null && parseChain(null) === null, "unsupported");
  assert(addressTopic("0xABE0db2386551471c655A8c21F2107d071Be50c5") === real[0].log.topics[2], "topic");
});

Deno.test("matching: exact unique amount auto, plain total as suggestion, others unmatched", () => {
  const invoices = [
    { id: "inv-a", number: "A-1", total: 100, currency: "USD" },
    { id: "inv-b", number: "B-2", total: 50, currency: "USDT" },
    { id: "inv-c", number: "C-3", total: 75, currency: "EUR" },
  ];
  const t = (micros: bigint, i: number): OnchainTransfer => ({
    chain: "base",
    asset: "USDC",
    token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    from: "0xfrom",
    to: "0xto",
    value: micros,
    micros,
    blockNumber: 1,
    txHash: `0x${i}`,
    logIndex: 0,
  });
  const r = matchTransfers([
    t(uniquePayMicros("inv-a", 100), 1), // exact
    t(50_000_000n, 2), // plain total of inv-b
    t(75_000_000n, 3), // EUR invoice never matches a USD stablecoin
    t(uniquePayMicros("inv-a", 100), 4), // same exact amount again: invoice already used
  ], invoices);
  assert(r[0].method === "exact" && r[0].invoice?.id === "inv-a", "exact");
  assert(r[1].method === "amount" && r[1].invoice?.id === "inv-b", "suggestion");
  assert(r[2].invoice === null && r[3].invoice === null, "unmatched");
  const e = onchainEvidence(r[0].transfer, "2026-10-17T00:00:00Z", "exact");
  assert(
    e.rail === "onchain" && e.chain === "base" && e.amount === Number(formatMicros(uniquePayMicros("inv-a", 100))),
    "evidence",
  );
});
