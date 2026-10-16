import { bnrBasis, parseBnrXml, rateBefore } from "../src/bnr.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const xml2026 = `<?xml version="1.0" encoding="utf-8"?>
<DataSet xmlns="https://www.bnr.ro/xsd"><Body><OrigCurrency>RON</OrigCurrency>
<Cube date="2026-10-14"><Rate currency="EUR">5.3361</Rate><Rate currency="USD">4.5900</Rate><Rate currency="HUF" multiplier="100">1.4678</Rate></Cube>
<Cube date="2026-10-15"><Rate currency="EUR">5.3370</Rate><Rate currency="USD">4.6000</Rate></Cube>
</Body></DataSet>`;
const xml2025 = `<DataSet xmlns="http://www.bnr.ro/xsd"><Body>
<Cube date="2025-12-31"><Rate currency="EUR">5.0900</Rate></Cube></Body></DataSet>`;

Deno.test("parses both namespace variants and applies multipliers", () => {
  const t = parseBnrXml(xml2026);
  assert(t.get("2026-10-15")?.get("EUR") === 5.337, "EUR");
  assert(Math.abs((t.get("2026-10-14")?.get("HUF") ?? 0) - 0.014678) < 1e-9, "HUF per unit");
  assert(parseBnrXml(xml2025).get("2025-12-31")?.get("EUR") === 5.09, "old namespace");
});

Deno.test("uses the last fixing strictly before the operation date", () => {
  const tables = [parseBnrXml(xml2026), parseBnrXml(xml2025)];
  const r = rateBefore(tables, "EUR", "2026-10-15");
  assert(r?.date === "2026-10-14" && r.rate === 5.3361, JSON.stringify(r));
  const jan = rateBefore(tables, "EUR", "2026-01-02");
  assert(jan?.date === "2025-12-31", "falls back to previous year");
});

Deno.test("stablecoins use the USD rate; RON is 1", () => {
  assert(bnrBasis("USDT") === "USD" && bnrBasis("usdttrc20") === "USD" && bnrBasis("USDC") === "USD", "basis");
  const r = rateBefore([parseBnrXml(xml2026)], "USDT", "2026-10-16");
  assert(r?.basis === "USD" && r.rate === 4.6 && r.date === "2026-10-15", JSON.stringify(r));
  assert(rateBefore([], "RON", "2026-10-16")?.rate === 1, "RON");
});
