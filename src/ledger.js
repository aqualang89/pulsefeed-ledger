// The ledger: score your own calls against what actually happened.
//
// Most crypto tooling stops at the signal. You get a feed of "smart money is buying X" and nobody,
// including the author, ever goes back to check what X did afterwards. This grades a file of recorded
// signals against their own outcomes, and it is deliberately unkind: it reports the cases where the
// filter killed something that then went up, not just the ones where it saved you.
//
// Input: JSONL or JSON array. One record per signal, minimum fields:
//   { "t": 1789000000000, "ticker": "ABC", "price": 1.23, "p24h": 0.81 }
// Optional and used when present:
//   score (0-10 from your own filter), verdict ("POST"/"SKIP"), risk ("low"/"med"/"high"),
//   posted (bool, did it actually reach your audience), p1h, p4h, judge ({ state, ... })
import fs from 'fs';

export function loadSignals(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (raw.startsWith('[')) return JSON.parse(raw);
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Outcome = last known price point vs entry. Falls back through the checkpoints so a signal with
// only a 1h reading still counts instead of being silently dropped.
export const outcome = (r) => {
  const to = r.p24h ?? r.p4h ?? r.p1h;
  return r.price && to ? (to / r.price - 1) * 100 : null;
};

// A micro-cap that opens at a price near zero produces outcomes like +11,249,601%. That is not a
// win, it is a pricing artifact, and leaving it in the "biggest misses" list makes the whole report
// look careless. Flag those rows separately instead of quietly deleting them.
export const SUSPECT_ABOVE = 5000;
export const isSuspect = (r) => { const o = outcome(r); return o != null && o > SUSPECT_ABOVE; };

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export const pct = (n) => (n == null ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);

// Medians, not averages. One coin that did +2786% drags the mean of a thousand rows into nonsense,
// and a "average outcome +17113%" line is how you end up lying to yourself in public.
export function summarize(rows, label = '') {
  const o = rows.map(outcome).filter((x) => x != null);
  if (!o.length) return { label, n: 0 };
  return {
    label,
    n: o.length,
    winners: o.filter((x) => x > 0).length,
    winRate: o.filter((x) => x > 0).length / o.length,
    median: median(o),
    mean: mean(o),
    dumped: o.filter((x) => x < -10).length,
    rugged: o.filter((x) => x < -50).length,
  };
}

export const line = (s) => (s.n
  ? `${String(s.label).padEnd(16)} n=${String(s.n).padStart(4)}  up ${String(Math.round(s.winRate * 100)).padStart(3)}%  median ${pct(s.median).padStart(8)}  below -10% ${String(s.dumped).padStart(4)}  below -50% ${String(s.rugged).padStart(4)}`
  : `${String(s.label).padEnd(16)} no outcomes`);

// Does the score actually rank anything? Correlation near zero means the number is decoration:
// the threshold you argue about in code review is not separating good calls from bad ones.
export function scoreCalibration(rows, buckets = [[0, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 11]]) {
  const scored = rows.filter((r) => r.score != null && outcome(r) != null);
  const out = { buckets: [], correlation: null, n: scored.length };
  for (const [lo, hi] of buckets) {
    const b = scored.filter((r) => r.score >= lo && r.score < hi);
    if (b.length) out.buckets.push(summarize(b, `score ${lo}-${hi}`));
  }
  if (scored.length > 8) {
    const xs = scored.map((r) => r.score), ys = scored.map(outcome);
    const mx = mean(xs), my = mean(ys);
    const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const sx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
    const sy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
    out.correlation = sx && sy ? cov / (sx * sy) : null;
  }
  return out;
}

// The two numbers a filter should be judged on, and the second one is the uncomfortable one.
export function filterValue(rows, { dumpBelow = -10, missAbove = 10 } = {}) {
  const killed = rows.filter((r) => outcome(r) != null && (r.posted === false || r.verdict === 'SKIP'));
  const saved = killed.filter((r) => outcome(r) < dumpBelow);
  const missed = killed.filter((r) => outcome(r) > missAbove && !isSuspect(r));
  return {
    killed: killed.length,
    saved: saved.length,
    missed: missed.length,
    suspect: killed.filter(isSuspect).length,
    savedShare: killed.length ? saved.length / killed.length : null,
    worstMisses: [...missed].sort((a, b) => outcome(b) - outcome(a)).slice(0, 8)
      .map((r) => ({ ticker: r.ticker, outcome: outcome(r), score: r.score ?? null })),
  };
}

// Group by any labelled field (risk tier, lane, judge state). A label that splits outcomes
// is worth more than a score that does not.
export function byField(rows, field) {
  const keys = [...new Set(rows.map((r) => (typeof r[field] === 'object' && r[field] ? r[field].state : r[field])).filter(Boolean))];
  return keys.map((k) => summarize(
    rows.filter((r) => (typeof r[field] === 'object' && r[field] ? r[field].state : r[field]) === k),
    `${field}=${k}`,
  )).filter((s) => s.n);
}

export function report(rows) {
  const done = rows.filter((r) => outcome(r) != null);
  const span = done.length ? (Math.max(...done.map((r) => r.t)) - Math.min(...done.map((r) => r.t))) / 86400e3 : 0;
  const out = [`${rows.length} signals, ${done.length} with outcomes, ${span.toFixed(0)} days`, ''];

  if (done.some((r) => r.posted != null)) {
    out.push(line(summarize(done.filter((r) => r.posted), 'published')));
    out.push(line(summarize(done.filter((r) => !r.posted), 'held back')));
    out.push('');
  }

  const fv = filterValue(done);
  out.push(`filter killed ${fv.killed}; ${fv.saved} of those went below -10% (${Math.round((fv.savedShare || 0) * 100)}%), ${fv.missed} went above +10%`);
  if (fv.suspect) out.push(`  ${fv.suspect} more read above +${SUSPECT_ABOVE}%, which is a pricing artifact on near-zero entries, not a call we missed`);
  if (fv.worstMisses.length) out.push(`  biggest misses: ${fv.worstMisses.map((m) => `${m.ticker} ${pct(m.outcome)}`).join(', ')}`);
  out.push('');

  const cal = scoreCalibration(done);
  if (cal.buckets.length) {
    out.push('score against outcome:');
    for (const b of cal.buckets) out.push('  ' + line(b));
    if (cal.correlation != null) out.push(`  correlation ${cal.correlation.toFixed(2)} (0 means the score ranks nothing)`);
    out.push('');
  }

  for (const field of ['risk', 'lane', 'judge']) {
    const groups = byField(done, field);
    if (groups.length > 1) { for (const g of groups) out.push(line(g)); out.push(''); }
  }
  return out.join('\n');
}
