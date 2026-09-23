# pulsefeed-ledger

Two tools built on the Nansen API for the Meridian Buildathon, both answering questions that a price chart cannot.

Demo, 46 seconds: https://x.com/aqualanga/status/2102688996979560850

**1. Liquidation maps with history.** Where open Hyperliquid positions get force-closed, and how those walls move over time. Every liquidation chart online is a snapshot of right now. Keep snapshotting and you learn something else: a wall that doubles while price stands still means somebody is adding into it, and a wall that halves in twenty minutes means somebody closed before price ever arrived.

**2. A ledger that grades signals against outcomes.** Point it at a file of your own recorded calls and it tells you, unkindly, whether your filter is doing anything. It reports what the filter killed that then went up, not only what it saved you from.

Both come out of running a live signal account for months. The second one exists because we finally ran it on our own data and did not like the answer.

## Install

```bash
git clone https://github.com/aqualang89/pulsefeed-ledger
cd pulsefeed-ledger
cp .env.example .env     # put your key from app.nansen.ai/api into it
node index.mjs map BTC
```

Node 20+, no dependencies. The free Nansen tier is enough to try everything here.

## Usage

```bash
node index.mjs map BTC                 # one liquidation map, printed
node index.mjs watch BTC,ETH 60        # snapshot every 60s into data/liqmap.jsonl
node index.mjs moved BTC 6             # what the walls did over the last 6 hours
node index.mjs score signals.jsonl     # grade recorded signals against outcomes
```

### `map` - where the forced exits sit

```
$86,289  97 accounts  longs $1.24B / shorts $1.37B
 +16%   $100,095  short   $42.2M  ####
 +14%    $98,369  short  $168.2M  #################
 +10%    $94,918  short   $61.9M  ######
   0%    $86,289  short   $49.1M  ##### <- price
  -6%    $81,112  long    $91.2M  #########
 -12%    $75,934  long   $345.8M  ##################################
 -20%    $69,031  long   $156.8M  ###############

worst position: short $227.5M at 5X, entry $75,210, liq $136,943, unrealized -$27.9M
```

Longs liquidate below price, shorts above, so the two sides are bucketed separately. Merged into one histogram you can no longer tell who gets hurt in which direction. The totals are over the largest tracked accounts Nansen returns, not the whole book, and the tool says so rather than pretending otherwise.

#### Named wallets, and why "every wallet is labelled" is a trap

`map` also shows how much of each wall sits on wallets with an actual identity, marked `*` in the bars, and lists the largest of them:

```
$75.1M of it sits on 6 wallets Nansen has a name for (* in the bars)
 -18%    $70,155  long    $52.4M  **####  named $12.8M

largest named positions:
  zolpi.eth*: long $25.0M at 40X, liq $58,500 (-31.6% from price), unrealized $479K
  samurai.eth: long $12.8M at 18X, liq $70,708 (-17.4% from price), unrealized $1.3M
```

The same wallet on ETH, same minute: long $90.5M at 25X, liquidation 8.8% below price.

The obvious version of this feature is wrong. On a live pull of the largest BTC and ETH positions (23 Sep 2026, 187 wallets) all but one carried a Nansen label, so a naive "money on labelled wallets" line reads close to 100% and tells you nothing. Most of those labels are behaviour categories, not names: `HL Perps Whale` (83 of them, true of anyone who makes a top-100 list), `Uses <code> HL Referral Code` (70), `High Activity`, `High Balance`, `Token Millionaire`. The tool drops those and counts ENS names, entities and Smart Money tags. That leaves 3% of the BTC book and 5% of the ETH book in that pull, which is the part you can actually go and look up.

`watch` records the named money inside the nearest walls too, so `moved` can say whether a wall grew because identifiable wallets added to it or because anonymous ones did. When named money is present in a wall, `moved` adds an `of which on named wallets: $A -> $B` line under it; when there is none, it stays silent. Real capture, 23 Sep 2026:

```
BTC: 3 snapshots over 2 minutes, price $85,569 -> $85,601
  wall above: $6.2M at $87,280 -> $17.3M at $87,313  (grew, x2.77)
  wall below: $11.1M at $83,858 -> $11.1M at $83,889  (held, x1.00)
```

The wall of shorts right above price nearly tripled in two minutes while price moved $32, and no named wallet was part of it: all of that was added by anonymous accounts.

### `moved` - the part a static chart cannot show

```
BTC: 91 snapshots over 46 minutes, price $86,066 -> $86,318
  wall above: $29.5M at $86,066 -> $49.1M at $86,318  (grew, x1.67)
  wall below: $17.5M at $82,624 -> $17.5M at $82,865  (held, x1.00)
```

Real capture from 22 Sep 2026. Price moved $250 and the wall of shorts sitting right on top of it grew by $20M. Nobody was forced to do that, somebody chose to add exposure into the exact level that closes them out.

### `score` - the uncomfortable one

Feed it JSONL where each line is a signal you recorded, with the price you saw and the price later:

```json
{"t":1789000000000,"ticker":"ABC","price":1.23,"p1h":1.4,"p24h":0.81,"score":7.5,"verdict":"POST","risk":"high","posted":false}
```

Everything except `t`, `ticker`, `price` and one later price is optional; the report grows as you add fields. `judge` accepts a nested `{ "state": "rug" }` so you can compare a classifier's labels against what happened.

## What it found on our own data

We ran `score` against 1,136 signals our bot recorded over 30 days, each with the price at the moment of the call and again 1h, 4h and 24h later. Full output and commentary in [docs/FINDINGS.md](docs/FINDINGS.md). The short version:

- Our numeric 0-10 filter score has a correlation of **-0.01** with the outcome. It ranks nothing. The highest scoring bucket, 8-9, had the worst median of any bucket at -14.1%.
- A plain risk label we almost deleted last month splits the same data cleanly: `low` 47% of calls up, median -0.3%; `high` 18% up, median -87.4%.
- A three-state classifier running in shadow mode ranked outcomes in exact order: `rug` median -99.5%, `overextended` +0.1%, `normal` +4.0%.

A score everyone argues about in code review turned out to be decoration, and a label nobody discussed turned out to be the signal. That is the argument for keeping a ledger.

## The bot behind it

These tools were pulled out of PulseFeed, a signal bot that has been posting to a public account for months and uses the Nansen API in production as its smart-money layer (1,833 credits over the last 30 days, not a demo key). The bot itself is closed source: its prompts and selection thresholds are the product. What is here is what stands on its own, plus the measurement method and the real numbers it produced.

You can check the bot's calls yourself, they are public and timestamped: [@aqualanga](https://x.com/aqualanga).

## Nansen endpoints used

| What | Endpoint | Credits |
|---|---|---|
| Open perp positions, entry, liquidation price, unrealized PnL | `POST /tgm/perp-positions` | 5 |
| Credit balance | `GET /account` | free |

`perp-positions` charges per call, not per row, so the map is built from the full 100 positions rather than a cheaper slice.

## License

MIT.
