/**
 * Canonical JSON: object keys sorted (by UTF-16 code unit, as Array.prototype.sort does) at every
 * level, `undefined` members dropped, no insignificant whitespace. Arrays keep their order.
 * Two parties that canonicalise the same value get byte-identical output, which is what is signed.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        const item = (v as Record<string, unknown>)[key];
        if (item !== undefined) out[key] = sort(item);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
