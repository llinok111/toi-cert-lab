/**
 * toi-cert-lab — certified time-of-impact for a pair of constantly-moving triangles.
 *
 * Pure ES module. No three.js, no window/document/navigator, no I/O, no env vars.
 * Everything here is deterministic and runs unchanged under `node`.
 *
 * Motion model (one "case"):
 *   { t1: {p:[v0,v1,v2], v:[..], w:[..]}, t2: {...}, tEnd:1 }
 *   vertex i at time t = centroid + Rodrigues(w, t) * (p_i - centroid) + v * t
 *
 * The certificate produced for a contact is an interval [lo, hi] with the guarantee:
 *   no contact happens at any time < lo   (lo is a certified LOWER bound on the TOI)
 *   a contact has happened by time hi      (hi is an UPPER bound)
 * If the scan proves there is no contact in [0, tEnd] we say so, also with a bound.
 */

const REL_EPS = 1e-12; // [DISCLOSED] separation tolerance, relative to the scene scale
const MAX_ITER = 512; // [DISCLOSED] conservative-advancement iteration cap

/* ------------------------------------------------------------------ vec3 */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a) => Math.sqrt(dot(a, a));

function centroid(p) {
  return [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3];
}

/* --------------------------------------------------------------- motion */
function rotateAbout(p, c, w, t) {
  const wl = len(w);
  const d = sub(p, c);
  if (wl * t < 1e-15) return add(c, d);
  const k = mul(w, 1 / wl);
  const th = wl * t;
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const kxd = cross(k, d);
  const kd = dot(k, d);
  return add(c, [
    d[0] * ct + kxd[0] * st + k[0] * kd * (1 - ct),
    d[1] * ct + kxd[1] * st + k[1] * kd * (1 - ct),
    d[2] * ct + kxd[2] * st + k[2] * kd * (1 - ct),
  ]);
}

/** The three world-space vertices of a moving triangle at time t. */
export function triangleAt(tri, t) {
  const c = centroid(tri.p);
  return tri.p.map((p) => add(rotateAbout(p, c, tri.w, t), mul(tri.v, t)));
}

/** Lipschitz bound on the relative speed of any point pair across the two triangles. */
export function speedBound(tri1, tri2) {
  const c1 = centroid(tri1.p);
  const c2 = centroid(tri2.p);
  const r1 = Math.max(len(sub(tri1.p[0], c1)), len(sub(tri1.p[1], c1)), len(sub(tri1.p[2], c1)));
  const r2 = Math.max(len(sub(tri2.p[0], c2)), len(sub(tri2.p[1], c2)), len(sub(tri2.p[2], c2)));
  return len(sub(tri1.v, tri2.v)) + len(tri1.w) * r1 + len(tri2.w) * r2;
}

export function sceneScale(c) {
  const all = [...c.t1.p, ...c.t2.p];
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (const p of all) for (let k = 0; k < 3; k++) {
    if (p[k] < mn[k]) mn[k] = p[k];
    if (p[k] > mx[k]) mx[k] = p[k];
  }
  return Math.max(1e-300, len(sub(mx, mn)));
}

/* ------------------------------------------- exact point/segment distance */
/** Ericson, Real-Time Collision Detection 5.1.5 (closest point on triangle to p). */
export function closestPtPointTriangle(p, a, b, c) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return add(a, mul(ab, v));
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return add(a, mul(ac, w));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return add(b, mul(sub(c, b), w));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return add(a, add(mul(ab, v), mul(ac, w)));
}

/** Ericson 5.1.9 (closest points between two segments), returns squared distance. */
export function segSegDist2(p1, q1, p2, q2) {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const tiny = 1e-300;
  let s;
  let t;
  if (a <= tiny && e <= tiny) return dot(r, r);
  if (a <= tiny) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= tiny) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1 = add(p1, mul(d1, s));
  const c2 = add(p2, mul(d2, t));
  return dot(sub(c1, c2), sub(c1, c2));
}

/**
 * Exact Euclidean distance between two disjoint triangles (0 if they touch/overlap).
 * The pair is first translated+normalised into a unit-scale local frame: the
 * vertex/segment solve below subtracts large coordinates and would otherwise lose
 * precision (measured: relative error blows up past ~1e3 scene scale).
 */
