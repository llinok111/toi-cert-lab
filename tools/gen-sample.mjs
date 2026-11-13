/**
 * Deterministic sample generator.  `node tools/gen-sample.mjs`
 * Writes data/cases.json (moving triangle pairs) and data/pairs.json (static pairs).
 * Fixed seed -> byte-identical output on every run.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { triangleAt } from '../src/core.mjs';
import { oracleOverlap } from '../bench/oracle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'data');

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20261113);
const rr = (a, b) => a + (b - a) * rnd();
const unit = () => {
  for (;;) {
    const v = [rr(-1, 1), rr(-1, 1), rr(-1, 1)];
    const l = Math.hypot(...v);
    if (l > 1e-3 && l <= 1) return [v[0] / l, v[1] / l, v[2] / l];
  }
};

function randTriangle(radius) {
  for (;;) {
    const p = [];
    for (let i = 0; i < 3; i++) p.push([rr(-radius, radius), rr(-radius, radius), rr(-radius, radius)]);
    const ab = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const ac = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const n = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    if (Math.hypot(...n) / 2 > 0.15 * radius * radius) return p;
  }
}

const randAngular = (amp) => {
  const u = unit();
  const s = rr(0, amp);
  return [u[0] * s, u[1] * s, u[2] * s];
};

const centro = (p) => [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3];

function classify(c) {
  const n = 500;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (oracleOverlap(triangleAt(c.t1, t), triangleAt(c.t2, t))) return true;
  }
  return false;
}

function makeCase(wantContact, id) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const t1 = { p: randTriangle(0.8), v: [rr(-0.4, 0.4), rr(-0.4, 0.4), rr(-0.4, 0.4)], w: randAngular(0.8) };
    const t2 = { p: randTriangle(0.8), v: [0, 0, 0], w: randAngular(0.8) };
    const tStar = rr(0.25, 0.75);
    const d = unit();
    const dist = rr(2.6, 3.4);
    const c2 = centro(t2.p);
    // want centroid of t2 near the origin at tStar
    const v2 = [(-d[0] * dist - c2[0]) / tStar, (-d[1] * dist - c2[1]) / tStar, (-d[2] * dist - c2[2]) / tStar];
    // keep the centroid of t1 at the origin; offset t2 start along d
    const c1 = centro(t1.p);
    t1.p = t1.p.map((p) => [p[0] - c1[0], p[1] - c1[1], p[2] - c1[2]]);
    t2.p = t2.p.map((p) => [p[0] - c2[0] + d[0] * dist, p[1] - c2[1] + d[1] * dist, p[2] - c2[2] + d[2] * dist]);
    const dir = wantContact ? 1 : -1;
    t2.v = [v2[0] * dir, v2[1] * dir, v2[2] * dir];
    const c = { id, t1, t2, tEnd: 1 };
    if (classify(c) === wantContact) return c;
  }
  return null;
}

const cases = [];
let cid = 0;
for (let i = 0; i < 150; i++) {
  const c = makeCase(true, `hit-${String(cid++).padStart(3, '0')}`);
  if (c) cases.push(c);
}
for (let i = 0; i < 150; i++) {
  const c = makeCase(false, `miss-${String(cid++).padStart(3, '0')}`);
  if (c) cases.push(c);
}
// a handful of pairs that already touch at t = 0
for (let i = 0; i < 10; i++) {
  const t1 = { p: randTriangle(0.8), v: [rr(-0.2, 0.2), rr(-0.2, 0.2), rr(-0.2, 0.2)], w: randAngular(0.3) };
  const c1 = centro(t1.p);
  t1.p = t1.p.map((p) => [p[0] - c1[0], p[1] - c1[1], p[2] - c1[2]]);
  const t2 = { p: t1.p.map((p) => [p[0], p[1] + 0.0, p[2]]), v: [0, 0, 0], w: [0, 0, 0] };
  cases.push({ id: `touch-${String(i).padStart(3, '0')}`, t1, t2, tEnd: 1 });
}

const pairs = [];
for (let i = 0; i < 400; i++) {
  const A = randTriangle(1);
  const B = randTriangle(1).map((p) => [p[0] + rr(-1.4, 1.4), p[1] + rr(-1.4, 1.4), p[2] + rr(-1.4, 1.4)]);
  pairs.push({ i, A, B, coplanar: false });
}
for (let i = 0; i < 100; i++) {
  const A = randTriangle(1);
  const B = randTriangle(1).map((p) => [p[0] + rr(-1.2, 1.2), p[1] + rr(-1.2, 1.2), 0]);
  const Az = A.map((p) => [p[0], p[1], 0]);
  pairs.push({ i: 400 + i, A: Az, B, coplanar: true });
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'cases.json'), JSON.stringify({ seed: 20261113, cases }, null, 0) + '\n');
writeFileSync(join(outDir, 'pairs.json'), JSON.stringify({ seed: 20261113, pairs }, null, 0) + '\n');
const hits = cases.filter((c) => c.id.startsWith('hit')).length;
const misses = cases.filter((c) => c.id.startsWith('miss')).length;
const touch = cases.filter((c) => c.id.startsWith('touch')).length;
console.log(`wrote data/cases.json (${cases.length}: ${hits} hit / ${misses} miss / ${touch} touch) and data/pairs.json (${pairs.length})`);
