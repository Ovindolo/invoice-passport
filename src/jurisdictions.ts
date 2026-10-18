/**
 * Invoicing rules per jurisdiction: indirect tax, tax id, the currency tax amounts must be shown in,
 * and the e-invoicing system. Data, not advice: each entry lists its sources and the date it was last
 * reviewed, and the checks return findings for the seller (or their accountant) to act on.
 */
import { countryCode } from "./ubl.ts";

export interface Jurisdiction {
  code: string;
  name: string;
  /** Null when the jurisdiction has no VAT/GST. */
  tax: {
    name: string;
    /** Standard rate in percent. */
    standardRate: number;
    idLabel: string;
    idPattern?: RegExp;
    idExample?: string;
  } | null;
  currency: string;
  /** When invoicing in another currency, the tax must also be shown in this one. */
  localTaxCurrency: { currency: string; rateSource: string; rule: string } | null;
  eInvoicing: {
    status: "mandatory" | "phased" | "planned" | "voluntary";
    system: string;
    format: string;
    detail: string;
  } | null;
  notes: string[];
  sources: string[];
  reviewed: string;
}

export interface Finding {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
}

const EU_VAT_DIRECTIVE = "https://eur-lex.europa.eu/eli/dir/2006/112/oj";
const PEPPOL_B2G =
  "Peppol BIS Billing 3.0 is accepted EU-wide; B2G e-invoicing is mandatory under Directive 2014/55/EU.";

interface EuRow {
  name: string;
  rate: number;
  currency: string;
  rateSource: string;
  idPattern: RegExp;
  idExample: string;
  eInvoicing?: Jurisdiction["eInvoicing"];
  sources?: string[];
}