export function triTriDistance(A, B) {
  const o = A[0];
  let s = 1e-300;
  for (const p of [...A, ...B]) s = Math.max(s, len(sub(p, o)));
  const An = A.map((p) => mul(sub(p, o), 1 / s));
  const Bn = B.map((p) => mul(sub(p, o), 1 / s));
  return s * triTriDistanceLocal(An, Bn);
}

function triTriDistanceLocal(A, B) {
  let best = Infinity;
  const edgesA = [[A[0], A[1]], [A[1], A[2]], [A[2], A[0]]];
  const edgesB = [[B[0], B[1]], [B[1], B[2]], [B[2], B[0]]];
  for (let i = 0; i < 3; i++) {
    const q = closestPtPointTriangle(A[i], B[0], B[1], B[2]);
    best = Math.min(best, len(sub(A[i], q)));
    const q2 = closestPtPointTriangle(B[i], A[0], A[1], A[2]);
    best = Math.min(best, len(sub(B[i], q2)));
  }
  for (const [p1, q1] of edgesA) {
    for (const [p2, q2] of edgesB) {
      best = Math.min(best, Math.sqrt(segSegDist2(p1, q1, p2, q2)));
    }
  }
  return best;
}

/* ------------------------------------------------- overlap (edge piercing) */
/** Moller-Trumbore style segment/triangle test: does segment pq pierce triangle abc? */
export function segTriPierce(p, q, a, b, c, tol = 1e-12) {
  const d = sub(q, p);
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const pv = cross(d, e2);
  const det = dot(e1, pv);
  if (Math.abs(det) <= tol * len(d) * len(e2)) return false; // segment parallel to the plane (relative)
  const inv = 1 / det;
  const tv = sub(p, a);
  const u = dot(tv, pv) * inv;
  if (u < -tol || u > 1 + tol) return false;
  const qv = cross(tv, e1);
  const v = dot(d, qv) * inv;
  if (v < -tol || u + v > 1 + tol) return false;
  const t = dot(e2, qv) * inv;
  return t >= -tol && t <= 1 + tol;
}

function triNormal(a, b, c) {
  return cross(sub(b, a), sub(c, a));
}

/** Coplanar 2D overlap by 2D SAT over the six edge normals (projected on the dominant axis). */
function coplanarOverlap2D(A, B, n, eps) {
  const ax = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
  const i = (ax + 1) % 3;
  const j = (ax + 2) % 3;
  const P = A.map((p) => [p[i], p[j]]);
  const Q = B.map((p) => [p[i], p[j]]);
  const polys = [P, Q];
  for (const poly of polys) {
    for (let e = 0; e < 3; e++) {
      const p0 = poly[e];
      const p1 = poly[(e + 1) % 3];
      const nx = -(p1[1] - p0[1]);
      const ny = p1[0] - p0[0];
      const nl = Math.hypot(nx, ny);
      if (nl <= 1e-300) continue;
      const ux = nx / nl;
      const uy = ny / nl;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const p of P) {
        const s = p[0] * ux + p[1] * uy;
        if (s < minA) minA = s;
        if (s > maxA) maxA = s;
      }
      for (const p of Q) {
        const s = p[0] * ux + p[1] * uy;
        if (s < minB) minB = s;
        if (s > maxB) maxB = s;
      }
      if (Math.min(maxA, maxB) - Math.max(minA, minB) < -eps) return false;
    }
  }
  return true;
}

/**
 * True when the two triangles touch/intersect (up to `eps`).
 * Covers the three ways two triangles can meet: a vertex/edge within eps, an edge
 * piercing the other triangle's interior, and coplanar 2D overlap.
 */
