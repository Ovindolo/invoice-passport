import { AE_EXPORT_ENDPOINT, buildPintInvoice, pintEndpoint, type PintInvoiceInput } from "../src/pint.ts";

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

const dir = new URL("../vectors/", import.meta.url);
const load = async (name: string) =>
  JSON.parse(await Deno.readTextFile(new URL(`${name}.input.json`, dir))) as PintInvoiceInput;

Deno.test("PINT vectors match the builder", async () => {
  for (
    const name of [
      "pint-ae-domestic-S",
      "pint-ae-usd-S",
      "pint-ae-export-Z",
      "pint-sg-domestic-SR",
      "pint-sg-usd-SR",
      "pint-sg-export-ZR",
    ]
  ) {
    const r = buildPintInvoice(await load(name));
    assert(r.xml === await Deno.readTextFile(new URL(`${name}.xml`, dir)), `${name} drift: ${r.problems.join("; ")}`);
  }
});

Deno.test("UAE: TIN endpoint from the TRN, predefined endpoint for exports, AED totals", async () => {
  assert(pintEndpoint("ae", { country: "AE", taxId: "100123456700003" })?.id === "1001234567");
  assert(pintEndpoint("ae", { country: "US" }) === AE_EXPORT_ENDPOINT);
  const xml = buildPintInvoice(await load("pint-ae-usd-S")).xml!;
  for (
    const needle of [
      "<cbc:CalculationRate>3.6725</cbc:CalculationRate>",
      '<cbc:TaxAmount currencyID="AED">91.81</cbc:TaxAmount>',
      "aedtotal-incl-vat",
      "<cbc:ProfileExecutionID>00000000</cbc:ProfileExecutionID>",
    ]
  ) {
    assert(xml.includes(needle), needle);
  }
  assert(
    buildPintInvoice(await load("pint-ae-export-Z")).xml!.includes(
      "<cbc:ProfileExecutionID>00000001</cbc:ProfileExecutionID>",
    ),
  );
});

Deno.test("UAE: missing emirate, licence authority and SAC code come back as problems", async () => {
  const input = await load("pint-ae-domestic-S");
  const r = buildPintInvoice({
    ...input,
    seller: { ...input.seller, subdivision: "Dubai", legalId: { id: "1", type: "TL" } },
    lines: [{ ...input.lines[0], serviceCode: null }],
  });
  assert(r.xml === null);
  for (const p of ["emirate", "trade licence", "SAC"]) {
    assert(r.problems.some((x) => x.includes(p)), `${p}: ${r.problems.join("|")}`);
  }
});

Deno.test("Singapore: SGD totals for foreign currency, NG rules", async () => {
  const xml = buildPintInvoice(await load("pint-sg-usd-SR")).xml!;
  assert(xml.includes("sgdtotal-excl-gst") && xml.includes("<cbc:TaxCurrencyCode>SGD</cbc:TaxCurrencyCode>"));
  const input = await load("pint-sg-domestic-SR");
  const ng = buildPintInvoice({ ...input, lines: [{ ...input.lines[0], taxCategory: "NG", taxRate: 0 }] });
  assert(ng.problems.some((p) => p.includes("NG")), ng.problems.join("|"));
});

Deno.test("credit notes: CreditNote 381 with the credited invoice, and a reason code in the UAE", async () => {
  const input = await load("pint-ae-credit-note-S");
  const xml = buildPintInvoice(input).xml!;
  for (
    const needle of [
      "<CreditNote ",
      "<cbc:CreditNoteTypeCode>381",
      "<cbc:ResponseCode>DL8.61.1.A",
      "<cac:CreditNoteLine>",
      "<cbc:ID>DL-2026-0101</cbc:ID>",
    ]
  ) {
    assert(xml.includes(needle), needle);
  }
  const noReason = buildPintInvoice({ ...input, creditReason: null });
  assert(noReason.problems.some((p) => p.includes("reason code")), noReason.problems.join("|"));
  const noInvoice = buildPintInvoice({ ...input, precedingInvoice: null });
  assert(noInvoice.problems.some((p) => p.includes("credits")), noInvoice.problems.join("|"));
});
