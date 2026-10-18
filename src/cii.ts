/**
 * UN/CEFACT Cross Industry Invoice (CII D16B) for the EN 16931 core: the XML inside a Factur-X /
 * ZUGFeRD PDF (profile "EN 16931", Factur-X 1.0.07) and one of France's accepted e-invoice formats.
 * Same input as the Peppol builder, except that the Peppol endpoints and buyer reference are optional.
 * Output is checked against the official CEN EN 16931 CII schematron and the D16B XSD
 * (see conformance/).
 */
import {
  attachmentProblems,
  type PeppolInvoiceInput,
  type PeppolLine,
  type PeppolParty,
  type VatCategory,
} from "./peppol.ts";
import { isValidCreditorReference, isValidIban } from "./sepa.ts";

/** Factur-X / ZUGFeRD "EN 16931" (COMFORT) profile. */
export const FACTURX_EN16931 = "urn:cen.eu:en16931:2017";

export type CiiParty = Omit<PeppolParty, "endpoint"> & { endpoint?: { scheme: string; id: string } | null };
export type CiiLine = PeppolLine & {
  /** line note (BT-127), e.g. the on-chain transaction hash of an agent payment */
  note?: string | null;
};
export type CiiInvoiceInput = Omit<PeppolInvoiceInput, "seller" | "buyer" | "lines"> & {
  seller: CiiParty;
  buyer: CiiParty;
  lines: CiiLine[];
  /** extra invoice notes (BT-22) with an optional UNTDID 4451 subject code (BT-21) */
  notes?: { text: string; subjectCode?: string | null }[];
};

/**
 * Notes France requires on every B2B invoice (BR-FR-05, French e-invoicing reform): recovery fee
 * (PMT), late-payment penalties (PMD) and the discount terms (AAB). Defaults to the legal minimums;
 * pass your own wording when your terms differ.
 */
export function frenchMandatoryNotes(
  over: { pmt?: string; pmd?: string; aab?: string } = {},
): { subjectCode: string; text: string }[] {
  return [
    {
      subjectCode: "PMT",
      text: over.pmt ?? "Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €.",
    },
    { subjectCode: "PMD", text: over.pmd ?? "Pénalités de retard : trois fois le taux d'intérêt légal." },
    { subjectCode: "AAB", text: over.aab ?? "Pas d'escompte pour paiement anticipé." },
  ];
}

/** French electronic address (EAS 0225) from a SIREN, used by the e-invoicing directory. */
export const frenchEndpoint = (siren: string): { scheme: string; id: string } => ({
  scheme: "0225",
  id: siren.replace(/\s/g, ""),
});

export interface CiiResult {
  xml: string | null;
  problems: string[];
  totals: { net: number; vat: number; gross: number } | null;
}