/** VAT id patterns follow the VIES formats; rates are the standard rates as of the review date. */
const EU: Record<string, EuRow> = {
  AT: {
    name: "Austria",
    rate: 20,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^ATU\d{8}$/,
    idExample: "ATU12345678",
  },
  BE: {
    name: "Belgium",
    rate: 21,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^BE[01]\d{9}$/,
    idExample: "BE0123456789",
    eInvoicing: {
      status: "mandatory",
      system: "Peppol",
      format: "Peppol BIS Billing 3.0",
      detail: "Structured B2B e-invoices between Belgian VAT-registered businesses since 1 January 2026.",
    },
    sources: ["https://einvoice.belgium.be/en"],
  },
  BG: {
    name: "Bulgaria",
    rate: 20,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^BG\d{9,10}$/,
    idExample: "BG123456789",
  },
  HR: {
    name: "Croatia",
    rate: 25,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^HR\d{11}$/,
    idExample: "HR12345678901",
    eInvoicing: {
      status: "mandatory",
      system: "Fiskalizacija 2.0",
      format: "EN 16931 (UBL)",
      detail: "B2B e-invoices with fiscal reporting for VAT-registered businesses from 1 January 2026.",
    },
  },
  CY: {
    name: "Cyprus",
    rate: 19,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^CY\d{8}[A-Z]$/,
    idExample: "CY12345678X",
  },
  CZ: {
    name: "Czechia",
    rate: 21,
    currency: "CZK",
    rateSource: "Czech National Bank",
    idPattern: /^CZ\d{8,10}$/,
    idExample: "CZ12345678",
  },
  DK: {
    name: "Denmark",
    rate: 25,
    currency: "DKK",
    rateSource: "Danmarks Nationalbank",
    idPattern: /^DK\d{8}$/,
    idExample: "DK12345678",
  },
  EE: {
    name: "Estonia",
    rate: 24,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^EE\d{9}$/,
    idExample: "EE123456789",
  },
  FI: {
    name: "Finland",
    rate: 25.5,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^FI\d{8}$/,
    idExample: "FI12345678",
  },
  FR: {
    name: "France",
    rate: 20,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^FR[0-9A-Z]{2}\d{9}$/,
    idExample: "FR12345678901",
    eInvoicing: {
      status: "phased",
      system: "Plateformes agréées (PA)",
      format: "Factur-X, UBL or CII",
      detail:
        "All businesses must receive e-invoices from 1 September 2026; large and mid-sized companies issue them from then, SMEs from 1 September 2027.",
    },
    sources: ["https://www.impots.gouv.fr/"],
  },
  DE: {
    name: "Germany",
    rate: 19,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^DE\d{9}$/,
    idExample: "DE123456789",
    eInvoicing: {
      status: "phased",
      system: "No platform: sent directly or over Peppol",
      format: "XRechnung or ZUGFeRD (EN 16931)",
      detail:
        "Every business must be able to receive e-invoices since 1 January 2025; issuing them becomes mandatory from 2027 (turnover above EUR 800,000) and 2028 for everyone.",
    },
    sources: ["https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html"],
  },
  GR: {
    name: "Greece",
    rate: 24,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^EL\d{9}$/,
    idExample: "EL123456789",
  },
  HU: {
    name: "Hungary",
    rate: 27,
    currency: "HUF",
    rateSource: "Magyar Nemzeti Bank",
    idPattern: /^HU\d{8}$/,
    idExample: "HU12345678",
  },
  IE: {
    name: "Ireland",
    rate: 23,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^IE\d{7}[A-Z]{1,2}$|^IE\d[A-Z+*]\d{5}[A-Z]$/,
    idExample: "IE1234567T",
  },
  IT: {
    name: "Italy",
    rate: 22,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^IT\d{11}$/,
    idExample: "IT12345678901",
    eInvoicing: {
      status: "mandatory",
      system: "Sistema di Interscambio (SdI)",
      format: "FatturaPA XML",
      detail: "Domestic B2B and B2C invoices go through SdI since 2019.",
    },
  },
  LV: {
    name: "Latvia",
    rate: 21,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^LV\d{11}$/,
    idExample: "LV12345678901",
  },
  LT: {
    name: "Lithuania",
    rate: 21,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^LT(\d{9}|\d{12})$/,
    idExample: "LT123456789",
  },
  LU: {
    name: "Luxembourg",
    rate: 17,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^LU\d{8}$/,
    idExample: "LU12345678",
  },
  MT: { name: "Malta", rate: 18, currency: "EUR", rateSource: "ECB", idPattern: /^MT\d{8}$/, idExample: "MT12345678" },
  NL: {
    name: "Netherlands",
    rate: 21,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^NL\d{9}B\d{2}$/,
    idExample: "NL123456789B01",
  },
  PL: {
    name: "Poland",
    rate: 23,
    currency: "PLN",
    rateSource: "Narodowy Bank Polski",
    idPattern: /^PL\d{10}$/,
    idExample: "PL1234567890",
    eInvoicing: {
      status: "phased",
      system: "KSeF",
      format: "FA(3) XML",
      detail: "Mandatory through KSeF from 1 February 2026 for large taxpayers and from 1 April 2026 for the rest.",
    },
  },
  PT: {
    name: "Portugal",
    rate: 23,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^PT\d{9}$/,
    idExample: "PT123456789",
  },
  RO: {
    name: "Romania",
    rate: 21,
    currency: "RON",
    rateSource: "BNR (last fixing before the invoice date)",
    idPattern: /^RO\d{2,10}$/,
    idExample: "RO12345678",
    eInvoicing: {
      status: "mandatory",
      system: "RO e-Factura (ANAF SPV)",
      format: "UBL 2.1, CIUS-RO 1.0.1",
      detail: "Every domestic B2B invoice is reported through ANAF within 5 working days.",
    },
    sources: ["https://mfinante.gov.ro/ro/web/efactura"],
  },
  SK: {
    name: "Slovakia",
    rate: 23,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^SK\d{10}$/,
    idExample: "SK1234567890",
  },
  SI: {
    name: "Slovenia",
    rate: 22,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^SI\d{8}$/,
    idExample: "SI12345678",
  },
  ES: {
    name: "Spain",
    rate: 21,
    currency: "EUR",
    rateSource: "ECB",
    idPattern: /^ES[0-9A-Z]\d{7}[0-9A-Z]$/,
    idExample: "ESX1234567X",
  },
  SE: {
    name: "Sweden",
    rate: 25,
    currency: "SEK",
    rateSource: "Sveriges Riksbank",
    idPattern: /^SE\d{10}01$/,
    idExample: "SE123456789001",
  },
};

