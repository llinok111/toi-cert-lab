/**
 * Independent oracle for triangle/triangle overlap and for the dense first-contact scan.
 *
 * Written as a deliberate second implementation: it uses 11-axis SAT for the
 * non-parallel plane case, and barycentric point-in-triangle + 2D segment
 * crossing for the coplanar case. It shares NO constant with src/core.mjs
 * (which uses a closest-point distance and a Moller-Trumbore edge pierce test).
 * Read-only by construction.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a) => Math.sqrt(dot(a, a));
const ORACLE_TOL = 1e-13; // [DISCLOSED] oracle-side relative tolerance (independent of core's 1e-12)

function spanOf(A, B) {
  let mn = Infinity;
  let mx = -Infinity;
  for (const p of [...A, ...B]) for (let k = 0; k < 3; k++) {
    if (p[k] < mn) mn = p[k];
    if (p[k] > mx) mx = p[k];
  }
  return Math.max(1e-300, mx - mn);
}

function normal(a, b, c) {
  return cross(sub(b, a), sub(c, a));
}

function project(pts, ax) {
  let mn = Infinity;
  let mx = -Infinity;
  for (const p of pts) {
    const s = dot(p, ax);
    if (s < mn) mn = s;
    if (s > mx) mx = s;
  }
  return [mn, mx];
}

function pointInTri2(p, a, b, c, tol) {
  const v0 = [b[0] - a[0], b[1] - a[1]];
  const v1 = [c[0] - a[0], c[1] - a[1]];
  const v2 = [p[0] - a[0], p[1] - a[1]];
  const d00 = v0[0] * v0[0] + v0[1] * v0[1];
  const d01 = v0[0] * v1[0] + v0[1] * v1[1];
  const d11 = v1[0] * v1[0] + v1[1] * v1[1];
  const d20 = v2[0] * v0[0] + v2[1] * v0[1];
  const d21 = v2[0] * v1[0] + v2[1] * v1[1];
  const den = d00 * d11 - d01 * d01;
  if (Math.abs(den) < 1e-300) return false;
  const u = (d11 * d20 - d01 * d21) / den;
  const v = (d00 * d21 - d01 * d20) / den;
  return u >= -tol && v >= -tol && u + v <= 1 + tol;
}

function segCross2(p1, q1, p2, q2) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(p2, q2, p1);
  const d2 = o(p2, q2, q1);
  const d3 = o(p1, q1, p2);
  const d4 = o(p1, q1, q2);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

/** Independent boolean: do A and B touch/intersect? */
export function oracleOverlap(A, B) {
  const tol = ORACLE_TOL * spanOf(A, B);
  const n1 = normal(A[0], A[1], A[2]);
  const n2 = normal(B[0], B[1], B[2]);
  const l1 = len(n1);
  const l2 = len(n2);
  if (l1 < 1e-300 || l2 < 1e-300) return false; // degenerate triangles never "touch"
  const parallel = len(cross(n1, n2)) <= 1e-9 * l1 * l2;
  if (!parallel) {
    const axes = [n1, n2];
    for (let i = 0; i < 3; i++) {
      const e1 = sub(A[(i + 1) % 3], A[i]);
      for (let j = 0; j < 3; j++) {
        const e2 = sub(B[(j + 1) % 3], B[j]);
        axes.push(cross(e1, e2));
      }
    }
    for (const ax of axes) {
      const al = len(ax);
      if (al <= 1e-300) continue;
      const u = [ax[0] / al, ax[1] / al, ax[2] / al];
      const [mnA, mxA] = project(A, u);
      const [mnB, mxB] = project(B, u);
      if (Math.min(mxA, mxB) - Math.max(mnA, mnB) < -tol) return false;
    }
    return true;
  }
  // parallel planes: separated along the normal?
  const u = [n2[0] / l2, n2[1] / l2, n2[2] / l2];
  if (Math.abs(dot(sub(A[0], B[0]), u)) > tol) return false;
  // coplanar: barycentric containment + 2D edge crossing
  const ax = Math.abs(u[0]) >= Math.abs(u[1]) && Math.abs(u[0]) >= Math.abs(u[2]) ? 0 : Math.abs(u[1]) >= Math.abs(u[2]) ? 1 : 2;
  const i = (ax + 1) % 3;
  const j = (ax + 2) % 3;
  const A2 = A.map((p) => [p[i], p[j]]);
  const B2 = B.map((p) => [p[i], p[j]]);
  for (const p of A2) if (pointInTri2(p, B2[0], B2[1], B2[2], 1e-12)) return true;
  for (const p of B2) if (pointInTri2(p, A2[0], A2[1], A2[2], 1e-12)) return true;
  for (let e = 0; e < 3; e++) {
    for (let f = 0; f < 3; f++) {
      if (segCross2(A2[e], A2[(e + 1) % 3], B2[f], B2[(f + 1) % 3])) return true;
    }
  }
  return false;
}

/** Dense brute-force scan using the oracle predicate only. */
export function oracleFirstContact(caseObj, dt, core) {
  const tEnd = caseObj.tEnd ?? 1;
  const n = Math.ceil(tEnd / dt);
  for (let k = 0; k <= n; k++) {
    const t = Math.min(tEnd, k * dt);
    if (oracleOverlap(core.triangleAt(caseObj.t1, t), core.triangleAt(caseObj.t2, t))) {
      return { contact: true, tFirst: t, tPrev: k === 0 ? 0 : Math.max(0, t - dt), samples: k + 1 };
    }
  }
  return { contact: false, tFirst: NaN, tPrev: tEnd, samples: n + 1 };
}
