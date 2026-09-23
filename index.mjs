#!/usr/bin/env node
// pulsefeed-ledger CLI
//   node index.mjs map BTC              one liquidation map, printed
//   node index.mjs watch BTC,ETH 60     keep snapshotting every 60s into data/liqmap.jsonl
//   node index.mjs moved BTC 6          what the walls did over the last 6 hours
//   node index.mjs score signals.jsonl  grade recorded signals against their outcomes
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

function moved(sym = 'BTC', hours = 6) {
  const h = wallHistory(FILE, String(sym).toUpperCase(), Number(hours));
  if (!h) return console.log(`not enough snapshots for ${sym} in the last ${hours}h (run "watch" first)`);
  console.log(`${sym}: ${h.snapshots} snapshots over ${h.minutes} minutes, price ${px(h.priceFrom)} -> ${px(h.priceTo)}`);
  const show = (name, from, to, ratio) => {
    if (!from || !to) return;
    const verb = ratio > 1.15 ? 'grew' : ratio < 0.85 ? 'thinned' : 'held';
    console.log(`  wall ${name}: ${usd(from.usd)} at ${px(from.from)} -> ${usd(to.usd)} at ${px(to.from)}  (${verb}, x${ratio.toFixed(2)})`);
    // snapshots taken before the named layer existed have no `named` field, so only compare when both do
    if (from.named != null && to.named != null && (from.named || to.named)) {
      console.log(`    of which on named wallets: ${usd(from.named)} -> ${usd(to.named)}`);
    }
  };
  show('above', h.upFrom, h.upTo, h.upRatio);
  show('below', h.downFrom, h.downTo, h.downRatio);
}

function score(file) {
  if (!file) return console.log('usage: node index.mjs score <signals.jsonl>');
  console.log(report(loadSignals(file)));
}

const commands = { map, watch, moved, score };
if (!commands[cmd]) {
  console.log(`pulsefeed-ledger

  node index.mjs map BTC                 print the liquidation map for one asset
  node index.mjs watch BTC,ETH 60        snapshot every 60s into ${FILE}
  node index.mjs moved BTC 6             how the walls changed over the last 6 hours
  node index.mjs score signals.jsonl     grade recorded signals against outcomes

needs NANSEN_API_KEY in .env (see .env.example)`);
  process.exit(cmd ? 1 : 0);
}
await commands[cmd](...args);
