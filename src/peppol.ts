/**
 * UBL 2.1 invoice for Peppol BIS Billing 3.0 (EN 16931 core + Peppol rules), usable across the EU.
 * Covers the VAT categories an SME invoice needs: S (standard), Z (zero rated), E (exempt),
 * AE (reverse charge), K (intra-community supply), G (export outside the EU) and O (outside scope).
 * Missing or contradictory data is returned as problems instead of an invoice that a validator or
 * access point would reject. Output is checked against the official CEN EN 16931 and OpenPeppol
 * schematron rules in the test suite (see tests/fixtures).
 */
import { isValidCreditorReference, isValidIban } from "./sepa.ts";

export const PEPPOL_BIS_3 = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
export const PEPPOL_BILLING_PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
/** XRechnung 3.0 CIUS (Germany, KoSIT), UBL syntax. */
export const XRECHNUNG_3 = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";

/** "peppol": Peppol BIS Billing 3.0. "xrechnung": the German CIUS, which adds BR-DE rules. */
export type InvoiceProfile = "peppol" | "xrechnung";

export type VatCategory = "S" | "Z" | "E" | "AE" | "K" | "G" | "O";

/** Default exemption reason codes (VATEX) for categories that require one. E has no safe default. */
const DEFAULT_VATEX: Partial<Record<VatCategory, string>> = {
  AE: "VATEX-EU-AE",
  K: "VATEX-EU-IC",
  G: "VATEX-EU-G",
  O: "VATEX-EU-O",
};

/**
 * Peppol EAS scheme for a country's VAT number, from the official OpenPeppol EAS code list
 * (BIS Billing 3.0.20, structure/codelist/eas.xml). Only VAT-number schemes are listed; a buyer may
 * be registered on the network under another identifier (e.g. Belgium 0208), so treat this as a
 * suggestion to confirm.
 */
export const VAT_EAS: Record<string, string> = {
  AT: "9914",
  BE: "9925",
  BG: "9926",
  CY: "9928",
  CZ: "9929",
  DE: "9930",
  EE: "9931",
  ES: "9920",
  FR: "9957",
  GB: "9932",
  GR: "9933",
  EL: "9933",
  HR: "9934",
  HU: "9910",
  IE: "9935",
  LT: "9937",
  LU: "9938",
  LV: "9939",
  MT: "9943",
  NL: "9944",
  PL: "9945",
  PT: "9946",
  RO: "9947",
  SI: "9949",
  SK: "9950",
  CH: "9927",
};

/** Suggested Peppol endpoint for a VAT id with country prefix ("DE123456789" → 9930:DE123456789). */
export function peppolEndpointForVat(vatId: string | null | undefined): { scheme: string; id: string } | null {
  const v = String(vatId ?? "").replace(/[\s.-]/g, "").toUpperCase();
  const scheme = VAT_EAS[v.slice(0, 2)];
  return scheme && /^[A-Z]{2}[0-9A-Z]{2,}$/.test(v) ? { scheme, id: v } : null;
}

export interface PeppolParty {
  name: string;
  /** Peppol electronic address (BT-34 / BT-49): EAS scheme code (e.g. "0088", "9930", "0208") and id */
  endpoint: { scheme: string; id: string };
  /** VAT identifier with country prefix (BT-31 / BT-48) */
  vatId?: string | null;
  /** legal registration id (BT-30 / BT-47), e.g. trade register number, with optional ICD scheme */
  legalId?: { id: string; scheme?: string | null } | null;
  street?: string | null;
  additionalStreet?: string | null;
  city?: string | null;
  postalCode?: string | null;
  /** ISO 3166-2 subdivision code or name */
  subdivision?: string | null;
  /** ISO 3166-1 alpha-2 */
  country: string;
  contact?: { name?: string | null; phone?: string | null; email?: string | null } | null;
}

export interface PeppolLine {
  description: string;
  quantity: number;
  /** UN/ECE rec 20 unit code; default C62 ("one") */
  unitCode?: string;
  /** net price per unit, excluding VAT */
  unitPrice: number;
  vatCategory: VatCategory;
  /** percent; must be 0 for every category except S */
  vatRate: number;
}

