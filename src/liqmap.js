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
      buckets.push({ from: lo, to: hi, offPct: off, longUsd: sum(longs), shortUsd: sum(shorts), n: longs.length + shorts.length });
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
  for (const b of [...map.buckets].sort((a, b) => b.offPct - a.offPct)) {
    const size = b.longUsd + b.shortUsd;
    const bar = '#'.repeat(Math.max(1, Math.round((size / max) * width)));
    const side = b.longUsd > b.shortUsd ? 'long ' : 'short';
    const here = Math.abs(b.offPct) <= 1 ? ' <- price' : '';
    lines.push(`${String(b.offPct > 0 ? '+' + b.offPct : b.offPct).padStart(4)}%  ${px(b.from).padStart(9)}  ${side} ${usd(size).padStart(8)}  ${bar}${here}`);
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
    up: map.up && { from: map.up.from, usd: map.up.longUsd + map.up.shortUsd },
    down: map.down && { from: map.down.from, usd: map.down.longUsd + map.down.shortUsd },
    densest: map.densest && { from: map.densest.from, off: map.densest.offPct, longUsd: map.densest.longUsd, shortUsd: map.densest.shortUsd },
    worst: loser && { side: loser.side, usd: loser.usd, entry: loser.entry, liq: loser.liq, upnl: loser.upnl },
    buckets: map.buckets.map((b) => [b.offPct, Math.round(b.longUsd), Math.round(b.shortUsd)]),
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
