import { canonicalJson, loadSigningKey, type Passport } from "../mod.ts";
import {
  type DidDocument,
  didWebDocument,
  didWebUrl,
  paymentConfirmationFromPassport,
  resolveDidWeb,
  signCredential,
  verifyCredential,
} from "../src/unvtd.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const vectors = new URL("../vectors/", import.meta.url);
const read = (name: string) => Deno.readTextFile(new URL(name, vectors));
const json = async <T>(name: string) => JSON.parse(await read(name)) as T;

Deno.test("published UNVTD vector verifies against the published did:web document", async () => {
  const r = await verifyCredential(
    (await read("unvtd-payment-confirmation.jwt")).trim(),
    await json<DidDocument>("did.json"),
  );
  assert(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  assert(r.kid === "did:web:issuer.example#test-2026-10", r.kid);
  assert(canonicalJson(r.credential) === canonicalJson(await json("unvtd-payment-confirmation.json")), "payload");
});

Deno.test("PaymentConfirmation maps the passport: parties, amount, due date, evidence summary", async () => {
  const passport = await json<Passport>("passport.json");
  const vc = paymentConfirmationFromPassport(passport, { issuer: "did:web:issuer.example" })!;
  const s = vc.credentialSubject as Record<string, any>;
  assert(s.invoiceNumber === "INV-2026-0001" && s.monetaryAmount.amount === 1016.4, "number/amount");
  assert(s.monetaryAmount.currency === "EUR" && s.paymentDueDate === "2026-10-15T00:00:00Z", "currency/due");
  assert(s.invoicee.name === "Gamma SRL" && s.payee.name === "Beta Consulting SRL", "parties");
  assert(s.paymentMethod.startsWith("USDC transfer on Ethereum, tx 0x8f2a"), s.paymentMethod);
  assert(vc.id === passport.verify_url && vc.validFrom === "2026-10-03T09:12:44.000Z", "id/validFrom");
});

Deno.test("no confirmation for unpaid passports; stablecoin currencies are reported as USD", async () => {
  const passport = await json<Passport>("passport.json");
  const unpaid = { ...passport, payment: { ...(passport.payment as object), status: "unpaid" } } as Passport;
  assert(paymentConfirmationFromPassport(unpaid, { issuer: "did:web:x.example" }) === null, "unpaid");
  const usdt = { ...passport, invoice: { ...(passport.invoice as object), currency: "USDT" } } as Passport;
  const vc = paymentConfirmationFromPassport(usdt, { issuer: "did:web:x.example" })!;
  assert((vc.credentialSubject as any).monetaryAmount.currency === "USD", "USDT → USD");
});

Deno.test("verification rejects other issuers, unknown keys, tampering and plain JWTs", async () => {
  const key = (await loadSigningKey(await read("test-key.private.jwk.json")))!;
  const doc = await json<DidDocument>("did.json");
  const jwt = (await read("unvtd-payment-confirmation.jwt")).trim();

  const other = didWebDocument("did:web:other.example", [key.publicJwk]);
  assert(!(await verifyCredential(jwt, other)).ok, "issuer mismatch");
  const noAssertion = { ...doc, assertionMethod: [] };
  const r1 = await verifyCredential(jwt, noAssertion);
  assert(!r1.ok && r1.reason === "unknown_key", "key must be an assertionMethod");
  const [h, b, sig] = jwt.split(".");
  const tampered = `${h}.${b.slice(0, -4)}AAAA.${sig}`;
  assert(!(await verifyCredential(tampered, doc)).ok, "tampered");
  const plain = (await read("passport.jws")).trim();
  const r2 = await verifyCredential(plain, doc);
  assert(!r2.ok && r2.reason === "not_vc_jwt", "a passport JWS is not a vc+jwt");
  const own = await signCredential({ issuer: "did:web:issuer.example", credentialSubject: {} }, key);
  assert((await verifyCredential(own, doc)).ok, "a credential signed with the DID's key verifies");
});

Deno.test("did:web URLs and resolution", async () => {
  assert(didWebUrl("did:web:billify.org") === "https://billify.org/.well-known/did.json", "root");
  assert(didWebUrl("did:web:example.com:user:alice") === "https://example.com/user/alice/did.json", "path");
  assert(didWebUrl("did:web:localhost%3A8443") === "https://localhost:8443/.well-known/did.json", "port");
  let threw = false;
  try {
    didWebUrl("did:key:z6Mk");
  } catch {
    threw = true;
  }
  assert(threw, "only did:web");
  const doc = await json<DidDocument>("did.json");
  const fake = ((url: string) =>
    Promise.resolve(
      url === "https://issuer.example/.well-known/did.json" ? Response.json(doc) : new Response("", { status: 404 }),
    )) as unknown as typeof fetch;
  assert((await resolveDidWeb("did:web:issuer.example", fake)).id === "did:web:issuer.example", "resolve");
});
