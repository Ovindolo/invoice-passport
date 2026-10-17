/**
 * ISO 20022 bank-to-customer cash management messages: camt.053 (statement), camt.054
 * (debit/credit notification) and camt.052 (intraday report), versions .001.02 to .001.13.
 * Each entry becomes one BankTransaction per transaction detail (a batch entry with several
 * TxDtls yields several transactions), with the references needed to match it to an invoice.
 */
import { child, children, parseXml, textAt, type XmlNode } from "./xml.ts";

export type CamtKind = "camt.052" | "camt.053" | "camt.054";

export interface BankTransaction {
  /** stable key within the file: "<statement id>/<entry index>/<detail index>" */
  key: string;
  statementId: string | null;
  accountIban: string | null;
  amount: number;
  currency: string;
  /** true for money received (CRDT) */
  credit: boolean;
  /** BOOK, PDNG, INFO; null when the bank omits it */
  status: string | null;
  reversal: boolean;
  bookingDate: string | null;
  valueDate: string | null;
  /** bank's own reference for the entry or transaction (AcctSvcrRef) */
  bankReference: string | null;
  endToEndId: string | null;
  /** structured creditor reference (RmtInf/Strd/CdtrRefInf/Ref), e.g. an RF reference */
  creditorReference: string | null;
  /** unstructured remittance information, joined with spaces */
  remittance: string | null;
  /** payer for credits */
  counterpartyName: string | null;
  counterpartyIban: string | null;
}

export interface CamtStatement {
  kind: CamtKind;
  messageId: string | null;
  createdAt: string | null;
  transactions: BankTransaction[];
}

const ROOTS: Record<string, { kind: CamtKind; item: string }> = {
  BkToCstmrStmt: { kind: "camt.053", item: "Stmt" },
  BkToCstmrDbtCdtNtfctn: { kind: "camt.054", item: "Ntfctn" },
  BkToCstmrAcctRpt: { kind: "camt.052", item: "Rpt" },
};

const date = (n: XmlNode | undefined) => {
  const v = textAt(n, "Dt") ?? textAt(n, "DtTm");
  return v ? v.slice(0, 10) : null;
};

const amountOf = (n: XmlNode | undefined): { amount: number; currency: string } | null => {
  if (!n) return null;
  const amount = Number(n.text.trim());
  const currency = n.attrs.Ccy;
  return Number.isFinite(amount) && currency ? { amount, currency: currency.toUpperCase() } : null;
};

const partyName = (party: XmlNode | undefined) => textAt(party, "Nm") ?? textAt(party, "Pty", "Nm");

const nullIfNotProvided = (v: string | null) => (v && v.toUpperCase() !== "NOTPROVIDED" ? v : null);

/** Parses a camt.052/053/054 XML document. Throws on anything else. */
export function parseCamt(xml: string): CamtStatement {
  const doc = parseXml(xml);
  const document = child(doc, "Document");
  const rootNode = document?.children.find((c) => c.name in ROOTS);
  if (!rootNode) throw new Error("not an ISO 20022 camt.052, camt.053 or camt.054 document");
  const { kind, item } = ROOTS[rootNode.name];

  const transactions: BankTransaction[] = [];
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
      const list = details.length > 0 ? details : [undefined];
      for (const [ti, tx] of list.entries()) {
        const txAmount = list.length > 1
          ? amountOf(child(tx, "Amt")) ?? amountOf(child(tx, "AmtDtls", "TxAmt", "Amt"))
          : null;
        const amount = txAmount ?? entryAmount;
        const rmt = child(tx, "RmtInf");
        const structured = children(rmt, "Strd")
          .map((s) => textAt(s, "CdtrRefInf", "Ref"))
          .find((r) => !!r) ?? null;
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
          counterpartyIban: textAt(parties, `${counterparty}Acct`, "Id", "IBAN"),
        });
      }
    }
  }
  return {
    kind,
    messageId: textAt(rootNode, "GrpHdr", "MsgId"),
    createdAt: textAt(rootNode, "GrpHdr", "CreDtTm"),
    transactions,
  };
}
