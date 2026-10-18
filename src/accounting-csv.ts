/**
 * CSV files for importing invoices into accounting software, one row per invoice line:
 * - Xero: the sales invoice import template (Sales > Invoices > Import). An invoice whose total is
 *   negative (a credit note stored with negative quantities) is imported by Xero as a credit note.
 * - QuickBooks Online: the invoice import (Settings > Import data > Invoices), with the columns of
 *   Intuit's example file. QuickBooks rejects negative amounts, so credit notes are left out and
 *   reported, and files are split at 1,000 rows / 100 invoices.
 * Pure functions, no dependencies.
 */

export interface AccountingInvoice {
  number: string;
  issueDate: string;
  dueDate?: string | null;
  currency: string;
  /** client display name, as it should appear in the accounting software */
  customer: string;
  customerEmail?: string | null;
  address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null;
  reference?: string | null;
  note?: string | null;
  isCreditNote?: boolean;
  lines: { description: string; quantity: number; unitPrice: number; taxRate?: number | null }[];
}

const XERO_HEADER = [
  "*ContactName",
  "EmailAddress",
  "POAddressLine1",
  "POAddressLine2",
  "POAddressLine3",
  "POAddressLine4",
  "POCity",
  "PORegion",
  "POPostalCode",
  "POCountry",
  "*InvoiceNumber",
  "Reference",
  "*InvoiceDate",
  "*DueDate",
  "Total",
  "InventoryItemCode",
  "*Description",
  "*Quantity",
  "*UnitAmount",
  "Discount",
  "*AccountCode",
  "*TaxType",
  "TaxAmount",
  "TrackingName1",
  "TrackingOption1",
  "TrackingName2",
  "TrackingOption2",
  "Currency",
  "BrandingTheme",
];

const QUICKBOOKS_HEADER = [
  "InvoiceNo",
  "Customer",
  "InvoiceDate",
  "DueDate",
  "Terms",
  "Location",
  "Memo",
  "Item(Product/Service)",
  "ItemDescription",
  "ItemQuantity",
  "ItemRate",
  "ItemAmount",
  "ItemTaxCode",
  "Service Date",
];

/** RFC 4180 field: quoted when it holds a comma, quote or line break; formula prefixes neutralised. */
function cell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`; // spreadsheet formula injection
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (cells: (string | number | null | undefined)[]) => cells.map(cell).join(",");
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const amount = (n: number) => round2(n).toFixed(2);

export interface XeroOptions {
  /** sales account code in the chart of accounts; Xero's default revenue account is 200 */
  accountCode?: string;
  /** the Xero tax rate name for a line rate, e.g. 21 → "21% (VAT on Income)"; blank uses the account default */
  taxType?: (rate: number) => string;
}

export function toXeroCsv(invoices: AccountingInvoice[], opts: XeroOptions = {}): string {
  const account = opts.accountCode ?? "200";
  const out = [row(XERO_HEADER)];
  for (const inv of invoices) {
    inv.lines.forEach((l, i) => {
      const a = i === 0 ? inv.address : null;
      out.push(row([
        inv.customer,
        i === 0 ? inv.customerEmail : "",
        a?.line1,
        a?.line2,
        "",
        "",
        a?.city,
        "",
        a?.postalCode,
        a?.country,
        inv.number,
        inv.reference ?? "",
        inv.issueDate,
        inv.dueDate ?? inv.issueDate,
        "",
        "",
        l.description,
        l.quantity,
        l.unitPrice,
        "",
        account,
        opts.taxType ? opts.taxType(l.taxRate ?? 0) : "",
        "",
        "",
        "",
        "",
        "",
        inv.currency,
        "",
      ]));
    });
  }
  return out.join("\r\n") + "\r\n";
}

export interface QuickBooksOptions {
  /** the date format chosen in the QuickBooks import screen; US default MM/DD/YYYY */
  dateFormat?: "MM/DD/YYYY" | "DD/MM/YYYY";
  /** product/service name; QuickBooks uses its generic "Sales" item when it does not exist */
  item?: string;
  /** item tax code, required for UK and Canadian companies */
  taxCode?: (rate: number) => string;
}

export interface QuickBooksExport {
  /** one CSV per batch of at most 1,000 rows and 100 invoices */
  files: string[];
  /** credit notes QuickBooks cannot import (enter them as credit memos by hand) */
  skippedCreditNotes: string[];
}

export function toQuickBooksCsv(invoices: AccountingInvoice[], opts: QuickBooksOptions = {}): QuickBooksExport {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-");
    return opts.dateFormat === "DD/MM/YYYY" ? `${d}/${m}/${y}` : `${m}/${d}/${y}`;
  };
  const files: string[] = [];
  const skippedCreditNotes: string[] = [];
  let rows: string[] = [];
  let count = 0;
  const flush = () => {
    if (rows.length) files.push([row(QUICKBOOKS_HEADER), ...rows].join("\r\n") + "\r\n");
    rows = [];
    count = 0;
  };
  for (const inv of invoices) {
    const total = inv.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    if (inv.isCreditNote || total < 0 || inv.lines.some((l) => l.quantity < 0 || l.unitPrice < 0)) {
      skippedCreditNotes.push(inv.number);
      continue;
    }
    if (count >= 100 || rows.length + inv.lines.length > 999) flush();
    count++;
    for (const l of inv.lines) {
      rows.push(row([
        inv.number,
        inv.customer,
        fmt(inv.issueDate),
        fmt(inv.dueDate ?? inv.issueDate),
        "",
        "",
        inv.note?.slice(0, 1000) ?? "",
        opts.item ?? "Sales",
        l.description,
        l.quantity,
        amount(l.unitPrice),
        amount(l.quantity * l.unitPrice),
        opts.taxCode ? opts.taxCode(l.taxRate ?? 0) : "",
        "",
      ]));
    }
  }
  flush();
  return { files, skippedCreditNotes };
}
