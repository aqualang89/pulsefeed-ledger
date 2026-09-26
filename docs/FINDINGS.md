# What the ledger found

Run on 1,136 signals recorded by a live bot between 23 August and 22 September 2026. Every row is a coin the bot evaluated, with the price at the moment of evaluation and again 1h, 4h and 24h later. 1,107 of them have a usable outcome. Nothing here is a backtest over historical candles: these are decisions that were made in real time, most of them in public.

```
1136 signals, 1107 with outcomes, 30 days

published        n=  45  up  53%  median    +0.3%  below -10%   12  below -50%    2
held back        n=1062  up  34%  median    -3.8%  below -10%  368  below -50%  259

filter killed 1070; 370 of those went below -10% (35%), 115 went above +10%
  4 more read above +5000%, which is a pricing artifact on near-zero entries, not a call we missed
  biggest misses: MICRODUCK +2803.8%, Dinger +2786.9%, SHRUB +1080.3%, EMBER +830.7%

score against outcome:
  score 0-5        n= 850  up  33%  median    -4.1%  below -10%  320  below -50%  246
  score 5-6        n=  70  up  41%  median    -2.7%  below -10%    6  below -50%    1
  score 6-7        n=   4  up  25%  median    -3.8%  below -10%    1  below -50%    1
  score 7-8        n= 147  up  43%  median    -1.1%  below -10%   32  below -50%    4
  score 8-9        n=  36  up  28%  median   -14.1%  below -10%   21  below -50%    9
  correlation -0.01 [95% CI -0.07 to 0.05], rank correlation 0.41 [95% CI 0.36 to 0.46], n=1107 (0 means the score ranks nothing)
  267 signals sit at exactly 0, which usually means a hard gate rather than the score's own judgement. Without them: rank correlation 0.05 [95% CI -0.01 to 0.12], n=840

risk=low         n= 575  up  47%  median    -0.3%  below -10%   31  below -50%    0
risk=high        n= 417  up  18%  median   -87.4%  below -10%  315  below -50%  259
risk=med         n= 115  up  31%  median    -4.3%  below -10%   34  below -50%    2

judge=rug          n=  40  up   8%  median   -99.5%  below -10%   37  below -50%   35
judge=overextended n= 123  up  50%  median    +0.1%  below -10%   13  below -50%    3
judge=normal       n=   9  up  89%  median    +4.0%  below -10%    0  below -50%    0
```

## Four things worth saying out loud

**The pipeline works, and that is the least interesting finding.** What got published was up 53% of the time with a median of +0.3%; what was held back was up 34% with a median of -3.8%. Selection beats the pool it selects from. Fine. The interesting part is which piece of the selection is doing the work.

**The score is decoration.** A 0-10 number from the filter, the one we spent weeks tuning and argued about in every code review, does not rank the outcome. (Corrected 26 Sep: the first version of this file said "-0.01", a Pearson figure that outliers decide. By rank the full sample reads 0.41, but 262 of the 267 zero scores were high-risk coins zeroed by a hard gate; without them the score's rank correlation is 0.05, 95% CI -0.01 to 0.12. Same conclusion, stated properly.) Worse than useless as a ranking: the top bucket, 8 to 9, has the worst median of all of them at -14.1%, and 9 of its 36 calls ended below -50%. Everything that made publishing better than not publishing came from somewhere else in the pipeline, and we would never have known which part without running this.

**A label nobody discussed carried the signal.** The `risk` tag is three words attached during enrichment. `low` is up 47% with a median of -0.3% and not a single row below -50% out of 575. `high` is up 18% with a median of -87.4% and 259 rows below -50%. One field splits the same dataset cleanly while the carefully tuned number does nothing.

**A three-state classifier beat a ten-point scale.** In the last five days of this window a second classifier ran in shadow mode, answering with one of three states instead of a number. It never touched what got published; its answers were just recorded next to the outcome. The three states came out in exact order: `rug` at a median of -99.5% and 35 of 40 rows below -50%, `overextended` at +0.1%, `normal` at +4.0% with 8 of 9 up. Small sample, especially for `normal`, and it needs another two weeks before anyone should lean on it. But the shape of the answer matters: asking "which of these three is it" produced a ranking that asking "score this from 0 to 10" did not.

## The honest caveats

- **This is our own bookkeeping, not an audit.** The prices were recorded by the same system that made the calls. We publish the tool so the method can be checked, and the calls themselves are public and timestamped, but nobody has independently replayed them.
- **Held-back rows are not comparable to published ones.** They were held back for a reason, usually because they were micro-caps that failed a check, which is why their median is so much worse. The `filter killed` line is the fair comparison, and it cuts both ways: 35% of what the filter killed did dump below -10%, but 115 rows went up more than 10% after being killed.
- **Outcome is measured at a fixed horizon**, 24h where available, falling back to 4h or 1h. A different horizon would produce different numbers. We picked it before looking, and we kept it.
- **Four rows read above +5000%.** Those are pricing artifacts on near-zero entries, not wins. The tool flags them separately rather than dropping them silently, because a report that quietly deletes its inconvenient rows is not worth running.
- **The `normal` bucket has 9 rows.** It is the most encouraging line in the table and the one least worth believing yet.

## Why it was built

Because a signal feed with no scorekeeping is a feed of opinions. The cost of keeping score turned out to be about fifty lines of code and one uncomfortable afternoon, and it changed what we are going to build next: the number we trusted is being replaced by the label we ignored.
