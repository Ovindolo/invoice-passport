/**
 * Peppol International (PINT) invoices for the United Arab Emirates (PINT AE 1.0.4, the format of the
 * UAE e-invoicing mandate) and Singapore (PINT SG 1.4.1, InvoiceNow / IRAS). UBL 2.1 syntax.
 * Covers the cases a services seller needs: standard rated, zero rated (exports), exempt and out of
 * scope, foreign invoice currencies with the tax in AED / SGD. Missing data comes back as problems;
 * output is checked against the official PINT and jurisdiction schematron (see conformance/).
 */
import { attachmentProblems, type InvoiceAttachment, ublAttachments } from "./peppol.ts";
import { isValidIban } from "./sepa.ts";

export const PINT_AE = "urn:peppol:pint:billing-1@ae-1";
export const PINT_SG = "urn:peppol:pint:billing-1@sg-1";
export const PINT_BILLING = "urn:peppol:bis:billing";
/** Emirate codes for the country subdivision of UAE addresses. */
export const EMIRATES = ["AUH", "DXB", "SHJ", "UAQ", "FUJ", "AJM", "RAK"];
/** UAE predefined endpoint for buyers outside the UAE network (exports). */
export const AE_EXPORT_ENDPOINT = { scheme: "0235", id: "9900000099" };

export type PintJurisdiction = "ae" | "sg";

export interface PintParty {
  name: string;
  /** Peppol address; defaults: UAE 0235 + TIN (first 10 digits of the TRN), Singapore 0195 + SGUEN + UEN */
  endpoint?: { scheme: string; id: string } | null;
  /** TRN (UAE, 15 digits) or GST registration number (Singapore) */
  taxId?: string | null;
  /** UAE: trade licence (TL), Emirates ID (EID), passport (PAS) or cabinet decision (CD); Singapore: UEN */
  legalId?: { id: string; type?: "TL" | "EID" | "PAS" | "CD" | null; authority?: string | null } | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  /** UAE: emirate code (DXB, AUH, …) */
  subdivision?: string | null;
  country: string;
  contact?: { name?: string | null; phone?: string | null; email?: string | null } | null;
}

export interface PintLine {
  name: string;
  description?: string | null;
  quantity: number;
  unitCode?: string;
  unitPrice: number;
  /** UAE: S, Z, E, O. Singapore: SR, ZR, ES33, ESN33, OS, NG */
  taxCategory: string;
  taxRate: number;
  /** UAE: G (goods), S (services) or B (both) */
  itemType?: "G" | "S" | "B" | null;
  /** UAE: HS code for goods */
  hsCode?: string | null;
  /** UAE: service accounting code (SAC) for services */
  serviceCode?: string | null;
  /** UAE exempt supplies: exemption code from the PINT AE list (e.g. DL8.46.1) */
  exemptionCode?: string | null;
}

/** UAE credit note reasons (BTAE-03, PINT AE CreditReason code list). */
export const AE_CREDIT_REASONS = ["DL8.61.1.A", "DL8.61.1.B", "DL8.61.1.C", "DL8.61.1.D", "DL8.61.1.E", "VD"];

export interface PintInvoiceInput {
  jurisdiction: PintJurisdiction;
  /** "credit-note" emits a UBL CreditNote (381) that credits `precedingInvoice` */
  documentType?: "invoice" | "credit-note";
  precedingInvoice?: { number: string; issueDate?: string | null } | null;
  /** UAE credit notes: reason code from AE_CREDIT_REASONS (e.g. DL8.61.1.A cancelled supply) */
  creditReason?: string | null;
  number: string;
  /** RFC 4122 UUID identifying the invoice */
  uuid: string;
  issueDate: string;
  dueDate?: string | null;
  currency: string;
  buyerReference?: string | null;
  orderReference?: string | null;
  note?: string | null;
  /** UAE transaction type flags, 8 characters of 0/1 (exports = 00000001); defaults from the buyer country */
  transactionType?: string | null;
  seller: PintParty;
  buyer: PintParty;
  lines: PintLine[];
  payment?: { account: string; bic?: string | null; accountName?: string | null; reference?: string | null } | null;
  paymentTerms?: string | null;
  /** units of AED / SGD per 1 unit of the invoice currency; required when the invoice is in another currency */
  taxCurrencyRate?: number | null;
  /** supporting documents embedded in the invoice, e.g. the CSV of on-chain transactions */
  attachments?: InvoiceAttachment[];
}

