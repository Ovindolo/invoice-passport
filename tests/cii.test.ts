import { PDFDocument } from "pdf-lib";
import { buildCiiInvoice, type CiiInvoiceInput, frenchEndpoint, frenchMandatoryNotes } from "../src/cii.ts";
import { FACTURX_FILENAME, saveAsFacturX } from "../src/facturx.ts";
import input from "../vectors/cii-fr-fr-S.input.json" with { type: "json" };

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

const base = input as unknown as CiiInvoiceInput;

Deno.test("CII matches the committed vector", async () => {
  const r = buildCiiInvoice(base);
  assert(r.xml === await Deno.readTextFile(new URL("../vectors/cii-fr-fr-S.xml", import.meta.url)), "vector drift");
  assert(r.totals?.gross === 3227.88, String(r.totals?.gross));
});

Deno.test("CII reports problems instead of an invalid invoice", () => {
  const r = buildCiiInvoice({ ...base, seller: { ...base.seller, vatId: null }, currency: "USDC" });
  assert(r.xml === null);
  assert(r.problems.some((p) => p.includes("ISO 4217")), r.problems.join("|"));
  assert(r.problems.some((p) => p.includes("seller VAT id")), r.problems.join("|"));
});

Deno.test("French notes carry their subject codes and the 0225 endpoint", () => {
  const xml = buildCiiInvoice({
    ...base,
    notes: frenchMandatoryNotes(),
    seller: { ...base.seller, endpoint: frenchEndpoint("123 456 789") },
  }).xml!;
  for (const code of ["PMT", "PMD", "AAB"]) assert(xml.includes(`<ram:SubjectCode>${code}</ram:SubjectCode>`), code);
  assert(xml.includes('<ram:URIID schemeID="0225">123456789</ram:URIID>'));
});

Deno.test("Factur-X PDF embeds the XML with PDF/A-3 metadata", async () => {
  const xml = buildCiiInvoice(base).xml!;
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = await saveAsFacturX(pdf, xml, {
    title: "Facture",
    author: "Atelier",
    date: new Date("2026-10-18T10:00:00Z"),
  });
  const raw = new TextDecoder("latin1").decode(bytes);
  for (
    const needle of [
      "/AFRelationship /Alternative",
      "<pdfaid:part>3</pdfaid:part>",
      "<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>",
      `(${FACTURX_FILENAME})`,
      "/GTS_PDFA1",
      "/ID [",
    ]
  ) assert(raw.includes(needle), needle);
  const again = await PDFDocument.load(bytes);
  assert(again.getTitle() === "Facture");
});
