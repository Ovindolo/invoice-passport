import {
  bankTransferEvidence,
  creditorReference,
  findCreditorReference,
  formatCreditorReference,
  isValidCreditorReference,
  isValidIban,
} from "../src/sepa.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

Deno.test("RF creditor reference: ISO 11649 example and round trip", () => {
  // Example from ISO 11649 / EPC guidance.
  assert(creditorReference("539007547034") === "RF18539007547034", creditorReference("539007547034"));
  assert(isValidCreditorReference("RF18 5390 0754 7034"), "spaced form");
  assert(!isValidCreditorReference("RF19539007547034"), "wrong check digits");
  assert(!isValidCreditorReference("RF18"), "too short");
  const rf = creditorReference("inv-2026-0001");
  assert(rf.startsWith("RF") && rf.endsWith("INV20260001") && isValidCreditorReference(rf), rf);
  assert(formatCreditorReference("RF18539007547034") === "RF18 5390 0754 7034", "grouping");
});

Deno.test("finds the RF reference in free remittance text", () => {
  assert(findCreditorReference("Plata factura RF18 5390 0754 7034 multumesc") === "RF18539007547034", "spaced");
  assert(findCreditorReference("payment rf18539007547034") === "RF18539007547034", "lower case");
  assert(findCreditorReference("RF00 1234 no valid ref here") === null, "invalid");
});

Deno.test("IBAN check digits", () => {
  assert(isValidIban("RO49 AAAA 1B31 0075 9384 0000"), "RO");
  assert(isValidIban("DE89370400440532013000"), "DE");
  assert(!isValidIban("DE88370400440532013000"), "bad check");
  assert(!isValidIban("RO49"), "short");
});

Deno.test("bank_transfer evidence keeps only the last four IBAN characters", () => {
  const e = bankTransferEvidence({
    scheme: "SEPA",
    amount: 1016.4,
    currency: "eur",
    recordedAt: "2026-10-03T10:00:00Z",
    endToEndId: "E2E-20261003-1",
    creditorReference: "rf18 5390 0754 7034",
    debtorIbanLast4: "DE89370400440532013000",
  });
  assert(e.rail === "bank_transfer" && e.currency === "EUR" && e.creditor_reference === "RF18539007547034", "fields");
  assert(e.debtor_iban_last4 === "3000" && e.booking_date === null, "privacy + nulls");
  let threw = false;
  try {
    bankTransferEvidence({ scheme: "SEPA", amount: 1, currency: "EUR", recordedAt: "x", creditorReference: "RF00X" });
  } catch {
    threw = true;
  }
  assert(threw, "invalid RF rejected");
});
