// miiLowpoly.js — a PS1-era low-poly character: blocky, flat-shaded, hard edges,
// segmented limbs (authentic for the era). Same Mixamo-named skeleton as the
// smooth model, so the same animations and head-size control work. The face is
// a flat textured panel (attached by main), like a real Mii / PS1 character.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildFacePatch } from './face.js';

export const DEFAULT_COLORS = {
  skin: '#f2c197', shirt: '#4f9dd6', pants: '#3c4668', shoes: '#d9d4c6', hair: '#6b4327',
};

const SKELETON = [
  ['mixamorigHips', 0, 0.64, 0, null],
  ['mixamorigSpine', 0, 0.74, 0, 'mixamorigHips'],
  ['mixamorigSpine1', 0, 0.84, 0, 'mixamorigSpine'],
  ['mixamorigSpine2', 0, 0.96, 0, 'mixamorigSpine1'],
  ['mixamorigNeck', 0, 1.02, 0, 'mixamorigSpine2'],
  ['mixamorigHead', 0, 1.08, 0, 'mixamorigNeck'],
  ['mixamorigLeftShoulder', 0.09, 0.97, 0, 'mixamorigSpine2'],
  ['mixamorigLeftArm', 0.15, 0.96, 0, 'mixamorigLeftShoulder'],
  ['mixamorigLeftForeArm', 0.33, 0.96, 0, 'mixamorigLeftArm'],
  ['mixamorigLeftHand', 0.50, 0.96, 0, 'mixamorigLeftForeArm'],
  ['mixamorigRightShoulder', -0.09, 0.97, 0, 'mixamorigSpine2'],
  ['mixamorigRightArm', -0.15, 0.96, 0, 'mixamorigRightShoulder'],
  ['mixamorigRightForeArm', -0.33, 0.96, 0, 'mixamorigRightArm'],
  ['mixamorigRightHand', -0.50, 0.96, 0, 'mixamorigRightForeArm'],
  ['mixamorigLeftUpLeg', 0.095, 0.62, 0, 'mixamorigHips'],
  ['mixamorigLeftLeg', 0.095, 0.34, 0, 'mixamorigLeftUpLeg'],
  ['mixamorigLeftFoot', 0.095, 0.07, 0, 'mixamorigLeftLeg'],
  ['mixamorigRightUpLeg', -0.095, 0.62, 0, 'mixamorigHips'],
  ['mixamorigRightLeg', -0.095, 0.34, 0, 'mixamorigRightUpLeg'],
  ['mixamorigRightFoot', -0.095, 0.07, 0, 'mixamorigRightLeg'],
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

export function buildLowpoly(options = {}) {
  const colors = { ...DEFAULT_COLORS, ...(options.colors || {}) };
  const h = Math.max(0.3, Math.min(3, options.headScale || 1));

  const bonesByName = {}, bones = [], worldPos = {};
  for (const [name, x, y, z, parent] of SKELETON) {
    const bone = new THREE.Bone(); bone.name = name;
    worldPos[name] = new THREE.Vector3(x, y, z);
    if (parent) { const p = worldPos[parent]; bone.position.set(x - p.x, y - p.y, z - p.z); bonesByName[parent].add(bone); }
    else bone.position.set(x, y, z);
    bonesByName[name] = bone; bones.push(bone);
  }
  const root = bonesByName['mixamorigHips'];
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const idx = (n) => bones.indexOf(bonesByName[n]);
  const W = (n) => worldPos[n];

  const parts = [];
  function tag(geo, color, bi) {
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3);
    const c = new THREE.Color(color).convertSRGBToLinear();
    for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b; }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    parts.push(geo.toNonIndexed());
  }
  function box(cx, cy, cz, sx, sy, sz, color, bone) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(cx, cy, cz); tag(g, color, idx(bone));
  }
  const Y = new THREE.Vector3(0, 1, 0);
  function cyl(a, b, rt, rb, sides, color, bone) {
    const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length();
    const g = new THREE.CylinderGeometry(rt, rb, len, sides, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir.clone().normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    tag(g, color, idx(bone));
  }
  function sphere(cx, cy, cz, r, scale, ws, hs, color, bone, phiL = Math.PI * 2, thetaS = 0, thetaL = Math.PI) {
    const g = new THREE.SphereGeometry(r, ws, hs, 0, phiL, thetaS, thetaL);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion(), new THREE.Vector3(...scale)));
    tag(g, color, idx(bone));
  }

  // head (low-poly, angular)
  const Rh = 0.28 * h;
  const Cy = 1.02 + Rh;
  sphere(0, Cy, 0, Rh, [1, 1.15, 0.92], 8, 6, colors.skin, 'mixamorigHead');
  // hair cap
  sphere(0, Cy + 0.02 * h, 0, Rh * 1.04, [1.02, 1.12, 0.96], 8, 5, colors.hair, 'mixamorigHead', Math.PI * 2, 0, 1.5);
  sphere(0, Cy + 0.02 * h, 0, Rh * 1.02, [1.02, 1.12, 0.96], 8, 6, colors.hair, 'mixamorigHead', Math.PI * 1.1, Math.PI * 0.95, 1.9);
  // neck
  box(0, 1.0, 0, 0.11, 0.1, 0.11, colors.skin, 'mixamorigNeck');

  // torso + pelvis (blocky)
  box(0, 0.83, 0, 0.30, 0.40, 0.22, colors.shirt, 'mixamorigSpine1');
  box(0, 0.62, 0, 0.29, 0.20, 0.21, colors.pants, 'mixamorigHips');

  for (const [g, A, F, Hd, U, L, Ft] of [
    [1, 'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand', 'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot'],
    [-1, 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand', 'mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot'],
  ]) {
    cyl(new THREE.Vector3(g * 0.15, 0.96, 0), new THREE.Vector3(g * 0.33, 0.96, 0), 0.052, 0.046, 5, colors.shirt, A);
    cyl(new THREE.Vector3(g * 0.33, 0.96, 0), new THREE.Vector3(g * 0.50, 0.96, 0), 0.046, 0.04, 5, colors.shirt, F);
    box(g * 0.545, 0.96, 0, 0.085, 0.085, 0.07, colors.skin, Hd);
    cyl(new THREE.Vector3(g * 0.095, 0.62, 0), new THREE.Vector3(g * 0.095, 0.34, 0), 0.072, 0.06, 5, colors.pants, U);
    cyl(new THREE.Vector3(g * 0.095, 0.34, 0), new THREE.Vector3(g * 0.095, 0.085, 0), 0.06, 0.05, 5, colors.pants, L);
    box(g * 0.095, 0.045, 0.03, 0.1, 0.085, 0.22, colors.shoes, Ft);
  }

  const geometry = mergeGeometries(parts, false);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75, metalness: 0 });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.castShadow = true;
  mesh.add(root);
  mesh.bind(skeleton);
  mesh.normalizeSkinWeights();

  const topY = Cy + Rh * 1.15 + 0.04;
  const radiusAt = (y) => Rh * Math.sqrt(Math.max(1 - ((y - Cy) / (Rh * 1.15)) ** 2, 2e-3));
  const faceGeometry = buildFacePatch({
    radiusAt, yBottom: Cy - Rh * 0.85, yTop: Cy + Rh * 0.15,
    angH: 0.82, eps: 0.02, zScale: 0.92, yOffset: -1.08,
  });
  return {
    mesh, skeleton, bones, bonesByName, headBone: bonesByName['mixamorigHead'],
    hipsRestY: root.position.y, topY, headScale: h, faceGeometry,
  };
}
