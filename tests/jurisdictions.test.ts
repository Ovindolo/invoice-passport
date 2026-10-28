import { checkCompliance, detectJurisdiction, jurisdiction, jurisdictions } from "../src/jurisdictions.ts";

const codes = (r: ReturnType<typeof checkCompliance>) => r.findings.map((f) => f.code);

Deno.test("every jurisdiction is reviewed and every EU one names the VAT directive", () => {
  for (const j of jurisdictions()) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(j.reviewed), j.code);
    if (j.tax) assert(j.tax.standardRate > 0 && j.tax.standardRate < 30, j.code);
    if (j.tax?.idPattern && j.tax.idExample) {
      assert(j.tax.idPattern.test(j.tax.idExample.replace(/[\s.-]/g, "").toUpperCase()), `${j.code} example`);
    }
  }
  assert(jurisdiction("DE")!.sources[0].includes("2006/112"));
});

Deno.test("detects the jurisdiction from the country name or the tax id", () => {
  assertEquals(detectJurisdiction("Dubai", null)?.code, "AE");
  assertEquals(detectJurisdiction("Singapore", null)?.code, "SG");
  assertEquals(detectJurisdiction("British Virgin Islands", null)?.code, "VG");
  assertEquals(detectJurisdiction(null, "100123456700003")?.code, "AE");
  assertEquals(detectJurisdiction(null, "CHE-123.456.789 MWST")?.code, "CH");
  assertEquals(detectJurisdiction(null, "EL123456789")?.code, "GR");
  assertEquals(detectJurisdiction("", "12345678"), null);
});

Deno.test("UAE seller invoicing in USDC-priced USD must show the VAT in AED", () => {
  const r = checkCompliance({
    seller: { country: "AE", taxId: "100123456700003" },
    invoice: { currency: "USD", taxRate: 5 },
  });
  assertEquals(r.jurisdiction?.code, "AE");
  assertEquals(codes(r).slice(0, 1), ["LOCAL_TAX_AMOUNT"]);
  assert(codes(r).includes("E_INVOICING"));
});

Deno.test("no-VAT jurisdictions must not charge tax", () => {
  const r = checkCompliance({ seller: { country: "BVI", taxId: null }, invoice: { currency: "USD", taxRate: 10 } });
  assertEquals(r.findings[0].code, "TAX_WITHOUT_REGIME");
  assertEquals(r.findings[0].level, "error");
  assert(!codes(r).includes("NO_TAX_ID"));
});

Deno.test("EU cross-border B2B with VAT charged suggests reverse charge", () => {
  const r = checkCompliance({
    seller: { country: "RO", taxId: "RO12345678" },
    invoice: { currency: "EUR", taxRate: 21, buyerCountry: "DE", buyerTaxId: "DE123456789" },
  });
  assert(codes(r).includes("EU_REVERSE_CHARGE"));
  assert(codes(r).includes("LOCAL_TAX_AMOUNT"));
});

// [country as a seller types it, code, a tax id in the local format (null when no format is recorded)]
const MARKETS: [string, string, string | null][] = [
  ["India", "IN", "29ABCDE1234F1Z5"],
  ["Australia", "AU", "51 824 753 556"],
  ["New Zealand", "NZ", null],
  ["Canada", "CA", "123456789 RT 0001"],
  ["日本", "JP", "T1234567890123"],
  ["Norge", "NO", "123 456 789 MVA"],
  ["Saudi Arabia", "SA", "310123456700003"],
  ["Turkey", "TR", null],
  ["México", "MX", null],
  ["South Africa", "ZA", "4123456789"],
  ["Nigeria", "NG", null],
  ["Kenya", "KE", "P123456789Z"],
  ["Malaysia", "MY", null],
  ["Israel", "IL", null],
  ["Ísland", "IS", null],
];

Deno.test("global markets are detected by country name, sourced, and accept their tax id format", () => {
  for (const [country, code, taxId] of MARKETS) {
    const j = detectJurisdiction(country, null);
    assertEquals(j?.code, code);
    assert(j!.sources.length > 0 && j!.sources.every((s) => s.startsWith("https://")), `${code} sources`);
    if (taxId) {
      assert(!codes(checkCompliance({ seller: { country, taxId } })).includes("TAX_ID_FORMAT"), `${code} id`);
      assert(codes(checkCompliance({ seller: { country, taxId: "X-1" } })).includes("TAX_ID_FORMAT"), `${code} bad id`);
    }
  }
});

Deno.test("distinctive tax ids name the jurisdiction without a country", () => {
  assertEquals(detectJurisdiction(null, "T1234567890123")?.code, "JP");
  assertEquals(detectJurisdiction(null, "310123456700003")?.code, "SA");
  assertEquals(detectJurisdiction(null, "123456789 RT 0001")?.code, "CA");
  assertEquals(detectJurisdiction(null, "NO 123 456 789 MVA")?.code, "NO");
  assertEquals(detectJurisdiction(null, "P123456789Z")?.code, "KE");
  // ten digits alone could be many countries' ids
  assertEquals(detectJurisdiction(null, "4123456789"), null);
});

Deno.test("Saudi and Japanese sellers invoicing in USD must show the tax in SAR and JPY", () => {
  const sa = checkCompliance({
    seller: { country: "SA", taxId: "310123456700003" },
    invoice: { currency: "USD", taxRate: 15 },
  });
  assertEquals(codes(sa).slice(0, 1), ["LOCAL_TAX_AMOUNT"]);
  assert(codes(sa).includes("E_INVOICING"));
  const jp = checkCompliance({
    seller: { country: "JP", taxId: "T1234567890123" },
    invoice: { currency: "USD", taxRate: 10 },
  });
  assertEquals(codes(jp).slice(0, 1), ["LOCAL_TAX_AMOUNT"]);
});

Deno.test("Canadian HST is not flagged as above the standard GST rate", () => {
  const rate = (taxRate: number) =>
    codes(
      checkCompliance({
        seller: { country: "Canada", taxId: "123456789RT0001" },
        invoice: { currency: "CAD", taxRate },
      }),
    );
  assert(!rate(13).includes("RATE_ABOVE_STANDARD"));
  assert(rate(16).includes("RATE_ABOVE_STANDARD"));
});

Deno.test("flags a malformed tax id and a missing country", () => {
  assert(codes(checkCompliance({ seller: { country: "SG", taxId: "ABC" } })).includes("TAX_ID_FORMAT"));
  assertEquals(codes(checkCompliance({ seller: { country: null, taxId: null } })), ["NO_COUNTRY"]);
  assertEquals(codes(checkCompliance({ seller: { country: "Narnia", taxId: null } })), ["UNKNOWN_JURISDICTION"]);
  assert(!codes(checkCompliance({ seller: { country: "RO", taxId: "12345678" } })).includes("TAX_ID_FORMAT"));
});

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
