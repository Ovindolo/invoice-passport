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
    /** Highest rate where regional or other taxes go above the standard one (Canadian HST); rates up to it are not flagged. */
    highestRate?: number;
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
  {
    code: "IN",
    name: "India",
    tax: {
      name: "GST",
      standardRate: 18,
      idLabel: "GSTIN",
      idPattern: /^\d{2}[0-9A-Z]{13}$/,
      idExample: "29ABCDE1234F1Z5",
    },
    currency: "INR",
    localTaxCurrency: null,
    eInvoicing: {
      status: "mandatory",
      system: "Invoice Reference Number (IRN) from the GST common portal",
      format: "FORM GST INV-01",
      detail:
        "Taxpayers above the notified aggregate turnover (INR 5 crore since 1 August 2023) must get an IRN for the invoices the notification covers; an invoice issued otherwise is not treated as an invoice (CGST Rules, rule 48(4)-(5)). Billify does not obtain IRNs yet.",
    },
    notes: [
      "Since 22 September 2025 GST has a standard rate of 18%, a merit rate of 5% and a 40% rate for a few goods and services.",
      "Registration is required above INR 20 lakh of aggregate turnover for services (INR 40 lakh for goods only; lower in some states).",
      "The GSTIN is the 2-digit state code, the 10-character PAN, a 2-character entity code and a check character.",
    ],
    sources: [
      "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2163555",
      "https://gstcouncil.gov.in/sites/default/files/e-version-gst-flyers/Registration_under_GST_Law_new.pdf",
      "https://www.gstcouncil.gov.in/node/4365",
      "https://cbic-gst.gov.in/pdf/01012020-CGST-Rules-2017-Part-A-Rules.pdf",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "AU",
    name: "Australia",
    tax: { name: "GST", standardRate: 10, idLabel: "ABN", idPattern: /^\d{11}$/, idExample: "51824753556" },
    currency: "AUD",
    localTaxCurrency: null,
    eInvoicing: {
      status: "voluntary",
      system: "Peppol",
      format: "Peppol A-NZ invoice specification",
      detail:
        "Non-corporate Commonwealth entities must be able to receive eInvoices since 2022, and the Government is making eInvoicing its default for procurement.",
    },
    notes: [
      "GST registration is required at a GST turnover of A$75,000 or more.",
      "A tax invoice must show it is intended as one and the seller's ABN; for sales of A$1,000 or more, also the buyer's identity or ABN.",
    ],
    sources: [
      "https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/how-gst-works",
      "https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/registering-for-gst",
      "https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices",
      "https://www.ato.gov.au/businesses-and-organisations/einvoicing/einvoicing-for-government",
      "https://www.abr.gov.au/business-super-funds-charities/applying-abn",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "NZ",
    name: "New Zealand",
    tax: { name: "GST", standardRate: 15, idLabel: "GST number" },
    currency: "NZD",
    localTaxCurrency: null,
    eInvoicing: {
      status: "voluntary",
      system: "Peppol",
      format: "Peppol A-NZ invoice specification",
      detail:
        "From 1 January 2027 government agencies must require large suppliers (revenue above NZ$33M in each of the previous two accounting periods) to send eInvoices, through new procurements and contracts.",
    },
    notes: [
      "GST registration is required at NZ$60,000 or more of turnover in 12 months.",
      "Since 1 April 2023 tax invoices are replaced by taxable supply information, which GST-registered buyers can request within 28 days for supplies over NZ$200.",
    ],
    sources: [
      "https://www.ird.govt.nz/gst/charging-gst",
      "https://www.ird.govt.nz/gst/registering-for-gst",
      "https://www.ird.govt.nz/gst/tax-invoices-for-gst",
      "https://www.ird.govt.nz/gst/tax-invoices-for-gst/how-taxable-supply-information-for-gst-works",
      "https://www.einvoicing.govt.nz/get-set-up/advice-for-government-agencies/government-agencies-requirements-large-suppliers-einvoicing",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "CA",
    name: "Canada",
    tax: {
      name: "GST/HST",
      standardRate: 5,
      highestRate: 15,
      idLabel: "GST/HST registration number",
      idPattern: /^\d{9}RT\d{4}$/,
      idExample: "123456789RT0001",
    },
    currency: "CAD",
    localTaxCurrency: null,
    eInvoicing: null,
    notes: [
      "GST is 5%; HST replaces it at 13% in Ontario, 14% in Nova Scotia and 15% in New Brunswick, Newfoundland and Labrador and Prince Edward Island.",
      "Some provinces add their own sales tax on top of the GST, e.g. 9.975% in Quebec.",
      "Small suppliers (C$30,000 or less of taxable supplies, as the CRA calculates it) do not have to register.",
    ],
    sources: [
      "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html",
      "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/when-register-charge.html",
      "https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4022/general-information-gst-hst-registrants.html",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "JP",
    name: "Japan",
    tax: {
      name: "Consumption tax",
      standardRate: 10,
      idLabel: "Registration number",
      idPattern: /^T\d{13}$/,
      idExample: "T1234567890123",
    },
    currency: "JPY",
    localTaxCurrency: {
      currency: "JPY",
      rateSource: "Not set in the NTA guide; confirm the rate with your accountant",
      rule: "NTA invoice system: consumption tax by rate, in yen, on a qualified invoice",
    },
    eInvoicing: {
      status: "voluntary",
      system: "Peppol",
      format: "JP PINT",
      detail: "The Digital Agency, as Japan Peppol Authority, maintains JP PINT for e-invoices sent over Peppol.",
    },
    notes: [
      "Since 1 October 2023 buyers need a qualified invoice from a registered issuer to claim input tax credit; it shows the registration number and the tax by rate (10% standard, 8% reduced).",
      "Only registered qualified invoice issuers can issue qualified invoices; a business with taxable sales of JPY 10 million or less in the base period is otherwise tax-exempt.",
    ],
    sources: [
      "https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/0024006-039_01.pdf",
      "https://www.nta.go.jp/english/taxes/consumption_tax/0024006-113_03.pdf",
      "https://www.digital.go.jp/en/policies/electronic_invoice",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "NO",
    name: "Norway",
    tax: {
      name: "MVA",
      standardRate: 25,
      idLabel: "Organisation number + MVA",
      idPattern: /^(NO)?\d{9}(MVA)?$/,
      idExample: "123456789MVA",
    },
    currency: "NOK",
    localTaxCurrency: null,
    eInvoicing: {
      status: "phased",
      system: "Peppol (ELMA register)",
      format: "EHF Billing or Peppol BIS Billing 3.0",
      detail:
        "From 1 January 2027 businesses must issue e-invoices to other businesses that can receive them (registered in ELMA/Peppol); a PDF is not enough for those buyers. Every business must be able to receive e-invoices from 1 January 2030. Turnover up to NOK 50,000 a year can be exempt.",
    },
    notes: [
      "A seller in the VAT register writes MVA after its organisation number on the invoice.",
      "Reduced rates: 15% on foodstuffs, 12% on passenger transport and room letting.",
    ],
    sources: [
      "https://www.skatteetaten.no/en/rates/value-added-tax/",
      "https://www.skatteetaten.no/en/rettskilder/type/uttalelser/uttalelser/forskrifter-til-lovendringer-om-digital-bokforing-og-e-fakturering/",
      "https://lovdata.no/dokument/SF/forskrift/2004-12-01-1558",
      "https://www.brreg.no/en/about-us-2/our-registers/about-the-central-coordinating-register-for-legal-entities-ccr/",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "SA",
    name: "Saudi Arabia",
    tax: {
      name: "VAT",
      standardRate: 15,
      idLabel: "VAT registration number",
      idPattern: /^3\d{13}3$/,
      idExample: "310123456700003",
    },
    currency: "SAR",
    localTaxCurrency: {
      currency: "SAR",
      rateSource: "Saudi Central Bank daily rate on the date the tax becomes due",
      rule: "Art. 53(5)(r) and 61, VAT Implementing Regulations",
    },
    eInvoicing: {
      status: "phased",
      system: "FATOORA (ZATCA)",
      format: "ZATCA e-invoice XML (UBL 2.1) with QR code",
      detail:
        "Phase 1 (generation) since 4 December 2021: invoices from a compliant e-invoicing solution, with a QR code. Phase 2 (integration with FATOORA) goes in waves: wave 24 (VAT revenue above SAR 375,000 in 2022-2024) by 30 June 2026, wave 25 (above SAR 187,500 in 2022-2025) by 1 February 2027. Billify is not integrated with FATOORA.",
    },
    notes: ["VAT registration is mandatory above SAR 375,000 of taxable supplies in 12 months."],
    sources: [
      "https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Guideline-for-Tax-Invoicing-and-Records-under-VAT-Provisions.pdf",
      "https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf",
      "https://zatca.gov.sa/en/Pages/news-1426.aspx",
      "https://zatca.gov.sa/en/MediaCenter/News/Pages/Wave25-E-invoicing.aspx",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "TR",
    name: "Türkiye",
    tax: { name: "KDV", standardRate: 20, idLabel: "VKN / TCKN" },
    currency: "TRY",
    localTaxCurrency: null,
    eInvoicing: {
      status: "mandatory",
      system: "e-Fatura and e-Arşiv Fatura (GİB)",
      format: "e-Fatura",
      detail:
        "Taxpayers with gross sales of TRY 3 million or more for 2022 or a later year must use e-Fatura from the start of the 7th month of the following year; e-Fatura users issue e-Arşiv Fatura to buyers outside e-Fatura. Billify does not transmit to GİB.",
    },
    notes: ["The general KDV rate is 20% since 10 July 2023; listed goods and services are taxed at 10% or 1%."],
    sources: [
      "https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2Fkdv-oranlari.pdf",
      "https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Finfografikler%2Fpdfs%2F2025_e_fatura.pdf",
      "https://cdn.gib.gov.tr/api/gibportal-file/file/getFile?objectKey=MEVZUAT_TEBLIGLER%2FUNIVERSAL%2F2026%2FMEVZUAT_TEBLIGLER_2026_VukTeb509_Guncel.pdf",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "MX",
    name: "Mexico",
    tax: { name: "IVA", standardRate: 16, idLabel: "RFC" },
    currency: "MXN",
    localTaxCurrency: null,
    eInvoicing: {
      status: "mandatory",
      system: "CFDI (SAT)",
      format: "CFDI 4.0",
      detail:
        "Taxpayers must issue their electronic invoices as CFDI version 4.0 since 1 April 2023. Billify does not issue CFDI yet.",
    },
    notes: [],
    sources: [
      "https://www.gob.mx/sat/prensa/el-sat-informa-sobre-el-avance-de-la-emision-de-cfdi-en-la-version-4-0-0012-2023",
      "https://www.gob.mx/cms/uploads/attachment/file/850660/Dato-3_IVA.pdf",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "ZA",
    name: "South Africa",
    tax: {
      name: "VAT",
      standardRate: 15,
      idLabel: "VAT registration number",
      idPattern: /^\d{10}$/,
      idExample: "4123456789",
    },
    currency: "ZAR",
    localTaxCurrency: null,
    eInvoicing: null,
    notes: [
      "VAT registration is compulsory above R2.3 million of taxable supplies a year from 1 April 2026 (was R1 million); voluntary registration is possible above R120,000.",
    ],
    sources: [
      "https://www.sars.gov.za/types-of-tax/value-added-tax/",
      "https://www.sars.gov.za/guide-to-completing-the-value-added-tax-vat201-return/",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "NG",
    name: "Nigeria",
    tax: { name: "VAT", standardRate: 7.5, idLabel: "TIN" },
    currency: "NGN",
    localTaxCurrency: null,
    eInvoicing: {
      status: "phased",
      system: "NRS e-invoicing (Merchant Buyer Solution)",
      format: "NRS e-invoice",
      detail:
        "The Nigeria Revenue Service is introducing e-invoices in stages; check with the NRS whether your business is in scope. Billify does not connect to the NRS system.",
    },
    notes: [
      "When virtual assets pay for taxable goods or services, VAT applies to the underlying supply as if it were paid in fiat (NRS circular 2026/21).",
    ],
    sources: [
      "https://www.nrs.gov.ng/uploads/Guidelines_on_taxation_of_Virtual_Assets_31_7_26_7cd2ef8dab.pdf",
      "https://einvoice.nrs.gov.ng/introduction-to-e-invoicing",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "KE",
    name: "Kenya",
    tax: { name: "VAT", standardRate: 16, idLabel: "KRA PIN", idPattern: /^[AP]\d{9}[A-Z]$/, idExample: "P123456789Z" },
    currency: "KES",
    localTaxCurrency: null,
    eInvoicing: {
      status: "mandatory",
      system: "eTIMS (KRA)",
      format: "Electronic tax invoice transmitted to KRA",
      detail:
        "Everyone carrying on business, VAT-registered or not, must generate and transmit invoices to KRA through eTIMS since 1 September 2023; since 1 January 2024 expenses without a valid electronic tax invoice are not deductible. Billify does not transmit to eTIMS.",
    },
    notes: ["VAT registration is required at KES 5 million or more of taxable supplies a year."],
    sources: [
      "https://www.kra.go.ke/individual/filing-paying/types-of-taxes/value-added-tax",
      "https://www.kra.go.ke/news-center/public-notices/2077-electronic-tax-invoicing-for-non-vat-registered-persons",
      "https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/buyer-initiated-invoicing",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "MY",
    name: "Malaysia",
    tax: { name: "SST", standardRate: 8, highestRate: 10, idLabel: "SST registration number" },
    currency: "MYR",
    localTaxCurrency: null,
    eInvoicing: {
      status: "phased",
      system: "MyInvois (LHDN)",
      format: "MyInvois e-Invoice",
      detail:
        "By annual turnover: above RM100M from 1 August 2024, RM25M-100M from 1 January 2025, RM5M-25M from 1 July 2025, up to RM5M from 1 January 2026; below RM3M is exempt (timeline updated 30 August 2026). Billify does not submit to MyInvois.",
    },
    notes: [
      "Service tax is 8% on most taxable services since 1 March 2024 (6% for F&B, logistics, telecommunications and parking); sales tax on goods is 5% or 10%.",
    ],
    sources: [
      "https://www.hasil.gov.my/en/e-invois/pelaksanaan-e-invois-di-malaysia/garis-masa-pelaksanaan-e-invois/",
      "https://mysst.customs.gov.my/faq-services-tax/",
      "https://mysst.customs.gov.my/faq-sales-tax/",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "IL",
    name: "Israel",
    tax: { name: "VAT", standardRate: 18, idLabel: "Dealer number" },
    currency: "ILS",
    localTaxCurrency: null,
    eInvoicing: {
      status: "mandatory",
      system: "Israel Invoice model: allocation numbers from the Tax Authority",
      format: "Allocation number on the tax invoice",
      detail:
        "Buyers registered as authorized dealers need an allocation number on invoices above a threshold to deduct input VAT: NIS 20,000 in 2025, NIS 10,000 from 1 January 2026 and NIS 5,000 (before VAT) from 1 June 2026. Billify does not request allocation numbers.",
    },
    notes: ["VAT is 18% since 1 January 2025."],
    sources: [
      "https://www.gov.il/he/pages/vat-history",
      "https://www.gov.il/en/service/verify-vendor-invoice-information",
      "https://www.gov.il/en/Departments/israel_tax_authority",
    ],
    reviewed: "2026-10-28",
  },
  {
    code: "IS",
    name: "Iceland",
    tax: { name: "VAT", standardRate: 24, idLabel: "VAT registration number" },
    currency: "ISK",
    localTaxCurrency: null,
    eInvoicing: null,
    notes: [
      "VAT is 24% or 11%.",
      "Registration is not required for taxable sales of ISK 2,000,000 or less in each twelve-month period.",
    ],
    sources: ["https://www.skatturinn.is/english/companies/value-added-tax/"],
    reviewed: "2026-10-28",
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

/** Tax id formats distinctive enough to name the jurisdiction without a country. */
const ID_FORMATS: [RegExp, string][] = [
  [/^CHE\d{9}/, "CH"],
  [/^100\d{12}$/, "AE"],
  [/^3\d{13}3$/, "SA"],
  [/^T\d{13}$/, "JP"],
  [/^\d{9}RT\d{4}$/, "CA"],
  [/^(NO)?\d{9}MVA$/, "NO"],
  [/^[AP]\d{9}[A-Z]$/, "KE"],
];

/**
 * The seller's jurisdiction: from the country field (a code or a name), else from the tax id
 * (an EU VAT prefix, a UK VAT number or one of ID_FORMATS).
 */
export function detectJurisdiction(country: string | null, taxId: string | null): Jurisdiction | null {
  const byCountry = jurisdiction(countryCode(country));
  if (byCountry) return byCountry;
  const id = cleanId(taxId);
  const format = ID_FORMATS.find(([pattern]) => pattern.test(id));
  if (format) return jurisdiction(format[1]);
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
    if (j.tax && inv.taxRate > (j.tax.highestRate ?? j.tax.standardRate)) {
      findings.push({
        level: "warning",
        code: "RATE_ABOVE_STANDARD",
        message: j.tax.highestRate
          ? `${inv.taxRate}% is above the highest ${j.name} ${j.tax.name} rate of ${j.tax.highestRate}%.`
          : `${inv.taxRate}% is above the ${j.name} standard ${j.tax.name} rate of ${j.tax.standardRate}%.`,
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
