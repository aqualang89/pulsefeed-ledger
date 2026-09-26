// node test/liqmap.test.mjs
// The case that fooled us: price drifts up, nobody touches their positions, and the old
// "nearest wall above price" reading reported a wall that grew by two thirds.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { liquidationMap, appendSnapshot, wallHistory } from '../src/liqmap.js';

let ok = 0, fail = 0;
const t = (name, cond) => { if (cond) { ok++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); } };

const book = (mark, extra = []) => [
  { side: 'short', usd: 29.5e6, liq: 86600, mark },
  { side: 'short', usd: 19.6e6, liq: 87900, mark }, // sits just past the 2% window at 86,066
  { side: 'short', usd: 40e6, liq: 90000, mark },
  { side: 'long', usd: 17.5e6, liq: 83000, mark },
  ...extra,
];
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'liqmap-')), 'snaps.jsonl');
const t0 = Date.UTC(2026, 8, 22, 13, 21);

console.log('price drifts $250, positions unchanged');
let a = liquidationMap(book(86066));
let b = liquidationMap(book(86318));
t('old moving window reports growth that did not happen', b.up.longUsd + b.up.shortUsd > 1.5 * (a.up.longUsd + a.up.shortUsd));
appendSnapshot(file, 'BTC', a, book(86066), t0);
appendSnapshot(file, 'BTC', b, book(86318), t0 + 46 * 60e3);
let h = wallHistory(file, 'BTC', 6, { endAt: t0 + 46 * 60e3 });
t('fixed zone above holds (x1.00)', h && Math.abs(h.up.ratio - 1) < 1e-9);
t('shorts total unchanged', h.shortsChange === 0);
t('not flagged legacy', h.legacy === false);

console.log('someone opens $20M of shorts inside the zone');
fs.writeFileSync(file, '');
appendSnapshot(file, 'BTC', liquidationMap(book(86066)), book(86066), t0);
const added = book(86100, [{ side: 'short', usd: 20e6, liq: 87000, mark: 86100 }]);
appendSnapshot(file, 'BTC', liquidationMap(added), added, t0 + 30 * 60e3);
h = wallHistory(file, 'BTC', 6, { endAt: t0 + 30 * 60e3 });
t('fixed zone above grows by the $20M added', h && Math.round(h.up.to - h.up.from) === 20e6);
t('shorts total grew by the same $20M', Math.round(h.shortsChange) === 20e6);

console.log('old snapshots without levels');
fs.writeFileSync(file, [
  { t: t0, sym: 'BTC', mark: 86066, n: 97, longTotal: 1, shortTotal: 1, up: { from: 86066, usd: 29.5e6 } },
  { t: t0 + 60e3, sym: 'BTC', mark: 86318, n: 97, longTotal: 1, shortTotal: 1, up: { from: 86318, usd: 49.1e6 } },
].map((r) => JSON.stringify(r)).join('\n'));
h = wallHistory(file, 'BTC', 6, { endAt: t0 + 60e3 });
t('flagged legacy, no wall comparison offered', h.legacy === true && h.up === null);

console.log(`\n${fail ? 'FAILED' : 'passed'}: ${ok} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
