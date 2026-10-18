// src/canonical.ts
function canonicalJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const out = {};
      for (const key of Object.keys(v).sort()) {
        const item = v[key];
        if (item !== void 0) out[key] = sort(item);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// src/jws.ts
function base64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64urlDecode(input) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function loadSigningKey(jwkJson) {
  if (!jwkJson) return null;
  const jwk = JSON.parse(jwkJson);
  if (!jwk.kid || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d) {
    throw new Error("signing key must be a P-256 private JWK with a kid");
  }
  const privateKey = await crypto.subtle.importKey("jwk", jwk, {
    name: "ECDSA",
    namedCurve: "P-256"
  }, false, [
    "sign"
  ]);
  const { kty, crv, x, y, kid } = jwk;
  return {
    kid,
    privateKey,
    publicJwk: {
      kty,
      crv,
      x,
      y,
      kid,
      alg: "ES256",
      use: "sig"
    }
  };
}
async function generateSigningKey(kid) {
  const pair = await crypto.subtle.generateKey({
    name: "ECDSA",
    namedCurve: "P-256"
  }, true, [
    "sign",
    "verify"
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return {
    privateJwk: {
      ...jwk,
      kid
    }
  };
}
function signCanonical(payload, key) {
  return signCompact(payload, key, {
    kid: key.kid,
    typ: "JWT"
  });
}
async function signCompact(payload, key, header) {
  const protectedHeader = base64url(new TextEncoder().encode(JSON.stringify({
    alg: "ES256",
    ...header
  })));
  const body = base64url(new TextEncoder().encode(canonicalJson(payload)));
  const signature = await crypto.subtle.sign({
    name: "ECDSA",
    hash: "SHA-256"
  }, key.privateKey, new TextEncoder().encode(`${protectedHeader}.${body}`));
  return `${protectedHeader}.${body}.${base64url(new Uint8Array(signature))}`;
}
function jwsHeader(jws) {
  const [header] = jws.split(".");
  try {
    return JSON.parse(new TextDecoder().decode(base64urlDecode(header)));
  } catch {
    return null;
  }
}
async function verifyJws(jws, publicJwk) {
  const [header, body, signature, extra] = jws.trim().split(".");
  if (!header || !body || !signature || extra !== void 0) return null;
  if (jwsHeader(jws)?.alg !== "ES256") return null;
  const key = await crypto.subtle.importKey("jwk", {
    kty: publicJwk.kty,
    crv: publicJwk.crv,
    x: publicJwk.x,
    y: publicJwk.y
  }, {
    name: "ECDSA",
    namedCurve: "P-256"
  }, false, [
    "verify"
  ]);
  const ok = await crypto.subtle.verify({
    name: "ECDSA",
    hash: "SHA-256"
  }, key, base64urlDecode(signature), new TextEncoder().encode(`${header}.${body}`));
  return ok ? JSON.parse(new TextDecoder().decode(base64urlDecode(body))) : null;
}
function verifyWithJwks(jws, jwks) {
  const kid = jwsHeader(jws)?.kid;
  const key = jwks.keys.find((k) => k.kid === kid);
  return key ? verifyJws(jws, key) : Promise.resolve(null);
}

// src/passport.ts
var PASSPORT_SPEC = "invoice-passport/0.1";
var CIUS_RO_FORMAT = "UBL-2.1/CIUS-RO-1.0.1";
var LEGACY_SPECS = [
  "billify.invoice-passport/0.1"
];
var drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== void 0));
function buildPassport(input) {
  return {
    spec: PASSPORT_SPEC,
    passport_id: input.passport_id,
    verify_url: input.verify_url,
    invoice: {
      ...drop({
        ...input.invoice,
        lines: void 0
      }),
      notes: input.invoice.notes ?? null,
      lines: input.invoice.lines.map((l) => drop({
        ...l
      }))
    },
    seller: drop({
      ...input.seller,
      contact: void 0,
      iban: input.seller.iban ?? null
    }),
    buyer: drop({
      ...input.buyer,
      iban: void 0,
      contact: input.buyer.contact ?? null
    }),
    payment: {
      ...drop({
        ...input.payment,
        evidence: void 0
      }),
      evidence: input.payment.evidence.map((e) => drop({
        ...e
      }))
    },
    history: input.history.map((e) => drop({
      ...e
    })),
    fiscal: {
      e_invoice: input.e_invoice ? drop({
        ...input.e_invoice
      }) : null
    }
  };
}
async function eInvoiceReference(xml, format, submissionId = null) {
  return {
    format,
    sha256: await sha256Hex(xml),
    submission_id: submissionId
  };
}
function signPassport(input, key) {
  return signCanonical(buildPassport(input), key);
}
async function verifyPassport(jws, jwks) {
  const payload = await verifyWithJwks(jws, jwks);
  if (!payload) return {
    ok: false,
    reason: "bad_signature"
  };
  const spec = String(payload.spec ?? "");
  if (spec !== PASSPORT_SPEC && !LEGACY_SPECS.includes(spec)) return {
    ok: false,
    reason: "unknown_spec"
  };
  return {
    ok: true,
    passport: payload,
    kid: String(jwsHeader(jws)?.kid)
  };
}
function passportDigest(passport) {
  return sha256Hex(canonicalJson(passport));
}

// src/ubl.ts
var CIUS_RO = "urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1";
var CITY_COUNTY = {
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
  otopeni: "RO-IF"
};
var fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var money = (n) => (Math.round(n * 100) / 100).toFixed(2);
var round2 = (n) => Math.round(n * 100) / 100;
var COUNTRY_ALIASES = {
  romania: "RO",
  "rom\xE2nia": "RO",
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
  moldova: "MD"
};
function countryCode(value) {
  if (!value) return null;
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRY_ALIASES[fold(v)] ?? null;
}
function countyFor(party2) {
  if (party2.county && /^RO-[A-Z]{1,2}$/.test(party2.county)) return party2.county;
  if (!party2.city) return null;
  const city = fold(party2.city).replace(/^(mun\.?|municipiul|oras\.?|orasul|comuna|com\.?)\s+/, "");
  if (/\bbucuresti\b|\bbucharest\b/.test(city)) return "RO-B";
  return CITY_COUNTY[city] ?? null;
}
function bucharestSector(party2) {
  const m = `${party2.city ?? ""} ${party2.street ?? ""}`.match(/sector(?:ul)?\s*([1-6])/i);
  return m ? `SECTOR${m[1]}` : null;
}
function isVatRegistered(taxId) {
  return !!taxId && /^[A-Z]{2}[0-9A-Z]+$/.test(taxId.replace(/\s/g, "").toUpperCase());
}
function validCui(taxId) {
  const digits = bareCui(taxId);
  if (!/^\d{2,10}$/.test(digits)) return false;
  const body = digits.slice(0, -1).split("").map(Number);
  const key = [
    7,
    5,
    3,
    2,
    1,
    7,
    5,
    3,
    2
  ].slice(9 - body.length);
  const sum = body.reduce((acc, d, i) => acc + d * key[i], 0);
  const control = sum * 10 % 11 % 10;
  return control === Number(digits.slice(-1));
}
function bareCui(taxId) {
  return taxId.replace(/\s/g, "").toUpperCase().replace(/^RO/, "");
}
function partyXml(tag, p, country, county, withVat) {
  const taxId = (p.taxId ?? "").replace(/\s/g, "").toUpperCase();
  const city = country === "RO" && county === "RO-B" ? bucharestSector(p) ?? p.city : p.city;
  const legalId = bareCui(taxId);
  return `
  <cac:${tag}>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(p.street ?? "")}</cbc:StreetName>
        <cbc:CityName>${esc(city ?? "")}</cbc:CityName>${p.postalCode ? `
        <cbc:PostalZone>${esc(p.postalCode)}</cbc:PostalZone>` : ""}${county ? `
        <cbc:CountrySubentity>${county}</cbc:CountrySubentity>` : ""}
        <cac:Country>
          <cbc:IdentificationCode>${country}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>${withVat ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(taxId)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>` : ""}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(p.name ?? "")}</cbc:RegistrationName>${legalId ? `
        <cbc:CompanyID>${esc(legalId)}</cbc:CompanyID>` : ""}
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:${tag}>`;
}
function buildUblInvoice(input) {
  const problems = [];
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency === "USDT" || currency === "USDC" || currency === "USDG") {
    problems.push(`Currency ${currency} cannot be used on an e-Factura invoice; issue it in RON, EUR or USD.`);
  }
  const sellerCountry = countryCode(input.seller.country) ?? "RO";
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
    problems.push("RO e-Factura is for clients in Romania; invoices to clients abroad are not sent through it (send the PDF instead).");
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
  let category = null;
  if (input.taxRate > 0) {
    if (sellerVat) category = "S";
    else problems.push("VAT is charged but the seller tax ID has no country prefix (e.g. RO12345678).");
  } else if (!sellerVat) {
    category = "O";
  } else {
    problems.push("0% VAT from a VAT-registered seller (exemption or reverse charge) is not supported yet; issue this e-Factura manually.");
  }
  if (problems.length > 0 || !category) return {
    xml: null,
    vatCategory: category,
    problems
  };
  const lines = input.lines.map((l, i) => ({
    ...l,
    id: i + 1,
    net: round2(l.quantity * l.unitPrice)
  }));
  const net = round2(lines.reduce((s, l) => s + l.net, 0));
  const rate = category === "S" ? input.taxRate : 0;
  const vat = round2(net * rate / 100);
  const gross = round2(net + vat);
  const taxCategory = (indent) => category === "S" ? `${indent}<cbc:ID>S</cbc:ID>
