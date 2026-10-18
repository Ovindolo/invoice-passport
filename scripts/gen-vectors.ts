/**
 * Regenerates the test vectors in vectors/. The key in vectors/test-key.private.jwk.json is a
 * TEST-ONLY key published on purpose so anyone can reproduce the signatures; never use it to sign
 * real passports. A missing key is generated.
 */
import { buildUblInvoice, type UblInvoiceInput } from "../src/ubl.ts";
import { buildPeppolInvoice, type PeppolInvoiceInput } from "../src/peppol.ts";
import { buildCiiInvoice, type CiiInvoiceInput } from "../src/cii.ts";
import { buildPintInvoice, type PintInvoiceInput } from "../src/pint.ts";
import { didWebDocument, paymentConfirmationFromPassport, signCredential } from "../src/unvtd.ts";
import { generateSigningKey, loadSigningKey } from "../src/jws.ts";
import { buildPassport, CIUS_RO_FORMAT, eInvoiceReference, type PassportInput, signPassport } from "../mod.ts";

const dir = new URL("../vectors/", import.meta.url);
const read = (name: string) => Deno.readTextFile(new URL(name, dir));
const write = (name: string, text: string) => Deno.writeTextFile(new URL(name, dir), text);

let keyJson: string;
try {
  keyJson = await read("test-key.private.jwk.json");
} catch {
  keyJson = JSON.stringify((await generateSigningKey("test-2026-10")).privateJwk, null, 2) + "\n";
  await write("test-key.private.jwk.json", keyJson);
}
const key = (await loadSigningKey(keyJson))!;
await write("jwks.json", JSON.stringify({ keys: [key.publicJwk] }, null, 2) + "\n");

for (const name of ["ubl-ro-O", "ubl-ro-S"]) {
  const input = JSON.parse(await read(`${name}.input.json`)) as UblInvoiceInput;
  const result = buildUblInvoice(input);
  if (!result.xml) throw new Error(`${name}: ${result.problems.join("; ")}`);
  await write(`${name}.xml`, result.xml);
}

for await (const entry of Deno.readDir(dir)) {
  const m = entry.name.match(/^((peppol|xrechnung)-.+)\.input\.json$/);
  if (!m) continue;
  const profile = m[2] === "xrechnung" ? "xrechnung" : "peppol";
  const result = buildPeppolInvoice(JSON.parse(await read(entry.name)) as PeppolInvoiceInput, profile);
  if (!result.xml) throw new Error(`${m[1]}: ${result.problems.join("; ")}`);
  await write(`${m[1]}.xml`, result.xml);
}

// PINT AE / PINT SG (UAE and Singapore).
for await (const entry of Deno.readDir(dir)) {
  const m = entry.name.match(/^(pint-(ae|sg)-.+)\.input\.json$/);
  if (!m) continue;
  const result = buildPintInvoice(JSON.parse(await read(entry.name)) as PintInvoiceInput);
  if (!result.xml) throw new Error(`${m[1]}: ${result.problems.join("; ")}`);
  await write(`${m[1]}.xml`, result.xml);
}

// CII (Factur-X EN 16931 profile): its own inputs, plus every Peppol input in CII syntax.
for await (const entry of Deno.readDir(dir)) {
  const m = entry.name.match(/^((cii|peppol)-.+)\.input\.json$/);
  if (!m) continue;
  const result = buildCiiInvoice(JSON.parse(await read(entry.name)) as CiiInvoiceInput);
  if (!result.xml) throw new Error(`${m[1]} (CII): ${result.problems.join("; ")}`);
  await write(`${m[1].startsWith("cii-") ? m[1] : `cii-${m[1]}`}.xml`, result.xml);
}

const input = JSON.parse(await read("sample-input.json")) as PassportInput;
input.e_invoice = await eInvoiceReference(await read("ubl-ro-S.xml"), CIUS_RO_FORMAT);
await write("passport.json", JSON.stringify(buildPassport(input), null, 2) + "\n");
await write("passport.jws", (await signPassport(input, key)) + "\n");
const passport = buildPassport(input);
const issuer = "did:web:issuer.example";
await write("did.json", JSON.stringify(didWebDocument(issuer, [key.publicJwk]), null, 2) + "\n");
const credential = paymentConfirmationFromPassport(passport, { issuer })!;
await write("unvtd-payment-confirmation.json", JSON.stringify(credential, null, 2) + "\n");
await write("unvtd-payment-confirmation.jwt", (await signCredential(credential, key)) + "\n");
console.log("vectors written");
