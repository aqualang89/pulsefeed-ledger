// Liquidation map: where open positions get force-closed, and how that changes over time.
//
// Every liquidation chart on the internet is a snapshot of now. The useful part is the movement:
// a wall that doubles while price stands still means someone is adding into it, and a wall that
// halves in twenty minutes means someone closed before price ever arrived. You only see that if
// you keep taking snapshots, which is what `watch` does.
//
// Longs liquidate below price, shorts liquidate above. They are bucketed separately on purpose:
// merged into one histogram you can no longer tell which direction hurts whom.
import fs from 'fs';

// A position is "named" when the wallet has an identity: an ENS name, a fund, an entity, or a Nansen
// Smart Money tag. Money on named wallets is the part of a wall you can reason about: an anonymous
// $40M could be anyone, $40M on zolpi.eth is a specific counterparty you can go and look up.
//
// Most Nansen labels on perp wallets are behaviour categories, not names, and counting them makes the
// layer useless. On a live BTC+ETH pull (23 Sep 2026) every one of the 96 largest wallets had a label:
// "HL Perps Whale" (83, true of anyone in a top-100 list), "Uses <code> HL Referral Code" (70),
// "High Activity", "High Balance", "Token Millionaire". Real names were a handful of ENS wallets.
const CATEGORY = /referral code|hl perps (whale|shark)|high activity|high balance|token millionaire|^(whale|shark)$/i;
export const isNamed = (r) => !!r.label && !/^0x[0-9a-f]{6,}/i.test(r.label) && !CATEGORY.test(r.label);

export function liquidationMap(rows, { step = 2, range = 20 } = {}) {
  const mark = rows.find((r) => r.mark > 0)?.mark || 0;
  if (!mark) return null;

  const buckets = [];
  for (let off = -range; off < range; off += step) {
    const lo = mark * (1 + off / 100);
    const hi = mark * (1 + (off + step) / 100);
    const within = (r) => r.liq >= lo && r.liq < hi;
    const longs = rows.filter((r) => r.side === 'long' && within(r));
    const shorts = rows.filter((r) => r.side === 'short' && within(r));
    const sum = (a) => a.reduce((s, r) => s + r.usd, 0);
    if (longs.length || shorts.length) {
      const namedUsd = sum([...longs, ...shorts].filter(isNamed));
      buckets.push({ from: lo, to: hi, offPct: off, longUsd: sum(longs), shortUsd: sum(shorts), namedUsd, n: longs.length + shorts.length });
    }
  }

  const total = (b) => b.longUsd + b.shortUsd;
  const densest = [...buckets].sort((a, b) => total(b) - total(a))[0] || null;
  // nearest wall in each direction: these are the ones that matter in the next hours
  const up = buckets.filter((b) => b.offPct >= 0 && total(b) > 0).sort((a, b) => a.offPct - b.offPct)[0] || null;
  const down = buckets.filter((b) => b.offPct < 0 && total(b) > 0).sort((a, b) => b.offPct - a.offPct)[0] || null;

  return {
    mark,
    buckets,
    densest,
    up,
    down,
    n: rows.length,
    longTotal: rows.filter((r) => r.side === 'long').reduce((s, r) => s + r.usd, 0),
    shortTotal: rows.filter((r) => r.side === 'short').reduce((s, r) => s + r.usd, 0),
    namedTotal: rows.filter(isNamed).reduce((s, r) => s + r.usd, 0),
    namedCount: rows.filter(isNamed).length,
    named: rows.filter(isNamed).sort((a, b) => b.usd - a.usd),
  };
}

// The account bleeding the most and the one printing the most, right now.
export function extremes(rows) {
  const byPnl = [...rows].sort((a, b) => a.upnl - b.upnl);
  return { loser: byPnl[0] || null, winner: byPnl[byPnl.length - 1] || null };
}

export const usd = (v) => {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${Math.round(a / 1e3)}K`;
};

export const px = (v) => `$${v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)}`;

// Terminal rendering. Bar length is relative to the fattest bucket in the map.
export function renderMap(map, { width = 34 } = {}) {
  const max = Math.max(...map.buckets.map((b) => b.longUsd + b.shortUsd), 1);
  const lines = [`${px(map.mark)}  ${map.n} accounts  longs ${usd(map.longTotal)} / shorts ${usd(map.shortTotal)}`];
  if (map.namedCount) lines.push(`${usd(map.namedTotal)} of it sits on ${map.namedCount} wallets Nansen has a name for (* in the bars)`);
  for (const b of [...map.buckets].sort((a, b) => b.offPct - a.offPct)) {
    const size = b.longUsd + b.shortUsd;
    const len = Math.max(1, Math.round((size / max) * width));
    const star = Math.min(len, Math.round(((b.namedUsd || 0) / max) * width));
    const bar = '*'.repeat(star) + '#'.repeat(len - star);
    const side = b.longUsd > b.shortUsd ? 'long ' : 'short';
    const here = Math.abs(b.offPct) <= 1 ? ' <- price' : '';
    const named = b.namedUsd ? `  named ${usd(b.namedUsd)}` : '';
    lines.push(`${String(b.offPct > 0 ? '+' + b.offPct : b.offPct).padStart(4)}%  ${px(b.from).padStart(9)}  ${side} ${usd(size).padStart(8)}  ${bar}${here}${named}`);
  }
  return lines.join('\n');
}

// One snapshot per line, append-only. Keeping the raw buckets means the history stays useful
// even if the questions change later.
export function appendSnapshot(file, sym, map, rows) {
  const { loser } = extremes(rows);
  const rec = {
    t: Date.now(),
    sym,
    mark: map.mark,
    n: map.n,
    longTotal: map.longTotal,
    shortTotal: map.shortTotal,
    up: map.up && { from: map.up.from, usd: map.up.longUsd + map.up.shortUsd, named: Math.round(map.up.namedUsd || 0) },
    down: map.down && { from: map.down.from, usd: map.down.longUsd + map.down.shortUsd, named: Math.round(map.down.namedUsd || 0) },
    namedTotal: Math.round(map.namedTotal || 0),
    densest: map.densest && { from: map.densest.from, off: map.densest.offPct, longUsd: map.densest.longUsd, shortUsd: map.densest.shortUsd },
    worst: loser && { side: loser.side, usd: loser.usd, entry: loser.entry, liq: loser.liq, upnl: loser.upnl },
    buckets: map.buckets.map((b) => [b.offPct, Math.round(b.longUsd), Math.round(b.shortUsd), Math.round(b.namedUsd || 0)]),
  };
  fs.appendFileSync(file, JSON.stringify(rec) + '\n');
  return rec;
}

// What changed between the first and last snapshot in a window: the whole point of keeping history.
export function wallHistory(file, sym, hours = 6) {
  if (!fs.existsSync(file)) return null;
  const cut = Date.now() - hours * 3600e3;
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n')
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && r.sym === sym && r.t >= cut);
  if (rows.length < 2) return null;
  const first = rows[0], last = rows[rows.length - 1];
  const ratio = (a, b) => (a && b && a.usd > 0 ? b.usd / a.usd : null);
  return {
    snapshots: rows.length,
    minutes: Math.round((last.t - first.t) / 60000),
    priceFrom: first.mark,
    priceTo: last.mark,
    upFrom: first.up,
    upTo: last.up,
    downFrom: first.down,
    downTo: last.down,
    upRatio: ratio(first.up, last.up),
    downRatio: ratio(first.down, last.down),
  };
}
