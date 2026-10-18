/**
 * European Central Bank euro foreign exchange reference rates (about 30 currencies, published on
 * TARGET working days around 16:00 CET), from the ECB Data Portal SDMX API — public, no key.
 * Rates are "units of currency per 1 EUR"; other pairs are crossed through the euro.
 */

const ECB_API = "https://data-api.ecb.europa.eu/service/data/EXR";

/** currency → date (YYYY-MM-DD) → units of currency per 1 EUR */
export type EcbTable = Map<string, Map<string, number>>;

/** Parses the API's `format=csvdata` answer (columns include CURRENCY, TIME_PERIOD, OBS_VALUE). */
export function parseEcbCsv(csv: string): EcbTable {
  const [head, ...lines] = csv.trim().split(/\r?\n/);
  const cols = head.split(",");
  const iCur = cols.indexOf("CURRENCY"), iDate = cols.indexOf("TIME_PERIOD"), iVal = cols.indexOf("OBS_VALUE");
  const table: EcbTable = new Map();
  for (const line of lines) {
    const cells = line.split(",");
    const value = Number(cells[iVal]);
    if (!cells[iCur] || !cells[iDate] || !Number.isFinite(value) || value <= 0) continue;
    const series = table.get(cells[iCur]) ?? new Map<string, number>();
    series.set(cells[iDate], value);
    table.set(cells[iCur], series);
  }
  return table;
}

/** Daily reference rates for these currencies (EUR excluded) between two dates. */
export async function fetchEcb(
  currencies: string[],
  start: string,
  end: string,
  fetcher: typeof fetch = fetch,
): Promise<EcbTable> {
  const list = [...new Set(currencies.map((c) => c.toUpperCase()).filter((c) => c !== "EUR"))];
  if (list.length === 0) return new Map();
  const url = `${ECB_API}/D.${list.join("+")}.EUR.SP00.A?startPeriod=${start}&endPeriod=${end}&format=csvdata`;
  const res = await fetcher(url, { headers: { Accept: "text/csv" }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return new Map(); // no observations in the window
  if (!res.ok) throw new Error(`ECB rates unavailable: HTTP ${res.status}`);
  return parseEcbCsv(await res.text());
}

/** Units of `currency` per 1 EUR on the last publication on or before `date`, with that date. */
export function eurRateOnOrBefore(
  table: EcbTable,
  currency: string,
  date: string,
): { rate: number; date: string } | null {
  if (currency === "EUR") return { rate: 1, date };
  let best: { rate: number; date: string } | null = null;
  for (const [d, rate] of table.get(currency) ?? []) {
    if (d <= date && (!best || d > best.date)) best = { rate, date: d };
  }
  return best;
}

/** Units of `to` per 1 unit of `from`, crossed through EUR; null when either side is missing. */
export function ecbCross(
  table: EcbTable,
  from: string,
  to: string,
  date: string,
): { rate: number; date: string } | null {
  const a = eurRateOnOrBefore(table, from, date);
  const b = eurRateOnOrBefore(table, to, date);
  if (!a || !b) return null;
  return { rate: b.rate / a.rate, date: a.date < b.date ? a.date : b.date };
}