export interface PintResult {
  xml: string | null;
  problems: string[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => round2(n).toFixed(2);
const el = (indent: string, tag: string, value: string | null | undefined, attrs = "") =>
  value ? `\n${indent}<${tag}${attrs}>${esc(value)}</${tag}>` : "";
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

const AE_CATEGORIES = ["S", "Z", "E", "O"];
const SG_CATEGORIES = ["SR", "ZR", "ES33", "ESN33", "OS", "NG"];

/** Default Peppol endpoint for a party under the jurisdiction's scheme, when one can be derived. */
export function pintEndpoint(
  jurisdiction: PintJurisdiction,
  p: Pick<PintParty, "country" | "taxId" | "legalId">,
): { scheme: string; id: string } | null {
  if (jurisdiction === "ae") {
    if (p.country !== "AE") return AE_EXPORT_ENDPOINT;
    const trn = digits(p.taxId);
    return trn.length === 15 ? { scheme: "0235", id: trn.slice(0, 10) } : null;
  }
  const uen = (p.legalId?.id ?? "").replace(/\s/g, "").toUpperCase();
  return p.country === "SG" && uen ? { scheme: "0195", id: `SGUEN${uen}` } : null;
}

export function buildPintInvoice(input: PintInvoiceInput): PintResult {
  const problems: string[] = [];
  const ae = input.jurisdiction === "ae";
  const local = ae ? "AED" : "SGD";
  const scheme = ae ? "VAT" : "GST";
  const currency = input.currency.trim().toUpperCase();
  const seller = { ...input.seller, endpoint: input.seller.endpoint ?? pintEndpoint(input.jurisdiction, input.seller) };
  const buyer = { ...input.buyer, endpoint: input.buyer.endpoint ?? pintEndpoint(input.jurisdiction, input.buyer) };
  const exportSale = ae && buyer.country !== "AE";
  const txType = input.transactionType ?? (exportSale ? "00000001" : "00000000");
  const credit = input.documentType === "credit-note";
  if (credit && !input.precedingInvoice?.number?.trim()) {
    problems.push("A credit note must name the invoice it credits.");
  }
  if (credit && ae && !AE_CREDIT_REASONS.includes(input.creditReason ?? "")) {
    problems.push(`UAE credit notes need a reason code: ${AE_CREDIT_REASONS.join(", ")}.`);
  }

  if (!/^[A-Z]{3}$/.test(currency) || /^(USDT|USDC|USDG)$/.test(currency)) {
    problems.push(`Currency ${currency} is not an ISO 4217 code; price stablecoin invoices in USD.`);
  }
  if (!input.number?.trim()) problems.push("Invoice number is missing.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.uuid ?? "")) {
    problems.push("The invoice UUID is missing or malformed.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) problems.push("Issue date must be YYYY-MM-DD.");
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) problems.push("Due date must be YYYY-MM-DD.");
  if (input.lines.length === 0) problems.push("The invoice has no lines.");
  for (const [role, p] of [["Seller", seller], ["Buyer", buyer]] as const) {
    if (!p.name?.trim()) problems.push(`${role} name is missing.`);
    if (!/^[A-Z]{2}$/.test(p.country ?? "")) problems.push(`${role} country must be a 2-letter ISO code.`);
    if (!p.endpoint) problems.push(`${role} Peppol endpoint is missing.`);
  }
  if (currency !== local && !(input.taxCurrencyRate && input.taxCurrencyRate > 0)) {
    problems.push(`Invoiced in ${currency}: the ${local} exchange rate is required.`);
  }
  if (input.payment && /^[A-Z]{2}\d{2}/.test(input.payment.account) && !isValidIban(input.payment.account)) {
    problems.push("Payment IBAN fails the check-digit test.");
  }

  const categories = new Set(input.lines.map((l) => l.taxCategory));
  if (ae) {
    if (seller.country !== "AE") problems.push("PINT AE is for sellers in the UAE.");
    if (!/^1\d{14}$/.test(digits(seller.taxId))) problems.push("Seller TRN must be 15 digits starting with 1.");
    if (!seller.legalId?.id || !seller.legalId.type) {
      problems.push(
        "Seller legal registration (trade licence, Emirates ID, passport or cabinet decision) is required.",
      );
    } else if (seller.legalId.type === "TL" && !seller.legalId.authority) {
      problems.push("Give the authority that issued the seller's trade licence.");
    }
    for (const [role, p] of [["Seller", seller], ["Buyer", buyer]] as const) {
      if (p.country !== "AE") continue;
      if (!p.street || !p.city) problems.push(`${role} street and city are required.`);
      if (!EMIRATES.includes(p.subdivision ?? "")) {
        problems.push(`${role} emirate must be one of ${EMIRATES.join(", ")}.`);
      }
    }
    if (!exportSale && !buyer.taxId && !buyer.legalId?.id) {
      problems.push("UAE buyers need their TRN or legal registration identifier.");
    }
    if (buyer.country === "AE" && buyer.legalId?.id && !buyer.legalId.type) {
      problems.push("Give the type of the buyer's legal registration identifier.");
    }
    if (!input.dueDate && !credit) problems.push("A payment due date is required.");
    if (exportSale && (!buyer.street || !buyer.city || !buyer.subdivision)) {
      problems.push("Exports need the buyer street, city and region (used as the delivery address).");
    }
    if (!/^[01]{8}$/.test(txType)) problems.push("Transaction type must be 8 characters of 0 and 1.");
    for (const [n, l] of input.lines.entries()) {
      if (!AE_CATEGORIES.includes(l.taxCategory)) problems.push(`Line ${n + 1}: VAT category must be S, Z, E or O.`);
      if (l.taxCategory === "S" && l.taxRate !== 5) problems.push(`Line ${n + 1}: standard rate is 5%.`);
      if (l.taxCategory !== "S" && l.taxRate !== 0) {
        problems.push(`Line ${n + 1}: category ${l.taxCategory} must be 0%.`);
      }
      if (!l.itemType) problems.push(`Line ${n + 1}: say whether it is goods (G), services (S) or both (B).`);
      if ((l.itemType === "G" || l.itemType === "B") && !l.hsCode) {
        problems.push(`Line ${n + 1}: goods need an HS code.`);
      }
      if ((l.itemType === "S" || l.itemType === "B") && !l.serviceCode) {
        problems.push(`Line ${n + 1}: services need a service accounting code (SAC).`);
      }
      if (l.taxCategory === "E" && !l.exemptionCode) {
        problems.push(`Line ${n + 1}: exempt supplies need an exemption code.`);
      }
    }
  } else {
    if (seller.country !== "SG") problems.push("PINT SG is for sellers in Singapore.");
    if (!input.buyerReference?.trim() && !input.orderReference?.trim()) {
      problems.push("A buyer reference or purchase order reference is required.");
    }
    if (!input.dueDate && !input.paymentTerms) problems.push("Give a due date or payment terms.");
    if (input.lines.some((l) => ["SR", "ZR"].includes(l.taxCategory)) && (!buyer.street || !buyer.postalCode)) {
      problems.push("Standard and zero-rated GST invoices need the buyer street and postal code.");
    }
    for (const [n, l] of input.lines.entries()) {
      if (!SG_CATEGORIES.includes(l.taxCategory)) {
        problems.push(`Line ${n + 1}: GST category must be one of ${SG_CATEGORIES.join(", ")}.`);
      }
      if (l.taxCategory === "SR" && !(l.taxRate > 0)) problems.push(`Line ${n + 1}: SR needs a rate above 0.`);
      if (l.taxCategory !== "SR" && l.taxRate !== 0) {
        problems.push(`Line ${n + 1}: category ${l.taxCategory} must be 0%.`);
      }
    }
    if (categories.has("NG") && (categories.size > 1 || seller.taxId)) {
      problems.push("NG (seller not GST registered) cannot be mixed with other categories or a GST number.");
    }
    if (!categories.has("NG") && !seller.taxId) problems.push("Seller GST registration number is required.");
  }
  for (const [n, l] of input.lines.entries()) {
    if (!l.name?.trim()) problems.push(`Line ${n + 1} has no name.`);
    if (!(l.quantity !== 0 && Number.isFinite(l.quantity))) problems.push(`Line ${n + 1} quantity is invalid.`);
    if (!(l.unitPrice >= 0)) problems.push(`Line ${n + 1} unit price must be zero or positive.`);
  }
  problems.push(...attachmentProblems(input.attachments));
  if (problems.length > 0) return { xml: null, problems };

  const lines = input.lines.map((l, i) => {
    const net = round2(l.quantity * l.unitPrice);
    return { ...l, id: i + 1, net, tax: round2((net * l.taxRate) / 100) };
  });
  const groups = new Map<string, { category: string; rate: number; taxable: number }>();
  for (const l of lines) {
    const key = `${l.taxCategory}:${l.taxRate}`;
    const g = groups.get(key) ?? { category: l.taxCategory, rate: l.taxRate, taxable: 0 };
    g.taxable = round2(g.taxable + l.net);
    groups.set(key, g);
  }
  const subtotals = [...groups.values()].map((g) => ({ ...g, tax: round2((g.taxable * g.rate) / 100) }));
  const net = round2(lines.reduce((s, l) => s + l.net, 0));
  const vat = round2(subtotals.reduce((s, g) => s + g.tax, 0));
  const gross = round2(net + vat);
  const rate = currency === local ? null : Math.round(input.taxCurrencyRate! * 1e6) / 1e6;
  /** AE leaves the rate out for exempt and out-of-scope; SG always states it. */
  const percent = (
    category: string,
    value: number,
  ) => (ae && (category === "E" || category === "O") ? null : String(value));

  const party = (tag: string, p: PintParty & { endpoint: { scheme: string; id: string } | null }) => {
    const legal = p.legalId?.id
      ? `\n        <cbc:CompanyID${
        ae && p.legalId.type
          ? ` schemeAgencyID="${p.legalId.type}"${
            p.legalId.authority ? ` schemeAgencyName="${esc(p.legalId.authority)}"` : ""
          }`
          : ""
      }>${esc(p.legalId.id)}</cbc:CompanyID>`
      : "";
    const c = p.contact;
    return `
  <cac:${tag}>
    <cac:Party>
      <cbc:EndpointID schemeID="${esc(p.endpoint!.scheme)}">${esc(p.endpoint!.id)}</cbc:EndpointID>
      <cac:PostalAddress>${el("        ", "cbc:StreetName", p.street)}${el("        ", "cbc:CityName", p.city)}${
      el("        ", "cbc:PostalZone", p.postalCode)
    }${el("        ", "cbc:CountrySubentity", p.subdivision)}
        <cac:Country>
          <cbc:IdentificationCode>${p.country}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>${
      p.taxId
        ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(p.taxId.replace(/\s/g, ""))}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>${scheme}</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`
        : ""
    }
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName>${legal}
      </cac:PartyLegalEntity>${
      c && (c.name || c.phone || c.email)
        ? `
      <cac:Contact>${el("        ", "cbc:Name", c.name)}${el("        ", "cbc:Telephone", c.phone)}${
          el("        ", "cbc:ElectronicMail", c.email)
        }
      </cac:Contact>`
        : ""
    }
    </cac:Party>
  </cac:${tag}>`;
  };

  const taxCategory = (indent: string, category: string, value: number, exemption?: string | null) =>
    `${indent}<cbc:ID>${category}</cbc:ID>${el(indent, "cbc:Percent", percent(category, value))}${
      el(indent, "cbc:TaxExemptionReasonCode", exemption)
    }
${indent}<cac:TaxScheme>
${indent}  <cbc:ID>${scheme}</cbc:ID>
${indent}</cac:TaxScheme>`;

  const p = input.payment;
  const root = credit ? "CreditNote" : "Invoice";
  const lineTag = credit ? "CreditNoteLine" : "InvoiceLine";
  const qtyTag = credit ? "CreditedQuantity" : "InvoicedQuantity";
  const pre = input.precedingInvoice;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${ae ? PINT_AE : PINT_SG}</cbc:CustomizationID>
  <cbc:ProfileID>${PINT_BILLING}</cbc:ProfileID>${
    ae ? `\n  <cbc:ProfileExecutionID>${txType}</cbc:ProfileExecutionID>` : ""
  }
  <cbc:ID>${esc(input.number)}</cbc:ID>
  <cbc:UUID>${input.uuid.toLowerCase()}</cbc:UUID>
  <cbc:IssueDate>${input.issueDate}</cbc:IssueDate>${credit ? "" : el("  ", "cbc:DueDate", input.dueDate)}
  <cbc:${credit ? "CreditNoteTypeCode" : "InvoiceTypeCode"}>${credit ? 381 : 380}</cbc:${
    credit ? "CreditNoteTypeCode" : "InvoiceTypeCode"
  }>${el("  ", "cbc:Note", input.note)}
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>${
    rate ? `\n  <cbc:TaxCurrencyCode>${local}</cbc:TaxCurrencyCode>` : ""
  }${el("  ", "cbc:BuyerReference", input.buyerReference)}${
    credit && ae
      ? `
  <cac:DiscrepancyResponse>
    <cbc:ResponseCode>${esc(input.creditReason!)}</cbc:ResponseCode>
  </cac:DiscrepancyResponse>`
      : ""
  }${
    input.orderReference
      ? `
  <cac:OrderReference>
    <cbc:ID>${esc(input.orderReference)}</cbc:ID>
  </cac:OrderReference>`
      : ""
  }${
    pre?.number
      ? `
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${esc(pre.number)}</cbc:ID>${el("      ", "cbc:IssueDate", pre.issueDate)}
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`
      : ""
  }${
    ae && rate
      ? `
  <cac:AdditionalDocumentReference>
    <cbc:ID>AED</cbc:ID>
    <cbc:DocumentTypeCode>aedtotal-incl-vat</cbc:DocumentTypeCode>
    <cbc:DocumentDescription>AED ${money(gross * rate)}</cbc:DocumentDescription>
  </cac:AdditionalDocumentReference>`
      : ""
  }${
    !ae && rate
      ? `
  <cac:AdditionalDocumentReference>
    <cbc:ID>SGD</cbc:ID>
    <cbc:DocumentTypeCode>sgdtotal-excl-gst</cbc:DocumentTypeCode>
    <cbc:DocumentDescription>${money(net * rate)}</cbc:DocumentDescription>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>SGD</cbc:ID>
    <cbc:DocumentTypeCode>sgdtotal-incl-gst</cbc:DocumentTypeCode>
    <cbc:DocumentDescription>${money(net * rate + round2(vat * rate))}</cbc:DocumentDescription>
  </cac:AdditionalDocumentReference>`
      : ""
  }${ublAttachments(input.attachments)}${party("AccountingSupplierParty", seller)}${
    party("AccountingCustomerParty", buyer)
  }${
    exportSale
      ? `
  <cac:Delivery>
    <cac:DeliveryLocation>
      <cac:Address>${el("        ", "cbc:StreetName", buyer.street)}${el("        ", "cbc:CityName", buyer.city)}${
        el("        ", "cbc:PostalZone", buyer.postalCode)
      }${el("        ", "cbc:CountrySubentity", buyer.subdivision)}
        <cac:Country>
          <cbc:IdentificationCode>${buyer.country}</cbc:IdentificationCode>
        </cac:Country>
      </cac:Address>
    </cac:DeliveryLocation>
  </cac:Delivery>`
      : ""
  }${
    p
      ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode name="Credit transfer">30</cbc:PaymentMeansCode>${el("    ", "cbc:PaymentID", p.reference)}
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(p.account.replace(/\s/g, "").toUpperCase())}</cbc:ID>${el("      ", "cbc:Name", p.accountName)}${
        p.bic
          ? `
      <cac:FinancialInstitutionBranch>
        <cbc:ID>${esc(p.bic)}</cbc:ID>
      </cac:FinancialInstitutionBranch>`
          : ""
      }
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`
      : ae && !credit
      ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode name="Instrument not defined">1</cbc:PaymentMeansCode>
  </cac:PaymentMeans>`
      : ""
  }${
    input.paymentTerms
      ? `
  <cac:PaymentTerms>
    <cbc:Note>${esc(input.paymentTerms)}</cbc:Note>
  </cac:PaymentTerms>`
      : ""
  }${
    ae && rate
      ? `
  <cac:TaxExchangeRate>
    <cbc:SourceCurrencyCode>${currency}</cbc:SourceCurrencyCode>
    <cbc:TargetCurrencyCode>AED</cbc:TargetCurrencyCode>
    <cbc:CalculationRate>${rate}</cbc:CalculationRate>
  </cac:TaxExchangeRate>`
      : ""
  }
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${money(vat)}</cbc:TaxAmount>${
    subtotals.map((g) => `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${money(g.taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${money(g.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
${taxCategory("        ", g.category, g.rate, lines.find((l) => l.taxCategory === g.category)?.exemptionCode)}
      </cac:TaxCategory>
    </cac:TaxSubtotal>`).join("")
  }
  </cac:TaxTotal>${
    rate
      ? `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${local}">${money(vat * rate)}</cbc:TaxAmount>
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
  <cac:${lineTag}>
    <cbc:ID>${l.id}</cbc:ID>
    <cbc:${qtyTag} unitCode="${esc(l.unitCode ?? "C62")}">${l.quantity}</cbc:${qtyTag}>
    <cbc:LineExtensionAmount currencyID="${currency}">${money(l.net)}</cbc:LineExtensionAmount>
    <cac:Item>${ae ? el("      ", "cbc:Description", l.description ?? l.name) : ""}
      <cbc:Name>${esc(l.name.slice(0, 100))}</cbc:Name>${
      ae && l.serviceCode
        ? `
      <cac:AdditionalItemIdentification>
        <cbc:ID schemeID="SAC">${esc(l.serviceCode)}</cbc:ID>
      </cac:AdditionalItemIdentification>`
        : ""
    }${
      ae
        ? `
      <cac:CommodityClassification>
        <cbc:CommodityCode>${l.itemType}</cbc:CommodityCode>${
          el("        ", "cbc:ItemClassificationCode", l.hsCode, ' listID="HS"')
        }
      </cac:CommodityClassification>`
        : ""
    }
      <cac:ClassifiedTaxCategory>
${taxCategory("        ", l.taxCategory, l.taxRate)}
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${l.unitPrice}</cbc:PriceAmount>${
      ae
        ? `
      <cbc:BaseQuantity unitCode="${esc(l.unitCode ?? "C62")}">1</cbc:BaseQuantity>
      <cac:AllowanceCharge>
        <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
        <cbc:Amount currencyID="${currency}">0.00</cbc:Amount>
        <cbc:BaseAmount currencyID="${currency}">${l.unitPrice}</cbc:BaseAmount>
      </cac:AllowanceCharge>`
        : ""
    }
    </cac:Price>${
      ae
        ? `
    <cac:ItemPriceExtension>
      <cbc:Amount currencyID="${currency}">${money(l.net + l.tax)}</cbc:Amount>${
          l.taxCategory === "E" ? "" : `
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${currency}">${money(l.tax)}</cbc:TaxAmount>
      </cac:TaxTotal>`
        }
    </cac:ItemPriceExtension>`
        : ""
    }
  </cac:${lineTag}>`).join("")
  }
</${root}>
`;
  return { xml, problems: [] };
}