const OTHERS: Jurisdiction[] = [
  {
    code: "AE",
    name: "United Arab Emirates",
    tax: { name: "VAT", standardRate: 5, idLabel: "TRN", idPattern: /^100\d{12}$/, idExample: "100123456700003" },
    currency: "AED",
    localTaxCurrency: {
      currency: "AED",
      rateSource: "UAE Central Bank, on the date of supply (6 decimals)",
      rule: "Art. 59, Cabinet Decision 52 of 2017",
    },
    eInvoicing: {
      status: "phased",
      system: "Peppol via a Ministry of Finance accredited service provider (ASP)",
      format: "PINT AE",
      detail:
        "Businesses with revenue of AED 50M or more appoint an ASP by 30 October 2026 and go live 1 January 2027; the rest appoint by 31 March 2027 and go live 1 July 2027.",
    },
    notes: [
      "VAT registration is mandatory above AED 375,000 of taxable supplies a year.",
      "Free zone companies: supplies inside designated zones can be outside the scope of VAT; check yours.",
    ],
    sources: ["https://mof.gov.ae/", "https://tax.gov.ae/en/taxes/vat.aspx"],
    reviewed: "2026-10-18",
  },
  {
    code: "SG",
    name: "Singapore",
    tax: {
      name: "GST",
      standardRate: 9,
      idLabel: "GST Reg. No.",
      idPattern: /^(\d{8,9}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z]|M[0-9A-Z]\d{7}[0-9A-Z])$/,
      idExample: "201912345K",
    },
    currency: "SGD",
    localTaxCurrency: {
      currency: "SGD",
      rateSource: "An IRAS-approved rate (local bank or newspaper), used consistently",
      rule: "IRAS: net amount, GST and total in SGD on foreign-currency tax invoices",
    },
    eInvoicing: {
      status: "phased",
      system: "InvoiceNow (Peppol) with invoice data sent to IRAS",
      format: "PINT SG",
      detail:
        "Required for new voluntary GST registrants since 1 April 2026; existing GST-registered businesses phase in from 2028 to 2031.",
    },
    notes: ["GST registration is compulsory above S$1M of taxable supplies a year."],
    sources: [
      "https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-invoicenow-requirement",
      "https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/foreign-currency-transactions",
    ],
    reviewed: "2026-10-18",
  },
  {
    code: "PA",
    name: "Panama",
    tax: { name: "ITBMS", standardRate: 7, idLabel: "RUC" },
    currency: "USD",
    localTaxCurrency: null,
    eInvoicing: {
      status: "mandatory",
      system: "SFEP (DGI): the free DGI invoicer or an authorised PAC",
      format: "Signed XML authorised before delivery",
      detail:
        "From 1 January 2026 the free DGI invoicer is limited to B/.36,000 of yearly income and 100 documents a month; above that a PAC is required. Billify does not transmit to the DGI yet.",
    },
    notes: ["The balboa is pegged 1:1 to the US dollar, which is legal tender."],
    sources: ["https://dgi.mef.gob.pa/"],
    reviewed: "2026-10-18",
  },
  {
    code: "CH",
    name: "Switzerland",
    tax: {
      name: "MWST/TVA",
      standardRate: 8.1,
      idLabel: "UID (MWST)",
      idPattern: /^CHE-?\d{3}\.?\d{3}\.?\d{3}( ?(MWST|TVA|IVA))?$/,
      idExample: "CHE-123.456.789 MWST",
    },
    currency: "CHF",
    localTaxCurrency: null,
    eInvoicing: null,
    notes: [
      "The VAT return is in CHF: foreign-currency invoices are converted at the ESTV monthly or a daily market rate.",
      "Domestic payments use the QR-bill.",
    ],
    sources: ["https://www.estv.admin.ch/estv/en/home/value-added-tax.html"],
    reviewed: "2026-10-18",
  },
  {
    code: "GB",
    name: "United Kingdom",
    tax: {
      name: "VAT",
      standardRate: 20,
      idLabel: "VAT registration number",
      idPattern: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
      idExample: "GB123456789",
    },
    currency: "GBP",
    localTaxCurrency: {
      currency: "GBP",
      rateSource: "HMRC period rate or a UK market rate",
      rule: "HMRC VAT Notice 700, section 16",
    },
    eInvoicing: {
      status: "planned",
      system: "To be announced by HMRC",
      format: "To be announced",
      detail: "Mandatory e-invoicing for VAT invoices is planned from April 2029.",
    },
    notes: [],
    sources: ["https://www.gov.uk/guidance/vat-guide-notice-700"],
    reviewed: "2026-10-18",
  },
  {
    code: "SV",
    name: "El Salvador",
    tax: { name: "IVA", standardRate: 13, idLabel: "NIT / NRC" },
    currency: "USD",
    localTaxCurrency: null,
    eInvoicing: {
      status: "mandatory",
      system: "DTE (Ministerio de Hacienda)",
      format: "Signed JSON DTE",
      detail: "Electronic tax documents are required for taxpayers; Billify does not transmit DTEs yet.",
    },
    notes: [],
    sources: ["https://www.mh.gob.sv/"],
    reviewed: "2026-10-18",
  },
  {
    code: "SC",
    name: "Seychelles",
    tax: { name: "VAT", standardRate: 15, idLabel: "TIN" },
    currency: "SCR",
    localTaxCurrency: null,
    eInvoicing: null,
    notes: [
      "VAT registration applies above SCR 2M of taxable turnover a year.",
      "Virtual asset services need an FSA licence (VASP Act 2024).",
    ],
    sources: ["https://www.src.gov.sc/"],
    reviewed: "2026-10-18",
  },
  {
    code: "VG",
    name: "British Virgin Islands",
    tax: null,
    currency: "USD",
    localTaxCurrency: null,
    eInvoicing: null,
    notes: [
      "No VAT or GST: invoice without tax.",
      "Virtual asset services must be registered with the FSC (VASP Act 2022), which also requires transaction records.",
      "Economic substance rules may apply to relevant activities.",
    ],
    sources: ["https://www.bvifsc.vg/"],
    reviewed: "2026-10-18",
  },
  {
    code: "KY",
    name: "Cayman Islands",
    tax: null,
    currency: "KYD",
    localTaxCurrency: null,
    eInvoicing: null,
    notes: [
      "No VAT or GST: invoice without tax.",
      "Virtual asset service providers must be registered or licensed with CIMA (VASP Act).",
    ],
    sources: ["https://www.cima.ky/"],
    reviewed: "2026-10-18",
  },
  {
    code: "HK",
    name: "Hong Kong",
    tax: null,
    currency: "HKD",
    localTaxCurrency: null,
    eInvoicing: null,
    notes: ["No VAT or GST.", "Virtual asset trading platforms need an SFC licence."],
    sources: ["https://www.ird.gov.hk/"],
    reviewed: "2026-10-18",
  },
  {
    code: "US",
    name: "United States",
    tax: null,
    currency: "USD",
    localTaxCurrency: null,
    eInvoicing: null,
    notes: ["No federal VAT; sales tax depends on the state and on what is sold."],
    sources: [],
    reviewed: "2026-10-18",
  },
];

