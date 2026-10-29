/**
 * UBL 2.1 invoice for RO e-Factura (EN 16931, CIUS-RO 1.0.1).
 * RO e-Factura carries invoices to clients in Romania (ANAF rejects foreign buyer ids), so v0
 * covers Romanian clients and two VAT situations:
 *   S — standard rate (invoice tax_rate > 0, seller VAT-registered)
 *   O — seller not VAT-registered (rate 0, CUI without "RO" prefix): "neplătitor de TVA"
 * Anything else is reported as a problem instead of guessing a VAT treatment.
 * Both cases pass ANAF's validator (webservicesp.anaf.ro/prod/FCTEL/rest/validare/FACT1).
 */

export const CIUS_RO = "urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1";

/** County codes (ISO 3166-2:RO) for the largest cities; anything else must be given explicitly. */
const CITY_COUNTY: Record<string, string> = {
  bucuresti: "RO-B",
  bucharest: "RO-B",
  "cluj-napoca": "RO-CJ",
  cluj: "RO-CJ",
  timisoara: "RO-TM",
  iasi: "RO-IS",
  constanta: "RO-CT",
  brasov: "RO-BV",
  craiova: "RO-DJ",
  galati: "RO-GL",
  ploiesti: "RO-PH",
  oradea: "RO-BH",
  braila: "RO-BR",
  arad: "RO-AR",
  pitesti: "RO-AG",
  sibiu: "RO-SB",
  bacau: "RO-BC",
  "targu mures": "RO-MS",
  "targu-mures": "RO-MS",
  "baia mare": "RO-MM",
  buzau: "RO-BZ",
  botosani: "RO-BT",
  "satu mare": "RO-SM",
  "ramnicu valcea": "RO-VL",
  suceava: "RO-SV",
  "piatra neamt": "RO-NT",
  drobeta: "RO-MH",
  "drobeta-turnu severin": "RO-MH",
  focsani: "RO-VN",
  "targu jiu": "RO-GJ",
  tulcea: "RO-TL",
  resita: "RO-CS",
  "alba iulia": "RO-AB",
  deva: "RO-HD",
  zalau: "RO-SJ",
  "sfantu gheorghe": "RO-CV",
  bistrita: "RO-BN",
  vaslui: "RO-VS",
  slatina: "RO-OT",
  calarasi: "RO-CL",
  giurgiu: "RO-GR",
  slobozia: "RO-IL",
  alexandria: "RO-TR",
  targoviste: "RO-DB",
  "miercurea ciuc": "RO-HR",
  voluntari: "RO-IF",
  otopeni: "RO-IF",
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export interface UblParty {
  name: string | null;
  /** CUI / VAT id as entered (e.g. "RO12345678" or "12345678") */
  taxId: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  /** ISO 3166-1 alpha-2, e.g. "RO" */
  country: string | null;
  /** ISO 3166-2 subdivision, e.g. "RO-CJ"; derived from city when missing */
  county?: string | null;
}

export interface UblLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface UblInvoiceInput {
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  /** percent, e.g. 19 */
  taxRate: number;
  note: string | null;
  seller: UblParty;
  buyer: UblParty;
  lines: UblLine[];
  iban: string | null;
  /** payment reference (BT-83), e.g. the RF creditor reference printed on the invoice */
  paymentReference?: string | null;
  /** RON per unit of currency (BNR), required when currency is not RON */
  ronRate: number | null;
}

export interface UblResult {
  xml: string | null;
  vatCategory: "S" | "O" | null;
  problems: string[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const round2 = (n: number) => Math.round(n * 100) / 100;

const COUNTRY_ALIASES: Record<string, string> = {
  romania: "RO",
  "românia": "RO",
  germany: "DE",
  deutschland: "DE",
  france: "FR",
  italy: "IT",
  spain: "ES",
  netherlands: "NL",
  "united kingdom": "GB",
  uk: "GB",
  "united states": "US",
  usa: "US",
  bulgaria: "BG",
  hungary: "HU",
  poland: "PL",
  austria: "AT",
  moldova: "MD",
  "united arab emirates": "AE",
  uae: "AE",
  "emiratele arabe unite": "AE",
  dubai: "AE",
  "abu dhabi": "AE",
  singapore: "SG",
  panama: "PA",
  "british virgin islands": "VG",
  bvi: "VG",
  "cayman islands": "KY",
  seychelles: "SC",
  switzerland: "CH",
  schweiz: "CH",
  elvetia: "CH",
  "hong kong": "HK",
  "el salvador": "SV",
  malta: "MT",
  cyprus: "CY",
  portugal: "PT",
  belgium: "BE",
  ireland: "IE",
  estonia: "EE",
  germania: "DE",
  franta: "FR",
  italia: "IT",
  spania: "ES",
  "marea britanie": "GB",
  sua: "US",
  // Informal or older English names that the standard names below do not cover.
  "czech republic": "CZ",
  holland: "NL",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  america: "US",
  "united states of america": "US",
  us: "US",
  "south korea": "KR",
  korea: "KR",
  "republic of korea": "KR",
  "north korea": "KP",
  turkey: "TR",
  "ivory coast": "CI",
  burma: "MM",
  myanmar: "MM",
  swaziland: "SZ",
  macedonia: "MK",
  "east timor": "TL",
  "cape verde": "CV",
  vatican: "VA",
  ksa: "SA",
  "democratic republic of the congo": "CD",
  "dr congo": "CD",
  drc: "CD",
  "republic of the congo": "CG",
  congo: "CG",
  macau: "MO",
  macao: "MO",
  palestine: "PS",
  russia: "RU",
  vietnam: "VN",
};

/** ISO 3166-1 alpha-2 country codes, plus XK (Kosovo). */
const ISO_COUNTRIES = new Set(
  ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW " +
    "BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ " +
    "FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ " +
    "IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH " +
    "MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL " +
    "PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD " +
    "TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW")
    .split(" "),
);
/** Codes people use that are not the ISO code: UK for GB, and EL (the EU VAT prefix) for Greece. */
const CODE_ALIASES: Record<string, string> = { UK: "GB", EL: "GR" };
/** Country names are recognised in these languages (Billify's languages and its main markets'). */
// deno-fmt-ignore
const NAME_LOCALES = [
  "en", "de", "fr", "es", "it", "ro", "hi", "pt", "nl", "pl", "sv", "da", "fi", "cs", "sk", "sl", "hr", "hu", "bg",
  "el", "lt", "lv", "et", "nb", "tr", "ru", "uk", "ar", "zh", "ja", "ko", "id", "vi", "th", "he",
];

/** "St. Kitts & Nevis" → "st kitts and nevis": no accents, punctuation or leading "the". */
const nameKey = (s: string) =>
  fold(s).replace(/&/g, " and ").replace(/[.,'’()\-]/g, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");

let namesByKey: Map<string, string> | null = null;
/** Every country's standard name in NAME_LOCALES (from the runtime's Unicode data), by nameKey. */
function countryNames(): Map<string, string> {
  if (namesByKey) return namesByKey;
  namesByKey = new Map();
  for (const locale of NAME_LOCALES) {
    let names: Intl.DisplayNames;
    try {
      names = new Intl.DisplayNames([locale], { type: "region", fallback: "none" });
    } catch {
      continue;
    }
    for (const code of ISO_COUNTRIES) {
      const name = names.of(code);
      if (!name) continue;
      // "Myanmar (Burma)", "Hong Kong SAR China": the full name and the part before the qualifier.
      for (const variant of [name, name.replace(/\s*\(.*\)$/, ""), name.replace(/ SAR China$/, "")]) {
        const key = nameKey(variant);
        if (key && !namesByKey.has(key)) namesByKey.set(key, code);
      }
    }
  }
  return namesByKey;
}

/** ISO code for a country written as a code ("de", "UK") or a name in a common language ("Sweden", "Suedia"). */
export function countryCode(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v)) {
    const code = CODE_ALIASES[v.toUpperCase()] ?? v.toUpperCase();
    return ISO_COUNTRIES.has(code) ? code : null;
  }
  const key = nameKey(v);
  return COUNTRY_ALIASES[fold(v)] ?? COUNTRY_ALIASES[key] ?? countryNames().get(key) ?? null;
}

export function countyFor(party: UblParty): string | null {
  if (party.county && /^RO-[A-Z]{1,2}$/.test(party.county)) return party.county;
  if (!party.city) return null;
  const city = fold(party.city).replace(/^(mun\.?|municipiul|oras\.?|orasul|comuna|com\.?)\s+/, "");
  if (/\bbucuresti\b|\bbucharest\b/.test(city)) return "RO-B";
  return CITY_COUNTY[city] ?? null;
}

/** Bucharest addresses must use SECTOR1…SECTOR6 as the city (BR-RO-100). */
function bucharestSector(party: UblParty): string | null {
  const m = `${party.city ?? ""} ${party.street ?? ""}`.match(/sector(?:ul)?\s*([1-6])/i);
  return m ? `SECTOR${m[1]}` : null;
}

function isVatRegistered(taxId: string | null): boolean {
  return !!taxId && /^[A-Z]{2}[0-9A-Z]+$/.test(taxId.replace(/\s/g, "").toUpperCase());
}

/** Romanian CUI/CIF control digit (key 753217532), which ANAF checks on upload. */
export function validCui(taxId: string): boolean {
  const digits = bareCui(taxId);
  if (!/^\d{2,10}$/.test(digits)) return false;
  const body = digits.slice(0, -1).split("").map(Number);
  const key = [7, 5, 3, 2, 1, 7, 5, 3, 2].slice(9 - body.length);
  const sum = body.reduce((acc, d, i) => acc + d * key[i], 0);
  const control = ((sum * 10) % 11) % 10;
  return control === Number(digits.slice(-1));
}

function bareCui(taxId: string): string {
  return taxId.replace(/\s/g, "").toUpperCase().replace(/^RO/, "");
}

function partyXml(tag: string, p: UblParty, country: string, county: string | null, withVat: boolean): string {
  const taxId = (p.taxId ?? "").replace(/\s/g, "").toUpperCase();
  const city = country === "RO" && county === "RO-B" ? bucharestSector(p) ?? p.city : p.city;
  const legalId = bareCui(taxId);
  return `
  <cac:${tag}>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(p.street ?? "")}</cbc:StreetName>
        <cbc:CityName>${esc(city ?? "")}</cbc:CityName>${
    p.postalCode
      ? `
        <cbc:PostalZone>${esc(p.postalCode)}</cbc:PostalZone>`
      : ""
  }${
    county
      ? `
        <cbc:CountrySubentity>${county}</cbc:CountrySubentity>`
      : ""
  }
        <cac:Country>
          <cbc:IdentificationCode>${country}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>${
    withVat
      ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(taxId)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`
      : ""
  }
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(p.name ?? "")}</cbc:RegistrationName>${
    legalId
      ? `
        <cbc:CompanyID>${esc(legalId)}</cbc:CompanyID>`
      : ""
  }
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:${tag}>`;
}

export function buildUblInvoice(input: UblInvoiceInput): UblResult {
  const problems: string[] = [];
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency === "USDT" || currency === "USDC" || currency === "USDG") {
    problems.push(`Currency ${currency} cannot be used on an e-Factura invoice; issue it in RON, EUR or USD.`);
  }

  // RO e-Factura is for sellers in Romania: no country means Romania, an unrecognised one is reported.
  const sellerCountry = input.seller.country?.trim() ? countryCode(input.seller.country) : "RO";
  if (!sellerCountry) problems.push(`Seller country "${input.seller.country}" is not recognised.`);
  const buyerCountry = countryCode(input.buyer.country);
  const sellerCounty = sellerCountry === "RO" ? countyFor(input.seller) : null;
  const buyerCounty = buyerCountry === "RO" ? countyFor(input.buyer) : null;

  if (!input.seller.name) problems.push("Seller name is missing.");
  if (!input.seller.taxId) problems.push("Seller CUI / VAT id is missing.");
  else if (sellerCountry === "RO" && !validCui(input.seller.taxId)) {
    problems.push("Seller CUI fails the control-digit check.");
  }
  if (!input.seller.street) problems.push("Seller street address is missing.");
  if (!input.seller.city) problems.push("Seller city is missing.");
  if (sellerCountry === "RO" && !sellerCounty) {
    problems.push("Seller county could not be derived from the city; add the county (e.g. RO-CJ).");
  }
  if (sellerCounty === "RO-B" && !bucharestSector(input.seller)) {
    problems.push('Bucharest seller address must include the sector (e.g. "Sector 3").');
  }
  if (!input.buyer.name) problems.push("Client name is missing.");
  if (!buyerCountry) problems.push("Client country is missing or not recognised (use a 2-letter code).");
  else if (buyerCountry !== "RO") {
    problems.push(
      "RO e-Factura is for clients in Romania; invoices to clients abroad are not sent through it (send the PDF instead).",
    );
  }
  if (!input.buyer.street) problems.push("Client street address is missing.");
  if (!input.buyer.city) problems.push("Client city is missing.");
  if (buyerCountry === "RO" && !buyerCounty) {
    problems.push("Client county could not be derived from the city; add the county.");
  }
  if (buyerCounty === "RO-B" && !bucharestSector(input.buyer)) {
    problems.push("Bucharest client address must include the sector.");
  }
  if (buyerCountry === "RO" && input.buyer.taxId && !validCui(input.buyer.taxId)) {
    problems.push("Client CUI fails the control-digit check.");
  }
  if (input.lines.length === 0) problems.push("The invoice has no lines.");
  if (currency !== "RON" && !(input.ronRate && input.ronRate > 0)) {
    problems.push("BNR exchange rate for the issue date is unavailable.");
  }

  const sellerVat = isVatRegistered(input.seller.taxId);
  const buyerVat = isVatRegistered(input.buyer.taxId);
  let category: "S" | "O" | null = null;
  if (input.taxRate > 0) {
    if (sellerVat) category = "S";
    else problems.push("VAT is charged but the seller tax ID has no country prefix (e.g. RO12345678).");
  } else if (!sellerVat) {
    category = "O";
  } else {
    problems.push(
      "0% VAT from a VAT-registered seller (exemption or reverse charge) is not supported yet; issue this e-Factura manually.",
    );
  }

  if (problems.length > 0 || !category) return { xml: null, vatCategory: category, problems };

  const lines = input.lines.map((l, i) => ({ ...l, id: i + 1, net: round2(l.quantity * l.unitPrice) }));
  const net = round2(lines.reduce((s, l) => s + l.net, 0));
  const rate = category === "S" ? input.taxRate : 0;
  const vat = round2((net * rate) / 100);
  const gross = round2(net + vat);

  const taxCategory = (indent: string) =>
    category === "S"
      ? `${indent}<cbc:ID>S</cbc:ID>\n${indent}<cbc:Percent>${rate}</cbc:Percent>`
      : `${indent}<cbc:ID>O</cbc:ID>\n${indent}<cbc:TaxExemptionReasonCode>VATEX-EU-O</cbc:TaxExemptionReasonCode>`;
  const lineCategory = (indent: string) =>
    category === "O"
      ? `${indent}<cbc:ID>O</cbc:ID>`
      : `${indent}<cbc:ID>${category}</cbc:ID>\n${indent}<cbc:Percent>${rate}</cbc:Percent>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${CIUS_RO}</cbc:CustomizationID>
  <cbc:ID>${esc(input.number)}</cbc:ID>
  <cbc:IssueDate>${input.issueDate}</cbc:IssueDate>${
    input.dueDate
      ? `
  <cbc:DueDate>${input.dueDate}</cbc:DueDate>`
      : ""
  }
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>${
    input.note
      ? `
  <cbc:Note>${esc(input.note.slice(0, 300))}</cbc:Note>`
      : ""
  }
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>${
    currency !== "RON"
      ? `
  <cbc:TaxCurrencyCode>RON</cbc:TaxCurrencyCode>`
      : ""
  }${partyXml("AccountingSupplierParty", input.seller, sellerCountry!, sellerCounty, sellerVat)}${
    partyXml("AccountingCustomerParty", input.buyer, buyerCountry!, buyerCounty, category === "S" && buyerVat)
  }${
    input.iban
      ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>${
        input.paymentReference
          ? `
    <cbc:PaymentID>${esc(input.paymentReference.replace(/\s/g, ""))}</cbc:PaymentID>`
          : ""
      }
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(input.iban.replace(/\s/g, ""))}</cbc:ID>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`
      : ""
  }${
    input.dueDate ? "" : `
  <cac:PaymentTerms>
    <cbc:Note>Plata la primire / Payable on receipt</cbc:Note>
  </cac:PaymentTerms>`
  }
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${money(vat)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${money(net)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${money(vat)}</cbc:TaxAmount>
      <cac:TaxCategory>
${taxCategory("        ")}
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>${
    currency !== "RON"
      ? `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="RON">${money(vat * (input.ronRate ?? 0))}</cbc:TaxAmount>
  </cac:TaxTotal>`
      : ""
  }
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${money(net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${money(net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${money(gross)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${money(gross)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${
    lines
      .map(
        (l) => `
  <cac:InvoiceLine>
    <cbc:ID>${l.id}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="H87">${l.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${money(l.net)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(l.description.slice(0, 100) || "Servicii")}</cbc:Name>
      <cac:ClassifiedTaxCategory>
${lineCategory("        ")}
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${money(l.unitPrice)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`,
      )
      .join("")
  }
</Invoice>
`;

  return { xml, vatCategory: category, problems: [] };
}