${indent}<cbc:Percent>${rate}</cbc:Percent>` : `${indent}<cbc:ID>O</cbc:ID>
${indent}<cbc:TaxExemptionReasonCode>VATEX-EU-O</cbc:TaxExemptionReasonCode>`;
  const lineCategory = (indent) => category === "O" ? `${indent}<cbc:ID>O</cbc:ID>` : `${indent}<cbc:ID>${category}</cbc:ID>
${indent}<cbc:Percent>${rate}</cbc:Percent>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${CIUS_RO}</cbc:CustomizationID>
  <cbc:ID>${esc(input.number)}</cbc:ID>
  <cbc:IssueDate>${input.issueDate}</cbc:IssueDate>${input.dueDate ? `
  <cbc:DueDate>${input.dueDate}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>${input.note ? `
  <cbc:Note>${esc(input.note.slice(0, 300))}</cbc:Note>` : ""}
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>${currency !== "RON" ? `
  <cbc:TaxCurrencyCode>RON</cbc:TaxCurrencyCode>` : ""}${partyXml("AccountingSupplierParty", input.seller, sellerCountry, sellerCounty, sellerVat)}${partyXml("AccountingCustomerParty", input.buyer, buyerCountry, buyerCounty, category === "S" && buyerVat)}${input.iban ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>${input.paymentReference ? `
    <cbc:PaymentID>${esc(input.paymentReference.replace(/\s/g, ""))}</cbc:PaymentID>` : ""}
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(input.iban.replace(/\s/g, ""))}</cbc:ID>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>` : ""}${input.dueDate ? "" : `
  <cac:PaymentTerms>
    <cbc:Note>Plata la primire / Payable on receipt</cbc:Note>
  </cac:PaymentTerms>`}
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
  </cac:TaxTotal>${currency !== "RON" ? `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="RON">${money(vat * (input.ronRate ?? 0))}</cbc:TaxAmount>
  </cac:TaxTotal>` : ""}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${money(net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${money(net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${money(gross)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${money(gross)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lines.map((l) => `
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
  </cac:InvoiceLine>`).join("")}
</Invoice>
`;
  return {
    xml,
    vatCategory: category,
    problems: []
  };
}

// src/bnr.ts
var BNR_HOST = "https://curs.bnr.ro";
function parseBnrXml(xml) {
  const table = /* @__PURE__ */ new Map();
  const cubeRe = /<Cube\s+date="(\d{4}-\d{2}-\d{2})"\s*>([\s\S]*?)<\/Cube>/g;
  const rateRe = /<Rate\s+currency="([A-Z]{3})"(?:\s+multiplier="(\d+)")?\s*>([\d.]+)<\/Rate>/g;
  for (const cube of xml.matchAll(cubeRe)) {
    const rates = /* @__PURE__ */ new Map();
    for (const r of cube[2].matchAll(rateRe)) {
      const multiplier = r[2] ? Number(r[2]) : 1;
      rates.set(r[1], Number(r[3]) / multiplier);
    }
    table.set(cube[1], rates);
  }
  return table;
}
var yearCache = /* @__PURE__ */ new Map();
function fetchYear(year) {
  let cached = yearCache.get(year);
  if (!cached) {
    cached = (async () => {
      const res = await fetch(`${BNR_HOST}/files/xml/years/nbrfxrates${year}.xml`, {
        signal: AbortSignal.timeout(2e4)
      });
      const body = await res.text();
      if (!res.ok || !body.includes("<DataSet")) {
        throw new Error(`BNR rates for ${year} unavailable (HTTP ${res.status})`);
      }
      return parseBnrXml(body);
    })();
    cached.catch(() => yearCache.delete(year));
    yearCache.set(year, cached);
  }
  return cached;
}
function bnrBasis(currency) {
  const c = currency.trim().toUpperCase();
  if (c.startsWith("USDT") || c.startsWith("USDC")) return "USD";
  return c;
}
function rateBefore(tables, currency, operationDate) {
  const basis = bnrBasis(currency);
  if (basis === "RON") return {
    rate: 1,
    date: operationDate,
    basis
  };
  let best = null;
  for (const table of tables) {
    for (const [date2, rates] of table) {
      if (date2 >= operationDate) continue;
      const rate = rates.get(basis);
      if (rate === void 0) continue;
      if (!best || date2 > best.date) best = {
        rate,
        date: date2,
        basis
      };
    }
  }
  return best;
}
async function bnrRateBefore(currency, operationDate) {
  if (bnrBasis(currency) === "RON") return rateBefore([], currency, operationDate);
  const year = Number(operationDate.slice(0, 4));
  const tables = await Promise.all([
    fetchYear(year),
    fetchYear(year - 1).catch(() => /* @__PURE__ */ new Map())
  ]);
  return rateBefore(tables, currency, operationDate);
}

// src/sepa.ts
var compact = (s) => s.replace(/\s+/g, "").toUpperCase();
function mod97(alnum2) {
  let rest = 0;
  for (const ch of alnum2) {
    const value = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest;
}
function creditorReference(reference) {
  const ref = compact(reference).replace(/[^0-9A-Z]/g, "");
  if (!/^[0-9A-Z]{1,21}$/.test(ref)) throw new Error("reference must have 1\u201321 letters or digits");
  const check = 98 - mod97(`${ref}RF00`);
  return `RF${String(check).padStart(2, "0")}${ref}`;
}
function isValidCreditorReference(value) {
  const rf = compact(value);
  if (!/^RF\d{2}[0-9A-Z]{1,21}$/.test(rf)) return false;
  return mod97(rf.slice(4) + rf.slice(0, 4)) === 1;
}
function formatCreditorReference(value) {
  return compact(value).replace(/(.{4})(?=.)/g, "$1 ");
}
function findCreditorReference(text) {
  const candidates = text.toUpperCase().match(/RF\s?\d{2}(?:\s?[0-9A-Z]){1,21}/g) ?? [];
  for (const candidate of candidates) {
    const rf = compact(candidate);
    for (let end = rf.length; end >= 5; end--) {
      if (isValidCreditorReference(rf.slice(0, end))) return rf.slice(0, end);
    }
  }
  return null;
}
function isValidIban(value) {
  const iban = compact(value);
  if (!/^[A-Z]{2}\d{2}[0-9A-Z]{11,30}$/.test(iban)) return false;
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
}
function bankTransferEvidence(input) {
  const rf = input.creditorReference ? compact(input.creditorReference) : null;
  if (rf && !isValidCreditorReference(rf)) throw new Error(`invalid creditor reference ${input.creditorReference}`);
  return {
    rail: "bank_transfer",
    scheme: input.scheme,
    amount: input.amount,
    currency: input.currency.toUpperCase(),
    booking_date: input.bookingDate ?? null,
    end_to_end_id: input.endToEndId ?? null,
    creditor_reference: rf,
    debtor_iban_last4: input.debtorIbanLast4 ? compact(input.debtorIbanLast4).slice(-4) : null,
    bank_reference: input.bankReference ?? null,
    recorded_at: input.recordedAt
  };
}

// src/peppol.ts
var PEPPOL_BIS_3 = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
var PEPPOL_BILLING_PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
var DEFAULT_VATEX = {
  AE: "VATEX-EU-AE",
  K: "VATEX-EU-IC",
  G: "VATEX-EU-G",
  O: "VATEX-EU-O"
};
var VAT_EAS = {
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
  CH: "9927"
};
function peppolEndpointForVat(vatId) {
  const v = String(vatId ?? "").replace(/[\s.-]/g, "").toUpperCase();
  const scheme = VAT_EAS[v.slice(0, 2)];
  return scheme && /^[A-Z]{2}[0-9A-Z]{2,}$/.test(v) ? {
    scheme,
    id: v
  } : null;
}
var esc2 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var round22 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
var money2 = (n) => round22(n).toFixed(2);
var el = (indent, tag, value, attrs = "") => value ? `
${indent}<${tag}${attrs}>${esc2(value)}</${tag}>` : "";
function checkParty(role, p, problems) {
  if (!p.name?.trim()) problems.push(`${role} name is missing.`);
  if (!/^\d{4}$/.test(p.endpoint?.scheme ?? "") || !p.endpoint?.id?.trim()) {
    problems.push(`${role} Peppol endpoint (EAS scheme code + id) is missing.`);
  }
  if (!/^[A-Z]{2}$/.test(p.country ?? "")) problems.push(`${role} country must be a 2-letter ISO code.`);
  if (p.vatId && !/^[A-Z]{2}[0-9A-Za-z+*.]{2,}$/.test(p.vatId.replace(/\s/g, ""))) {
    problems.push(`${role} VAT id must start with the country prefix (e.g. DE123456789).`);
  }
}
function partyXml2(tag, p) {
  const i = "      ";
  const vatId = p.vatId?.replace(/\s/g, "");
  return `
  <cac:${tag}>
    <cac:Party>
      <cbc:EndpointID schemeID="${esc2(p.endpoint.scheme)}">${esc2(p.endpoint.id)}</cbc:EndpointID>
      <cac:PartyName>
        <cbc:Name>${esc2(p.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>${el(i + "  ", "cbc:StreetName", p.street)}${el(i + "  ", "cbc:AdditionalStreetName", p.additionalStreet)}${el(i + "  ", "cbc:CityName", p.city)}${el(i + "  ", "cbc:PostalZone", p.postalCode)}${el(i + "  ", "cbc:CountrySubentity", p.subdivision)}
        <cac:Country>
          <cbc:IdentificationCode>${p.country}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>${vatId ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc2(vatId)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>` : ""}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc2(p.name)}</cbc:RegistrationName>${p.legalId?.id ? `
        <cbc:CompanyID${p.legalId.scheme ? ` schemeID="${esc2(p.legalId.scheme)}"` : ""}>${esc2(p.legalId.id)}</cbc:CompanyID>` : ""}
      </cac:PartyLegalEntity>${p.contact && (p.contact.name || p.contact.phone || p.contact.email) ? `
      <cac:Contact>${el(i + "  ", "cbc:Name", p.contact.name)}${el(i + "  ", "cbc:Telephone", p.contact.phone)}${el(i + "  ", "cbc:ElectronicMail", p.contact.email)}
      </cac:Contact>` : ""}
    </cac:Party>
  </cac:${tag}>`;
}
function buildPeppolInvoice(input) {
  const problems = [];
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency === "USDT" || currency === "USDC" || currency === "USDG") {
    problems.push(`Currency ${currency} is not an ISO 4217 code; stablecoin invoices must be issued in EUR, USD, \u2026`);
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
  for (const c of [
    "S",
    "Z",
    "E",
    "AE",
    "K",
    "G"
  ]) {
    if (categories.has(c) && !sellerVat) problems.push(`Category ${c} needs the seller VAT id.`);
  }
  if ((categories.has("AE") || categories.has("K")) && !buyerVat) {
    problems.push("Reverse charge (AE) and intra-community supply (K) need the buyer VAT id.");
  }
  if (categories.has("K") && !(input.delivery?.date && input.delivery?.country)) {
    problems.push("Intra-community supply (K) needs the delivery date and delivery country.");
  }
  const reasons = (c) => ({
    code: DEFAULT_VATEX[c],
    ...input.exemptionReasons?.[c]
  });
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
  const from = input.seller.country, to = input.buyer.country;
  const hasAddress = (p2) => !!(p2.street && p2.city && p2.postalCode);
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
  if (input.taxCurrency && !(input.taxCurrency.rate > 0 && /^[A-Z]{3}$/.test(input.taxCurrency.code))) {
    problems.push("Tax currency needs a 3-letter code and a positive exchange rate.");
  }
  if (problems.length > 0) return {
    xml: null,
    problems
  };
  const lines = input.lines.map((l, idx) => ({
    ...l,
    id: idx + 1,
    net: round22(l.quantity * l.unitPrice)
  }));
  const groups = /* @__PURE__ */ new Map();
  for (const l of lines) {
    const key = `${l.vatCategory}:${l.vatRate}`;
    const g = groups.get(key) ?? {
      category: l.vatCategory,
      rate: l.vatRate,
      taxable: 0
    };
    g.taxable = round22(g.taxable + l.net);
    groups.set(key, g);
  }
  const subtotals = [
    ...groups.values()
  ].map((g) => ({
    ...g,
    tax: round22(g.taxable * g.rate / 100)
  }));
  const net = round22(lines.reduce((s, l) => s + l.net, 0));
  const vat = round22(subtotals.reduce((s, g) => s + g.tax, 0));
  const gross = round22(net + vat);
  const taxCategoryXml = (indent, c, rate, withReason) => {
    const r = reasons(c);
    return `${indent}<cbc:ID>${c}</cbc:ID>${c === "O" ? "" : `
${indent}<cbc:Percent>${rate}</cbc:Percent>`}${withReason && c !== "S" && c !== "Z" ? `${el(indent, "cbc:TaxExemptionReasonCode", r.code)}${el(indent, "cbc:TaxExemptionReason", r.text)}` : ""}
${indent}<cac:TaxScheme>
${indent}  <cbc:ID>VAT</cbc:ID>
${indent}</cac:TaxScheme>`;
  };
  const p = input.payment;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${PEPPOL_BIS_3}</cbc:CustomizationID>
  <cbc:ProfileID>${PEPPOL_BILLING_PROCESS}</cbc:ProfileID>
  <cbc:ID>${esc2(input.number)}</cbc:ID>
  <cbc:IssueDate>${input.issueDate}</cbc:IssueDate>${el("  ", "cbc:DueDate", input.dueDate)}
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>${el("  ", "cbc:Note", input.note)}
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>${el("  ", "cbc:TaxCurrencyCode", input.taxCurrency?.code)}${el("  ", "cbc:BuyerReference", input.buyerReference)}${input.orderReference ? `
  <cac:OrderReference>
    <cbc:ID>${esc2(input.orderReference)}</cbc:ID>
  </cac:OrderReference>` : ""}${partyXml2("AccountingSupplierParty", input.seller)}${partyXml2("AccountingCustomerParty", input.buyer)}${input.delivery && (input.delivery.date || input.delivery.country) ? `
  <cac:Delivery>${el("    ", "cbc:ActualDeliveryDate", input.delivery.date)}${input.delivery.country ? `
    <cac:DeliveryLocation>
      <cac:Address>
        <cac:Country>
          <cbc:IdentificationCode>${esc2(input.delivery.country)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:Address>
    </cac:DeliveryLocation>` : ""}
  </cac:Delivery>` : ""}${p ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode name="SEPA credit transfer">58</cbc:PaymentMeansCode>${el("    ", "cbc:PaymentID", p.reference?.replace(/\s/g, ""))}
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc2(p.iban.replace(/\s/g, "").toUpperCase())}</cbc:ID>${el("      ", "cbc:Name", p.accountName)}${p.bic ? `
      <cac:FinancialInstitutionBranch>
        <cbc:ID>${esc2(p.bic)}</cbc:ID>
      </cac:FinancialInstitutionBranch>` : ""}
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>` : ""}${input.paymentTerms ? `
  <cac:PaymentTerms>
    <cbc:Note>${esc2(input.paymentTerms)}</cbc:Note>
  </cac:PaymentTerms>` : ""}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${money2(vat)}</cbc:TaxAmount>${subtotals.map((g) => `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${money2(g.taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${money2(g.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
${taxCategoryXml("        ", g.category, g.rate, true)}
      </cac:TaxCategory>
    </cac:TaxSubtotal>`).join("")}
  </cac:TaxTotal>${input.taxCurrency ? `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${input.taxCurrency.code}">${money2(vat * input.taxCurrency.rate)}</cbc:TaxAmount>
  </cac:TaxTotal>` : ""}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${money2(net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${money2(net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${money2(gross)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${money2(gross)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lines.map((l) => `
  <cac:InvoiceLine>
    <cbc:ID>${l.id}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${esc2(l.unitCode ?? "C62")}">${l.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${money2(l.net)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc2(l.description.slice(0, 100))}</cbc:Name>
      <cac:ClassifiedTaxCategory>
${taxCategoryXml("        ", l.vatCategory, l.vatRate, false)}
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${l.unitPrice}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`).join("")}
</Invoice>
`;
  return {
    xml,
    problems: []
  };
}

// src/xml.ts
var ENTITIES = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'"
};
function decode(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 1114111 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref] ?? whole;
  });
}
var localName = (qname) => qname.slice(qname.indexOf(":") + 1);
function parseXml(xml) {
  const root = {
    name: "#document",
    attrs: {},
    children: [],
    text: ""
  };
  const stack = [
    root
  ];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      stack[stack.length - 1].text += decode(xml.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decode(xml.slice(i, lt));
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end === -1) throw new Error("XML: unterminated comment");
      i = end + 3;
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end === -1) throw new Error("XML: unterminated CDATA");
      stack[stack.length - 1].text += xml.slice(lt + 9, end);
      i = end + 3;
    } else if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      if (end === -1) throw new Error("XML: unterminated processing instruction");
      i = end + 2;
    } else if (xml.startsWith("<!", lt)) {
      throw new Error("XML: DOCTYPE and other declarations are not accepted");
    } else if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt);
      if (end === -1) throw new Error("XML: unterminated end tag");
      const name = localName(xml.slice(lt + 2, end).trim());
      const open = stack.pop();
      if (!open || open === root || open.name !== name) throw new Error(`XML: unexpected </${name}>`);
      i = end + 1;
    } else {
      let j = lt + 1;
      let quote = "";
      for (; j < n; j++) {
        const c = xml[j];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      if (j >= n) throw new Error("XML: unterminated start tag");
      const selfClosing = xml[j - 1] === "/";
      const body = xml.slice(lt + 1, selfClosing ? j - 1 : j);
      const nameMatch = body.match(/^\s*([^\s/>]+)/);
      if (!nameMatch) throw new Error("XML: tag without a name");
      const node = {
        name: localName(nameMatch[1]),
        attrs: {},
        children: [],
        text: ""
      };
      for (const a of body.slice(nameMatch[0].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
        if (a[1].startsWith("xmlns")) continue;
        node.attrs[localName(a[1])] = decode(a[3] ?? a[4] ?? "");
      }
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new Error(`XML: <${stack[stack.length - 1].name}> is not closed`);
  return root;
}
function child(node, ...path) {
  let cur = node;
  for (const name of path) {
    cur = cur?.children.find((c) => c.name === name);
    if (!cur) return void 0;
  }
  return cur;
}
function children(node, name) {
  return node ? node.children.filter((c) => c.name === name) : [];
}
function textAt(node, ...path) {
  const t = child(node, ...path)?.text.trim();
  return t ? t : null;
}

// src/camt.ts
var ROOTS = {
  BkToCstmrStmt: {
    kind: "camt.053",
    item: "Stmt"
  },
  BkToCstmrDbtCdtNtfctn: {
    kind: "camt.054",
    item: "Ntfctn"
  },
  BkToCstmrAcctRpt: {
    kind: "camt.052",
    item: "Rpt"
  }
};
var date = (n) => {
  const v = textAt(n, "Dt") ?? textAt(n, "DtTm");
  return v ? v.slice(0, 10) : null;
};
var amountOf = (n) => {
  if (!n) return null;
  const amount = Number(n.text.trim());
  const currency = n.attrs.Ccy;
  return Number.isFinite(amount) && currency ? {
    amount,
    currency: currency.toUpperCase()
  } : null;
};
var partyName = (party2) => textAt(party2, "Nm") ?? textAt(party2, "Pty", "Nm");
var nullIfNotProvided = (v) => v && v.toUpperCase() !== "NOTPROVIDED" ? v : null;
function parseCamt(xml) {
  const doc = parseXml(xml);
  const document = child(doc, "Document");
  const rootNode = document?.children.find((c) => c.name in ROOTS);
  if (!rootNode) throw new Error("not an ISO 20022 camt.052, camt.053 or camt.054 document");
  const { kind, item } = ROOTS[rootNode.name];
  const transactions = [];
  for (const [si, stmt] of children(rootNode, item).entries()) {
    const statementId = textAt(stmt, "Id") ?? `S${si + 1}`;
    const accountIban = textAt(stmt, "Acct", "Id", "IBAN");
    for (const [ei, entry] of children(stmt, "Ntry").entries()) {
      const entryAmount = amountOf(child(entry, "Amt"));
      if (!entryAmount) continue;
      const credit = textAt(entry, "CdtDbtInd") === "CRDT";
      const statusNode = child(entry, "Sts");
      const status = textAt(statusNode, "Cd") ?? (statusNode?.text.trim() || null);
      const reversal = textAt(entry, "RvslInd") === "true";
      const bookingDate = date(child(entry, "BookgDt"));
      const valueDate = date(child(entry, "ValDt"));
      const entryRef = textAt(entry, "AcctSvcrRef");
      const details = children(entry, "NtryDtls").flatMap((d) => children(d, "TxDtls"));
      const list = details.length > 0 ? details : [
        void 0
      ];
      for (const [ti, tx] of list.entries()) {
        const txAmount = list.length > 1 ? amountOf(child(tx, "Amt")) ?? amountOf(child(tx, "AmtDtls", "TxAmt", "Amt")) : null;
        const amount = txAmount ?? entryAmount;
        const rmt = child(tx, "RmtInf");
        const structured = children(rmt, "Strd").map((s) => textAt(s, "CdtrRefInf", "Ref")).find((r) => !!r) ?? null;
        const ustrd = children(rmt, "Ustrd").map((u) => u.text.trim()).filter(Boolean).join(" ");
        const parties = child(tx, "RltdPties");
        const counterparty = credit ? "Dbtr" : "Cdtr";
        transactions.push({
          key: `${statementId}/${ei + 1}/${ti + 1}`,
          statementId,
          accountIban,
          amount: amount.amount,
          currency: amount.currency,
          credit,
          status,
          reversal,
          bookingDate,
          valueDate,
          bankReference: textAt(tx, "Refs", "AcctSvcrRef") ?? entryRef,
          endToEndId: nullIfNotProvided(textAt(tx, "Refs", "EndToEndId")),
          creditorReference: structured,
          remittance: ustrd || null,
          counterpartyName: partyName(child(parties, counterparty)),
          counterpartyIban: textAt(parties, `${counterparty}Acct`, "Id", "IBAN")
        });
      }
    }
  }
  return {
    kind,
    messageId: textAt(rootNode, "GrpHdr", "MsgId"),
    createdAt: textAt(rootNode, "GrpHdr", "CreDtTm"),
    transactions
  };
}

// src/reconcile.ts
var alnum = (s) => s.toUpperCase().replace(/[^0-9A-Z]/g, "");
var cents = (n) => Math.round(n * 100);
function isIncomingBooked(t) {
  return t.credit && !t.reversal && (t.status === null || t.status === "BOOK");
}
function transactionReference(t) {
  const structured = t.creditorReference ? alnum(t.creditorReference) : null;
  if (structured && isValidCreditorReference(structured)) return structured;
  return findCreditorReference(`${t.creditorReference ?? ""} ${t.remittance ?? ""}`);
}
function mentionsNumber(t, number) {
  const chars = alnum(number).split("");
  if (chars.length < 2) return false;
  const pattern = new RegExp(`(?<![0-9A-Z])${chars.join("[^0-9A-Z]?")}(?![0-9A-Z])`);
  return pattern.test(`${t.remittance ?? ""} ${t.creditorReference ?? ""} ${t.endToEndId ?? ""}`.toUpperCase());
}
function reconcile(transactions, invoices) {
  const result = {
    matches: [],
    ambiguous: [],
    unmatched: [],
    ignored: []
  };
  const usedInvoices = /* @__PURE__ */ new Set();
  const pending = [];
  for (const t of transactions) (isIncomingBooked(t) ? pending : result.ignored).push(t);
  const take = (t, method, candidates) => {
    const free = candidates.filter((i) => !usedInvoices.has(i.id));
    if (free.length === 0) return false;
    if (free.length > 1) {
      result.ambiguous.push({
        transaction: t,
        candidates: free
      });
      return true;
    }
    const invoice = free[0];
    usedInvoices.add(invoice.id);
    const coverage = cents(t.amount) >= cents(invoice.amount) ? "full" : "partial";
    result.matches.push({
      invoice,
      transaction: t,
      method,
      coverage,
      autoApply: method !== "amount_only" && coverage === "full"
    });
    return true;
  };
  const passes = [
    [
      "reference",
      (t, i) => {
        const ref = transactionReference(t);
        return !!ref && !!i.reference && alnum(i.reference) === ref;
      }
    ],
    [
      "number_and_amount",
      (t, i) => mentionsNumber(t, i.number) && cents(t.amount) === cents(i.amount)
    ],
    [
      "amount_only",
      (t, i) => cents(t.amount) === cents(i.amount)
    ]
  ];
  let queue = pending;
  for (const [method, fits] of passes) {
    const next = [];
    for (const t of queue) {
      const candidates = invoices.filter((i) => i.currency.toUpperCase() === t.currency && fits(t, i));
      if (!take(t, method, candidates)) next.push(t);
    }
    queue = next;
  }
  result.unmatched = queue;
  return result;
}
function evidenceForMatch(match, recordedAt) {
  const t = match.transaction;
  return {
    ...bankTransferEvidence({
      scheme: t.currency === "EUR" ? "SEPA" : "bank_transfer",
      amount: t.amount,
      currency: t.currency,
      recordedAt,
      bookingDate: t.bookingDate,
      endToEndId: t.endToEndId,
      creditorReference: transactionReference(t),
      debtorIbanLast4: t.counterpartyIban,
      bankReference: t.bankReference
    }),
    match_method: match.method
  };
}

// src/onchain.ts
var STABLECOINS = [
  {
    chain: "base",
    asset: "USDC",
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    decimals: 6
  },
  {
    chain: "base",
    asset: "USDT",
    address: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
    decimals: 6
  },
  {
    chain: "ethereum",
    asset: "USDC",
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    decimals: 6
  },
  {
    chain: "ethereum",
    asset: "USDT",
    address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    decimals: 6
  },
  {
    chain: "bsc",
    asset: "USDT",
    address: "0x55d398326f99059ff775485246999027b3197955",
    decimals: 18
  },
  {
    chain: "bsc",
    asset: "USDC",
    address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    decimals: 18
  },
  // Robinhood Chain (chain id 4663): Paxos Global Dollar, verified on-chain 2026-10-18.
  {
    chain: "robinhood",
    asset: "USDG",
    address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    decimals: 6
  }
];
var CHAIN_NAMES = {
  base: "Base",
  ethereum: "Ethereum",
  bsc: "BNB Chain",
  robinhood: "Robinhood Chain"
};
var TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
var USD_CURRENCIES = [
  "USD",
  "USDC",
  "USDT",
  "USDG"
];
var isEvmAddress = (v) => !!v && /^0x[0-9a-fA-F]{40}$/.test(v.trim());
function parseChain(network) {
  const n = String(network ?? "").toLowerCase();
  if (/robinhood/.test(n)) return "robinhood";
  if (/\bbase\b/.test(n)) return "base";
  if (/bep-?20|\bbsc\b|\bbnb\b/.test(n)) return "bsc";
  if (/erc-?20|\beth(ereum)?\b/.test(n)) return "ethereum";
  return null;
}
var addressTopic = (address) => "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
function fnv1a(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function uniquePayMicros(invoiceId, total) {
  const tag = fnv1a(invoiceId) % 9999 + 1;
  return BigInt(Math.round(total * 100)) * 10000n + BigInt(tag);
}
function formatMicros(micros) {
  const s = micros.toString().padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`;
}
function uniquePayAmount(invoiceId, total) {
  return formatMicros(uniquePayMicros(invoiceId, total));
}
var topicAddress = (topic) => "0x" + topic.slice(-40).toLowerCase();
function decodeTransfer(chain, log) {
  if (log.removed) return null;
  const coin = STABLECOINS.find((c) => c.chain === chain && c.address === log.address.toLowerCase());
  if (!coin || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics.length !== 3) return null;
  const value = BigInt(log.data === "0x" ? 0 : log.data);
  const scale = 10n ** BigInt(coin.decimals - 6);
  return {
    chain,
    asset: coin.asset,
    token: coin.address,
    from: topicAddress(log.topics[1]),
    to: topicAddress(log.topics[2]),
    value,
    micros: value % scale === 0n ? value / scale : null,
    blockNumber: Number(BigInt(log.blockNumber)),
    txHash: log.transactionHash.toLowerCase(),
    logIndex: Number(BigInt(log.logIndex))
  };
}
function transferAmount(t) {
  const decimals = STABLECOINS.find((c) => c.chain === t.chain && c.address === t.token)?.decimals ?? 6;
  const s = t.value.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
function matchTransfers(transfers, invoices) {
  const open = invoices.filter((i) => USD_CURRENCIES.includes(i.currency.toUpperCase()));
  const used = /* @__PURE__ */ new Set();
  const out = [];
  for (const t of transfers) {
    const exact = t.micros === null ? void 0 : open.find((i) => !used.has(i.id) && uniquePayMicros(i.id, i.total) === t.micros);
    if (exact) {
      used.add(exact.id);
      out.push({
        transfer: t,
        invoice: exact,
        method: "exact"
      });
      continue;
    }
    const byTotal = t.micros === null ? [] : open.filter((i) => !used.has(i.id) && BigInt(Math.round(i.total * 100)) * 10000n === t.micros);
    out.push(byTotal.length === 1 ? {
      transfer: t,
      invoice: byTotal[0],
      method: "amount"
    } : {
      transfer: t,
      invoice: null,
      method: null
    });
  }
  return out;
}
function onchainEvidence(t, recordedAt, method) {
  return {
    rail: "onchain",
    chain: t.chain,
    asset: t.asset,
    amount: Number(transferAmount(t)),
    tx_hash: t.txHash,
    log_index: t.logIndex,
    from_address: t.from,
    to_address: t.to,
    block_number: t.blockNumber,
    match_method: method,
    recorded_at: recordedAt
  };
}

// src/unvtd.ts
var UNVTD_PAYMENT_CONTEXT = "https://unvtd.unece.org/payment-confirmation-context.json";
var UNVTD_PAYMENT_SCHEMA = "https://unvtd.unece.org/payment-confirmation-schema.yaml";
var obj = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var str = (v) => typeof v === "string" && v.trim() ? v.trim() : null;
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
function iso4217(currency) {
  const c = (currency ?? "").toUpperCase();
  if (c === "USDT" || c === "USDC" || c === "USDG") return "USD";
  return /^[A-Z]{3}$/.test(c) ? c : null;
}
function party(p, withStreet) {
  const address = {
    type: "Address"
  };
  if (withStreet && str(p.address)) address.streetAddress = str(p.address);
  if (str(p.country)) address.addressCountry = str(p.country);
  const out = {
    type: "Party",
    name: str(p.name) ?? ""
  };
  if (Object.keys(address).length > 1) out.postalAddress = address;
  return out;
}
var CHAIN_LABELS = {
  base: "Base",
  ethereum: "Ethereum",
  bsc: "BNB Chain",
  robinhood: "Robinhood Chain"
};
function describePayment(passport) {
  const payment = obj(passport.payment);
  const evidence = Array.isArray(payment.evidence) ? payment.evidence.map(obj) : [];
  const parts = evidence.map((e) => {
    const rail = str(e.rail);
    if (rail === "onchain") {
      const chain = str(e.chain);
      const name = chain ? CHAIN_LABELS[chain] ?? chain : "chain";
      return `${str(e.asset) ?? "Stablecoin"} transfer on ${name}, tx ${str(e.tx_hash) ?? "?"}`;
    }
    if (rail === "bank_transfer") {
      const ref = str(e.creditor_reference) ?? str(e.end_to_end_id) ?? str(e.bank_reference);
      return `${str(e.scheme) === "SEPA" ? "SEPA credit transfer" : "Bank transfer"}${ref ? `, reference ${ref}` : ""}`;
    }
    if (rail === "nowpayments") {
      return `Crypto payment (${str(e.asset) ?? "crypto"}) via NOWPayments${str(e.tx_hash) ? `, tx ${str(e.tx_hash)}` : ""}`;
    }
    if (rail === "stripe") {
      return `Card payment via Stripe, ${str(e.payment_intent) ?? str(e.checkout_session_id) ?? ""}`.trim();
    }
    return rail ?? "payment";
  });
  return parts.length ? parts.join("; ") : str(payment.method) ?? "Payment";
}
function paymentConfirmationFromPassport(passport, options) {
  const payment = obj(passport.payment);
  const invoice = obj(passport.invoice);
  const seller = obj(passport.seller);
  const buyer = obj(passport.buyer);
  const currency = iso4217(str(invoice.currency));
  const amount = num(invoice.total);
  if (str(payment.status) !== "paid" || !currency || amount === null || !str(invoice.number)) return null;
  const paidAt = str(payment.paid_at);
  const due = str(invoice.due_date);
  const subject = {
    invoiceNumber: str(invoice.number),
    invoicee: party(buyer, true),
    payee: party(seller, true),
    accountHolder: party(seller, false),
    paymentMethod: describePayment(passport),
    monetaryAmount: {
      amount,
      currency
    }
  };
  if (due) subject.paymentDueDate = /T/.test(due) ? due : `${due}T00:00:00Z`;
  const vc = {
    "@context": UNVTD_PAYMENT_CONTEXT,
    type: [
      "VerifiableCredential",
      "PaymentConfirmation"
    ],
    credentialSchema: {
      id: UNVTD_PAYMENT_SCHEMA,
      type: "JsonSchema"
    },
    id: options.id ?? str(passport.verify_url) ?? `urn:invoice-passport:${str(passport.passport_id)}`,
    issuer: options.issuer,
    credentialSubject: subject
  };
  if (paidAt) vc.validFrom = new Date(paidAt).toISOString();
  if (options.validTo) vc.validTo = options.validTo;
  return vc;
}
function signCredential(vc, key) {
  const issuer = str(vc.issuer);
  if (!issuer) throw new Error("credential has no issuer");
  return signCompact(vc, key, {
    kid: `${issuer}#${key.kid}`,
    typ: "vc+jwt",
    cty: "vc"
  });
}
function didWebDocument(did, keys) {
  const methods = keys.map((k) => ({
    id: `${did}#${k.kid}`,
    type: "JsonWebKey",
    controller: did,
    publicKeyJwk: {
      kty: k.kty,
      crv: k.crv,
      x: k.x,
      y: k.y,
      kid: k.kid,
      alg: k.alg
    }
  }));
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/jwk/v1"
    ],
    id: did,
    verificationMethod: methods,
    assertionMethod: methods.map((m) => m.id)
  };
}
function didWebUrl(did) {
  const m = did.match(/^did:web:([^#?]+)$/);
  if (!m) throw new Error(`not a did:web identifier: ${did}`);
  const [host, ...path] = m[1].split(":").map(decodeURIComponent);
  if (!host || /[/\s]/.test(host)) throw new Error(`invalid did:web host in ${did}`);
  return path.length ? `https://${host}/${path.join("/")}/did.json` : `https://${host}/.well-known/did.json`;
}
async function resolveDidWeb(did, fetcher = fetch) {
  const res = await fetcher(didWebUrl(did), {
    headers: {
      Accept: "application/did+json, application/json"
    }
  });
  if (!res.ok) throw new Error(`could not resolve ${did}: HTTP ${res.status}`);
  const doc = await res.json();
  if (doc.id !== did) throw new Error(`DID document id ${doc.id} does not match ${did}`);
  return doc;
}
async function verifyCredential(jws, didDocument) {
  const header = jwsHeader(jws);
  if (!header || header.alg !== "ES256" || header.typ !== "vc+jwt" || !header.kid) {
    return {
      ok: false,
      reason: "not_vc_jwt"
    };
  }
  const kid = header.kid;
  if (!kid.startsWith(`${didDocument.id}#`)) return {
    ok: false,
    reason: "issuer_mismatch"
  };
  const method = didDocument.verificationMethod.find((m) => m.id === kid);
  if (!method || !didDocument.assertionMethod.includes(kid)) return {
    ok: false,
    reason: "unknown_key"
  };
  const credential = await verifyJws(jws, method.publicKeyJwk);
  if (!credential) return {
    ok: false,
    reason: "bad_signature"
  };
  if (credential.issuer !== didDocument.id) return {
    ok: false,
    reason: "issuer_mismatch"
  };
  return {
    ok: true,
    credential,
    issuer: didDocument.id,
    kid
  };
}

// src/ecb.ts
var ECB_API = "https://data-api.ecb.europa.eu/service/data/EXR";
function parseEcbCsv(csv) {
  const [head, ...lines] = csv.trim().split(/\r?\n/);
  const cols = head.split(",");
  const iCur = cols.indexOf("CURRENCY"), iDate = cols.indexOf("TIME_PERIOD"), iVal = cols.indexOf("OBS_VALUE");
  const table = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const cells = line.split(",");
    const value = Number(cells[iVal]);
    if (!cells[iCur] || !cells[iDate] || !Number.isFinite(value) || value <= 0) continue;
    const series = table.get(cells[iCur]) ?? /* @__PURE__ */ new Map();
    series.set(cells[iDate], value);
    table.set(cells[iCur], series);
  }
  return table;
}
async function fetchEcb(currencies, start, end, fetcher = fetch) {
  const list = [
    ...new Set(currencies.map((c) => c.toUpperCase()).filter((c) => c !== "EUR"))
  ];
  if (list.length === 0) return /* @__PURE__ */ new Map();
  const url = `${ECB_API}/D.${list.join("+")}.EUR.SP00.A?startPeriod=${start}&endPeriod=${end}&format=csvdata`;
  const res = await fetcher(url, {
    headers: {
      Accept: "text/csv"
    },
    signal: AbortSignal.timeout(2e4)
  });
  if (res.status === 404) return /* @__PURE__ */ new Map();
  if (!res.ok) throw new Error(`ECB rates unavailable: HTTP ${res.status}`);
  return parseEcbCsv(await res.text());
}
function eurRateOnOrBefore(table, currency, date2) {
  if (currency === "EUR") return {
    rate: 1,
    date: date2
  };
  let best = null;
  for (const [d, rate] of table.get(currency) ?? []) {
    if (d <= date2 && (!best || d > best.date)) best = {
      rate,
      date: d
    };
  }
  return best;
}
function ecbCross(table, from, to, date2) {
  const a = eurRateOnOrBefore(table, from, date2);
  const b = eurRateOnOrBefore(table, to, date2);
  if (!a || !b) return null;
  return {
    rate: b.rate / a.rate,
    date: a.date < b.date ? a.date : b.date
  };
}
export {
  CHAIN_NAMES,
  CIUS_RO,
  CIUS_RO_FORMAT,
  LEGACY_SPECS,
  PASSPORT_SPEC,
  PEPPOL_BILLING_PROCESS,
  PEPPOL_BIS_3,
  STABLECOINS,
  TRANSFER_TOPIC,
  UNVTD_PAYMENT_CONTEXT,
  UNVTD_PAYMENT_SCHEMA,
  USD_CURRENCIES,
  VAT_EAS,
  addressTopic,
  bankTransferEvidence,
  bnrBasis,
  bnrRateBefore,
  buildPassport,
  buildPeppolInvoice,
  buildUblInvoice,
  canonicalJson,
  child,
  children,
  countryCode,
  countyFor,
  creditorReference,
  decodeTransfer,
  describePayment,
  didWebDocument,
  didWebUrl,
  eInvoiceReference,
  ecbCross,
  eurRateOnOrBefore,
  evidenceForMatch,
  fetchEcb,
  fetchYear,
  findCreditorReference,
  formatCreditorReference,
  formatMicros,
  generateSigningKey,
  isEvmAddress,
  isIncomingBooked,
  isValidCreditorReference,
  isValidIban,
  jwsHeader,
  loadSigningKey,
  matchTransfers,
  onchainEvidence,
  parseBnrXml,
  parseCamt,
  parseChain,
  parseEcbCsv,
  parseXml,
  passportDigest,
  paymentConfirmationFromPassport,
  peppolEndpointForVat,
  rateBefore,
  reconcile,
  resolveDidWeb,
  sha256Hex,
  signCanonical,
  signCompact,
  signCredential,
  signPassport,
  textAt,
  transactionReference,
  transferAmount,
  uniquePayAmount,
  uniquePayMicros,
  validCui,
  verifyCredential,
  verifyJws,
  verifyPassport,
  verifyWithJwks
};
