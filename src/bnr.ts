/**
 * National Bank of Romania reference rates (RON per unit of currency).
 * Feed host moved to curs.bnr.ro in 2026; the XML namespace changed from http:// to https://,
 * so parsing ignores namespaces.
 */

const BNR_HOST = "https://curs.bnr.ro";

/** date (YYYY-MM-DD) → currency → RON per 1 unit */
export type RateTable = Map<string, Map<string, number>>;

export function parseBnrXml(xml: string): RateTable {
  const table: RateTable = new Map();
  const cubeRe = /<Cube\s+date="(\d{4}-\d{2}-\d{2})"\s*>([\s\S]*?)<\/Cube>/g;
  const rateRe = /<Rate\s+currency="([A-Z]{3})"(?:\s+multiplier="(\d+)")?\s*>([\d.]+)<\/Rate>/g;
  for (const cube of xml.matchAll(cubeRe)) {
    const rates = new Map<string, number>();
    for (const r of cube[2].matchAll(rateRe)) {
      const multiplier = r[2] ? Number(r[2]) : 1;
      rates.set(r[1], Number(r[3]) / multiplier);
    }
    table.set(cube[1], rates);
  }
  return table;
}

const yearCache = new Map<number, Promise<RateTable>>();

export function fetchYear(year: number): Promise<RateTable> {
  let cached = yearCache.get(year);
  if (!cached) {
    cached = (async () => {
      const res = await fetch(`${BNR_HOST}/files/xml/years/nbrfxrates${year}.xml`, {
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.text();
      if (!res.ok || !body.includes("<DataSet")) {
        throw new Error(`BNR rates for ${year} unavailable (HTTP ${res.status})`);
      }
      return parseBnrXml(body);
    })();
    cached.catch(() => yearCache.delete(year));
    yearCache.set(year, cached);
  }
  return cached;
}

export interface BnrRate {
  /** RON per 1 unit of `basis` */
  rate: number;
  /** date of the BNR fixing used */
  date: string;
  /** currency the rate is for (USDT/USDC use USD) */
  basis: string;
}

/** Stablecoins are converted at the USD rate (BNR publishes no rate for them). */
export function bnrBasis(currency: string): string {
  const c = currency.trim().toUpperCase();
  if (c.startsWith("USDT") || c.startsWith("USDC")) return "USD";
  return c;
}

/**
 * The last BNR reference rate published strictly before `operationDate` (YYYY-MM-DD), the rate
 * Romanian tax rules use for a foreign-currency operation. Looks back into the previous year.
 */
export function rateBefore(tables: RateTable[], currency: string, operationDate: string): BnrRate | null {
  const basis = bnrBasis(currency);
  if (basis === "RON") return { rate: 1, date: operationDate, basis };
  let best: BnrRate | null = null;
  for (const table of tables) {
    for (const [date, rates] of table) {
      if (date >= operationDate) continue;
      const rate = rates.get(basis);
      if (rate === undefined) continue;
      if (!best || date > best.date) best = { rate, date, basis };
    }
  }
  return best;
}

export async function bnrRateBefore(currency: string, operationDate: string): Promise<BnrRate | null> {
  if (bnrBasis(currency) === "RON") return rateBefore([], currency, operationDate);
  const year = Number(operationDate.slice(0, 4));
  const tables = await Promise.all([fetchYear(year), fetchYear(year - 1).catch(() => new Map() as RateTable)]);
  return rateBefore(tables, currency, operationDate);
}
