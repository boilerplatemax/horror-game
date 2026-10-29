// mii.js — builds a charming chibi character as ONE cohesive, smoothly-skinned
// mesh.
//
// Instead of a pile of overlapping capsules (which show seams where they
// intersect and crease at joints), the body is defined as an IMPLICIT SURFACE:
// a smooth-min blend of tapered capsules (round cones) + an ellipsoid head.
// That field is polygonized with marching cubes into a single watertight skin,
// so overlaps fuse into one surface with filleted joints. Each vertex is then
// auto-skinned with SMOOTH weights (the 2-3 nearest bones, blended), so elbows
// and knees deform as one continuous skin.
//
// Face (eyes, blush, mouth) and hair are separate overlay pieces merged into
// the same mesh — standard practice; they sit flush on the surface.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';

export const DEFAULT_COLORS = {
  skin:  '#ffce9e', nose: '#f2b488', blush: '#ff9d8e',
  shirt: '#5ab7e6', pants: '#54628f', shoes: '#f3efe6',
  hair:  '#6b4327', brows: '#4a2e1a',
  eyeWhite: '#ffffff', pupil: '#2c2e3c', shine: '#ffffff', mouth: '#7c3b38',
};

const SKELETON = [
  ['mixamorigHips',          0.000, 0.64, 0.00, null],
  ['mixamorigSpine',         0.000, 0.74, 0.00, 'mixamorigHips'],
  ['mixamorigSpine1',        0.000, 0.84, 0.00, 'mixamorigSpine'],
  ['mixamorigSpine2',        0.000, 0.96, 0.00, 'mixamorigSpine1'],
  ['mixamorigNeck',          0.000, 1.02, 0.00, 'mixamorigSpine2'],
  ['mixamorigHead',          0.000, 1.08, 0.00, 'mixamorigNeck'],
  ['mixamorigLeftShoulder',  0.090, 0.97, 0.00, 'mixamorigSpine2'],
  ['mixamorigLeftArm',       0.140, 0.96, 0.00, 'mixamorigLeftShoulder'],
  ['mixamorigLeftForeArm',   0.330, 0.96, 0.00, 'mixamorigLeftArm'],
  ['mixamorigLeftHand',      0.500, 0.96, 0.00, 'mixamorigLeftForeArm'],
  ['mixamorigRightShoulder', -0.090, 0.97, 0.00, 'mixamorigSpine2'],
  ['mixamorigRightArm',      -0.140, 0.96, 0.00, 'mixamorigRightShoulder'],
  ['mixamorigRightForeArm',  -0.330, 0.96, 0.00, 'mixamorigRightArm'],
  ['mixamorigRightHand',     -0.500, 0.96, 0.00, 'mixamorigRightForeArm'],
  ['mixamorigLeftUpLeg',      0.095, 0.62, 0.00, 'mixamorigHips'],
  ['mixamorigLeftLeg',        0.095, 0.34, 0.00, 'mixamorigLeftUpLeg'],
  ['mixamorigLeftFoot',       0.095, 0.07, 0.00, 'mixamorigLeftLeg'],
  ['mixamorigRightUpLeg',    -0.095, 0.62, 0.00, 'mixamorigHips'],
  ['mixamorigRightLeg',      -0.095, 0.34, 0.00, 'mixamorigRightUpLeg'],
  ['mixamorigRightFoot',     -0.095, 0.07, 0.00, 'mixamorigRightLeg'],
];

export const BONE = {
  Hips: 'mixamorigHips', Spine: 'mixamorigSpine', Spine1: 'mixamorigSpine1',
  Spine2: 'mixamorigSpine2', Neck: 'mixamorigNeck', Head: 'mixamorigHead',
  LShoulder: 'mixamorigLeftShoulder', LArm: 'mixamorigLeftArm',
  LFore: 'mixamorigLeftForeArm', LHand: 'mixamorigLeftHand',
  RShoulder: 'mixamorigRightShoulder', RArm: 'mixamorigRightArm',
  RFore: 'mixamorigRightForeArm', RHand: 'mixamorigRightHand',
  LUpLeg: 'mixamorigLeftUpLeg', LLeg: 'mixamorigLeftLeg', LFoot: 'mixamorigLeftFoot',
  RUpLeg: 'mixamorigRightUpLeg', RLeg: 'mixamorigRightLeg', RFoot: 'mixamorigRightFoot',
};

const HEAD_BASE_R = 0.26, HEAD_YSCALE = 1.12, HEAD_ANCHOR_Y = 1.02, WAIST_Y = 0.73;
const CELL = 0.024;        // marching-cubes voxel size
const BLEND = 0.05;        // smooth-min radius (joint fillet)

