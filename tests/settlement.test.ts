import { decodeInvoicePaid, encodeApprove, encodePay, invoiceRef } from "../src/settlement.ts";
import vector from "../vectors/settlement-invoice-paid.json" with { type: "json" };

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test("decodes the InvoicePaid log recorded on anvil and matches the reference", async () => {
  const paid = decodeInvoicePaid(vector.log)!;
  assert(paid.invoiceRef === await invoiceRef(vector.ref_id), paid.invoiceRef);
  assert(paid.payer === "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
  assert(paid.seller === "0x000000000000000000000000000000000000b0b0");
  assert(paid.amount === 15_004_428n && paid.logIndex === 0);
  assert(decodeInvoicePaid({ ...vector.log, topics: vector.log.topics.slice(0, 3) }) === null, "wrong shape");
});

Deno.test("encodes pay() and approve() calldata and rejects bad input", async () => {
  const ref = await invoiceRef("x");
  const data = encodePay(
    ref,
    "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    "0x000000000000000000000000000000000000B0b0",
    1n,
  );
  assert(data.startsWith("0x76bbf425" + ref.slice(2)) && data.length === 10 + 4 * 64, data);
  assert(encodeApprove("0xe7f1725e7734ce288f8367e1bb143e90bb3f0512", 2n ** 256n - 1n).endsWith("f".repeat(64)));
  for (
    const bad of [
      () => encodeApprove("", 1n),
      () => encodePay(ref, "0x1", "0x2", 1n),
      () =>
        encodePay(
          "0x12",
          "0x5fbdb2315678afecb367f032d93f642f64180aa3",
          "0x5fbdb2315678afecb367f032d93f642f64180aa3",
          1n,
        ),
    ]
  ) {
    let threw = false;
    try {
      bad();
    } catch {
      threw = true;
    }
    assert(threw);
  }
});
