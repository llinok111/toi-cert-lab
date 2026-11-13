/**
 * bench/bench.mjs — timing + headline correctness numbers -> bench/result.json
 * warmup 1, then 7 measured reps; cold start (very first run) recorded separately.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { certificate, fixedStepScan, scaleCase, digest, triTriOverlap, triTriDistance, triangleAt } from '../src/core.mjs';
import { oracleOverlap, oracleFirstContact } from './oracle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const { cases } = JSON.parse(readFileSync(join(root, 'data', 'cases.json'), 'utf8'));
const { pairs } = JSON.parse(readFileSync(join(root, 'data', 'pairs.json'), 'utf8'));

const now = () => Number(process.hrtime.bigint()) / 1e6;
const runAll = () => cases.map((c) => ({ id: c.id, ...certificate(c) }));

const tCold0 = now();
const coldRows = runAll();
const coldMs = now() - tCold0;
runAll(); // warmup

const REPS = 7;
const times = [];
let rows = coldRows;
for (let i = 0; i < REPS; i++) {
  const t0 = now();
  rows = runAll();
  times.push(now() - t0);
}
const sorted = [...times].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const mean = times.reduce((a, b) => a + b, 0) / times.length;
const stddev = Math.sqrt(times.reduce((a, b) => a + (b - mean) ** 2, 0) / times.length);
const p95 = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))];

// correctness (measured, not asserted here — verify.mjs owns the gates)
const hit = cases.filter((c) => c.id.startsWith('hit'));
const miss = cases.filter((c) => c.id.startsWith('miss'));
const rowOf = (id) => rows.find((r) => r.id === id);
let gHit = 0;
for (const c of hit) if (oracleFirstContact(c, 2e-4, { triangleAt }).contact) gHit++;
let invented = 0;
for (const c of miss) if (rowOf(c.id).status === 'contact') invented++;
let missed = 0;
for (const c of hit) if (rowOf(c.id).status !== 'contact') missed++;

let soundSamples = 0;
let soundViolations = 0;
for (const r of rows) {
  if (r.status !== 'contact' || r.hi === 0) continue;
  const c = cases.find((x) => x.id === r.id);
  for (let k = 0; k <= 2000; k++) {
    soundSamples++;
    if (oracleOverlap(triangleAt(c.t1, (r.lo * k) / 2000), triangleAt(c.t2, (r.lo * k) / 2000))) { soundViolations++; break; }
  }
}
const widths = rows.filter((r) => r.status === 'contact' && r.hi > r.lo).map((r) => r.width).sort((a, b) => a - b);
let pairDisagree = 0;
for (const p of pairs) {
  const a = oracleOverlap(p.A, p.B);
  const b = triTriOverlap(p.A, p.B, 1e-12) || triTriDistance(p.A, p.B) <= 1e-12;
  if (a !== b) pairDisagree++;
}
let scaleDrift = 0;
let scaleMismatch = 0;
for (const s of [1e-6, 1e-3, 1, 1e3, 1e6]) {
  for (const c of cases.filter((_, i) => i % 10 === 0)) {
    const a = certificate(c);
    const b = certificate(scaleCase(c, s));
    if (a.status !== b.status) { scaleMismatch++; continue; }
    if (a.status === 'contact' && a.hi > 0) scaleDrift = Math.max(scaleDrift, Math.abs(b.lo - a.lo) / Math.max(1e-300, a.lo));
  }
}
// baseline
const BASE_DT = 1 / 60;
const tB0 = now();
let baseMissed = 0;
const late = [];
for (const c of hit) {
  const s = fixedStepScan(c, BASE_DT, oracleOverlap);
  if (!s.hit) { baseMissed++; continue; }
  const gt = oracleFirstContact(c, 2e-4, { triangleAt });
  if (gt.contact) late.push(s.t - gt.tFirst);
}
const baseMs = now() - tB0;
late.sort((a, b) => a - b);
const dg = digest(rows);

const result = {
  tool: 'toi-cert-lab',
  generatedAt: new Date().toISOString(),
  node: process.version,
  corpus: { cases: cases.length, hit: hit.length, miss: miss.length, touch: cases.length - hit.length - miss.length, staticPairs: pairs.length },
  timing: {
    reps: REPS,
    coldStartMs: +coldMs.toFixed(3),
    samplesMs: times.map((t) => +t.toFixed(3)),
    minMs: +sorted[0].toFixed(3),
    medianMs: +median.toFixed(3),
    p95Ms: +p95.toFixed(3),
    stddevMs: +stddev.toFixed(3),
    rsdPct: +((100 * stddev) / mean).toFixed(2),
    perCaseMs: +(median / cases.length).toFixed(4),
  },
  correctness: {
    oracleGroundTruthHit: `${gHit}/${hit.length}`,
    missedCollisions: missed,
    inventedCollisions: invented,
    soundSamplesScanned: soundSamples,
    soundViolations,
    bracketWidthMedian: +(widths[Math.floor(widths.length / 2)] ?? 0).toExponential(4),
    bracketWidest: +(widths[widths.length - 1] ?? 0).toExponential(4),
    oraclePairAgreement: `${pairs.length - pairDisagree}/${pairs.length}`,
    scaleMismatches: scaleMismatch,
    scaleToiDrift: +scaleDrift.toExponential(3),
    digest: dg,
  },
  baseline: {
    kind: 'fixed-step sampling dt=1/60 with the independent oracle predicate',
    dt: BASE_DT,
    missedOf: `${baseMissed}/${hit.length}`,
    medianLateBy: +(late[Math.floor(late.length / 2)] ?? 0).toExponential(4),
    totalMs: +baseMs.toFixed(3),
  },
};
writeFileSync(join(here, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
