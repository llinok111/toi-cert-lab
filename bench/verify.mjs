/**
 * bench/verify.mjs — assertions A1..A10 over the generated corpora.
 * Every number printed is measured here; exit 0 only if all checks pass.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  certificate,
  fixedStepScan,
  scaleCase,
  digest,
  triTriOverlap,
  triTriDistance,
  triangleAt,
} from '../src/core.mjs';
import { oracleOverlap, oracleFirstContact } from './oracle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const { cases } = JSON.parse(readFileSync(join(root, 'data', 'cases.json'), 'utf8'));
const { pairs } = JSON.parse(readFileSync(join(root, 'data', 'pairs.json'), 'utf8'));

let failed = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} :: ${detail}`);
  if (!cond) failed++;
};

/* A1 — corpus shape */
const hit = cases.filter((c) => c.id.startsWith('hit'));
const miss = cases.filter((c) => c.id.startsWith('miss'));
const touch = cases.filter((c) => c.id.startsWith('touch'));
check('A1 corpus', cases.length === 310 && hit.length === 150 && miss.length === 150 && touch.length === 10,
  `cases=${cases.length} hit=${hit.length} miss=${miss.length} touch=${touch.length} pairs=${pairs.length}`);

/* A2 — independent ground truth with the oracle at a fine step */
const GT_DT = 2e-4;
let gtHitContact = 0;
let gtMissContact = 0;
for (const c of hit) if (oracleFirstContact(c, GT_DT, { triangleAt }).contact) gtHitContact++;
for (const c of miss) if (oracleFirstContact(c, GT_DT, { triangleAt }).contact) gtMissContact++;
check('A2 oracle ground truth', gtHitContact === hit.length && gtMissContact === 0,
  `oracle@dt=${GT_DT}: ${gtHitContact}/${hit.length} hit-cases collide, ${gtMissContact}/${miss.length} miss-cases collide`);

/* A3/A4 — the certificate neither misses a collision nor invents one */
const rows = cases.map((c) => ({ id: c.id, ...certificate(c) }));
const missMissed = hit.filter((c) => rows.find((r) => r.id === c.id).status !== 'contact');
const missInvented = miss.filter((c) => rows.find((r) => r.id === c.id).status === 'contact');
const stalls = rows.filter((r) => r.status === 'stalled');
check('A3 no missed collision', missMissed.length === 0, `missed=${missMissed.length}/${hit.length} (stalled=${stalls.length})`);
check('A4 no invented collision', missInvented.length === 0, `invented=${missInvented.length}/${miss.length}`);

/* A5 — soundness: no oracle overlap strictly before the certified lower bound lo */
const SOUND_N = 2000;
let soundViolations = 0;
let soundSamples = 0;
let minSlack = Infinity;
const contactRows = rows.filter((r) => r.status === 'contact' && r.hi > 0);
for (const r of contactRows) {
  const c = cases.find((x) => x.id === r.id);
  for (let k = 0; k <= SOUND_N; k++) {
    const t = (r.lo * k) / SOUND_N;
    soundSamples++;
    if (oracleOverlap(triangleAt(c.t1, t), triangleAt(c.t2, t))) {
      soundViolations++;
      break;
    }
  }
  const dLo = triTriDistance(triangleAt(c.t1, r.lo), triangleAt(c.t2, r.lo));
  if (dLo < minSlack) minSlack = dLo;
}
check('A5 certificate sound', soundViolations === 0,
  `oracle scanned ${soundSamples} samples inside [0,lo] over ${contactRows.length} contact cases -> ${soundViolations} violations (min separation at lo = ${minSlack.toExponential(3)})`);

