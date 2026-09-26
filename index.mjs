#!/usr/bin/env node
// pulsefeed-ledger CLI
//   node index.mjs map BTC              one liquidation map, printed
//   node index.mjs watch BTC,ETH 60     keep snapshotting every 60s into data/liqmap.jsonl
//   node index.mjs moved BTC 6          what the walls did over the last 6 hours
//   node index.mjs score signals.jsonl  grade recorded signals against their outcomes
//   node index.mjs demo                 all of it on examples/, no key
import fs from 'fs';
import { account, perpPositions } from './src/nansen.js';
import { liquidationMap, extremes, renderMap, appendSnapshot, wallHistory, usd, px } from './src/liqmap.js';
import { loadSignals, report } from './src/ledger.js';

for (const l of (fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').split('\n') : [])) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const [cmd, ...args] = process.argv.slice(2);
const FILE = process.env.LIQMAP_FILE || 'data/liqmap.jsonl';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function map(sym = 'BTC') {
  const rows = await perpPositions(sym);
  const m = liquidationMap(rows);
  if (!m) return console.log(`${sym}: no open positions returned`);
  console.log(renderMap(m));
  const { loser, winner } = extremes(rows);
  if (loser) console.log(`\nworst position: ${loser.side} ${usd(loser.usd)}${loser.lev ? ` at ${loser.lev}` : ''}, entry ${px(loser.entry)}, liq ${px(loser.liq)}, unrealized ${usd(loser.upnl)}`);
  if (winner) console.log(`best position:  ${winner.side} ${usd(winner.usd)}, unrealized ${usd(winner.upnl)}`);
  if (m.named.length) {
    console.log('\nlargest named positions:');
    for (const p of m.named.slice(0, 3)) {
      const dist = ((p.liq / m.mark - 1) * 100).toFixed(1);
      console.log(`  ${p.label}: ${p.side} ${usd(p.usd)}${p.lev ? ` at ${p.lev}` : ''}, liq ${px(p.liq)} (${dist > 0 ? '+' : ''}${dist}% from price), unrealized ${usd(p.upnl)}`);
    }
  }
}

async function watch(symsArg = 'BTC', everySec = 60, capArg) {
  const syms = String(symsArg).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const cap = Number(capArg) || Infinity;
  fs.mkdirSync(FILE.replace(/[^/\\]+$/, '') || '.', { recursive: true });
  const start = await account().catch(() => null);
  console.log(`watching ${syms.join(', ')} every ${everySec}s -> ${FILE}` + (start ? ` (plan ${start.plan}, ${start.credits} credits)` : ''));
  let calls = 0;
  while (calls < cap) {
    for (const sym of syms) {
      try {
        const rows = await perpPositions(sym);
        calls++;
        const m = liquidationMap(rows);
        if (!m) continue;
        appendSnapshot(FILE, sym, m, rows);
        console.log(`${new Date().toISOString().slice(11, 19)} ${sym} ${px(m.mark)} longs ${usd(m.longTotal)} shorts ${usd(m.shortTotal)} | above ${m.up ? px(m.up.from) + ' ' + usd(m.up.longUsd + m.up.shortUsd) : '-'} | below ${m.down ? px(m.down.from) + ' ' + usd(m.down.longUsd + m.down.shortUsd) : '-'}`);
      } catch (e) {
        console.error(`${sym}: ${e.message.slice(0, 120)}`);
      }
      await sleep(1500);
    }
    await sleep(everySec * 1000);
  }
}

function moved(sym = 'BTC', hours = 6, file = FILE, endAt) {
  const h = wallHistory(file, String(sym).toUpperCase(), Number(hours), endAt ? { endAt } : {});
  if (!h) return console.log(`not enough snapshots for ${sym} in the last ${hours}h (run "watch" first)`);
  console.log(`${sym}: ${h.snapshots} snapshots over ${h.minutes} minutes, price ${px(h.priceFrom)} -> ${px(h.priceTo)}`);
  console.log(`  all tracked positions: ${h.accountsFrom} -> ${h.accountsTo} accounts, longs ${h.longsChange >= 0 ? '+' : ''}${usd(h.longsChange)}, shorts ${h.shortsChange >= 0 ? '+' : ''}${usd(h.shortsChange)}`);
  if (h.legacy) {
    return console.log('  these snapshots predate fixed price levels, so their walls cannot be compared (the old wall window moved with price). Run "watch" again.');
  }
  // same price range at both ends: a change here is money added or closed, not price sliding past old positions
  const show = (name, z) => {
    if (!z) return;
    const verb = z.ratio == null ? 'appeared' : z.ratio > 1.15 ? 'grew' : z.ratio < 0.85 ? 'thinned' : 'held';
    console.log(`  wall ${name}, fixed at ${px(z.lo)}-${px(z.hi)}: ${usd(z.from)} -> ${usd(z.to)}  (${verb}${z.ratio != null ? `, x${z.ratio.toFixed(2)}` : ''})`);
  };
  show('above', h.up);
  show('below', h.down);
  if (h.bands.length) {
    console.log('  biggest changes at fixed prices:');
    for (const b of h.bands) {
      const d = b.to - b.from;
      console.log(`    ${px(b.lo)}-${px(b.hi)} (${b.off >= 0 ? '+' : ''}${b.off}% from start price): ${usd(b.from)} -> ${usd(b.to)}  ${d >= 0 ? '+' : ''}${usd(d)}`);
    }
  }
}

function score(file) {
  if (!file) return console.log('usage: node index.mjs score <signals.jsonl>');
  console.log(report(loadSignals(file)));
}

// Runs on files shipped in examples/, no key and no network, so anyone can check the ledger works.
function demo() {
  const ex = (f) => new URL(`./examples/${f}`, import.meta.url);
  const say = (s) => console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`);
  say('1/3  SYNTHETIC, shaped like our real data: a noise score, a gate that zeroes risky coins,\n     and a risk label that actually drives the outcome. Watch the overall correlation lie.');
  console.log(report(loadSignals(ex('decoy.jsonl'))));
  say('2/3  SYNTHETIC with a planted edge (+2% per score point, buried in noise).\n     If the ledger could only ever say "nothing", this is where it would fail.');
  console.log(report(loadSignals(ex('planted.jsonl'))));
  say('3/3  REAL Nansen perp positions, BTC, snapshots taken on 26 Sep 2026.\n     Walls are compared at the same FIXED prices at both ends of the window.');
  const snaps = fs.readFileSync(ex('liqmap-btc.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  moved('BTC', 24, ex('liqmap-btc.jsonl'), snaps.at(-1).t);
}

const commands = { map, watch, moved, score, demo };
if (!commands[cmd]) {
  console.log(`pulsefeed-ledger

  node index.mjs map BTC                 print the liquidation map for one asset
  node index.mjs watch BTC,ETH 60        snapshot every 60s into ${FILE}
  node index.mjs moved BTC 6             how the walls changed over the last 6 hours
  node index.mjs score signals.jsonl     grade recorded signals against outcomes
  node index.mjs demo                    everything above on shipped example data, no key needed

map and watch need NANSEN_API_KEY in .env (see .env.example)`);
  process.exit(cmd ? 1 : 0);
}
await commands[cmd](...args);