// ---- signed-distance primitives (scalar math, negative = inside) ----------
function sdRoundCone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
function sdEllipsoid(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const dx = (px - cx), dy = (py - cy), dz = (pz - cz);
  const k0 = Math.hypot(dx / rx, dy / ry, dz / rz);
  if (k0 === 0) return -Math.min(rx, ry, rz);
  const k1 = Math.hypot(dx / (rx * rx), dy / (ry * ry), dz / (rz * rz));
  return k0 * (k0 - 1) / k1;
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
// distance from point to a segment core (for skin weighting)
function distSeg(px, py, pz, ax, ay, az, bx, by, bz) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz || 1e-6;
  let t = ((px - ax) * bax + (py - ay) * bay + (pz - az) * baz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + bax * t, cy = ay + bay * t, cz = az + baz * t;
  return Math.hypot(px - cx, py - cy, pz - cz);
}

export function buildMii(options = {}) {
  const colors = { ...DEFAULT_COLORS, ...(options.colors || {}) };
  const h = Math.max(0.3, Math.min(3, options.headScale || 1));

  // --- Bones ---------------------------------------------------------------
  const bonesByName = {}, bones = [], worldPos = {};
  for (const [name, x, y, z, parent] of SKELETON) {
    const bone = new THREE.Bone();
    bone.name = name;
    worldPos[name] = new THREE.Vector3(x, y, z);
    if (parent) { const p = worldPos[parent]; bone.position.set(x - p.x, y - p.y, z - p.z); bonesByName[parent].add(bone); }
    else bone.position.set(x, y, z);
    bonesByName[name] = bone; bones.push(bone);
  }
  const root = bonesByName['mixamorigHips'];
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const boneIdx = (n) => bones.indexOf(bonesByName[n]);

  // --- Implicit body definition (bind pose) --------------------------------
  const Rh = HEAD_BASE_R * h;
  const C = new THREE.Vector3(0, HEAD_ANCHOR_Y + Rh * HEAD_YSCALE, 0);
  const headRadii = [Rh, Rh * HEAD_YSCALE, Rh * 0.95];
  const colL = (c) => new THREE.Color(c).convertSRGBToLinear();
  const cShirt = colL(colors.shirt), cPants = colL(colors.pants),
        cSkin = colL(colors.skin), cShoes = colL(colors.shoes);

  // Each segment: SDF + a core (for skin weighting) + bone + base color + region.
  const segs = [];
  const cone = (ax, ay, az, bx, by, bz, r1, r2, bone, color, region) =>
    segs.push({ kind: 'cone', ax, ay, az, bx, by, bz, r1, r2, reff: Math.max(r1, r2),
                bi: boneIdx(bone), color, region });
  const ballSeg = (cx, cy, cz, r, bone, color, region) =>
    segs.push({ kind: 'ball', ax: cx, ay: cy, az: cz, bx: cx, by: cy, bz: cz, r, reff: r,
                bi: boneIdx(bone), color, region });

  // torso (tapered tube), split across spine bones; colored by waist height
  cone(0, 0.62, 0, 0, 0.82, 0, 0.125, 0.132, 'mixamorigSpine', cShirt, 'torso');
  cone(0, 0.82, 0, 0, 0.99, 0, 0.132, 0.088, 'mixamorigSpine1', cShirt, 'torso');
  cone(0, 0.96, 0, 0, 1.055, 0, 0.052, 0.048, 'mixamorigNeck', cSkin, 'skin');
  segs.push({ kind: 'ellipsoid', cx: C.x, cy: C.y, cz: C.z, rx: headRadii[0], ry: headRadii[1], rz: headRadii[2],
              ax: C.x, ay: C.y, az: C.z, bx: C.x, by: C.y, bz: C.z, reff: Rh, bi: boneIdx('mixamorigHead'), color: cSkin, region: 'skin' });
  for (const [g, A, F, Hd, U, L, Ft] of [
    [1, 'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand', 'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot'],
    [-1, 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand', 'mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot'],
  ]) {
    cone(g * 0.14, 0.96, 0, g * 0.33, 0.96, 0, 0.055, 0.047, A, cShirt, 'skinClothes'); // sleeve
    cone(g * 0.33, 0.96, 0, g * 0.50, 0.96, 0, 0.047, 0.044, F, cShirt, 'skinClothes');
    ballSeg(g * 0.555, 0.96, 0, 0.06, Hd, cSkin, 'skin');                                // ball hand
    cone(g * 0.095, 0.62, 0, g * 0.095, 0.34, 0, 0.072, 0.056, U, cPants, 'legs');       // thigh
    cone(g * 0.095, 0.34, 0, g * 0.095, 0.10, 0, 0.056, 0.05, L, cPants, 'legs');        // shin
    cone(g * 0.095, 0.085, -0.02, g * 0.095, 0.05, 0.12, 0.052, 0.04, Ft, cShoes, 'shoes'); // foot
  }

  function field(x, y, z) {
    let f = 1e9;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const d = s.kind === 'cone'
        ? sdRoundCone(x, y, z, s.ax, s.ay, s.az, s.bx, s.by, s.bz, s.r1, s.r2)
        : s.kind === 'ellipsoid'
          ? sdEllipsoid(x, y, z, s.cx, s.cy, s.cz, s.rx, s.ry, s.rz)
          : Math.hypot(x - s.ax, y - s.ay, z - s.az) - s.r;
      f = smin(f, d, BLEND);
    }
    return f;
  }
  const EPS = CELL * 0.45;
  function grad(x, y, z) {
    const gx = field(x + EPS, y, z) - field(x - EPS, y, z);
    const gy = field(x, y + EPS, z) - field(x, y - EPS, z);
    const gz = field(x, y, z + EPS) - field(x, y, z - EPS);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  }

  // --- Marching cubes over the field --------------------------------------
  const min = [-0.66, -0.02, -0.22], max = [0.66, C.y + headRadii[1] + 0.08, 0.25];
  const nx = Math.ceil((max[0] - min[0]) / CELL), ny = Math.ceil((max[1] - min[1]) / CELL), nz = Math.ceil((max[2] - min[2]) / CELL);
  const gx = nx + 1, gy = ny + 1, gz = nz + 1;
  const grid = new Float32Array(gx * gy * gz);
  const gidx = (i, j, k) => (k * gy + j) * gx + i;
  for (let k = 0; k < gz; k++) { const z = min[2] + k * CELL;
    for (let j = 0; j < gy; j++) { const y = min[1] + j * CELL;
      for (let i = 0; i < gx; i++) grid[gidx(i, j, k)] = field(min[0] + i * CELL, y, z); } }

  const CORN = [[0,0,0],[1,0,0],[1,0,1],[0,0,1],[0,1,0],[1,1,0],[1,1,1],[0,1,1]];
  const ECORN = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  const positions = [], normals = [], vcolors = [], skinI = [], skinW = [];
  const val = new Array(8), cx8 = new Array(8), cy8 = new Array(8), cz8 = new Array(8);
  const vtx = new Array(12);
  const tmpCol = new THREE.Color();

  function emitVertex(px, py, pz) {
    positions.push(px, py, pz);
    const n = grad(px, py, pz); normals.push(n[0], n[1], n[2]);
    // skin weights: nearest segments by inverse distance, top 4
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, w0 = 0, w1 = 0, w2 = 0, w3 = 0, best = -1, bestW = -1;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const d = distSeg(px, py, pz, s.ax, s.ay, s.az, s.bx, s.by, s.bz);
      const w = Math.pow(s.reff / (d + 1e-4), 3);
      if (w > bestW) { bestW = w; best = i; }
      if (w > w0) { w3=w2;b3=b2; w2=w1;b2=b1; w1=w0;b1=b0; w0=w;b0=s.bi; }
      else if (w > w1) { w3=w2;b3=b2; w2=w1;b2=b1; w1=w;b1=s.bi; }
      else if (w > w2) { w3=w2;b3=b2; w2=w;b2=s.bi; }
      else if (w > w3) { w3=w;b3=s.bi; }
    }
    const sum = w0 + w1 + w2 + w3 || 1;
    skinI.push(b0, b1, b2, b3);
    skinW.push(w0 / sum, w1 / sum, w2 / sum, w3 / sum);
    // color from the dominant segment (crisp clothing edges); torso by waist line
    const s = segs[best];
    let c = s.color;
    if (s.region === 'torso') c = py < WAIST_Y ? cPants : cShirt;
    vcolors.push(c.r, c.g, c.b);
  }

  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let cube = 0;
    for (let c = 0; c < 8; c++) {
      const o = CORN[c], ii = i + o[0], jj = j + o[1], kk = k + o[2];
      const v = grid[gidx(ii, jj, kk)];
      val[c] = v; cx8[c] = min[0] + ii * CELL; cy8[c] = min[1] + jj * CELL; cz8[c] = min[2] + kk * CELL;
      if (v < 0) cube |= (1 << c);
    }
    const e = edgeTable[cube];
    if (e === 0) continue;
    for (let b = 0; b < 12; b++) {
      if (e & (1 << b)) {
        const [a, d] = ECORN[b];
        let t = (0 - val[a]) / (val[d] - val[a]); if (!isFinite(t)) t = 0.5;
        vtx[b] = [cx8[a] + t * (cx8[d] - cx8[a]), cy8[a] + t * (cy8[d] - cy8[a]), cz8[a] + t * (cz8[d] - cz8[a])];
      }
    }
    const base = cube * 16;
    for (let t = 0; triTable[base + t] !== -1; t += 3) {
      const a = vtx[triTable[base + t]], b = vtx[triTable[base + t + 1]], c = vtx[triTable[base + t + 2]];
      // orient outward using the field gradient at the centroid
      const mx = (a[0]+b[0]+c[0])/3, my = (a[1]+b[1]+c[1])/3, mz = (a[2]+b[2]+c[2])/3;
      const g = grad(mx, my, mz);
      const ux=b[0]-a[0], uy=b[1]-a[1], uz=b[2]-a[2], vx=c[0]-a[0], vy=c[1]-a[1], vz=c[2]-a[2];
      const fnx=uy*vz-uz*vy, fny=uz*vx-ux*vz, fnz=ux*vy-uy*vx;
      if (fnx*g[0]+fny*g[1]+fnz*g[2] < 0) { emitVertex(...a); emitVertex(...c); emitVertex(...b); }
      else { emitVertex(...a); emitVertex(...b); emitVertex(...c); }
    }
  }

  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  body.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  body.setAttribute('color', new THREE.Float32BufferAttribute(vcolors, 3));
  body.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI, 4));
  body.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
  body.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));

  // --- Overlays: face + hair (rigid to the head bone) ---------------------
  const overlays = [];
  const hi = boneIdx('mixamorigHead');
  function tagOverlay(geo, color) {
    geo = geo.toNonIndexed();
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3);
    const c = colL(color);
    for (let i = 0; i < n; i++) { si[i * 4] = hi; sw[i * 4] = 1; col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b; }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    overlays.push(geo);
  }
  const headBall = (ox, oy, oz, r, scale, color, euler = null) => {
    const geo = new THREE.SphereGeometry(r * h, 22, 16);
    const q = euler ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler)) : new THREE.Quaternion();
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(C.x + h * ox, C.y + h * oy, C.z + h * oz), q, new THREE.Vector3(scale[0], scale[1], scale[2])));
    tagOverlay(geo, color);
  };
  // hair cap + lower back
  const hairMat = new THREE.Matrix4().compose(C, new THREE.Quaternion(), new THREE.Vector3(h * 1.03, h * HEAD_YSCALE * 1.02, h * 0.99));
  const cap = new THREE.SphereGeometry(HEAD_BASE_R + 0.012, 30, 24, 0, Math.PI * 2, 0, 1.42); cap.applyMatrix4(hairMat); tagOverlay(cap, colors.hair);
  const back = new THREE.SphereGeometry(HEAD_BASE_R + 0.004, 30, 24, Math.PI * 1.02, Math.PI * 0.96, 0, 1.6); back.applyMatrix4(hairMat); tagOverlay(back, colors.hair);
  // face
  for (const s of [1, -1]) {
    headBall(s * 0.105, -0.005, 0.205, 0.062, [1.0, 1.32, 0.52], colors.eyeWhite);
    headBall(s * 0.112, -0.012, 0.235, 0.042, [1.0, 1.3, 0.6], colors.pupil);
    headBall(s * 0.132, 0.03, 0.262, 0.016, [1, 1, 1], colors.shine);
    headBall(s * 0.108, 0.07, 0.212, 0.044, [1.35, 0.26, 0.5], colors.brows, [0, 0, s * -0.16]);
    headBall(s * 0.172, -0.058, 0.178, 0.046, [1.2, 0.85, 0.34], colors.blush);
  }
  headBall(0, -0.03, 0.245, 0.021, [1, 0.85, 0.9], colors.nose);
  {
    const geo = new THREE.TorusGeometry(0.042 * h, 0.011 * h, 10, 24, Math.PI);
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(C.x, C.y - h * 0.088, C.z + h * 0.222),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)), new THREE.Vector3(1, 1, 1)));
    tagOverlay(geo, colors.mouth);
  }

  // --- Merge & build -------------------------------------------------------
  const geometry = mergeGeometries([body, ...overlays], false);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: false, roughness: 0.52, metalness: 0.0, envMapIntensity: 0.75,
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.castShadow = true;
  mesh.add(root);
  mesh.bind(skeleton);
  mesh.normalizeSkinWeights();

  const topY = C.y + Rh * HEAD_YSCALE + h * 0.05;
  return { mesh, skeleton, bones, bonesByName, hipsRestY: root.position.y, topY, headScale: h };
}
