import {
  createMppChallenge,
  encodeJcs,
  evmChargeRequest,
  findChargeTransfer,
  formatMppChallenge,
  fromBase64url,
  mppChallengeId,
  mppCredential,
  mppReceipt,
  parseMppChallenges,
  parseMppCredential,
  verifyMppChallenge,
} from "../src/mpp.ts";

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

const secret = "test-vector-secret";
const request = encodeJcs({ amount: "1000000" });

Deno.test("HMAC challenge ids match the spec test vectors", async () => {
  assert(request === "eyJhbW91bnQiOiIxMDAwMDAwIn0", request);
  const base = { realm: "api.example.com", method: "tempo", intent: "charge", request };
  assert(await mppChallengeId(secret, base) === "X6v1eo7fJ76gAxqY0xN9Jd__4lUyDDYmriryOM-5FO4", "legacy layout");
  assert(
    await mppChallengeId(secret, { ...base, header: "Payment-Authorization" }) ===
      "S91xi-OFGZPMs-j7GsX0FDpIkmCcZT1P9XyV58WNy_U",
    "header layout",
  );
  assert(encodeJcs({ pi: "pi_123" }) === "eyJwaSI6InBpXzEyMyJ9");
});

Deno.test("a challenge round-trips through the header, the credential and verification", async () => {
  const req = evmChargeRequest({
    amount: "1500123",
    currency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
    chainId: 8453,
    decimals: 6,
    externalId: "INV-7",
    credentialTypes: ["hash"],
  });
  const c = await createMppChallenge("s3cret", {
    realm: "billify.org",
    method: "evm",
    intent: "charge",
    request: req,
    expires: "2030-01-01T00:00:00Z",
    description: 'Invoice "INV-7"',
  });
  const header = formatMppChallenge(c);
  assert(header.startsWith(`Payment id="${c.id}", realm="billify.org", method="evm"`), header);
  assert(header.includes('description="Invoice \\"INV-7\\""'), header);
  assert(JSON.parse(fromBase64url(c.request)).methodDetails.chainId === 8453);

  const credential = btoa(JSON.stringify({ challenge: c, payload: { type: "hash", hash: "0xabc" } }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const parsed = parseMppCredential(`Payment ${credential}`)!;
  assert(parsed.payload.type === "hash");
  assert(await verifyMppChallenge("s3cret", parsed.challenge) === null, "authentic");
  assert(await verifyMppChallenge("other", parsed.challenge) !== null, "wrong secret");
  const tampered = { ...parsed.challenge, request: encodeJcs({ ...req, amount: "1" }) };
  assert(await verifyMppChallenge("s3cret", tampered) !== null, "tampered request");
  assert(await verifyMppChallenge("s3cret", parsed.challenge, new Date("2031-01-01")) === "challenge expired");
  assert(parseMppCredential("Bearer abc") === null && parseMppCredential("Payment !!!") === null);
});

Deno.test("findChargeTransfer matches token, recipient and exact amount", () => {
  const recipient = "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00";
  const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const log = (amount: bigint, to = recipient) => ({
    address: usdc.toLowerCase(),
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x0000000000000000000000001234567890abcdef1234567890abcdef12345678",
      "0x" + to.toLowerCase().slice(2).padStart(64, "0"),
    ],
    data: "0x" + amount.toString(16).padStart(64, "0"),
    logIndex: "0x5",
  });
  const hit = findChargeTransfer([log(1n), log(1500123n)], { currency: usdc, recipient, amount: "1500123" });
  assert(hit?.logIndex === 5 && hit.from === "0x1234567890abcdef1234567890abcdef12345678", JSON.stringify(hit));
  assert(findChargeTransfer([log(1500124n)], { currency: usdc, recipient, amount: "1500123" }) === null);
  const receipt = JSON.parse(
    fromBase64url(
      mppReceipt({ challengeId: "c1", reference: "0xabc", chainId: 8453, timestamp: "2026-10-18T00:00:00Z" }),
    ),
  );
  assert(receipt.status === "success" && receipt.method === "evm");
});

Deno.test("client side: challenges parse back from WWW-Authenticate and credentials verify", async () => {
  const c = await createMppChallenge("k", {
    realm: "billify.org",
    method: "evm",
    intent: "charge",
    request: { amount: "1" },
    description: 'Invoice "A, B"',
    expires: "2030-01-01T00:00:00Z",
  });
  const header = `Bearer realm="x", ${formatMppChallenge(c)}`;
  const [parsed] = parseMppChallenges(header);
  assert(parsed.id === c.id && parsed.description === 'Invoice "A, B"', JSON.stringify(parsed));
  const cred = parseMppCredential(mppCredential(parsed, { type: "hash", hash: "0x1" }, "did:pkh:eip155:8453:0xabc"))!;
  assert(cred.source === "did:pkh:eip155:8453:0xabc");
  assert(await verifyMppChallenge("k", cred.challenge) === null);
});