const fromEu = (code: string, r: EuRow): Jurisdiction => ({
  code,
  name: r.name,
  tax: { name: "VAT", standardRate: r.rate, idLabel: "VAT ID", idPattern: r.idPattern, idExample: r.idExample },
  currency: r.currency,
  localTaxCurrency: { currency: r.currency, rateSource: r.rateSource, rule: "Art. 230, Directive 2006/112/EC" },
  eInvoicing: r.eInvoicing ?? {
    status: "voluntary",
    system: "Peppol",
    format: "Peppol BIS Billing 3.0",
    detail: PEPPOL_B2G,
  },
  notes: [],
  sources: [EU_VAT_DIRECTIVE, ...(r.sources ?? [])],
  reviewed: "2026-10-18",
});

const ALL = new Map<string, Jurisdiction>([
  ...Object.entries(EU).map(([code, r]) => [code, fromEu(code, r)] as [string, Jurisdiction]),
  ...OTHERS.map((j) => [j.code, j] as [string, Jurisdiction]),
]);

export const isEuMember = (code: string | null): boolean => !!code && code in EU;

/** Every jurisdiction with known rules. */
export const jurisdictions = (): Jurisdiction[] => [...ALL.values()];

export function jurisdiction(code: string | null): Jurisdiction | null {
  if (!code) return null;
  const c = code.toUpperCase();
  return ALL.get(c === "EL" ? "GR" : c) ?? null;
}

const cleanId = (taxId: string | null) => (taxId ?? "").replace(/[\s.-]/g, "").toUpperCase();

/**
 * The seller's jurisdiction: from the country field (a code or a name), else from the tax id
 * (an EU VAT prefix, a Swiss UID, a UK VAT number or a UAE TRN).
 */
