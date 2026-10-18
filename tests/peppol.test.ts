import { buildPeppolInvoice, peppolEndpointForVat, type PeppolInvoiceInput } from "../src/peppol.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const vectors = new URL("../vectors/", import.meta.url);
const read = (name: string) => Deno.readTextFile(new URL(name, vectors));
const input = async (name: string) => JSON.parse(await read(`${name}.input.json`)) as PeppolInvoiceInput;
const NAMES = [
  "peppol-domestic-S-E",
  "peppol-reverse-charge-AE",
  "peppol-intra-community-K",
  "peppol-export-G",
  "peppol-outside-scope-O",
];

// The XML vectors pass the UBL 2.1 XSD and the official CEN + OpenPeppol schematron (conformance/run.sh).
Deno.test("Peppol vectors are reproduced byte for byte", async () => {
  for (const name of NAMES) {
    const r = buildPeppolInvoice(await input(name));
    assert(r.problems.length === 0, `${name}: ${r.problems.join("; ")}`);
    assert(r.xml === (await read(`${name}.xml`)), `${name}.xml`);
  }
});

Deno.test("mixed rates are grouped per category and rate", async () => {
  const xml = buildPeppolInvoice(await input("peppol-domestic-S-E")).xml!;
  // 900 @19% = 171.00, 59.70 @7% = 4.18 (4.179), 300 exempt
  assert(xml.includes('<cbc:TaxAmount currencyID="EUR">175.18</cbc:TaxAmount>'), "total VAT");
  assert(xml.includes('<cbc:PayableAmount currencyID="EUR">1434.88</cbc:PayableAmount>'), "payable");
  assert(xml.includes("<cbc:TaxExemptionReason>Exempt under §4 Nr. 21 UStG</cbc:TaxExemptionReason>"), "E reason");
  assert((xml.match(/<cac:TaxSubtotal>/g) ?? []).length === 3, "three subtotals");
});

Deno.test("reverse charge carries VATEX-EU-AE and a RON tax total", async () => {
  const xml = buildPeppolInvoice(await input("peppol-reverse-charge-AE")).xml!;
  assert(xml.includes("<cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode>"), "vatex");
  assert(xml.includes("<cbc:TaxCurrencyCode>RON</cbc:TaxCurrencyCode>"), "tax currency");
  assert(xml.includes("<cbc:PaymentID>RF18539007547034</cbc:PaymentID>"), "RF reference as PaymentID");
});

Deno.test("contradictions are reported instead of producing a rejectable invoice", async () => {
  const ae = await input("peppol-reverse-charge-AE");
  const noBuyerVat = buildPeppolInvoice({ ...ae, buyer: { ...ae.buyer, vatId: null } });
  assert(noBuyerVat.xml === null && noBuyerVat.problems.some((p) => p.includes("buyer VAT id")), "AE buyer VAT");

  const k = await input("peppol-intra-community-K");
  assert(buildPeppolInvoice({ ...k, delivery: null }).problems.some((p) => p.includes("delivery")), "K delivery");

  const mixedO = buildPeppolInvoice({
    ...ae,
    lines: [...ae.lines, { description: "x", quantity: 1, unitPrice: 1, vatCategory: "O", vatRate: 0 }],
  });
  assert(mixedO.problems.some((p) => p.includes("cannot be combined")), "O mixed");

  const de = await input("peppol-domestic-S-E");
  const noContact = buildPeppolInvoice({ ...de, seller: { ...de.seller, contact: null } });
  assert(noContact.problems.some((p) => p.includes("seller contact")), "DE-R-002");
  const noRef = buildPeppolInvoice({ ...de, buyerReference: null });
  assert(noRef.problems.some((p) => p.includes("buyer reference")), "PEPPOL-EN16931-R003");
  const exempt = buildPeppolInvoice({ ...de, exemptionReasons: {} });
  assert(exempt.problems.some((p) => p.includes("exemption reason")), "E needs reason");
  const badRf = buildPeppolInvoice({
    ...de,
    payment: { iban: "DE89370400440532013000", reference: "RF19539007547034" },
  });
  assert(badRf.problems.some((p) => p.includes("RF creditor reference")), "bad RF");
  const usdt = buildPeppolInvoice({ ...de, currency: "USDT" });
  assert(usdt.problems.some((p) => p.includes("USDT")), "stablecoin");
  const wrongRate = buildPeppolInvoice({ ...de, lines: [{ ...de.lines[2], vatRate: 7 }] });
  assert(wrongRate.problems.some((p) => p.includes("must be 0%")), "E with a rate");
});

Deno.test("endpoint suggestion from a VAT id uses the official EAS VAT schemes", () => {
  assert(JSON.stringify(peppolEndpointForVat("de 811 907 980")) === '{"scheme":"9930","id":"DE811907980"}', "DE");
  assert(
    peppolEndpointForVat("RO14399840")?.scheme === "9947" && peppolEndpointForVat("FR12345678901")?.scheme === "9957",
    "RO/FR",
  );
  assert(
    peppolEndpointForVat("14399840") === null && peppolEndpointForVat("US123") === null &&
      peppolEndpointForVat(null) === null,
    "no prefix / unknown",
  );
});
