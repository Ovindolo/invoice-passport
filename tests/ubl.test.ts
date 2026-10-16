import { buildUblInvoice, countyFor, type UblInvoiceInput, validCui } from "../src/ubl.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

// Same shapes as the samples that passed ANAF's validator (stare: ok) on 2026-10-15.
const base: UblInvoiceInput = {
  number: "BLF-1",
  issueDate: "2026-10-15",
  dueDate: "2026-10-22",
  currency: "RON",
  taxRate: 0,
  note: "Servicii dezvoltare",
  seller: {
    name: "Popescu Ion PFA",
    taxId: "14399840",
    street: "Str. Memorandumului 10",
    city: "Cluj-Napoca",
    postalCode: "400114",
    country: "RO",
  },
  buyer: {
    name: "Alfa Soft SRL",
    taxId: "RO14399840",
    street: "Bd. Unirii 5, Sector 3",
    city: "Bucuresti",
    postalCode: "030167",
    country: "RO",
  },
  lines: [{ description: "Dezvoltare software", quantity: 2, unitPrice: 1500 }],
  iban: "RO49AAAA1B31007593840000",
  ronRate: null,
};

Deno.test("CUI control digit", () => {
  assert(validCui("14399840") && validCui("RO14399840") && validCui("RO 16341004"), "valid CUIs");
  assert(!validCui("45123785") && !validCui("RO123") && !validCui("abc"), "invalid CUIs");
});

Deno.test("non-VAT seller → category O with Bucharest sector as city", () => {
  const r = buildUblInvoice(base);
  assert(r.problems.length === 0 && r.vatCategory === "O", JSON.stringify(r.problems));
  assert(r.xml!.includes("<cbc:CityName>SECTOR3</cbc:CityName>"), "sector");
  assert(r.xml!.includes("<cbc:CountrySubentity>RO-CJ</cbc:CountrySubentity>"), "county from city");
  assert(r.xml!.includes('<cbc:PayableAmount currencyID="RON">3000.00</cbc:PayableAmount>'), "total");
  assert(r.xml!.includes("VATEX-EU-O") && !r.xml!.includes("<cbc:Percent>"), "O has no percent");
});

Deno.test("VAT seller in EUR → category S with a RON tax total and payment terms", () => {
  const r = buildUblInvoice({
    ...base,
    currency: "EUR",
    taxRate: 21,
    dueDate: null,
    seller: { ...base.seller, name: "Beta Consulting SRL", taxId: "RO14399840" },
    buyer: {
      name: "Gamma SRL",
      taxId: "RO16341004",
      street: "Str. Lunga 3",
      city: "Brasov",
      postalCode: "500035",
      country: "Romania",
    },
    lines: [{ description: "Consultanta", quantity: 1, unitPrice: 1000 }],
    ronRate: 5,
  });
  assert(r.problems.length === 0 && r.vatCategory === "S", JSON.stringify(r.problems));
  assert(r.xml!.includes('<cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount>'), "VAT EUR");
  assert(r.xml!.includes('<cbc:TaxAmount currencyID="RON">1050.00</cbc:TaxAmount>'), "VAT RON");
  assert(r.xml!.includes("<cac:PaymentTerms>"), "payment terms without due date");
});

Deno.test("foreign clients, stablecoin currencies and missing data are reported, not guessed", () => {
  const foreign = buildUblInvoice({ ...base, buyer: { ...base.buyer, country: "DE", city: "Berlin" } });
  assert(foreign.xml === null && foreign.problems.some((p) => p.includes("clients in Romania")), "foreign");
  const usdt = buildUblInvoice({ ...base, currency: "USDT" });
  assert(usdt.problems.some((p) => p.includes("USDT")), "stablecoin");
  const missing = buildUblInvoice({ ...base, seller: { ...base.seller, city: "Ocna Mures", street: null } });
  assert(
    missing.problems.some((p) => p.includes("street")) && missing.problems.some((p) => p.includes("county")),
    "missing",
  );
  assert(countyFor({ ...base.seller, city: "Timișoara" }) === "RO-TM", "diacritics folded");
});
