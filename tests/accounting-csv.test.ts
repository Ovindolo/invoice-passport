import { type AccountingInvoice, toQuickBooksCsv, toXeroCsv } from "../src/accounting-csv.ts";

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

const invoice: AccountingInvoice = {
  number: "INV-2610-001",
  issueDate: "2026-10-01",
  dueDate: "2026-10-31",
  currency: "EUR",
  customer: 'Client "Big", GmbH',
  customerEmail: "ap@client.example",
  address: { line1: "Marktplatz 5", city: "Munich", postalCode: "80331", country: "DE" },
  lines: [
    { description: "Consulting", quantity: 2, unitPrice: 450, taxRate: 19 },
    { description: "=HYPERLINK(evil)", quantity: 1, unitPrice: 50, taxRate: 19 },
  ],
};
const credit: AccountingInvoice = {
  ...invoice,
  number: "CN-2610-001",
  isCreditNote: true,
  lines: [{ description: "Consulting", quantity: -1, unitPrice: 450, taxRate: 19 }],
};

Deno.test("Xero: one row per line, template header, quoting and formula neutralising", () => {
  const csv = toXeroCsv([invoice, credit], { taxType: (r) => (r ? `${r}% (VAT on Income)` : "No VAT") });
  const lines = csv.trim().split("\r\n");
  assert(
    lines[0].startsWith("*ContactName,EmailAddress,POAddressLine1") && lines[0].endsWith("Currency,BrandingTheme"),
  );
  assert(lines.length === 4, String(lines.length));
  assert(lines[1].startsWith('"Client ""Big"", GmbH",ap@client.example,Marktplatz 5'), lines[1]);
  assert(lines[1].includes(",INV-2610-001,,2026-10-01,2026-10-31,,,Consulting,2,450,,200,19% (VAT on Income),"));
  assert(lines[2].includes("'=HYPERLINK(evil)"), lines[2]);
  assert(
    lines[3].includes(",CN-2610-001,") && lines[3].includes(",Consulting,-1,450,"),
    "credit note as negative quantity",
  );
  assert(lines.every((l) => l.split(",").length >= 29), "column count");
});

Deno.test("QuickBooks: US dates, credit notes skipped, batches of 100 invoices", () => {
  const out = toQuickBooksCsv([invoice, credit]);
  assert(out.skippedCreditNotes.join() === "CN-2610-001");
  const lines = out.files[0].trim().split("\r\n");
  assert(
    lines[0] ===
      "InvoiceNo,Customer,InvoiceDate,DueDate,Terms,Location,Memo,Item(Product/Service),ItemDescription,ItemQuantity,ItemRate,ItemAmount,ItemTaxCode,Service Date",
  );
  assert(
    lines[1].includes(",10/01/2026,10/31/2026,") && lines[1].endsWith(",Sales,Consulting,2,450.00,900.00,,"),
    lines[1],
  );
  const eu = toQuickBooksCsv([invoice], { dateFormat: "DD/MM/YYYY" });
  assert(eu.files[0].includes(",01/10/2026,31/10/2026,"));
  const many = toQuickBooksCsv(Array.from({ length: 250 }, (_, i) => ({ ...invoice, number: `INV-${i}` })));
  assert(many.files.length === 3, String(many.files.length));
  assert(many.files.every((f) => f.trim().split("\r\n").length <= 1001));
});
