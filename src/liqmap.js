// Liquidation map: where open positions get force-closed, and how that changes over time.
//
// Every liquidation chart on the internet is a snapshot of now. The useful part is the movement:
// a wall that doubles while price stands still means someone is adding into it, and a wall that
// halves in twenty minutes means someone closed before price ever arrived. You only see that if
// you keep taking snapshots, which is what `watch` does.
//
// Longs liquidate below price, shorts liquidate above. They are bucketed separately on purpose:
// merged into one histogram you can no longer tell which direction hurts whom.
//
// Correction, 26 Sep 2026. The first version compared "the nearest wall above price" between two
// snapshots. That wall is a window measured FROM the current price, so when price moves the window
// moves with it and swallows positions that were always there. Our published example (a BTC wall
// "growing" from $29.5M to $49.1M in 46 minutes) was that artifact: across those 46 minutes the
// total of all tracked shorts rose by $4M, and the "wall" flipped between $6.3M and $59.7M from one
// minute to the next as price wiggled. Snapshots now also keep `levels`, liquidations summed on a
// grid of FIXED prices, and history compares the same price levels at both ends.
import fs from 'fs';

// Grid step for fixed levels: a thousandth of the price's order of magnitude ($10 for BTC at 86k,
// $1 for ETH at 3k). It only changes when price crosses a power of ten, so two snapshots of the same
// asset almost always share the grid and a zone sum means the same thing at both ends.
export const levelStep = (mark) => 10 ** (Math.floor(Math.log10(mark)) - 3);

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

  const bin = levelStep(mark);
  const grid = new Map();
  for (const r of rows) {
    if (!(r.liq > 0) || Math.abs(r.liq / mark - 1) * 100 > range) continue;
    const at = Math.floor(r.liq / bin) * bin;
    const g = grid.get(at) || [0, 0];
    g[r.side === 'long' ? 0 : 1] += r.usd;
    grid.set(at, g);
  }
  const levels = [...grid].sort((a, b) => a[0] - b[0]).map(([at, [l, s]]) => [+at.toFixed(6), Math.round(l), Math.round(s)]);

  return {
    mark,
    buckets,
    densest,
    up,
    down,
    bin,
    levels,
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
export function appendSnapshot(file, sym, map, rows, t = Date.now()) {
  const { loser } = extremes(rows);
  const rec = {
    t,
    sym,
    mark: map.mark,
    n: map.n,
    longTotal: map.longTotal,
    shortTotal: map.shortTotal,
    up: map.up && { from: map.up.from, to: map.up.to, usd: map.up.longUsd + map.up.shortUsd, named: Math.round(map.up.namedUsd || 0) },
    down: map.down && { from: map.down.from, to: map.down.to, usd: map.down.longUsd + map.down.shortUsd, named: Math.round(map.down.namedUsd || 0) },
    bin: map.bin,
    levels: map.levels,
    namedTotal: Math.round(map.namedTotal || 0),
    densest: map.densest && { from: map.densest.from, off: map.densest.offPct, longUsd: map.densest.longUsd, shortUsd: map.densest.shortUsd },
    worst: loser && { side: loser.side, usd: loser.usd, entry: loser.entry, liq: loser.liq, upnl: loser.upnl },
    buckets: map.buckets.map((b) => [b.offPct, Math.round(b.longUsd), Math.round(b.shortUsd), Math.round(b.namedUsd || 0)]),
  };
  fs.appendFileSync(file, JSON.stringify(rec) + '\n');
  return rec;
}

// Liquidations sitting between two FIXED prices in one snapshot.
export const zoneUsd = (snap, lo, hi) => (snap.levels || [])
  .filter(([at]) => at >= lo && at < hi)
  .reduce((s, [, l, sh]) => s + l + sh, 0);

// What changed between the first and last snapshot in a window: the whole point of keeping history.
// The zones are fixed where the walls stood in the FIRST snapshot, and the same price range is summed
// again in the last one. `endAt` defaults to now; pass the time of the last snapshot to replay a file.
export function wallHistory(file, sym, hours = 6, { endAt = Date.now() } = {}) {
  if (!fs.existsSync(file)) return null;
  const cut = endAt - hours * 3600e3;
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n')
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && r.sym === sym && r.t >= cut && r.t <= endAt);
  if (rows.length < 2) return null;
  const first = rows[0], last = rows[rows.length - 1];
  // snapshots from before 26 Sep have no fixed levels: their walls cannot be compared honestly
  const legacy = !first.levels || !last.levels || first.bin !== last.bin;
  const zone = (w) => {
    if (!w || legacy || w.to == null) return null;
    const from = zoneUsd(first, w.from, w.to), to = zoneUsd(last, w.from, w.to);
    return { lo: w.from, hi: w.to, from, to, ratio: from > 0 ? to / from : null };
  };
  // where the money actually moved: 2% bands fixed at the first snapshot's price, largest changes first.
  // The nearest walls can hold while $10M lands 5% further up, and that is the part worth seeing
  const bands = [];
  if (!legacy) {
    for (let off = -20; off < 20; off += 2) {
      const lo = first.mark * (1 + off / 100), hi = first.mark * (1 + (off + 2) / 100);
      const from = zoneUsd(first, lo, hi), to = zoneUsd(last, lo, hi);
      if (Math.abs(to - from) >= 1e6) bands.push({ lo, hi, off, from, to });
    }
    bands.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  }
  return {
    snapshots: rows.length,
    minutes: Math.round((last.t - first.t) / 60000),
    bands: bands.slice(0, 4),
    priceFrom: first.mark,
    priceTo: last.mark,
    accountsFrom: first.n,
    accountsTo: last.n,
    longsChange: last.longTotal - first.longTotal,
    shortsChange: last.shortTotal - first.shortTotal,
    legacy,
    up: zone(first.up),
    down: zone(first.down),
  };
}
