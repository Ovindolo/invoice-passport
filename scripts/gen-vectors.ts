/**
 * Regenerates the test vectors in vectors/. The key in vectors/test-key.private.jwk.json is a
 * TEST-ONLY key published on purpose so anyone can reproduce the signatures; never use it to sign
 * real passports. A missing key is generated.
 */
import { buildUblInvoice, type UblInvoiceInput } from "../src/ubl.ts";
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

const input = JSON.parse(await read("sample-input.json")) as PassportInput;
input.e_invoice = await eInvoiceReference(await read("ubl-ro-S.xml"), CIUS_RO_FORMAT);
await write("passport.json", JSON.stringify(buildPassport(input), null, 2) + "\n");
await write("passport.jws", (await signPassport(input, key)) + "\n");
console.log("vectors written");
