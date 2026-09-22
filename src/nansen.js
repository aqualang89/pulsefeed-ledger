// Minimal Nansen API client. Auth header is `apikey`, lowercase, not Authorization/Bearer.
// Free tier works: create a key at app.nansen.ai/api and put it in .env as NANSEN_API_KEY.
const BASE = 'https://api.nansen.ai/api/v1';

export async function nansen(path, body, { method = 'POST', timeout = 25000 } = {}) {
  const key = process.env.NANSEN_API_KEY;
  if (!key) throw new Error('NANSEN_API_KEY is not set (copy .env.example to .env)');
  const r = await fetch(BASE + path, {
    method,
    headers: { apikey: key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`Nansen ${path} ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.json();
}

export async function account() {
  const j = await nansen('/account', null, { method: 'GET' });
  return { plan: j.plan, credits: j.credits_remaining ?? j.credits };
}

// Open perp positions for one asset on Hyperliquid. 5 credits per call regardless of page size,
// so ask for the full 100: a map built from 100 positions costs the same as one built from 20.
export async function perpPositions(symbol, perPage = 100) {
  const j = await nansen('/tgm/perp-positions', { token_symbol: symbol, pagination: { page: 1, per_page: perPage } });
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  return (j?.data || []).map((p) => ({
    addr: p.address,
    label: p.address_label || null,
    side: /short/i.test(p.side) ? 'short' : 'long',
    usd: num(p.position_value_usd),
    size: num(p.position_size),
    lev: p.leverage || null,
    entry: num(p.entry_price),
    mark: num(p.mark_price),
    liq: num(p.liquidation_price),
    funding: num(p.funding_usd),
    upnl: num(p.upnl_usd),
  })).filter((p) => p.usd > 0 && p.liq > 0);
}
