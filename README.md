# toi-cert-lab — certified time-of-impact for moving triangles

**Promise:** for a pair of triangles carrying constant linear + angular velocity, return a *certified* TOI
bracket `[lo, hi]` — `lo` is a proven lower bound (no contact before it), `hi` is an upper bound (contact has
happened by it). On the shipped 310-case corpus: **0/150 missed collisions, 0/150 invented collisions, median
bracket width 9.78e-13** versus the in-repo fixed-step baseline `baseline/naive.mjs` at **dt = 1/60 = 1.67e-2**,
which **misses 8/150 collisions** and is median **8.2e-3 late** on the ones it does catch.

Upstream: 原创（无上游）— original work, no upstream project modified.

## Run it (one command)

```bash
node tools/gen-sample.mjs && node bench/verify.mjs && node bench/bench.mjs
```

`verify.mjs` runs assertions A1–A10 and exits non-zero on any failure; `bench.mjs` writes `bench/result.json`.
Browser view: `python3 -m http.server 4173` then open `http://localhost:4173/` (three.js via pinned CDN
importmap, `three@0.169.0`; `main.js` only renders — every number on screen is computed by the same
`src/core.mjs` that node imports).

## Evidence (`bench/result.json`, real runs on this machine)

| claim | measured | how |
| --- | --- | --- |
| no missed collision | **0 / 150** | 150 collide-cases, ground truth from the independent oracle at `dt=2e-4` (**150/150** agree) |
| no invented collision | **0 / 150** | 150 miss-cases, oracle finds no contact in any of them |
| certificate is sound | **0 violations / 300,150 oracle samples** inside `[0, lo]` | A5 re-scans the certified-safe region with the SAT/barycentric oracle |
| `hi` is a real upper bound | **150 / 150** brackets | oracle finds contact inside `[lo, hi + 32·eps/L]` (A6) |
| bracket ≪ baseline resolution | median **9.78e-13** (widest 6.97e-12) vs step **1.67e-2** | A7 |
| baseline is genuinely naive | **8 / 150 collisions missed**, median late by **8.2e-3** | A8, `bench/bench.mjs` |
| implementation independence | **500 / 500** static pairs agree | core (closest-point + Möller pierce) vs oracle (11-axis SAT + barycentric) |
| scale invariance | **0** status mismatches, TOI drift **3.85e-16** | 155 runs at s ∈ {1e-6, 1e-3, 1, 1e3, 1e6}, A9 |
| speed | **0.069 ms / case** (310 cases: median 21.5 ms, min 15.2 ms, p95 38.0 ms, cold 92.5 ms, 7 reps) | `bench/bench.mjs` |

**Relative standard deviation is 34.45%** and is disclosed rather than hidden: the workload is ~21 ms
(sub-millisecond per case) on a shared 4-core box, so GC and host noise dominate. `min` (15.2 ms) and `p95`
(38.0 ms) are published next to the median; no correctness number depends on a timer.

## What the certificate means

Conservative advancement: `d(t)` is the exact triangle/triangle distance, `L` a Lipschitz bound on the relative
speed of any point pair, so `TOI >= t + d(t)/L`. Iterating gives a monotone sequence of *proven-safe* times;
when `d(t) <= eps` at some `t`, contact is bracketed as `[previous t, t]`. If the loop reaches `t = tEnd`
without contact, `TOI >= tEnd` is proven. If 512 iterations are exhausted the tool **abstains** with
`status:"stalled"` rather than guessing (0 stalls on this corpus).

## 本轮创新 (novelty, B tier)

Conservative advancement is classical (Mirtich 1996; van den Bergen), and every JS physics/geometry library
that uses it returns either a boolean or a single point estimate. **This repo returns a two-sided certificate
and then attacks its own claim**: the `[lo, hi]` bracket is re-checked by an independently written oracle
(11-axis SAT + barycentric containment, sharing no constant with the core's closest-point/Möller path), by
dense sampling *inside the certified-safe region* (300,150 samples, 0 violations), and by a scale sweep of six
orders of magnitude (drift 3.85e-16). The baseline is not a strawman re-implementation of my own method: it is
the standard fixed-step sampler parameterised by the resolution a real engine would pick (`1/60`), which loses
8/150 collisions while the certificate loses none. The browser page recomputes the identical bracket and the
identical core digest in front of the user, so the displayed number is the verified number.

## Known limitations (disclosed, not hidden)

- **Only triangle pairs.** Hierarchies/BVH traversal, meshes, and (de)formable bodies are out of scope.
- **Constant linear and angular velocity** per pair. A real solver re-issues the query every substep.
- **`[lo, hi]` is a bracket, not the exact TOI.** `hi` is only guaranteed within the tolerance slack
  `eps/L` (A6 verifies contact by `hi + 32·eps/L`, so the guarantee is "contact within that slack").
- **The separation tolerance is relative, not absolute**: `eps = 1e-12 × scene bbox diagonal`, and `L` is the
  global bound over the whole motion. An absolute-threshold bug (an absolute `1e-12` in the edge-pierce test
  plus catastrophic cancellation in segment/segment distance) was found and fixed by the scale sweep in A9;
  the valid range verified here is scene scale **1e-6 … 1e6**.
- **The ground truth is itself sampled** (`dt = 2e-4`). A contact window shorter than that step would be
  classified as a miss by the oracle too; the corpus is generated with guaranteed-transversal hits, so this is
  a structural blind spot of the *ground truth*, not of the certificate (whose soundness is proven, not sampled).
- **Angular grazing contacts** are the cases most likely to stall; this corpus produced 0 abstentions, but a
  tangential tangent-touch is exactly where a 512-iteration cap would report `stalled`.
- **No GPU run was performed** in this headless environment. The page was only checked for HTTP 200 and for the
  pinned importmap; the browser/node numeric identity is by construction (one shared module), not by screenshot.
- 310 cases and 500 static pairs are *evidence*, not a theorem.

## License

MIT — see `LICENSE`.
