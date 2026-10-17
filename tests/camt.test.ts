import { parseCamt } from "../src/camt.ts";
import { evidenceForMatch, type OpenInvoice, reconcile } from "../src/reconcile.ts";
import { parseXml } from "../src/xml.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const read = (name: string) => Deno.readTextFile(new URL(`../vectors/${name}`, import.meta.url));

const invoices: OpenInvoice[] = [
  { id: "a", number: "INV-2026-0001", reference: "RF16INV20260001", amount: 1016.4, currency: "EUR" },
  { id: "b", number: "PF-7", reference: null, amount: 500, currency: "EUR" },
  { id: "c", number: "INV-2026-0040", reference: null, amount: 79, currency: "EUR" },
  { id: "d", number: "INV-2026-0050", reference: "RF51INV20260050", amount: 300, currency: "EUR" },
  { id: "e", number: "INV-2026-0051", reference: "RF24INV20260051", amount: 200, currency: "EUR" },
  { id: "f", number: "INV-2026-0052", reference: "RF94INV20260052", amount: 2200, currency: "EUR" },
  { id: "g", number: "INV-2026-0060", reference: "RF72INV20260060", amount: 1500, currency: "RON" },
  { id: "h", number: "INV-2026-0099", reference: "RF00NOTUSED", amount: 42.42, currency: "USD" },
];

Deno.test("camt.053 v08: entries, batch details, statuses and references", async () => {
  const s = parseCamt(await read("camt053-sample.xml"));
  assert(s.kind === "camt.053" && s.messageId === "STMT-2026-10-03", s.kind);
  assert(s.transactions.length === 9, String(s.transactions.length)); // 8 entries, one with 2 details
  const first = s.transactions[0];
  assert(first.amount === 1016.4 && first.currency === "EUR" && first.credit && first.status === "BOOK", "amount");
  assert(first.creditorReference === "RF16INV20260001" && first.endToEndId === "E2E-GAMMA-0001", "refs");
  assert(first.counterpartyName === "Gamma SRL" && first.counterpartyIban === "DE89370400440532013000", "debtor");
  assert(first.accountIban === "RO49AAAA1B31007593840000" && first.bookingDate === "2026-10-03", "account/date");
  assert(s.transactions[1].endToEndId === null, "NOTPROVIDED → null");
  assert(s.transactions[2].remittance === "thanks & regards", "entity decoded");
  const batch = s.transactions.filter((t) => t.bankReference === "BNK-BATCH-7");
  assert(batch.length === 2 && batch[0].amount === 300 && batch[1].amount === 200, "batch split");
});

Deno.test("camt.054 v02: plain-text status, DateTime booking, party without Pty", async () => {
  const s = parseCamt(await read("camt054-sample.xml"));
  const t = s.transactions[0];
  assert(s.kind === "camt.054" && s.transactions.length === 1, s.kind);
  assert(t.status === "BOOK" && t.bookingDate === "2026-10-05" && t.currency === "RON", JSON.stringify(t));
  assert(t.counterpartyName === "Alfa Soft SRL" && t.bankReference === "RO-INST-99", "party/ref");
});

Deno.test("reconcile: reference, number+amount, amount-only, partial, ignored, unmatched", async () => {
  const txs = [
    ...parseCamt(await read("camt053-sample.xml")).transactions,
    ...parseCamt(await read("camt054-sample.xml")).transactions,
  ];
  const r = reconcile(txs, invoices);
  const by = (id: string) => r.matches.find((m) => m.invoice.id === id);

  assert(by("a")?.method === "reference" && by("a")?.autoApply, "structured RF");
  assert(by("b")?.method === "number_and_amount" && by("b")?.autoApply, "invoice number in text + amount");
  assert(by("c")?.method === "amount_only" && !by("c")?.autoApply, "amount only is a suggestion");
  assert(by("d")?.method === "reference" && by("d")?.transaction.amount === 300, "batch detail 1");
  assert(by("e")?.method === "reference", "spaced RF in free text");
  assert(by("f")?.coverage === "partial" && !by("f")?.autoApply, "partial payment not auto-applied");
  assert(by("g")?.method === "reference" && by("g")?.transaction.currency === "RON", "camt.054 RON");
  assert(!by("h"), "currency mismatch never matches");
  assert(r.unmatched.length === 1 && r.unmatched[0].amount === 42.42, "unmatched 42.42 EUR");
  assert(r.ignored.length === 2, `ignored debit + pending: ${r.ignored.length}`);
  assert(r.ambiguous.length === 0, "no ambiguity");
});

Deno.test("two invoices with the same amount and no reference are ambiguous, not guessed", () => {
  const tx = {
    key: "x/1/1",
    statementId: "x",
    accountIban: null,
    amount: 100,
    currency: "EUR",
    credit: true,
    status: "BOOK",
    reversal: false,
    bookingDate: "2026-10-01",
    valueDate: null,
    bankReference: null,
    endToEndId: null,
    creditorReference: null,
    remittance: "payment",
    counterpartyName: null,
    counterpartyIban: null,
  };
  const r = reconcile([tx], [
    { id: "1", number: "A-1", reference: null, amount: 100, currency: "EUR" },
    { id: "2", number: "A-2", reference: null, amount: 100, currency: "EUR" },
  ]);
  assert(r.matches.length === 0 && r.ambiguous.length === 1 && r.ambiguous[0].candidates.length === 2, "ambiguous");
});

Deno.test("evidence keeps the RF, end-to-end id and only the last four IBAN characters", async () => {
  const txs = parseCamt(await read("camt053-sample.xml")).transactions;
  const m = reconcile(txs, invoices).matches.find((x) => x.invoice.id === "a")!;
  const e = evidenceForMatch(m, "2026-10-04T08:00:00Z");
  assert(e.rail === "bank_transfer" && e.scheme === "SEPA" && e.creditor_reference === "RF16INV20260001", "rf");
  assert(e.end_to_end_id === "E2E-GAMMA-0001" && e.debtor_iban_last4 === "3000", "e2e + iban");
  assert(e.match_method === "reference" && e.booking_date === "2026-10-03", "method + date");
});

Deno.test("XML reader rejects DOCTYPE and broken nesting, accepts CDATA and comments", () => {
  let threw = 0;
  for (const bad of ['<!DOCTYPE x [<!ENTITY a "b">]><x/>', "<a><b></a></b>", "<a>", "<Document><x></Document>"]) {
    try {
      parseXml(bad);
    } catch {
      threw++;
    }
  }
  assert(threw === 4, `rejected ${threw}/4`);
  const doc = parseXml("<a><!-- c --><b><![CDATA[1 < 2]]></b><c x='1 > 0'/></a>");
  assert(doc.children[0].children[0].text === "1 < 2" && doc.children[0].children[1].attrs.x === "1 > 0", "cdata");
  let notCamt = false;
  try {
    parseCamt("<Document><Other/></Document>");
  } catch {
    notCamt = true;
  }
  assert(notCamt, "non-camt rejected");
});