export function detectJurisdiction(country: string | null, taxId: string | null): Jurisdiction | null {
  const byCountry = jurisdiction(countryCode(country));
  if (byCountry) return byCountry;
  const id = cleanId(taxId);
  if (/^CHE\d{9}/.test(id)) return jurisdiction("CH");
  if (/^100\d{12}$/.test(id)) return jurisdiction("AE");
  const prefix = id.slice(0, 2);
  if (/^[A-Z]{2}$/.test(prefix) && (isEuMember(prefix) || prefix === "EL" || prefix === "GB")) {
    return jurisdiction(prefix);
  }
  return null;
}

export interface ComplianceInput {
  seller: { country: string | null; taxId: string | null };
  /** Optional: an invoice to check as well. */
  invoice?: { currency: string; taxRate: number; buyerCountry?: string | null; buyerTaxId?: string | null };
}

/** Findings for the seller, most severe first. Unknown jurisdictions get an info finding, not a guess. */
export function checkCompliance(input: ComplianceInput): { jurisdiction: Jurisdiction | null; findings: Finding[] } {
  const j = detectJurisdiction(input.seller.country, input.seller.taxId);
  const findings: Finding[] = [];
  if (!j) {
    findings.push(
      input.seller.country
        ? {
          level: "info",
          code: "UNKNOWN_JURISDICTION",
          message: `No invoicing rules for "${input.seller.country}" yet; check them with a local accountant.`,
        }
        : { level: "error", code: "NO_COUNTRY", message: "Set your country so the right invoicing rules apply." },
    );
    return { jurisdiction: null, findings };
  }

  const id = cleanId(input.seller.taxId);
  if (j.tax) {
    if (!id) {
      findings.push({
        level: "warning",
        code: "NO_TAX_ID",
        message:
          `Add your ${j.tax.idLabel} if you are registered for ${j.tax.name}; registered sellers must show it on every invoice.`,
      });
    } else if (j.tax.idPattern && !j.tax.idPattern.test(id) && !(j.code === "RO" && /^\d{2,10}$/.test(id))) {
      findings.push({
        level: "warning",
        code: "TAX_ID_FORMAT",
        message: `${input.seller.taxId} does not look like a ${j.name} ${j.tax.idLabel}${
          j.tax.idExample ? ` (e.g. ${j.tax.idExample})` : ""
        }.`,
      });
    }
  }

  const inv = input.invoice;
  if (inv) {
    const currency = inv.currency.toUpperCase();
    if (!j.tax && inv.taxRate > 0) {
      findings.push({
        level: "error",
        code: "TAX_WITHOUT_REGIME",
        message: `${j.name} has no VAT or GST: the invoice should not charge ${inv.taxRate}% tax.`,
      });
    }
    if (j.tax && inv.taxRate > j.tax.standardRate) {
      findings.push({
        level: "warning",
        code: "RATE_ABOVE_STANDARD",
        message: `${inv.taxRate}% is above the ${j.name} standard ${j.tax.name} rate of ${j.tax.standardRate}%.`,
      });
    }
    const buyer = countryCode(inv.buyerCountry ?? null);
    if (
      j.tax && inv.taxRate > 0 && isEuMember(j.code) && buyer && buyer !== j.code && isEuMember(buyer) &&
      cleanId(inv.buyerTaxId ?? null)
    ) {
      findings.push({
        level: "warning",
        code: "EU_REVERSE_CHARGE",
        message:
          'EU business client in another member state: this is usually reverse charge (0% with the note "Reverse charge"), not local VAT.',
      });
    }
    if (j.localTaxCurrency && inv.taxRate > 0 && currency !== j.localTaxCurrency.currency) {
      findings.push({
        level: "warning",
        code: "LOCAL_TAX_AMOUNT",
        message: `Invoiced in ${currency}: the ${
          j.tax?.name ?? "tax"
        } must also be shown in ${j.localTaxCurrency.currency} at the rate used (${j.localTaxCurrency.rateSource}; ${j.localTaxCurrency.rule}).`,
      });
    }
  }

  if (j.eInvoicing && j.eInvoicing.status !== "voluntary") {
    findings.push({
      level: j.eInvoicing.status === "mandatory" ? "warning" : "info",
      code: "E_INVOICING",
      message: `${j.name}: ${j.eInvoicing.system} (${j.eInvoicing.format}). ${j.eInvoicing.detail}`,
    });
  }
  for (const note of j.notes) findings.push({ level: "info", code: "NOTE", message: note });

  const order = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return { jurisdiction: j, findings };
}
