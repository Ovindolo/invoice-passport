/**
 * Matches incoming bank transactions to open invoices.
 *
 * Methods, strongest first:
 *   reference         — the RF creditor reference of the invoice is in the structured reference or
 *                       in the remittance text, and the currency matches
 *   number_and_amount — the invoice number appears in the remittance text and the amount equals
 *                       the open amount
 *   amount_only       — no reference, but exactly one open invoice in that currency has this exact
 *                       amount; a suggestion for a person to confirm, never applied automatically
 *
 * Each invoice and each transaction is used at most once. When a transaction fits several invoices
 * equally well it is reported as ambiguous instead of guessed.
 */
import type { BankTransaction } from "./camt.ts";
import type { PaymentEvidence } from "./passport.ts";
import { bankTransferEvidence, findCreditorReference, isValidCreditorReference } from "./sepa.ts";

export type MatchMethod = "reference" | "number_and_amount" | "amount_only";

export interface OpenInvoice {
  id: string;
  number: string;
  /** RF creditor reference printed on the invoice, if any */
  reference: string | null;
  /** amount still to be paid */
  amount: number;
  currency: string;
}

export interface Match {
  invoice: OpenInvoice;
  transaction: BankTransaction;
  method: MatchMethod;
  /** "full" when the transaction covers the open amount, "partial" when it is less */
  coverage: "full" | "partial";
  /** true for reference and number_and_amount with full coverage */
  autoApply: boolean;
}

export interface ReconcileResult {
  matches: Match[];
  ambiguous: { transaction: BankTransaction; candidates: OpenInvoice[] }[];
  /** incoming, booked transactions that matched nothing */
  unmatched: BankTransaction[];
  /** debits, reversals, pending or informational entries */
  ignored: BankTransaction[];
}

const alnum = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, "");
const cents = (n: number) => Math.round(n * 100);

/** Booked money received; pending, informational, reversed and outgoing entries are ignored. */
export function isIncomingBooked(t: BankTransaction): boolean {
  return t.credit && !t.reversal && (t.status === null || t.status === "BOOK");
}

/** The RF reference a transaction carries, from the structured field first, then the free text. */
export function transactionReference(t: BankTransaction): string | null {
  const structured = t.creditorReference ? alnum(t.creditorReference) : null;
  if (structured && isValidCreditorReference(structured)) return structured;
  return findCreditorReference(`${t.creditorReference ?? ""} ${t.remittance ?? ""}`);
}

/** The invoice number as a whole token, ignoring case and separators ("PF-7" matches "pf 7", not "pf-70"). */
function mentionsNumber(t: BankTransaction, number: string): boolean {
  const chars = alnum(number).split("");
  if (chars.length < 2) return false;
  const pattern = new RegExp(`(?<![0-9A-Z])${chars.join("[^0-9A-Z]?")}(?![0-9A-Z])`);
  return pattern.test(`${t.remittance ?? ""} ${t.creditorReference ?? ""} ${t.endToEndId ?? ""}`.toUpperCase());
}

export function reconcile(transactions: BankTransaction[], invoices: OpenInvoice[]): ReconcileResult {
  const result: ReconcileResult = { matches: [], ambiguous: [], unmatched: [], ignored: [] };
  const usedInvoices = new Set<string>();
  const pending: BankTransaction[] = [];

  for (const t of transactions) (isIncomingBooked(t) ? pending : result.ignored).push(t);

  const take = (t: BankTransaction, method: MatchMethod, candidates: OpenInvoice[]): boolean => {
    const free = candidates.filter((i) => !usedInvoices.has(i.id));
    if (free.length === 0) return false;
    if (free.length > 1) {
      result.ambiguous.push({ transaction: t, candidates: free });
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
      autoApply: method !== "amount_only" && coverage === "full",
    });
    return true;
  };

  // Pass 1: references. Pass 2: number + amount. Pass 3: amount only. A transaction leaves the
  // queue as soon as one pass decides it (matched or ambiguous).
  const passes: [MatchMethod, (t: BankTransaction, i: OpenInvoice) => boolean][] = [
    ["reference", (t, i) => {
      const ref = transactionReference(t);
      return !!ref && !!i.reference && alnum(i.reference) === ref;
    }],
    ["number_and_amount", (t, i) => mentionsNumber(t, i.number) && cents(t.amount) === cents(i.amount)],
    ["amount_only", (t, i) => cents(t.amount) === cents(i.amount)],
  ];
  let queue = pending;
  for (const [method, fits] of passes) {
    const next: BankTransaction[] = [];
    for (const t of queue) {
      const candidates = invoices.filter((i) => i.currency.toUpperCase() === t.currency && fits(t, i));
      if (!take(t, method, candidates)) next.push(t);
    }
    queue = next;
  }
  result.unmatched = queue;
  return result;
}

/** `bank_transfer` passport evidence for a matched transaction. */
export function evidenceForMatch(match: Match, recordedAt: string): PaymentEvidence {
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
      bankReference: t.bankReference,
    }),
    match_method: match.method,
  };
}
