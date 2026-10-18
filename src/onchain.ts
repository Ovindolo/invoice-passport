/**
 * Direct stablecoin payments to the seller's own wallet (no processor in between).
 *
 * A stablecoin transfer carries no memo, so the invoice is identified by the amount: each invoice
 * gets a unique pay amount, its total plus a tag of 1–9999 millionths derived from the invoice id
 * (100.00 USD → 100.004213 USDC). The payer sends exactly that; the matcher pairs the ERC-20
 * Transfer log with the invoice. Transfers of other amounts are kept as suggestions for a person.
 */
import type { PaymentEvidence } from "./passport.ts";

export type Chain = "base" | "ethereum" | "bsc" | "robinhood";

export interface Stablecoin {
  chain: Chain;
  asset: "USDC" | "USDT" | "USDG";
  /** contract address, lower case */
  address: string;
  decimals: number;
}

/** Verified on-chain (symbol() and decimals()) on 2026-10-17 / 2026-10-18. */
export const STABLECOINS: Stablecoin[] = [
  { chain: "base", asset: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
  { chain: "base", asset: "USDT", address: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", decimals: 6 },
  { chain: "ethereum", asset: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
  { chain: "ethereum", asset: "USDT", address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
  { chain: "bsc", asset: "USDT", address: "0x55d398326f99059ff775485246999027b3197955", decimals: 18 },
  { chain: "bsc", asset: "USDC", address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", decimals: 18 },
  // Robinhood Chain (chain id 4663): Paxos Global Dollar, verified on-chain 2026-10-18.
  { chain: "robinhood", asset: "USDG", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", decimals: 6 },
];

export const CHAIN_NAMES: Record<Chain, string> = {
  base: "Base",
  ethereum: "Ethereum",
  bsc: "BNB Chain",
  robinhood: "Robinhood Chain",
};

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** Invoice currencies a USD stablecoin can settle 1:1. */
export const USD_CURRENCIES = ["USD", "USDC", "USDT", "USDG"];

export const isEvmAddress = (v: string | null | undefined): v is string => !!v && /^0x[0-9a-fA-F]{40}$/.test(v.trim());

/** Maps a stored network label ("base", "USDT / ERC20", "BEP20", …) to a supported chain. */
export function parseChain(network: string | null | undefined): Chain | null {
  const n = String(network ?? "").toLowerCase();
  if (/robinhood/.test(n)) return "robinhood";
  if (/\bbase\b/.test(n)) return "base";
  if (/bep-?20|\bbsc\b|\bbnb\b/.test(n)) return "bsc";
  if (/erc-?20|\beth(ereum)?\b/.test(n)) return "ethereum";
  return null;
}

/** 32-byte topic for an address (left-padded). */
export const addressTopic = (address: string): string =>
  "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/** FNV-1a 32-bit; small, synchronous and identical in every runtime (the browser shows the same amount). */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Unique amount to pay, in millionths of a USD stablecoin: total + tag (1–9999). */
export function uniquePayMicros(invoiceId: string, total: number): bigint {
  const tag = (fnv1a(invoiceId) % 9999) + 1;
  return BigInt(Math.round(total * 100)) * 10_000n + BigInt(tag);
}

/** "100.004213" */
export function formatMicros(micros: bigint): string {
  const s = micros.toString().padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`;
}

export function uniquePayAmount(invoiceId: string, total: number): string {
  return formatMicros(uniquePayMicros(invoiceId, total));
}

export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  removed?: boolean;
}

export interface OnchainTransfer {
  chain: Chain;
  asset: Stablecoin["asset"];
  token: string;
  from: string;
  to: string;
  /** raw token units */
  value: bigint;
  /** millionths, or null when the value has more precision than 6 decimals */
  micros: bigint | null;
  blockNumber: number;
  txHash: string;
  logIndex: number;
}

const topicAddress = (topic: string) => "0x" + topic.slice(-40).toLowerCase();

/** Decodes an ERC-20 Transfer log of a known stablecoin; null for anything else. */
export function decodeTransfer(chain: Chain, log: RpcLog): OnchainTransfer | null {
  if (log.removed) return null;
  const coin = STABLECOINS.find((c) => c.chain === chain && c.address === log.address.toLowerCase());
  if (!coin || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics.length !== 3) return null;
  const value = BigInt(log.data === "0x" ? 0 : log.data);
  const scale = 10n ** BigInt(coin.decimals - 6);
  return {
    chain,
    asset: coin.asset,
    token: coin.address,
    from: topicAddress(log.topics[1]),
    to: topicAddress(log.topics[2]),
    value,
    micros: value % scale === 0n ? value / scale : null,
    blockNumber: Number(BigInt(log.blockNumber)),
    txHash: log.transactionHash.toLowerCase(),
    logIndex: Number(BigInt(log.logIndex)),
  };
}

/** Human amount of a transfer ("100.004213"), exact for any decimals. */
export function transferAmount(t: OnchainTransfer): string {
  const decimals = STABLECOINS.find((c) => c.chain === t.chain && c.address === t.token)?.decimals ?? 6;
  const s = t.value.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export interface OpenCryptoInvoice {
  id: string;
  number: string;
  total: number;
  currency: string;
}

export interface OnchainMatch {
  transfer: OnchainTransfer;
  invoice: OpenCryptoInvoice | null;
  /** exact: unique amount, auto-applied; amount: equals an invoice total, needs confirmation */
  method: "exact" | "amount" | null;
}

/**
 * Pairs incoming transfers with open USD invoices. Exact unique amounts are matched automatically;
 * a transfer equal to exactly one invoice's plain total becomes a suggestion; everything else is
 * returned unmatched. Each invoice is used at most once.
 */
export function matchTransfers(transfers: OnchainTransfer[], invoices: OpenCryptoInvoice[]): OnchainMatch[] {
  const open = invoices.filter((i) => USD_CURRENCIES.includes(i.currency.toUpperCase()));
  const used = new Set<string>();
  const out: OnchainMatch[] = [];
  for (const t of transfers) {
    const exact = t.micros === null
      ? undefined
      : open.find((i) => !used.has(i.id) && uniquePayMicros(i.id, i.total) === t.micros);
    if (exact) {
      used.add(exact.id);
      out.push({ transfer: t, invoice: exact, method: "exact" });
      continue;
    }
    const byTotal = t.micros === null
      ? []
      : open.filter((i) => !used.has(i.id) && BigInt(Math.round(i.total * 100)) * 10_000n === t.micros);
    out.push(
      byTotal.length === 1
        ? { transfer: t, invoice: byTotal[0], method: "amount" }
        : { transfer: t, invoice: null, method: null },
    );
  }
  return out;
}

/** `onchain` passport evidence for a matched transfer. */
export function onchainEvidence(t: OnchainTransfer, recordedAt: string, method: string): PaymentEvidence {
  return {
    rail: "onchain",
    chain: t.chain,
    asset: t.asset,
    amount: Number(transferAmount(t)),
    tx_hash: t.txHash,
    log_index: t.logIndex,
    from_address: t.from,
    to_address: t.to,
    block_number: t.blockNumber,
    match_method: method,
    recorded_at: recordedAt,
  };
}
