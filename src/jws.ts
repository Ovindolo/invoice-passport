/**
 * Compact JWS (RFC 7515) with ES256 over canonical JSON, using only WebCrypto, so it runs in Deno,
 * Node 20+, browsers and edge runtimes without dependencies.
 */
import { canonicalJson } from "./canonical.ts";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): Uint8Array<ArrayBuffer> {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type PublicJwk = JsonWebKey & { kid: string; alg: string; use: string };

export interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: PublicJwk;
}

export interface Jwks {
  keys: JsonWebKey[];
}

/** Loads an ES256 private JWK that carries a "kid"; null when no key is given. */
export async function loadSigningKey(jwkJson: string | undefined | null): Promise<SigningKey | null> {
  if (!jwkJson) return null;
  const jwk = JSON.parse(jwkJson) as JsonWebKey & { kid?: string };
  if (!jwk.kid || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d) {
    throw new Error("signing key must be a P-256 private JWK with a kid");
  }
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
  const { kty, crv, x, y, kid } = jwk;
  return { kid, privateKey, publicJwk: { kty, crv, x, y, kid, alg: "ES256", use: "sig" } };
}

/** Generates a fresh signing key (for tests and first-time setup). */
export async function generateSigningKey(kid: string): Promise<{ privateJwk: JsonWebKey & { kid: string } }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { privateJwk: { ...jwk, kid } };
}

/** Compact JWS (ES256) over the canonical JSON of the payload. */
export async function signCanonical(payload: unknown, key: SigningKey): Promise<string> {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: key.kid, typ: "JWT" })));
  const body = base64url(new TextEncoder().encode(canonicalJson(payload)));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key.privateKey,
    new TextEncoder().encode(`${header}.${body}`),
  );
  return `${header}.${body}.${base64url(new Uint8Array(signature))}`;
}

/** The protected header of a compact JWS, or null when it is not one. */
export function jwsHeader(jws: string): { alg?: string; kid?: string; typ?: string } | null {
  const [header] = jws.split(".");
  try {
    return JSON.parse(new TextDecoder().decode(base64urlDecode(header)));
  } catch {
    return null;
  }
}

/** Verifies a compact ES256 JWS with a public JWK and returns the decoded payload, or null. */
export async function verifyJws(jws: string, publicJwk: JsonWebKey): Promise<unknown | null> {
  const [header, body, signature, extra] = jws.trim().split(".");
  if (!header || !body || !signature || extra !== undefined) return null;
  if (jwsHeader(jws)?.alg !== "ES256") return null;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64urlDecode(signature),
    new TextEncoder().encode(`${header}.${body}`),
  );
  return ok ? JSON.parse(new TextDecoder().decode(base64urlDecode(body))) : null;
}

/** Verifies against the JWKS key whose kid matches the JWS header; null when none matches or verifies. */
export function verifyWithJwks(jws: string, jwks: Jwks): Promise<unknown | null> {
  const kid = jwsHeader(jws)?.kid;
  const key = jwks.keys.find((k) => (k as { kid?: string }).kid === kid);
  return key ? verifyJws(jws, key) : Promise.resolve(null);
}
