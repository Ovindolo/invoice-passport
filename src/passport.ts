/**
 * Invoice Passport v0.1: one machine-readable, signed record per invoice that ties together the
 * invoice, the parties, the payment evidence (bank reference, card processor ids, on-chain hash)
 * and its history. See SPEC.md. This module is storage-agnostic: callers map their own data to
 * PassportInput, and buildPassport returns the payload that signCanonical() signs.
 */
import { canonicalJson, type Json, sha256Hex } from "./canonical.ts";
import { type Jwks, jwsHeader, signCanonical, type SigningKey, verifyWithJwks } from "./jws.ts";

export const PASSPORT_SPEC = "invoice-passport/0.1";
/** EInvoiceReference.format for RO e-Factura XML from buildUblInvoice(). */
export const CIUS_RO_FORMAT = "UBL-2.1/CIUS-RO-1.0.1";
/** Identifier used by the first production issuer (Billify) before the spec was published. */
export const LEGACY_SPECS = ["billify.invoice-passport/0.1"];

export interface PassportParty {
  name: string | null;
  /** contact person, buyer only */
  contact?: string | null;
  tax_id: string | null;
  address: string | null;
  /** ISO 3166-1 alpha-2 or free text as stored by the issuer */
  country: string | null;
  /** seller only */
  iban?: string | null;
}

export interface PassportLine {
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
}

/**
 * One piece of payment evidence. `rail` names how the money moved; the recommended rails and their
 * fields are listed in SPEC.md (bank_transfer, card, onchain, or a processor name such as
 * "stripe" or "nowpayments"). Unknown fields are kept as-is so issuers can add rail-specific ids.
 */
export interface PaymentEvidence {
  rail: string;
  recorded_at: string;
  [field: string]: Json | undefined;
}

export interface PassportEvent {
  event: string;
  at: string;
  source: string;
}

export interface EInvoiceReference {
  /** e.g. "UBL-2.1/CIUS-RO-1.0.1" or "UBL-2.1/PEPPOL-BIS-3.0" */
  format: string;
  /** SHA-256 (hex) of the exact XML bytes that were issued */
  sha256: string;
  /** national or network id once submitted (ANAF upload index, Peppol message id) */
  submission_id?: string | null;
}

export interface PassportInput {
  passport_id: string;
  verify_url: string;
  invoice: {
    number: string | null;
    issue_date: string | null;
    due_date: string | null;
    currency: string | null;
    status: string | null;
    lines: PassportLine[];
    subtotal: number | null;
    tax_rate: number | null;
    tax_amount: number | null;
    total: number | null;
    notes?: string | null;
  };
  seller: PassportParty;
  buyer: PassportParty;
  payment: {
    status: "paid" | "partially_paid" | "unpaid";
    paid_at: string | null;
    method: string | null;
    amount_received: number | null;
    evidence: PaymentEvidence[];
  };
  history: PassportEvent[];
  e_invoice?: EInvoiceReference | null;
}

export type Passport = Record<string, Json>;

const drop = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Record<string, Json>;

/** The passport payload, with the spec identifier and null for absent optional fields. */
export function buildPassport(input: PassportInput): Passport {
  return {
    spec: PASSPORT_SPEC,
    passport_id: input.passport_id,
    verify_url: input.verify_url,
    invoice: {
      ...drop({ ...input.invoice, lines: undefined }),
      notes: input.invoice.notes ?? null,
      lines: input.invoice.lines.map((l) => drop({ ...l })),
    },
    seller: drop({ ...input.seller, contact: undefined, iban: input.seller.iban ?? null }),
    buyer: drop({ ...input.buyer, iban: undefined, contact: input.buyer.contact ?? null }),
    payment: {
      ...drop({ ...input.payment, evidence: undefined }),
      evidence: input.payment.evidence.map((e) => drop({ ...e })),
    },
    history: input.history.map((e) => drop({ ...e })),
    fiscal: { e_invoice: input.e_invoice ? drop({ ...input.e_invoice }) : null },
  };
}

/** Reference to an issued e-invoice XML, for PassportInput.e_invoice. */
export async function eInvoiceReference(
  xml: string,
  format: string,
  submissionId: string | null = null,
): Promise<EInvoiceReference> {
  return { format, sha256: await sha256Hex(xml), submission_id: submissionId };
}

export function signPassport(input: PassportInput, key: SigningKey): Promise<string> {
  return signCanonical(buildPassport(input), key);
}

export type VerifyResult =
  | { ok: true; passport: Passport; kid: string }
  | { ok: false; reason: "bad_signature" | "unknown_spec" };

/** Verifies a passport JWS against the issuer's JWKS and checks the spec identifier. */
export async function verifyPassport(jws: string, jwks: Jwks): Promise<VerifyResult> {
  const payload = (await verifyWithJwks(jws, jwks)) as Passport | null;
  if (!payload) return { ok: false, reason: "bad_signature" };
  const spec = String(payload.spec ?? "");
  if (spec !== PASSPORT_SPEC && !LEGACY_SPECS.includes(spec)) return { ok: false, reason: "unknown_spec" };
  return { ok: true, passport: payload, kid: String(jwsHeader(jws)?.kid) };
}

/** Stable fingerprint of a passport payload (SHA-256 of its canonical JSON). */
export function passportDigest(passport: Passport): Promise<string> {
  return sha256Hex(canonicalJson(passport));
}