/* A6 — hi really is an upper bound (contact found by hi + eps/L) */
let upperViolations = 0;
let upperChecked = 0;
for (const r of contactRows) {
  const c = cases.find((x) => x.id === r.id);
  const slack = r.lip > 0 ? r.eps / r.lip : 0;
  const hi = Math.min(c.tEnd ?? 1, r.hi + slack * 32);
  let found = false;
  for (let k = 0; k <= 2000; k++) {
    const t = r.lo + ((hi - r.lo) * k) / 2000;
    if (oracleOverlap(triangleAt(c.t1, t), triangleAt(c.t2, t))) { found = true; break; }
  }
  upperChecked++;
  if (!found) upperViolations++;
}
check('A6 upper bound valid', upperViolations === 0,
  `${upperChecked} brackets, oracle finds real contact inside [lo, hi+32*eps/L] for ${upperChecked - upperViolations}`);

/* A7 — bracket width / iteration stats */
const widths = contactRows.filter((r) => r.hi > r.lo).map((r) => r.width).sort((a, b) => a - b);
const med = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
const iters = contactRows.map((r) => r.iterations).sort((a, b) => a - b);
check('A7 bracket width', widths.length > 0,
  `n=${widths.length} median width=${med.toExponential(3)} min=${widths[0]?.toExponential(3)} max=${widths[widths.length - 1]?.toExponential(3)}; iterations median=${iters[Math.floor(iters.length / 2)]} max=${iters[iters.length - 1]}`);

/* A8 — the fixed-step baseline on the same colliding cases */
const BASE_DT = 1 / 60;
let baseMissed = 0;
const baseErr = [];
for (const c of hit) {
  const s = fixedStepScan(c, BASE_DT, oracleOverlap);
  if (!s.hit) { baseMissed++; continue; }
  const gt = oracleFirstContact(c, GT_DT, { triangleAt });
  if (gt.contact) baseErr.push(s.t - gt.tFirst);
}
baseErr.sort((a, b) => a - b);
check('A8 baseline is genuinely naive', baseMissed > 0,
  `fixed-step dt=1/60 misses ${baseMissed}/${hit.length} collisions; median late-by=${baseErr.length ? baseErr[Math.floor(baseErr.length / 2)].toExponential(3) : 'n/a'} (step=${BASE_DT.toExponential(3)})`);

/* A9 — scale invariance 1e-6 .. 1e6 */
const SCALES = [1e-6, 1e-3, 1, 1e3, 1e6];
let scaleClassMismatch = 0;
let maxScaleDrift = 0;
let scaleTests = 0;
const probe = cases.filter((_, i) => i % 10 === 0);
for (const s of SCALES) {
  for (const c of probe) {
    const base = certificate(c);
    const sc = certificate(scaleCase(c, s));
    scaleTests++;
    if (base.status !== sc.status) { scaleClassMismatch++; continue; }
    if (base.status === 'contact' && base.hi > 0 && sc.hi > 0) {
      const driftLo = Math.abs(sc.lo - base.lo) / Math.max(1e-300, base.lo);
      const driftHi = Math.abs(sc.hi - base.hi) / Math.max(1e-300, base.hi);
      maxScaleDrift = Math.max(maxScaleDrift, driftLo, driftHi);
    }
  }
}
check('A9 scale invariance', scaleClassMismatch === 0 && maxScaleDrift < 1e-6,
  `${scaleTests} runs at s in {${SCALES.join(', ')}}: status mismatches=${scaleClassMismatch}, max normalised TOI drift=${maxScaleDrift.toExponential(3)}`);

/* A10 — implementation independence + determinism */
let pairDisagree = 0;
for (const p of pairs) {
  const a = oracleOverlap(p.A, p.B);
  const b = triTriOverlap(p.A, p.B, 1e-12) || triTriDistance(p.A, p.B) <= 1e-12;
  if (a !== b) pairDisagree++;
}
const d1 = digest(rows);
const d2 = digest(cases.map((c) => ({ id: c.id, ...certificate(c) })));
check('A10 independence + determinism', pairDisagree === 0 && d1 === d2,
  `static pairs: core vs SAT/barycentric oracle agree ${pairs.length - pairDisagree}/${pairs.length}; digest ${d1} (rerun ${d2})`);

console.log(`\nA1..A10 ${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} | digest=${d1} | contacts=${contactRows.length} | stalls=${stalls.length}`);
process.exit(failed === 0 ? 0 : 1);
