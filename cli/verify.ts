/**
 * Verify an Invoice Passport.
 *
 *   deno run --allow-read --allow-net cli/verify.ts <passport.jws | -> --jwks <url | file>
 *
 * Exits 0 and prints the passport when the signature and spec are valid, 1 otherwise.
 */
import { verifyPassport } from "../src/passport.ts";
import type { Jwks } from "../src/jws.ts";

async function readSource(source: string): Promise<string> {
  if (source === "-") return await new Response(Deno.stdin.readable).text();
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GET ${source} → HTTP ${res.status}`);
    return await res.text();
  }
  return await Deno.readTextFile(source);
}

const args = [...Deno.args];
const jwksAt = args.indexOf("--jwks");
const jwksSource = jwksAt >= 0 ? args.splice(jwksAt, 2)[1] : undefined;
const [jwsSource] = args;
if (!jwsSource || !jwksSource) {
  console.error("usage: verify.ts <passport.jws | -> --jwks <url | file>");
  Deno.exit(2);
}

const jws = (await readSource(jwsSource)).trim();
const jwks = JSON.parse(await readSource(jwksSource)) as Jwks;
const result = await verifyPassport(jws, jwks);
if (!result.ok) {
  console.error(`INVALID: ${result.reason}`);
  Deno.exit(1);
}
console.error(`VALID: signed by key ${result.kid}`);
console.log(JSON.stringify(result.passport, null, 2));
