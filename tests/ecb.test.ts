import { ecbCross, eurRateOnOrBefore, fetchEcb, parseEcbCsv } from "../src/ecb.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const csv = await Deno.readTextFile(new URL("../vectors/ecb-2026-10-12_16.csv", import.meta.url));

Deno.test("parses the ECB SDMX CSV (captured 2026-10-18)", () => {
  const t = parseEcbCsv(csv);
  assert(t.get("USD")?.get("2026-10-16") === 1.1253 && t.get("PLN")?.get("2026-10-12") === 4.385, "values");
  assert(t.get("GBP")?.size === 5, "five working days");
});

Deno.test("last publication on or before the date; weekends use Friday", () => {
  const t = parseEcbCsv(csv);
  assert(eurRateOnOrBefore(t, "USD", "2026-10-18")?.date === "2026-10-16", "Sunday → Friday");
  assert(eurRateOnOrBefore(t, "USD", "2026-10-11") === null, "before the window");
  assert(eurRateOnOrBefore(t, "EUR", "2026-10-18")?.rate === 1, "EUR");
});

Deno.test("cross rates through the euro", () => {
  const t = parseEcbCsv(csv);
  const usdPln = ecbCross(t, "USD", "PLN", "2026-10-16")!;
  assert(Math.abs(usdPln.rate - 4.37 / 1.1253) < 1e-12, `USD→PLN ${usdPln.rate}`);
  assert(ecbCross(t, "EUR", "GBP", "2026-10-16")!.rate === 0.84385, "EUR→GBP");
  assert(Math.abs(ecbCross(t, "GBP", "EUR", "2026-10-16")!.rate - 1 / 0.84385) < 1e-12, "GBP→EUR");
  assert(ecbCross(t, "USD", "XYZ", "2026-10-16") === null, "unknown currency");
});

Deno.test("fetchEcb builds one request for all currencies and skips EUR", async () => {
  const urls: string[] = [];
  const fake = ((u: string) => {
    urls.push(u);
    return Promise.resolve(new Response(csv));
  }) as unknown as typeof fetch;
  const t = await fetchEcb(["usd", "EUR", "PLN", "USD"], "2026-10-12", "2026-10-16", fake);
  assert(urls.length === 1 && urls[0].includes("/D.USD+PLN.EUR.SP00.A?startPeriod=2026-10-12"), urls[0]);
  assert(t.has("USD"), "parsed");
  assert(
    (await fetchEcb(["EUR"], "2026-10-12", "2026-10-16", fake)).size === 0 && urls.length === 1,
    "EUR only → no call",
  );
});
