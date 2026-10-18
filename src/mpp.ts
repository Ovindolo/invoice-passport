/**
 * Machine Payments Protocol (MPP): the "Payment" HTTP authentication scheme
 * (draft-httpauth-payment-01) with the "evm" method and "charge" intent (draft-evm-charge-00).
 *   server: 402 + WWW-Authenticate: Payment id=…, realm=…, method="evm", intent="charge", request=…
 *   client: pays, then retries with Authorization: Payment <base64url credential>
 *   server: verifies the binding and the payment, answers 200 + Payment-Receipt
 * Challenges are bound statelessly with HMAC-SHA256 as the spec recommends. For "hash" credentials
 * the payment check is findChargeTransfer() over the transaction receipt's logs.
 */
import { canonicalJson } from "./canonical.ts";

export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface MppChallenge {
  id: string;
  realm: string;
  method: string;
  intent: string;
  /** base64url(JCS(request object)) */
  request: string;
  expires?: string;
  digest?: string;
  description?: string;
  /** base64url(JCS(flat string map)) */
  opaque?: string;
  header?: "Payment-Authorization";
}

export interface MppCredential {
  challenge: MppChallenge;
  source?: string;
  payload: Record<string, unknown>;
}

export type EvmCredentialType = "permit2" | "authorization" | "transaction" | "hash";

export interface EvmChargeRequest {
  amount: string;
  currency: string;
  recipient: string;
  description?: string;
  externalId?: string;
  methodDetails: {
    chainId: number;
    permit2Address: string;
    credentialTypes?: EvmCredentialType[];
    decimals?: number;
  };
}

const enc = new TextEncoder();

export function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? enc.encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** base64url of the JCS serialization, as the spec requires for `request` and `opaque`. */
export const encodeJcs = (value: unknown): string => base64url(canonicalJson(value));

async function hmac(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(input))));
}

/** The challenge id: HMAC-SHA256 over realm|method|intent|request|expires|digest[|header]|opaque. */
export function mppChallengeId(secret: string, c: Omit<MppChallenge, "id">): Promise<string> {
  const slots = [c.realm, c.method, c.intent, c.request, c.expires ?? "", c.digest ?? ""];
  if (c.header) slots.push(c.header);
  slots.push(c.opaque ?? "");
  return hmac(secret, slots.join("|"));
}

export async function createMppChallenge(
  secret: string,
  c: Omit<MppChallenge, "id" | "request" | "opaque"> & { request: unknown; opaque?: Record<string, string> },
): Promise<MppChallenge> {
  const challenge: Omit<MppChallenge, "id"> = {
    realm: c.realm,
    method: c.method,
    intent: c.intent,
    request: encodeJcs(c.request),
    ...(c.expires ? { expires: c.expires } : {}),
    ...(c.digest ? { digest: c.digest } : {}),
    ...(c.description ? { description: c.description } : {}),
    ...(c.opaque ? { opaque: encodeJcs(c.opaque) } : {}),
    ...(c.header ? { header: c.header } : {}),
  };
  return { id: await mppChallengeId(secret, challenge), ...challenge };
}

const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The WWW-Authenticate field value for a challenge. */
export function formatMppChallenge(c: MppChallenge): string {
  const params: [string, string | undefined][] = [
    ["id", c.id],
    ["realm", c.realm],
    ["method", c.method],
    ["intent", c.intent],
    ["request", c.request],
    ["expires", c.expires],
    ["digest", c.digest],
    ["description", c.description],
    ["opaque", c.opaque],
    ["header", c.header],
  ];
  return "Payment " + params.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${quote(v!)}`).join(", ");
}

/** Client side: the Payment challenges in a WWW-Authenticate value (other schemes are skipped). */
export function parseMppChallenges(value: string | null | undefined): MppChallenge[] {
  const out: MppChallenge[] = [];
  const re = /Payment\s+((?:[A-Za-z]+="(?:[^"\\]|\\.)*"\s*,?\s*)+)/g;
  for (const m of (value ?? "").matchAll(re)) {
    const params: Record<string, string> = {};
    for (const p of m[1].matchAll(/([A-Za-z]+)="((?:[^"\\]|\\.)*)"/g)) params[p[1]] = p[2].replace(/\\(.)/g, "$1");
    if (params.id && params.realm && params.method && params.intent && params.request) {
      out.push(params as unknown as MppChallenge);
    }
  }
  return out;
}

/** Client side: the Authorization value for a challenge and a method-specific payload. */
export function mppCredential(challenge: MppChallenge, payload: Record<string, unknown>, source?: string): string {
  return `Payment ${base64url(JSON.stringify({ challenge, payload, ...(source ? { source } : {}) }))}`;
}

/** Decodes "Payment <base64url JSON>"; null when the value is not a Payment credential. */
export function parseMppCredential(value: string | null | undefined): MppCredential | null {
  const m = (value ?? "").trim().match(/^Payment\s+([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const cred = JSON.parse(fromBase64url(m[1])) as MppCredential;
    if (!cred?.challenge?.id || typeof cred.payload !== "object" || cred.payload === null) return null;
    return cred;
  } catch {
    return null;
  }
}

/** Null when the echoed challenge is authentic and unexpired; otherwise the reason. */
export async function verifyMppChallenge(
  secret: string,
  c: MppChallenge,
  now: Date = new Date(),
): Promise<string | null> {
  const { id, description: _description, ...bound } = c;
  if (id !== await mppChallengeId(secret, bound)) return "challenge binding does not match";
  if (c.expires && Date.parse(c.expires) <= now.getTime()) return "challenge expired";
  return null;
}

export function evmChargeRequest(r: {
  amount: string;
  currency: string;
  recipient: string;
  chainId: number;
  decimals?: number;
  externalId?: string;
  description?: string;
  credentialTypes?: EvmCredentialType[];
}): EvmChargeRequest {
  return {
    amount: r.amount,
    currency: r.currency,
    recipient: r.recipient,
    ...(r.description ? { description: r.description } : {}),
    ...(r.externalId ? { externalId: r.externalId } : {}),
    methodDetails: {
      chainId: r.chainId,
      permit2Address: PERMIT2_ADDRESS,
      ...(r.credentialTypes ? { credentialTypes: r.credentialTypes } : {}),
      ...(r.decimals !== undefined ? { decimals: r.decimals } : {}),
    },
  };
}

export interface ReceiptLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: string;
}

/** The ERC-20 Transfer log paying exactly `amount` of `currency` to `recipient`, or null. */
export function findChargeTransfer(
  logs: ReceiptLog[],
  want: { currency: string; recipient: string; amount: string },
): { logIndex: number; from: string } | null {
  const to = "0x" + want.recipient.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const log = logs.find((l) =>
    l.address.toLowerCase() === want.currency.toLowerCase() && l.topics[0] === TRANSFER_TOPIC &&
    l.topics[2]?.toLowerCase() === to && BigInt(l.data) === BigInt(want.amount)
  );
  return log ? { logIndex: Number(BigInt(log.logIndex)), from: "0x" + log.topics[1].slice(-40).toLowerCase() } : null;
}

/** The Payment-Receipt field value for an evm charge. */
export function mppReceipt(r: {
  challengeId: string;
  reference: string;
  chainId: number;
  timestamp: string;
  externalId?: string;
}): string {
  return base64url(JSON.stringify({
    status: "success",
    method: "evm",
    challengeId: r.challengeId,
    reference: r.reference,
    chainId: r.chainId,
    timestamp: r.timestamp,
    ...(r.externalId ? { externalId: r.externalId } : {}),
  }));
}
