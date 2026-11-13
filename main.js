// Render + interaction only. Every number shown comes from src/core.mjs.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { certificate, digest, triangleAt } from './src/core.mjs';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 200);
camera.position.set(4.5, 3.2, 5.5);
const controls = new OrbitControls(camera, renderer.domElement);

scene.add(new THREE.GridHelper(8, 16, 0x30363d, 0x21262d));
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(5, 8, 6);
scene.add(key);

function tmesh(color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const m = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, flatShading: true });
  return new THREE.Mesh(g, m);
}
const meshA = tmesh(0x58a6ff);
const meshB = tmesh(0xf0883e);
scene.add(meshA, meshB);
const marker = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: 0x3fb950 }));
scene.add(marker);

const cases = [];
let current = null;
let cert = null;

function fit(c) {
  const pts = [...c.t1.p, ...c.t2.p];
  const box = new THREE.Box3();
  pts.forEach((p) => box.expandByPoint(new THREE.Vector3(...p)));
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  controls.target.set(0, 0, 0);
  camera.position.copy(new THREE.Vector3(1.4, 1.0, 1.7).multiplyScalar(size * 1.5));
}

function draw(t) {
  const A = triangleAt(current.t1, t);
  const B = triangleAt(current.t2, t);
  [meshA, meshB].forEach((m, i) => {
    const v = i === 0 ? A : B;
    const a = m.geometry.attributes.position;
    v.forEach((p, k) => a.setXYZ(k, p[0], p[1], p[2]));
    a.needsUpdate = true;
    m.geometry.computeVertexNormals();
    m.geometry.computeBoundingSphere();
  });
  const mid = cert && cert.status === 'contact' && cert.hi > 0 ? (cert.lo + cert.hi) / 2 : 0;
  const [p, q] = [triangleAt(current.t1, mid)[0], triangleAt(current.t2, mid)[0]];
  marker.position.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
  marker.visible = !!(cert && cert.status === 'contact' && cert.hi > 0);
}

const $ = (id) => document.getElementById(id);
function show(t) {
  $('tval').textContent = t.toFixed(3);
  draw(t);
}

fetch('./data/cases.json')
  .then((r) => r.json())
  .then((data) => {
    cases.push(...data.cases);
    const sel = $('pick');
    cases.forEach((c, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      const r = certificate(c);
      o.textContent = `${c.id} → ${r.status}${r.status === 'contact' && r.hi > 0 ? ` [${r.lo.toExponential(2)}, ${r.hi.toExponential(2)}]` : ''}`;
      sel.appendChild(o);
    });
    const pick = (i) => {
      current = cases[i];
      cert = certificate(current);
      fit(current);
      $('status').textContent = cert.status;
      $('status').className = cert.status === 'contact' ? 'pass' : '';
      $('lo').textContent = cert.hi > 0 ? cert.lo.toExponential(6) : '—';
      $('hi').textContent = cert.hi > 0 ? cert.hi.toExponential(6) : (cert.status === 'no-contact' ? 'no contact in [0,1]' : '—');
      $('w').textContent = cert.status === 'contact' && cert.hi > 0 ? (cert.hi - cert.lo).toExponential(3) : '—';
      $('it').textContent = String(cert.iterations);
      $('lip').textContent = cert.lip.toFixed(4);
      $('dg').textContent = digest(cases.map((c) => ({ id: c.id, ...certificate(c) })));
      $('t').value = '0';
      show(0);
    };
    sel.addEventListener('change', () => pick(Number(sel.value)));
    pick(0);
  });

$('t').addEventListener('input', (e) => show(Number(e.target.value)));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
(function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
})();