const DEFAULT_VATEX: Partial<Record<VatCategory, string>> = {
  AE: "VATEX-EU-AE",
  K: "VATEX-EU-IC",
  G: "VATEX-EU-G",
  O: "VATEX-EU-O",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => round2(n).toFixed(2);
const el = (indent: string, tag: string, value: string | null | undefined, attrs = "") =>
  value ? `\n${indent}<${tag}${attrs}>${esc(value)}</${tag}>` : "";
const date102 = (d: string) => `<udt:DateTimeString format="102">${d.replace(/-/g, "")}</udt:DateTimeString>`;

function checkParty(role: "Seller" | "Buyer", p: CiiParty, problems: string[]) {
  if (!p.name?.trim()) problems.push(`${role} name is missing.`);
  if (!/^[A-Z]{2}$/.test(p.country ?? "")) problems.push(`${role} country must be a 2-letter ISO code.`);
  if (p.vatId && !/^[A-Z]{2}[0-9A-Za-z+*.]{2,}$/.test(p.vatId.replace(/\s/g, ""))) {
    problems.push(`${role} VAT id must start with the country prefix (e.g. FR12345678901).`);
  }
  if (p.endpoint && (!/^\d{4}$/.test(p.endpoint.scheme) || !p.endpoint.id.trim())) {
    problems.push(`${role} electronic address needs an EAS scheme code and an id.`);
  }
}

function partyXml(tag: string, p: CiiParty): string {
  const i = "        ";
  const vatId = p.vatId?.replace(/\s/g, "");
  const c = p.contact;
  return `
      <ram:${tag}>
        <ram:Name>${esc(p.name)}</ram:Name>${
    p.legalId?.id
      ? `
        <ram:SpecifiedLegalOrganization>
          <ram:ID${p.legalId.scheme ? ` schemeID="${esc(p.legalId.scheme)}"` : ""}>${esc(p.legalId.id)}</ram:ID>
        </ram:SpecifiedLegalOrganization>`
      : ""
  }${
    c && (c.name || c.phone || c.email)
      ? `
        <ram:DefinedTradeContact>${el(i + "  ", "ram:PersonName", c.name)}${
        c.phone
          ? `
          <ram:TelephoneUniversalCommunication>
            <ram:CompleteNumber>${esc(c.phone)}</ram:CompleteNumber>
          </ram:TelephoneUniversalCommunication>`
          : ""
      }${
        c.email
          ? `
          <ram:EmailURIUniversalCommunication>
            <ram:URIID>${esc(c.email)}</ram:URIID>
          </ram:EmailURIUniversalCommunication>`
          : ""
      }
        </ram:DefinedTradeContact>`
      : ""
  }
        <ram:PostalTradeAddress>${el(i + "  ", "ram:PostcodeCode", p.postalCode)}${
    el(i + "  ", "ram:LineOne", p.street)
  }${el(i + "  ", "ram:LineTwo", p.additionalStreet)}${el(i + "  ", "ram:CityName", p.city)}
          <ram:CountryID>${p.country}</ram:CountryID>${el(i + "  ", "ram:CountrySubDivisionName", p.subdivision)}
        </ram:PostalTradeAddress>${
    p.endpoint
      ? `
        <ram:URIUniversalCommunication>
          <ram:URIID schemeID="${esc(p.endpoint.scheme)}">${esc(p.endpoint.id)}</ram:URIID>
        </ram:URIUniversalCommunication>`
      : ""
  }${
    vatId
      ? `
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${esc(vatId)}</ram:ID>
        </ram:SpecifiedTaxRegistration>`
      : ""
  }
      </ram:${tag}>`;
}

export function buildCiiInvoice(input: CiiInvoiceInput): CiiResult {
  const problems: string[] = [];
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency === "USDT" || currency === "USDC" || currency === "USDG") {
    problems.push(`Currency ${currency} is not an ISO 4217 code; stablecoin invoices must be issued in EUR, USD, …`);
  }
  if (!input.number?.trim()) problems.push("Invoice number is missing.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) problems.push("Issue date must be YYYY-MM-DD.");
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) problems.push("Due date must be YYYY-MM-DD.");
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
  if (input.taxCurrency && !(input.taxCurrency.rate > 0 && /^[A-Z]{3}$/.test(input.taxCurrency.code))) {
    problems.push("Tax currency needs a 3-letter code and a positive exchange rate.");
  }
  problems.push(...attachmentProblems(input.attachments));
  if (problems.length > 0) return { xml: null, problems, totals: null };

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

  const lineTax = (c: VatCategory, rate: number) => `
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${c}</ram:CategoryCode>${
    c === "O" ? "" : `
          <ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent>`
  }
        </ram:ApplicableTradeTax>`;

  const p = input.payment;
  const d = input.delivery;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${FACTURX_EN16931}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(input.number)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      ${date102(input.issueDate)}
    </ram:IssueDateTime>${
    [...(input.note ? [{ text: input.note, subjectCode: null }] : []), ...(input.notes ?? [])].map((n) => `
    <ram:IncludedNote>
      <ram:Content>${esc(n.text)}</ram:Content>${el("      ", "ram:SubjectCode", n.subjectCode)}
    </ram:IncludedNote>`).join("")
  }
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${
    lines.map((l) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${l.id}</ram:LineID>${
      l.note
        ? `
        <ram:IncludedNote>
          <ram:Content>${esc(l.note)}</ram:Content>
        </ram:IncludedNote>`
        : ""
    }
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${esc(l.description.slice(0, 100))}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${l.unitPrice}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${esc(l.unitCode ?? "C62")}">${l.quantity}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>${lineTax(l.vatCategory, l.vatRate)}
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${money(l.net)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join("")
  }
    <ram:ApplicableHeaderTradeAgreement>${el("      ", "ram:BuyerReference", input.buyerReference)}${
    partyXml("SellerTradeParty", input.seller)
  }${partyXml("BuyerTradeParty", input.buyer)}${
    input.orderReference
      ? `
      <ram:BuyerOrderReferencedDocument>
        <ram:IssuerAssignedID>${esc(input.orderReference)}</ram:IssuerAssignedID>
      </ram:BuyerOrderReferencedDocument>`
      : ""
  }${
    (input.attachments ?? []).map((a) => `
      <ram:AdditionalReferencedDocument>
        <ram:IssuerAssignedID>${esc(a.id)}</ram:IssuerAssignedID>
        <ram:TypeCode>916</ram:TypeCode>${el("        ", "ram:Name", a.description)}
        <ram:AttachmentBinaryObject mimeCode="${esc(a.mimeCode)}" filename="${
      esc(a.filename)
    }">${a.base64}</ram:AttachmentBinaryObject>
      </ram:AdditionalReferencedDocument>`).join("")
  }
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>${
    d?.country
      ? `
      <ram:ShipToTradeParty>
        <ram:PostalTradeAddress>
          <ram:CountryID>${esc(d.country)}</ram:CountryID>
        </ram:PostalTradeAddress>
      </ram:ShipToTradeParty>`
      : ""
  }${
    d?.date
      ? `
      <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime>
          ${date102(d.date)}
        </ram:OccurrenceDateTime>
      </ram:ActualDeliverySupplyChainEvent>`
      : ""
  }
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>${el("      ", "ram:PaymentReference", p?.reference?.replace(/\s/g, ""))}${
    el("      ", "ram:TaxCurrencyCode", input.taxCurrency?.code)
  }
      <ram:InvoiceCurrencyCode>${currency}</ram:InvoiceCurrencyCode>${
    p
      ? `
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>${esc(p.iban.replace(/\s/g, "").toUpperCase())}</ram:IBANID>${
        el("          ", "ram:AccountName", p.accountName)
      }
        </ram:PayeePartyCreditorFinancialAccount>${
        p.bic
          ? `
        <ram:PayeeSpecifiedCreditorFinancialInstitution>
          <ram:BICID>${esc(p.bic)}</ram:BICID>
        </ram:PayeeSpecifiedCreditorFinancialInstitution>`
          : ""
      }
      </ram:SpecifiedTradeSettlementPaymentMeans>`
      : ""
  }${
    subtotals.map((g) => {
      const r = reasons(g.category);
      const exempt = g.category !== "S" && g.category !== "Z";
      return `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${money(g.tax)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>${exempt ? el("        ", "ram:ExemptionReason", r.text) : ""}
        <ram:BasisAmount>${money(g.taxable)}</ram:BasisAmount>
        <ram:CategoryCode>${g.category}</ram:CategoryCode>${
        exempt ? el("        ", "ram:ExemptionReasonCode", r.code) : ""
      }${
        g.category === "O" ? "" : `
        <ram:RateApplicablePercent>${g.rate}</ram:RateApplicablePercent>`
      }
      </ram:ApplicableTradeTax>`;
    }).join("")
  }${
    input.paymentTerms || input.dueDate
      ? `
      <ram:SpecifiedTradePaymentTerms>${el("        ", "ram:Description", input.paymentTerms)}${
        input.dueDate
          ? `
        <ram:DueDateDateTime>
          ${date102(input.dueDate)}
        </ram:DueDateDateTime>`
          : ""
      }
      </ram:SpecifiedTradePaymentTerms>`
      : ""
  }
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${money(net)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${money(net)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${currency}">${money(vat)}</ram:TaxTotalAmount>${
    input.taxCurrency
      ? `
        <ram:TaxTotalAmount currencyID="${input.taxCurrency.code}">${
        money(vat * input.taxCurrency.rate)
      }</ram:TaxTotalAmount>`
      : ""
  }
        <ram:GrandTotalAmount>${money(gross)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${money(gross)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
  return { xml, problems: [], totals: { net, vat, gross } };
}
