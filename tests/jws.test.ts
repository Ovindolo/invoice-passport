import { canonicalJson, loadSigningKey, signCanonical, verifyJws } from "../mod.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

async function testKeyJson(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return JSON.stringify({ ...jwk, kid: "test-key" });
}

Deno.test("canonical JSON sorts keys at every level and drops undefined", () => {
  const a = canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } });
  assert(a === '{"a":{"d":[{"y":2,"z":1}]},"b":1}', a);
});

Deno.test("passport JWS verifies with the published public key and detects tampering", async () => {
  const key = await loadSigningKey(await testKeyJson());
  assert(key && key.publicJwk.kid === "test-key" && !("d" in key.publicJwk), "public JWK without private part");
  const payload = { spec: "invoice-passport/0.1", invoice: { total: 15, currency: "USD" } };
  const jws = await signCanonical(payload, key!);

  const decoded = await verifyJws(jws, key!.publicJwk);
  assert(canonicalJson(decoded) === canonicalJson(payload), "round trip");

  const [h, , s] = jws.split(".");
  const forgedBody = btoa(canonicalJson({ ...payload, invoice: { total: 1, currency: "USD" } }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert((await verifyJws(`${h}.${forgedBody}.${s}`, key!.publicJwk)) === null, "tampered payload rejected");
});

Deno.test("signing key must be a P-256 private JWK with kid", async () => {
  let threw = false;
  try {
    await loadSigningKey(JSON.stringify({ kty: "EC", crv: "P-256", x: "a", y: "b" }));
  } catch {
    threw = true;
  }
  assert(threw, "rejects public-only JWK");
  assert((await loadSigningKey(undefined)) === null, "missing key → null");
});
