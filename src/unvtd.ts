/**
 * UN/CEFACT Verifiable Trade Documents (UNVTD) interoperability.
 *
 * UNVTD (draft; final standard expected by end of 2026) models trade documents as W3C Verifiable
 * Credentials issued by DIDs. Its "Payment & Reconciliation" use case matches a verifiable invoice
 * with a verifiable payment confirmation — the same link an Invoice Passport records. This module
 * derives a UNVTD PaymentConfirmation credential from a paid passport, secures it as a VC-JOSE
 * compact JWS (typ "vc+jwt"), and resolves/verifies did:web issuers.
 *
 * The UNVTD schema has no place for rail-specific evidence (transaction hash, RF reference,
 * end-to-end id); those are summarised in `paymentMethod`, and the full evidence stays in the
 * passport, which the credential id points to. See SPEC.md, "Relation to UN/CEFACT UNVTD".
 */
import type { Json } from "./canonical.ts";
import { jwsHeader, type PublicJwk, signCompact, type SigningKey, verifyJws } from "./jws.ts";
import type { Passport } from "./passport.ts";

export const UNVTD_PAYMENT_CONTEXT = "https://unvtd.unece.org/payment-confirmation-context.json";
export const UNVTD_PAYMENT_SCHEMA = "https://unvtd.unece.org/payment-confirmation-schema.yaml";