export interface PeppolInvoiceInput {
  number: string;
  /** YYYY-MM-DD */
  issueDate: string;
  dueDate?: string | null;
  currency: string;
  /** buyer reference (BT-10), e.g. the buyer's contact or cost centre; this or orderReference is required */
  buyerReference?: string | null;
  /** purchase order reference (BT-13) */
  orderReference?: string | null;
  note?: string | null;
  seller: PeppolParty;
  buyer: PeppolParty;
  lines: PeppolLine[];
  payment?: {
    iban: string;
    bic?: string | null;
    accountName?: string | null;
    /** RF creditor reference or other remittance id (BT-83) */
    reference?: string | null;
  } | null;
  /** payment terms text (BT-20); required when there is no due date and an amount is payable */
  paymentTerms?: string | null;
  /** delivery date and country (required for K, intra-community supply) */
  delivery?: { date?: string | null; country?: string | null } | null;
  /** exemption reason text or VATEX code per category, overriding the defaults (required for E) */
  exemptionReasons?: Partial<Record<VatCategory, { code?: string; text?: string }>>;
  /** VAT accounting currency (BT-6) with the rate from invoice currency (1 unit = rate units) */
  taxCurrency?: { code: string; rate: number } | null;
}

export interface PeppolResult {
  xml: string | null;
  problems: string[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => round2(n).toFixed(2);
const el = (indent: string, tag: string, value: string | null | undefined, attrs = "") =>
  value ? `\n${indent}<${tag}${attrs}>${esc(value)}</${tag}>` : "";

function checkParty(role: "Seller" | "Buyer", p: PeppolParty, problems: string[]) {
  if (!p.name?.trim()) problems.push(`${role} name is missing.`);
  if (!/^\d{4}$/.test(p.endpoint?.scheme ?? "") || !p.endpoint?.id?.trim()) {
    problems.push(`${role} Peppol endpoint (EAS scheme code + id) is missing.`);
  }
  if (!/^[A-Z]{2}$/.test(p.country ?? "")) problems.push(`${role} country must be a 2-letter ISO code.`);
  if (p.vatId && !/^[A-Z]{2}[0-9A-Za-z+*.]{2,}$/.test(p.vatId.replace(/\s/g, ""))) {
    problems.push(`${role} VAT id must start with the country prefix (e.g. DE123456789).`);
  }
}

function partyXml(tag: string, p: PeppolParty): string {
  const i = "      ";
  const vatId = p.vatId?.replace(/\s/g, "");
  return `
  <cac:${tag}>
    <cac:Party>
      <cbc:EndpointID schemeID="${esc(p.endpoint.scheme)}">${esc(p.endpoint.id)}</cbc:EndpointID>
      <cac:PartyName>
        <cbc:Name>${esc(p.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>${el(i + "  ", "cbc:StreetName", p.street)}${
    el(i + "  ", "cbc:AdditionalStreetName", p.additionalStreet)
  }${el(i + "  ", "cbc:CityName", p.city)}${el(i + "  ", "cbc:PostalZone", p.postalCode)}${
    el(i + "  ", "cbc:CountrySubentity", p.subdivision)
  }
        <cac:Country>
          <cbc:IdentificationCode>${p.country}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>${
    vatId
      ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(vatId)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`
      : ""
  }
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName>${
    p.legalId?.id
      ? `
        <cbc:CompanyID${p.legalId.scheme ? ` schemeID="${esc(p.legalId.scheme)}"` : ""}>${
        esc(p.legalId.id)
      }</cbc:CompanyID>`
      : ""
  }
      </cac:PartyLegalEntity>${
    p.contact && (p.contact.name || p.contact.phone || p.contact.email)
      ? `
      <cac:Contact>${el(i + "  ", "cbc:Name", p.contact.name)}${el(i + "  ", "cbc:Telephone", p.contact.phone)}${
        el(i + "  ", "cbc:ElectronicMail", p.contact.email)
      }
      </cac:Contact>`
      : ""
  }
    </cac:Party>
  </cac:${tag}>`;
}

export function buildPeppolInvoice(input: PeppolInvoiceInput, profile: InvoiceProfile = "peppol"): PeppolResult {
  const problems: string[] = [];
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency === "USDT" || currency === "USDC" || currency === "USDG") {
    problems.push(`Currency ${currency} is not an ISO 4217 code; stablecoin invoices must be issued in EUR, USD, …`);
  }
  if (!input.number?.trim()) problems.push("Invoice number is missing.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) problems.push("Issue date must be YYYY-MM-DD.");
  if (!input.buyerReference?.trim() && !input.orderReference?.trim()) {
    problems.push("A buyer reference or purchase order reference is required by Peppol.");
  }
  checkParty("Seller", input.seller, problems);
  checkParty("Buyer", input.buyer, problems);
  if (input.lines.length === 0) problems.push("The invoice has no lines.");

  const categories = new Set(input.lines.map((l) => l.vatCategory));
  const sellerVat = !!input.seller.vatId;
  const buyerVat = !!input.buyer.vatId;
  for (const [n, l] of input.lines.entries()) {
    if (!l.description?.trim()) problems.push(`Line ${n + 1} has no description.`);
    if (!(l.quantity !== 0 && Number.isFinite(l.quantity))) problems.push(`Line ${n + 1} quantity is invalid.`);
    if (!(l.unitPrice >= 0)) problems.push(`Line ${n + 1} unit price must be zero or positive.`);
    if (l.vatCategory === "S" && !(l.vatRate > 0)) problems.push(`Line ${n + 1}: category S needs a rate above 0.`);
    if (l.vatCategory !== "S" && l.vatRate !== 0) problems.push(`Line ${n + 1}: category ${l.vatCategory} must be 0%.`);
  }
  if (categories.has("O") && categories.size > 1) {
    problems.push("Category O (outside the scope of VAT) cannot be combined with other VAT categories.");
  }
  if (categories.has("O") && (sellerVat || buyerVat)) {
    problems.push("Category O invoices must not carry seller or buyer VAT ids.");
  }
  for (const c of ["S", "Z", "E", "AE", "K", "G"] as VatCategory[]) {
    if (categories.has(c) && !sellerVat) problems.push(`Category ${c} needs the seller VAT id.`);
  }
  if ((categories.has("AE") || categories.has("K")) && !buyerVat) {
    problems.push("Reverse charge (AE) and intra-community supply (K) need the buyer VAT id.");
  }
  if (categories.has("K") && !(input.delivery?.date && input.delivery?.country)) {
    problems.push("Intra-community supply (K) needs the delivery date and delivery country.");
  }
  const reasons = (c: VatCategory) => ({ code: DEFAULT_VATEX[c], ...input.exemptionReasons?.[c] });
  if (categories.has("E") && !reasons("E").code && !reasons("E").text) {
    problems.push("Exempt lines (E) need an exemption reason (text or VATEX code).");
  }
  if (input.payment) {
    if (!isValidIban(input.payment.iban)) problems.push("Payment IBAN fails the check-digit test.");
    const ref = input.payment.reference?.replace(/\s/g, "");
    if (ref?.toUpperCase().startsWith("RF") && !isValidCreditorReference(ref)) {
      problems.push("Payment reference looks like an RF creditor reference but its check digits are wrong.");
    }
  }
  if (!input.dueDate && !input.paymentTerms) {
    problems.push("Give a due date or payment terms text (one is required when an amount is payable).");
  }
  // National Peppol rules (fatal) for the countries that add them.
  const from = input.seller.country, to = input.buyer.country;
  const hasAddress = (p: PeppolParty) => !!(p.street && p.city && p.postalCode);
  if (from === "DE" && to === "DE") {
    if (!input.payment) problems.push("German domestic invoices need payment instructions (IBAN).");
    const c = input.seller.contact;
    if (!(c && (c.name || c.phone || c.email))) problems.push("German domestic invoices need a seller contact.");
  }
  if ((from === "IT" || from === "NL") && !hasAddress(input.seller)) {
    problems.push(`Sellers in ${from} must give street, city and postal code.`);
  }
  if (from === "NL" && to === "NL" && !hasAddress(input.buyer)) {
    problems.push("Dutch domestic invoices need the buyer street, city and postal code.");
  }
  if (profile === "xrechnung") {
    // KoSIT BR-DE rules on top of EN 16931 (XRechnung 3.0).
    const c = input.seller.contact;
    if (!input.buyerReference?.trim()) {
      problems.push("XRechnung needs a buyer reference (Leitweg-ID for public buyers).");
    }
    if (!c?.name || !c?.phone || !c?.email) problems.push("XRechnung needs the seller contact name, phone and email.");
    if (c?.phone && (c.phone.match(/\d/g) ?? []).length < 3) {
      problems.push("The seller phone needs at least three digits.");
    }
    if (!input.seller.city || !input.seller.postalCode) {
      problems.push("XRechnung needs the seller city and postal code.");
    }
    if (!input.buyer.city || !input.buyer.postalCode) problems.push("XRechnung needs the buyer city and postal code.");
    if (!input.payment) problems.push("XRechnung needs payment instructions (IBAN).");
  }
  if (input.taxCurrency && !(input.taxCurrency.rate > 0 && /^[A-Z]{3}$/.test(input.taxCurrency.code))) {
    problems.push("Tax currency needs a 3-letter code and a positive exchange rate.");
  }

  if (problems.length > 0) return { xml: null, problems };

  const lines = input.lines.map((l, idx) => ({ ...l, id: idx + 1, net: round2(l.quantity * l.unitPrice) }));
  const groups = new Map<string, { category: VatCategory; rate: number; taxable: number }>();
  for (const l of lines) {
    const key = `${l.vatCategory}:${l.vatRate}`;
    const g = groups.get(key) ?? { category: l.vatCategory, rate: l.vatRate, taxable: 0 };
    g.taxable = round2(g.taxable + l.net);
    groups.set(key, g);
  }
  const subtotals = [...groups.values()].map((g) => ({ ...g, tax: round2((g.taxable * g.rate) / 100) }));
  const net = round2(lines.reduce((s, l) => s + l.net, 0));
  const vat = round2(subtotals.reduce((s, g) => s + g.tax, 0));
  const gross = round2(net + vat);

  const taxCategoryXml = (indent: string, c: VatCategory, rate: number, withReason: boolean) => {
    const r = reasons(c);
    // XRechnung (BR-DE-14) wants the rate in every VAT breakdown, 0 for O; Peppol leaves it out for O.
    const percent = c !== "O" || (profile === "xrechnung" && withReason);
    return `${indent}<cbc:ID>${c}</cbc:ID>${percent ? `\n${indent}<cbc:Percent>${rate}</cbc:Percent>` : ""}${
      withReason && c !== "S" && c !== "Z"
        ? `${el(indent, "cbc:TaxExemptionReasonCode", r.code)}${el(indent, "cbc:TaxExemptionReason", r.text)}`
        : ""
    }
${indent}<cac:TaxScheme>
${indent}  <cbc:ID>VAT</cbc:ID>
${indent}</cac:TaxScheme>`;
  };

  const p = input.payment;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${profile === "xrechnung" ? XRECHNUNG_3 : PEPPOL_BIS_3}</cbc:CustomizationID>
  <cbc:ProfileID>${PEPPOL_BILLING_PROCESS}</cbc:ProfileID>
  <cbc:ID>${esc(input.number)}</cbc:ID>
  <cbc:IssueDate>${input.issueDate}</cbc:IssueDate>${el("  ", "cbc:DueDate", input.dueDate)}
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>${el("  ", "cbc:Note", input.note)}
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>${
    el("  ", "cbc:TaxCurrencyCode", input.taxCurrency?.code)
  }${el("  ", "cbc:BuyerReference", input.buyerReference)}${
    input.orderReference
      ? `
  <cac:OrderReference>
    <cbc:ID>${esc(input.orderReference)}</cbc:ID>
  </cac:OrderReference>`
      : ""
  }${partyXml("AccountingSupplierParty", input.seller)}${partyXml("AccountingCustomerParty", input.buyer)}${
    input.delivery && (input.delivery.date || input.delivery.country)
      ? `
  <cac:Delivery>${el("    ", "cbc:ActualDeliveryDate", input.delivery.date)}${
        input.delivery.country
          ? `
    <cac:DeliveryLocation>
      <cac:Address>
        <cac:Country>
          <cbc:IdentificationCode>${esc(input.delivery.country)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:Address>
    </cac:DeliveryLocation>`
          : ""
      }
  </cac:Delivery>`
      : ""
  }${
    p
      ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode name="SEPA credit transfer">58</cbc:PaymentMeansCode>${
        el("    ", "cbc:PaymentID", p.reference?.replace(/\s/g, ""))
      }
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(p.iban.replace(/\s/g, "").toUpperCase())}</cbc:ID>${el("      ", "cbc:Name", p.accountName)}${
        p.bic
          ? `
      <cac:FinancialInstitutionBranch>
        <cbc:ID>${esc(p.bic)}</cbc:ID>
      </cac:FinancialInstitutionBranch>`
          : ""
      }
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`
      : ""
  }${
    input.paymentTerms
      ? `
  <cac:PaymentTerms>
    <cbc:Note>${esc(input.paymentTerms)}</cbc:Note>
  </cac:PaymentTerms>`
      : ""
  }
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${money(vat)}</cbc:TaxAmount>${
    subtotals.map((g) => `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${money(g.taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${money(g.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
${taxCategoryXml("        ", g.category, g.rate, true)}
      </cac:TaxCategory>
    </cac:TaxSubtotal>`).join("")
  }
  </cac:TaxTotal>${
    input.taxCurrency
      ? `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${input.taxCurrency.code}">${money(vat * input.taxCurrency.rate)}</cbc:TaxAmount>
  </cac:TaxTotal>`
      : ""
  }
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${money(net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${money(net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${money(gross)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${money(gross)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${
    lines.map((l) => `
  <cac:InvoiceLine>
    <cbc:ID>${l.id}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${esc(l.unitCode ?? "C62")}">${l.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${money(l.net)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(l.description.slice(0, 100))}</cbc:Name>
      <cac:ClassifiedTaxCategory>
${taxCategoryXml("        ", l.vatCategory, l.vatRate, false)}
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${l.unitPrice}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`).join("")
  }
</Invoice>
`;
  return { xml, problems: [] };
}
