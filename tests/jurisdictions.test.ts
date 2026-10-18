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