export function triTriOverlap(A, B, eps) {
  for (const [p, q] of [[A[0], A[1]], [A[1], A[2]], [A[2], A[0]]]) {
    if (segTriPierce(p, q, B[0], B[1], B[2])) return true;
  }
  for (const [p, q] of [[B[0], B[1]], [B[1], B[2]], [B[2], B[0]]]) {
    if (segTriPierce(p, q, A[0], A[1], A[2])) return true;
  }
  const n1 = triNormal(A[0], A[1], A[2]);
  const n2 = triNormal(B[0], B[1], B[2]);
  const l2 = len(n2);
  if (l2 > 1e-300 && len(n1) > 1e-300) {
    const planeDist = Math.abs(dot(sub(A[0], B[0]), mul(n2, 1 / l2)));
    if (planeDist <= eps && coplanarOverlap2D(A, B, n2, eps)) return true;
  }
  return false;
}

/* --------------------------------------------------- conservative advance */
/**
 * Certified time of impact for one moving triangle pair.
 * @returns {{status:'contact'|'no-contact'|'stalled', lo:number, hi:number, iterations:number, lip:number, eps:number}}
 */
export function timeOfImpact(c, opts = {}) {
  const maxIter = opts.maxIter ?? MAX_ITER;
  const relEps = opts.relEps ?? REL_EPS;
  const tEnd = c.tEnd ?? 1;
  const scale = sceneScale(c);
  const eps = relEps * scale;
  const L = speedBound(c.t1, c.t2);
  const A0 = triangleAt(c.t1, 0);
  const B0 = triangleAt(c.t2, 0);
  const d0 = triTriDistance(A0, B0);
  const base = { iterations: 0, lip: L, eps };
  if (d0 <= eps || triTriOverlap(A0, B0, eps)) return { status: 'contact', lo: 0, hi: 0, ...base };
  if (L === 0) return { status: 'no-contact', lo: tEnd, hi: tEnd, ...base };
  let prev = 0;
  let t = 0;
  for (let i = 0; i < maxIter; i++) {
    const A = triangleAt(c.t1, t);
    const B = triangleAt(c.t2, t);
    const d = triTriDistance(A, B);
    if (d <= eps || triTriOverlap(A, B, eps)) {
      return { status: 'contact', lo: prev, hi: t, iterations: i + 1, lip: L, eps };
    }
    const step = d / L;
    if (t + step >= tEnd) {
      return { status: 'no-contact', lo: tEnd, hi: tEnd, iterations: i + 1, lip: L, eps };
    }
    prev = t;
    t += step;
  }
  return { status: 'stalled', lo: prev, hi: NaN, iterations: maxIter, lip: L, eps };
}

/** Naive fixed-step scanner (the in-repo baseline): reports the first sampled overlap time. */
export function fixedStepScan(c, dt, overlapFn) {
  const tEnd = c.tEnd ?? 1;
  const n = Math.ceil(tEnd / dt);
  const samples = [];
  for (let k = 0; k <= n; k++) {
    const t = Math.min(tEnd, k * dt);
    samples.push(t);
    if (overlapFn(triangleAt(c.t1, t), triangleAt(c.t2, t))) {
      return { hit: true, t, prev: k === 0 ? 0 : samples[k - 1], steps: k + 1, dt };
    }
  }
  return { hit: false, t: NaN, prev: tEnd, steps: n + 1, dt };
}

/** Certificate for one case using the core's own exact distance predicate. */
export function certificate(c, opts = {}) {
  const r = timeOfImpact(c, opts);
  const width = r.status === 'contact' ? r.hi - r.lo : 0;
  return { ...r, width };
}

/**
 * Uniform spatial similarity of a case: positions x s, linear velocity x s,
 * angular velocity UNCHANGED (so the rotation angle at time t is preserved).
 * The whole trajectory is then exactly s times the original one and the time
 * of impact is invariant, which is what makes the scale test meaningful.
 */
export function scaleCase(c, s) {
  const m = (tri) => ({ p: tri.p.map((p) => mul(p, s)), v: mul(tri.v, s), w: tri.w.slice() });
  return { t1: m(c.t1), t2: m(c.t2), tEnd: c.tEnd ?? 1 };
}

/* ------------------------------------------------------------- provenance */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Deterministic digest of a batch of certificates — node and the browser compute the same string. */
export function digest(rows) {
  const s = rows
    .map((r) => `${r.id}:${r.status}:${r.lo.toExponential(9)}:${r.hi.toExponential(9)}`)
    .join('|');
  return fnv1a(s);
}
