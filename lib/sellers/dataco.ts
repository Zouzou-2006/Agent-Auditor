// DataCo: the honest fake seller (beat 1). Owner: Fabi. See SPEC.md section 6.
//
// Charges $0.10 (100000 base units) for a price quote and, once paid, returns clean JSON:
//   {"ticker":"SOL","date":"2026-11-14","price_usd":142.10,"source":"DataCo"}
// A bad request (unknown ticker, bad date) gets a 400 BEFORE any quote, so nobody is ever
// charged for data DataCo can't deliver.

import {
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  buildRequirements,
  encodeHeader,
  paymentRequiredResponse,
  verifyAndSettle,
} from "./x402";

export const DATACO_PRICE = 100000; // $0.10 in USDC base units

// Fake but fixed prices, so the same request always returns the same answer.
const PRICES_USD: Record<string, number> = {
  SOL: 142.1,
  BTC: 98250.0,
  ETH: 3420.55,
  USDC: 1.0,
};

export interface PriceQuote {
  ticker: string;
  date: string;
  price_usd: number;
  source: "DataCo";
}

type Parsed = { ok: true; ticker: string; date: string } | { ok: false; error: string };

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function parseParams(search: URLSearchParams): Parsed {
  const ticker = search.get("ticker");
  const date = search.get("date");
  if (!ticker || !date) return { ok: false, error: "ticker and date are required" };
  if (!(ticker in PRICES_USD)) return { ok: false, error: `unknown ticker ${ticker}` };
  if (!isIsoDate(date)) return { ok: false, error: "date must be YYYY-MM-DD" };
  return { ok: true, ticker, date };
}

export function priceQuote(ticker: string, date: string): PriceQuote {
  return { ticker, date, price_usd: PRICES_USD[ticker], source: "DataCo" };
}

export async function handleDataCo(req: Request): Promise<Response> {
  const wallet = process.env.DATACO_WALLET;
  if (!wallet) {
    return Response.json({ error: "DATACO_WALLET is not set (see .env.example)" }, { status: 500 });
  }

  const url = new URL(req.url);
  const parsed = parseParams(url.searchParams);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const requirements = await buildRequirements(DATACO_PRICE, wallet);
  const resource = {
    url: url.toString(),
    description: `DataCo ${parsed.ticker} price quote for ${parsed.date}`,
    mimeType: "application/json",
  };

  const payment = req.headers.get(PAYMENT_SIGNATURE_HEADER);
  if (!payment) return paymentRequiredResponse(requirements, resource);

  const settled = await verifyAndSettle(payment, requirements);
  if (!settled.ok) return paymentRequiredResponse(requirements, resource, settled.reason);

  return Response.json(priceQuote(parsed.ticker, parsed.date), {
    headers: {
      [PAYMENT_RESPONSE_HEADER]: encodeHeader({
        success: true,
        transaction: settled.transaction,
        network: settled.network,
        payer: settled.payer,
      }),
    },
  });
}
