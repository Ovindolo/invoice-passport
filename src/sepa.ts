/**
 * Bank-transfer helpers: ISO 11649 creditor references ("RF" references), IBAN checks (ISO 13616)
 * and the `bank_transfer` evidence object of an Invoice Passport.
 *
 * An RF reference printed on the invoice (and carried in the UBL PaymentID, BT-83) travels with a
 * SEPA credit transfer as structured remittance information, so the incoming payment can be matched
 * to the invoice without guessing from free text.
 */
import type { PaymentEvidence } from "./passport.ts";

const compact = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** ISO 7064 MOD 97-10 over an alphanumeric string (A=10 … Z=35), computed in chunks. */
function mod97(alnum: string): number {
  let rest = 0;
  for (const ch of alnum) {
    const value = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest;
}

/** Builds an RF creditor reference from your own reference (1–21 letters/digits), e.g. an invoice number. */
export function creditorReference(reference: string): string {
  const ref = compact(reference).replace(/[^0-9A-Z]/g, "");
  if (!/^[0-9A-Z]{1,21}$/.test(ref)) throw new Error("reference must have 1–21 letters or digits");
  const check = 98 - mod97(`${ref}RF00`);
  return `RF${String(check).padStart(2, "0")}${ref}`;
}

export function isValidCreditorReference(value: string): boolean {
  const rf = compact(value);
  if (!/^RF\d{2}[0-9A-Z]{1,21}$/.test(rf)) return false;
  return mod97(rf.slice(4) + rf.slice(0, 4)) === 1;
}

/** RF reference grouped in fours for printing: "RF18 5390 0754 7034". */
export function formatCreditorReference(value: string): string {
  return compact(value).replace(/(.{4})(?=.)/g, "$1 ");
}

/** The first valid RF reference in free text (e.g. unstructured remittance information), or null. */
export function findCreditorReference(text: string): string | null {
  const candidates = text.toUpperCase().match(/RF\s?\d{2}(?:\s?[0-9A-Z]){1,21}/g) ?? [];
  for (const candidate of candidates) {
    // Spaces make the end of the reference ambiguous; try the longest valid prefix first.
    const rf = compact(candidate);
    for (let end = rf.length; end >= 5; end--) {
      if (isValidCreditorReference(rf.slice(0, end))) return rf.slice(0, end);
    }
  }
  return null;
}

/** IBAN check digits (ISO 13616, MOD 97-10). Does not check country-specific length or bank codes. */
export function isValidIban(value: string): boolean {
  const iban = compact(value);
  if (!/^[A-Z]{2}\d{2}[0-9A-Z]{11,30}$/.test(iban)) return false;
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
}

export interface BankTransferInput {
  /** "SEPA", "SEPA_INSTANT", "SWIFT", or a domestic scheme name */
  scheme: string;
  amount: number;
  currency: string;
  /** when the issuer recorded the payment (ISO 8601) */
  recordedAt: string;
  /** booking or value date on the creditor's statement */
  bookingDate?: string | null;
  /** ISO 20022 EndToEndId (pain.001 / pacs.008 / camt.05x) */
  endToEndId?: string | null;
  /** RF creditor reference; validated */
  creditorReference?: string | null;
  /** last four characters only; the full debtor IBAN is personal data and stays out of the passport */
  debtorIbanLast4?: string | null;
  /** bank's own entry reference (camt AcctSvcrRef) */
  bankReference?: string | null;
}

/** `bank_transfer` evidence for PassportInput.payment.evidence. Throws on an invalid RF reference. */
export function bankTransferEvidence(input: BankTransferInput): PaymentEvidence {
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
    recorded_at: input.recordedAt,
  };
}
