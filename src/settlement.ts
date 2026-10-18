/**
 * The InvoiceSettlement contract (contracts/src/InvoiceSettlement.sol): pays an invoice in an ERC-20
 * straight from the payer to the seller and emits InvoicePaid(invoiceRef, payer, seller, token,
 * amount), so a payment can be matched to its invoice by reference instead of by a unique amount.
 * Encoding and decoding here need no dependencies.
 */

/** keccak256("InvoicePaid(bytes32,address,address,address,uint256)") */
export const INVOICE_PAID_TOPIC = "0x61bce195b049e2b054583e737888e5987da14266c85874ce393d1bb95b5693fa";
const PAY_SELECTOR = "0x76bbf425"; // pay(bytes32,address,address,uint256)
const APPROVE_SELECTOR = "0x095ea7b3"; // approve(address,uint256)

export interface InvoicePaid {
  invoiceRef: string;
  payer: string;
  seller: string;
  token: string;
  amount: bigint;
  txHash?: string;
  logIndex?: number;
}

const word = (hex: string) => hex.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const isAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);
const uint = (v: bigint) => {
  if (v < 0n || v >= 2n ** 256n) throw new Error(`Not a uint256: ${v}`);
  return v.toString(16).padStart(64, "0");
};
const address = (word32: string) => "0x" + word32.slice(-40).toLowerCase();

/**
 * The 32-byte reference for an invoice: SHA-256 of "invoice-passport/ref:" + an identifier the
 * issuer controls (Billify uses the invoice's public token). Hex, 0x-prefixed.
 */
export async function invoiceRef(id: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`invoice-passport/ref:${id}`));
  return "0x" + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Calldata for pay(invoiceRef, token, seller, amount). */
export function encodePay(ref: string, token: string, seller: string, amount: bigint): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(ref)) throw new Error(`Invoice reference must be 32 bytes hex: ${ref}`);
  if (!isAddress(token) || !isAddress(seller)) throw new Error("Token and seller must be addresses");
  if (amount === 0n) throw new Error("Amount must be positive");
  return PAY_SELECTOR + word(ref) + word(token) + word(seller) + uint(amount);
}

/** Calldata for the token's approve(spender, amount), needed once before pay(). */
export function encodeApprove(spender: string, amount: bigint): string {
  if (!isAddress(spender)) throw new Error("Spender must be an address");
  return APPROVE_SELECTOR + word(spender) + uint(amount);
}

/** Decodes an InvoicePaid log (eth_getLogs / receipt shape); null for any other log. */
export function decodeInvoicePaid(log: {
  topics: string[];
  data: string;
  transactionHash?: string;
  logIndex?: string;
}): InvoicePaid | null {
  if (log.topics[0]?.toLowerCase() !== INVOICE_PAID_TOPIC || log.topics.length !== 4) return null;
  const data = log.data.replace(/^0x/, "");
  if (data.length !== 128) return null;
  return {
    invoiceRef: "0x" + word(log.topics[1]),
    payer: address(log.topics[2]),
    seller: address(log.topics[3]),
    token: address(data.slice(0, 64)),
    amount: BigInt("0x" + data.slice(64, 128)),
    ...(log.transactionHash ? { txHash: log.transactionHash.toLowerCase() } : {}),
    ...(log.logIndex ? { logIndex: Number(BigInt(log.logIndex)) } : {}),
  };
}
