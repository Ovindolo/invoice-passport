import {
  buildPassport,
  canonicalJson,
  eInvoiceReference,
  type Jwks,
  loadSigningKey,
  type PassportInput,
  sha256Hex,
  signCanonical,
  signPassport,
  verifyPassport,
} from "../mod.ts";
import { buildUblInvoice, type UblInvoiceInput } from "../src/ubl.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const vectors = new URL("../vectors/", import.meta.url);
const read = (name: string) => Deno.readTextFile(new URL(name, vectors));
const json = async <T>(name: string) => JSON.parse(await read(name)) as T;

Deno.test("published vector verifies against the published JWKS", async () => {
  const jws = (await read("passport.jws")).trim();
  const result = await verifyPassport(jws, await json<Jwks>("jwks.json"));
  assert(result.ok, JSON.stringify(result));
  if (!result.ok) return;
  assert(result.kid === "test-2026-10", result.kid);
  assert(canonicalJson(result.passport) === canonicalJson(await json("passport.json")), "payload = passport.json");
});

Deno.test("passport.json is exactly buildPassport(sample-input) with the e-invoice hash", async () => {
  const input = await json<PassportInput>("sample-input.json");
  const xml = await read("ubl-ro-S.xml");
  input.e_invoice = await eInvoiceReference(xml, "UBL-2.1/CIUS-RO-1.0.1");
  assert(canonicalJson(buildPassport(input)) === canonicalJson(await json("passport.json")), "rebuild");
  const ref = (await json<{ fiscal: { e_invoice: { sha256: string } } }>("passport.json")).fiscal.e_invoice;
  assert(ref.sha256 === (await sha256Hex(xml)), "hash of the issued XML");
});

Deno.test("UBL vectors are reproduced byte for byte", async () => {
  for (const name of ["ubl-ro-O", "ubl-ro-S"]) {
    const r = buildUblInvoice(await json<UblInvoiceInput>(`${name}.input.json`));
    assert(r.xml === (await read(`${name}.xml`)), `${name}.xml`);
  }
});

Deno.test("wrong key, unknown spec and legacy spec", async () => {
  const jws = (await read("passport.jws")).trim();
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const otherJwk = { ...(await crypto.subtle.exportKey("jwk", other.publicKey)), kid: "test-2026-10" };
  assert(!(await verifyPassport(jws, { keys: [otherJwk] })).ok, "foreign key with the same kid rejected");
  assert(!(await verifyPassport(jws, { keys: [] })).ok, "empty JWKS rejected");

  const key = (await loadSigningKey(await read("test-key.private.jwk.json")))!;
  const jwks = { keys: [key.publicJwk] };
  const unknown = await signCanonical({ spec: "something-else/1" }, key);
  const r = await verifyPassport(unknown, jwks);
  assert(!r.ok && r.reason === "unknown_spec", JSON.stringify(r));
  const legacy = await signCanonical({ spec: "billify.invoice-passport/0.1" }, key);
  assert((await verifyPassport(legacy, jwks)).ok, "legacy Billify passports still verify");
});

Deno.test("absent optional fields become null, unknown evidence fields are kept", async () => {
  const input = await json<PassportInput>("sample-input.json");
  delete input.invoice.notes;
  delete input.buyer.contact;
  input.payment.evidence = [{ rail: "bank_transfer", recorded_at: "2026-10-03", end_to_end_id: "E2E-1", custom: 7 }];
  const p = buildPassport(input) as any;
  assert(p.invoice.notes === null && p.buyer.contact === null && p.fiscal.e_invoice === null, "nulls");
  assert(!("iban" in p.buyer) && !("contact" in p.seller), "party fields stay on their side");
  assert(p.payment.evidence[0].custom === 7, "extra evidence field kept");
  const key = (await loadSigningKey(await read("test-key.private.jwk.json")))!;
  assert((await verifyPassport(await signPassport(input, key), { keys: [key.publicJwk] })).ok, "sign + verify");
});