type Obj = Record<string, Json>;
const obj = (v: Json | undefined): Obj => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const str = (v: Json | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: Json | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** ISO 4217 code for the amount; USD stablecoins settle 1:1 and are reported as USD. */
function iso4217(currency: string | null): string | null {
  const c = (currency ?? "").toUpperCase();
  if (c === "USDT" || c === "USDC" || c === "USDG") return "USD";
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

function party(p: Obj, withStreet: boolean): Obj {
  const address: Obj = { type: "Address" };
  if (withStreet && str(p.address)) address.streetAddress = str(p.address)!;
  if (str(p.country)) address.addressCountry = str(p.country)!;
  const out: Obj = { type: "Party", name: str(p.name) ?? "" };
  if (Object.keys(address).length > 1) out.postalAddress = address;
  return out;
}

const CHAIN_LABELS: Record<string, string> = {
  base: "Base",
  ethereum: "Ethereum",
  bsc: "BNB Chain",
  robinhood: "Robinhood Chain",
};

/** One-line description of how the invoice was paid, with the identifiers a verifier can check. */
export function describePayment(passport: Passport): string {
  const payment = obj(passport.payment);
  const evidence = Array.isArray(payment.evidence) ? payment.evidence.map(obj) : [];
  const parts = evidence.map((e) => {
    const rail = str(e.rail);
    if (rail === "onchain") {
      const chain = str(e.chain);
      const name = chain ? (CHAIN_LABELS[chain] ?? chain) : "chain";
      return `${str(e.asset) ?? "Stablecoin"} transfer on ${name}, tx ${str(e.tx_hash) ?? "?"}`;
    }
    if (rail === "bank_transfer") {
      const ref = str(e.creditor_reference) ?? str(e.end_to_end_id) ?? str(e.bank_reference);
      return `${str(e.scheme) === "SEPA" ? "SEPA credit transfer" : "Bank transfer"}${ref ? `, reference ${ref}` : ""}`;
    }
    if (rail === "nowpayments") {
      return `Crypto payment (${str(e.asset) ?? "crypto"}) via NOWPayments${
        str(e.tx_hash) ? `, tx ${str(e.tx_hash)}` : ""
      }`;
    }
    if (rail === "stripe") {
      return `Card payment via Stripe, ${str(e.payment_intent) ?? str(e.checkout_session_id) ?? ""}`.trim();
    }
    return rail ?? "payment";
  });
  return parts.length ? parts.join("; ") : (str(payment.method) ?? "Payment");
}

export interface PaymentConfirmationOptions {
  /** issuer DID, e.g. "did:web:billify.org" */
  issuer: string;
  /** credential id; defaults to the passport's verify_url */
  id?: string;
  validTo?: string | null;
}

/** UNVTD PaymentConfirmation for a paid passport; null while the invoice is not fully paid. */
export function paymentConfirmationFromPassport(passport: Passport, options: PaymentConfirmationOptions): Obj | null {
  const payment = obj(passport.payment);
  const invoice = obj(passport.invoice);
  const seller = obj(passport.seller);
  const buyer = obj(passport.buyer);
  const currency = iso4217(str(invoice.currency));
  const amount = num(invoice.total);
  if (str(payment.status) !== "paid" || !currency || amount === null || !str(invoice.number)) return null;

  const paidAt = str(payment.paid_at);
  const due = str(invoice.due_date);
  const subject: Obj = {
    invoiceNumber: str(invoice.number)!,
    invoicee: party(buyer, true),
    payee: party(seller, true),
    accountHolder: party(seller, false),
    paymentMethod: describePayment(passport),
    monetaryAmount: { amount, currency },
  };
  if (due) subject.paymentDueDate = /T/.test(due) ? due : `${due}T00:00:00Z`;

  const vc: Obj = {
    "@context": UNVTD_PAYMENT_CONTEXT,
    type: ["VerifiableCredential", "PaymentConfirmation"],
    credentialSchema: { id: UNVTD_PAYMENT_SCHEMA, type: "JsonSchema" },
    id: options.id ?? str(passport.verify_url) ?? `urn:invoice-passport:${str(passport.passport_id)}`,
    issuer: options.issuer,
    credentialSubject: subject,
  };
  if (paidAt) vc.validFrom = new Date(paidAt).toISOString();
  if (options.validTo) vc.validTo = options.validTo;
  return vc;
}

/** Secures a credential as a VC-JOSE compact JWS (typ "vc+jwt"), signed by `${issuer}#${kid}`. */
export function signCredential(vc: Obj, key: SigningKey): Promise<string> {
  const issuer = str(vc.issuer);
  if (!issuer) throw new Error("credential has no issuer");
  return signCompact(vc, key, { kid: `${issuer}#${key.kid}`, typ: "vc+jwt", cty: "vc" });
}

export interface DidDocument {
  "@context": string[];
  id: string;
  verificationMethod: { id: string; type: string; controller: string; publicKeyJwk: JsonWebKey }[];
  assertionMethod: string[];
}

/** did:web DID document listing the issuer's signing keys (JsonWebKey verification methods). */
export function didWebDocument(did: string, keys: PublicJwk[]): DidDocument {
  const methods = keys.map((k) => ({
    id: `${did}#${k.kid}`,
    type: "JsonWebKey",
    controller: did,
    publicKeyJwk: { kty: k.kty, crv: k.crv, x: k.x, y: k.y, kid: k.kid, alg: k.alg } as JsonWebKey,
  }));
  return {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/jwk/v1"],
    id: did,
    verificationMethod: methods,
    assertionMethod: methods.map((m) => m.id),
  };
}

/** HTTPS location of a did:web document (W3C did:web method). */
export function didWebUrl(did: string): string {
  const m = did.match(/^did:web:([^#?]+)$/);
  if (!m) throw new Error(`not a did:web identifier: ${did}`);
  const [host, ...path] = m[1].split(":").map(decodeURIComponent);
  if (!host || /[/\s]/.test(host)) throw new Error(`invalid did:web host in ${did}`);
  return path.length ? `https://${host}/${path.join("/")}/did.json` : `https://${host}/.well-known/did.json`;
}

export async function resolveDidWeb(did: string, fetcher: typeof fetch = fetch): Promise<DidDocument> {
  const res = await fetcher(didWebUrl(did), { headers: { Accept: "application/did+json, application/json" } });
  if (!res.ok) throw new Error(`could not resolve ${did}: HTTP ${res.status}`);
  const doc = (await res.json()) as DidDocument;
  if (doc.id !== did) throw new Error(`DID document id ${doc.id} does not match ${did}`);
  return doc;
}

export type CredentialResult =
  | { ok: true; credential: Obj; issuer: string; kid: string }
  | { ok: false; reason: "not_vc_jwt" | "issuer_mismatch" | "unknown_key" | "bad_signature" };

/** Verifies a vc+jwt against the issuer's DID document (assertionMethod keys only). */
export async function verifyCredential(jws: string, didDocument: DidDocument): Promise<CredentialResult> {
  const header = jwsHeader(jws);
  if (!header || header.alg !== "ES256" || header.typ !== "vc+jwt" || !header.kid) {
    return { ok: false, reason: "not_vc_jwt" };
  }
  const kid = header.kid;
  if (!kid.startsWith(`${didDocument.id}#`)) return { ok: false, reason: "issuer_mismatch" };
  const method = didDocument.verificationMethod.find((m) => m.id === kid);
  if (!method || !didDocument.assertionMethod.includes(kid)) return { ok: false, reason: "unknown_key" };
  const credential = (await verifyJws(jws, method.publicKeyJwk)) as Obj | null;
  if (!credential) return { ok: false, reason: "bad_signature" };
  if (credential.issuer !== didDocument.id) return { ok: false, reason: "issuer_mismatch" };
  return { ok: true, credential, issuer: didDocument.id, kid };
}
