import { AED_PER_USD, localTaxRate, parseHmrcCsv } from "../src/taxfx.ts";

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

const dir = new URL("../vectors/", import.meta.url);
const ecbCsv = await Deno.readTextFile(new URL("ecb-2026-10-12_16.csv", dir));
const hmrcCsv = await Deno.readTextFile(new URL("hmrc-2026-10.csv", dir));
const fetcher =
  ((url: string) =>
    Promise.resolve(new Response(String(url).includes("trade-tariff") ? hmrcCsv : ecbCsv))) as unknown as typeof fetch;

Deno.test("HMRC CSV parses units per pound", () => {
  const r = parseHmrcCsv(hmrcCsv);
  assert(r.get("USD") === 1.3456 && r.get("EUR") === 1.1665, JSON.stringify([...r]));
});

Deno.test("UAE: USD and USDC invoices use the CBUAE peg", async () => {
  const r = await localTaxRate("Dubai", "USDC", "2026-10-15", { fetcher });
  assert(r?.currency === "AED" && r.rate === AED_PER_USD && r.basis === "USD" && r.note === null, JSON.stringify(r));
});

Deno.test("UK: HMRC monthly rate, inverted to GBP per unit", async () => {
  const r = await localTaxRate("GB", "USD", "2026-10-15", { fetcher });
  assert(r?.currency === "GBP" && r.rate === 0.743163 && r.date === "2026-10-01", JSON.stringify(r));
});

Deno.test("EU outside the euro: ECB cross, on or before the date", async () => {
  const r = await localTaxRate("PL", "USD", "2026-10-18", { fetcher });
  assert(r?.currency === "PLN" && r.date === "2026-10-16" && r.source.includes("91(2)"), JSON.stringify(r));
});

Deno.test("Romania uses BNR; invoices already in the local currency need nothing", async () => {
  const r = await localTaxRate("RO", "EUR", "2026-10-15", {
    bnr: () => Promise.resolve({ rate: 5.0912, date: "2026-10-14" }),
  });
  assert(r?.source === "BNR" && r.rate === 5.0912, JSON.stringify(r));
  assert((await localTaxRate("AE", "AED", "2026-10-15", { fetcher })) === null);
  assert((await localTaxRate("VG", "USD", "2026-10-15", { fetcher })) === null);
});
