// Synthetic signals for `node index.mjs demo`. Seeded, so everyone gets the same numbers.
//   node examples/make-synthetic.mjs
//
// Two worlds, both made up on purpose, labelled as such in every row (`synthetic: true`):
//   decoy.jsonl    the shape of our real data: the score is noise, a risk gate zeroes the score of
//                  risky coins, and the risk label is what actually drives the outcome
//   planted.jsonl  the score has a real edge built in, so the ledger has to find it
// If the ledger reported "nothing" on both, it would be useless. It should say nothing on the first
// once the gate is removed, and something on the second.
import fs from 'fs';

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const t0 = Date.UTC(2026, 7, 20);
const row = (i, score, risk, move) => {
  const price = +(0.001 + rnd()).toFixed(6);
  return { t: t0 + i * 40 * 60e3, ticker: `SYN${i}`, synthetic: true, score, risk, posted: score >= 7, verdict: score >= 7 ? 'POST' : 'SKIP', price, p24h: +(price * (1 + move / 100)).toFixed(8) };
};

const decoy = [];
for (let i = 0; i < 800; i++) {
  const risk = rnd() < 0.35 ? 'high' : 'low';
  const score = risk === 'high' && rnd() < 0.7 ? 0 : +(1 + rnd() * 9).toFixed(1); // the gate
  const move = risk === 'high' ? Math.max(-99.9, -70 + 25 * gauss()) : 12 * gauss(); // the label is the signal
  decoy.push(row(i, score, risk, move));
}

const planted = [];
for (let i = 0; i < 800; i++) {
  const score = +(1 + rnd() * 9).toFixed(1);
  planted.push(row(i, score, 'low', 2 * (score - 5.5) + 12 * gauss())); // +2% per score point, buried in noise
}

const out = new URL('.', import.meta.url);
fs.writeFileSync(new URL('decoy.jsonl', out), decoy.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(new URL('planted.jsonl', out), planted.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log('wrote examples/decoy.jsonl and examples/planted.jsonl (800 synthetic signals each)');
