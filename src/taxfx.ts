/**
 * The rate for showing VAT/GST in the seller's local currency when the invoice is in another one,
 * from the source each jurisdiction accepts:
 * - Romania: BNR, last fixing before the invoice date (Romanian Fiscal Code);
 * - other EU states: the latest ECB reference rate (Art. 91(2), Directive 2006/112/EC);
 * - United Kingdom: the HMRC monthly period rate (VAT Notice 700, section 16);
 * - UAE: the CBUAE USD peg (3.6725 AED per USD); other currencies via the ECB cross to USD, flagged;
 * - Singapore: the ECB cross rate, flagged, since IRAS asks for an approved source used consistently.
 * Stablecoins priced in USD (USDT, USDC, USDG) use the USD rate.
 */
import { bnrRateBefore } from "./bnr.ts";
import { ecbCross, fetchEcb } from "./ecb.ts";
import { detectJurisdiction, isEuMember } from "./jurisdictions.ts";

/** AED per USD, fixed by the Central Bank of the UAE since 1997. */
export const AED_PER_USD = 3.6725;

export interface LocalTaxRate {
  /** the currency the tax must also be shown in */
  currency: string;
  /** units of `currency` per 1 unit of the invoice currency, 6 decimals */
  rate: number;
  /** date (or first day of the period) of the rate used */
  date: string;
  source: string;
  /** the currency actually priced (USD for stablecoins) */
  basis: string;
  /** set when the seller should confirm the source */
  note: string | null;
}

export interface TaxFxDeps {
  fetcher?: typeof fetch;
  bnr?: (currency: string, date: string) => Promise<{ rate: number; date: string } | null>;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const basisOf = (currency: string) => (/^(USDT|USDC|USDG)/.test(currency) ? "USD" : currency);
const minusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** HMRC monthly rates CSV ("Currency Units per £1") → currency → units per GBP. */
export function parseHmrcCsv(csv: string): Map<string, number> {
  const rates = new Map<string, number>();
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const cells = line.split(",");
    const code = cells[2]?.trim(), value = Number(cells[3]);
    if (/^[A-Z]{3}$/.test(code ?? "") && value > 0) rates.set(code!, value);
  }
  return rates;
}

/** HMRC monthly exchange rates for a month ("YYYY-MM"), published by the UK Trade Tariff service. */
export async function fetchHmrcMonth(month: string, fetcher: typeof fetch = fetch): Promise<Map<string, number>> {
  const url = `https://www.trade-tariff.service.gov.uk/api/v2/exchange_rates/files/monthly_csv_${month}.csv`;
  const res = await fetcher(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HMRC rates unavailable: HTTP ${res.status}`);
  return parseHmrcCsv(await res.text());
}

/**
 * The local-currency rate for the tax on an invoice, or null when the seller's jurisdiction has no
 * such rule or the invoice is already in the local currency. Throws when a source is unreachable.
 */
export async function localTaxRate(
  sellerCountry: string | null,
  invoiceCurrency: string,
  date: string,
  deps: TaxFxDeps = {},
): Promise<LocalTaxRate | null> {
  const j = detectJurisdiction(sellerCountry, null);
  if (!j?.localTaxCurrency) return null;
  const local = j.localTaxCurrency.currency;
  const basis = basisOf(invoiceCurrency.toUpperCase());
  if (basis === local) return null;
  const fetcher = deps.fetcher ?? fetch;
  const ecb = async (to: string) => {
    const table = await fetchEcb([basis, to], minusDays(date, 14), date, fetcher);
    return ecbCross(table, basis, to, date);
  };
  const out = (rate: number, rateDate: string, source: string, note: string | null = null): LocalTaxRate => ({
    currency: local,
    rate: round6(rate),
    date: rateDate,
    source,
    basis,
    note,
  });

  if (j.code === "RO") {
    const r = await (deps.bnr ?? bnrRateBefore)(basis, date);
    return r ? out(r.rate, r.date, "BNR") : null;
  }
  if (j.code === "GB") {
    const month = date.slice(0, 7);
    const perGbp = (await fetchHmrcMonth(month, fetcher)).get(basis);
    return perGbp ? out(1 / perGbp, `${month}-01`, "HMRC monthly rate") : null;
  }
  if (j.code === "AE") {
    if (basis === "USD") return out(AED_PER_USD, date, "CBUAE USD peg");
    const usd = await ecb("USD");
    return usd
      ? out(
        usd.rate * AED_PER_USD,
        usd.date,
        "ECB cross to USD × CBUAE peg",
        "Check against the CBUAE rate for the date of supply.",
      )
      : null;
  }
  if (isEuMember(j.code) || j.code === "SG") {
    const r = await ecb(local);
    if (!r) return null;
    return j.code === "SG"
      ? out(
        r.rate,
        r.date,
        "ECB reference rate",
        "IRAS asks for an approved rate source used consistently; confirm this one is yours.",
      )
      : out(r.rate, r.date, "ECB reference rate (Art. 91(2) VAT Directive)");
  }
  return null;
}
