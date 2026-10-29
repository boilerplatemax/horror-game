// mii.js — builds a low-poly, flat-shaded Mii character as a single
// SkinnedMesh bound to a Mixamo-compatible humanoid skeleton.
//
// Design notes:
//  * Every body part is a primitive authored directly in the bind ("T") pose
//    world space and bound 100% to a single bone (rigid skinning). Spheres at
//    the joints hide the gaps when limbs bend.
//  * All parts are merged into ONE geometry that carries a per-vertex `color`
//    attribute, so a single MeshStandardMaterial({vertexColors, flatShading})
//    gives us the whole flat-shaded, multi-coloured character in one draw call.
//  * Bones use Mixamo's naming convention (mixamorigHips, mixamorigLeftArm, …)
//    and a standard T-pose, so Mixamo animation clips can be retargeted onto it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Default palette (tweakable via buildMii({ colors }))
// ---------------------------------------------------------------------------
export const DEFAULT_COLORS = {
  skin:  '#f2c9a0',
  shirt: '#f5f6f8',
  pants: '#8d93a0',
  shoes: '#4a4f5a',
  hair:  '#5a3a22',
  brows: '#4a3018',
  eyes:  '#1c1c22',
  mouth: '#8a4a44',
  nose:  '#e3b188',
};

// ---------------------------------------------------------------------------
// Skeleton definition: [mixamorigName, x, y, z, parentName]
// Positions are WORLD-space in the bind (T) pose. +Z faces the camera,
// the character's LEFT is +X (Mixamo convention).
// ---------------------------------------------------------------------------
const SKELETON = [
  ['mixamorigHips',          0.00, 0.84,  0.00, null],
  ['mixamorigSpine',         0.00, 0.95,  0.00, 'mixamorigHips'],
  ['mixamorigSpine1',        0.00, 1.07,  0.00, 'mixamorigSpine'],
  ['mixamorigSpine2',        0.00, 1.20,  0.00, 'mixamorigSpine1'],
  ['mixamorigNeck',          0.00, 1.30,  0.00, 'mixamorigSpine2'],
  ['mixamorigHead',          0.00, 1.38,  0.00, 'mixamorigNeck'],

  ['mixamorigLeftShoulder',  0.06, 1.22,  0.00, 'mixamorigSpine2'],
  ['mixamorigLeftArm',       0.17, 1.20,  0.00, 'mixamorigLeftShoulder'],
  ['mixamorigLeftForeArm',   0.40, 1.20,  0.00, 'mixamorigLeftArm'],
  ['mixamorigLeftHand',      0.58, 1.20,  0.00, 'mixamorigLeftForeArm'],

  ['mixamorigRightShoulder', -0.06, 1.22, 0.00, 'mixamorigSpine2'],
  ['mixamorigRightArm',      -0.17, 1.20, 0.00, 'mixamorigRightShoulder'],
  ['mixamorigRightForeArm',  -0.40, 1.20, 0.00, 'mixamorigRightArm'],
  ['mixamorigRightHand',     -0.58, 1.20, 0.00, 'mixamorigRightForeArm'],

  ['mixamorigLeftUpLeg',      0.12, 0.80, 0.00, 'mixamorigHips'],
  ['mixamorigLeftLeg',        0.12, 0.42, 0.00, 'mixamorigLeftUpLeg'],
  ['mixamorigLeftFoot',       0.12, 0.08, 0.00, 'mixamorigLeftLeg'],

  ['mixamorigRightUpLeg',    -0.12, 0.80, 0.00, 'mixamorigHips'],
  ['mixamorigRightLeg',      -0.12, 0.42, 0.00, 'mixamorigRightUpLeg'],
  ['mixamorigRightFoot',     -0.12, 0.08, 0.00, 'mixamorigRightLeg'],
];

// Short alias -> full mixamorig name, for readable animation code.
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

const HEAD_C = new THREE.Vector3(0, 1.56, 0); // head geometry centre

// ---------------------------------------------------------------------------
// buildMii(options) -> { mesh, skeleton, bones, bonesByName, hipsRestY }
// ---------------------------------------------------------------------------
export function buildMii(options = {}) {
  const colors = { ...DEFAULT_COLORS, ...(options.colors || {}) };

  // --- 1. Build bones (local positions derived from world positions) -------
  const bonesByName = {};
  const bones = [];
  const worldPos = {};

  for (const [name, x, y, z, parent] of SKELETON) {
    const bone = new THREE.Bone();
    bone.name = name;
    worldPos[name] = new THREE.Vector3(x, y, z);
    if (parent) {
      const p = worldPos[parent];
      bone.position.set(x - p.x, y - p.y, z - p.z);
      bonesByName[parent].add(bone);
    } else {
      bone.position.set(x, y, z);
    }
    bonesByName[name] = bone;
    bones.push(bone);
  }
  const root = bonesByName['mixamorigHips'];
  root.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(bones);
  const idx = (name) => bones.indexOf(bonesByName[name]);

  // --- 2. Build geometry parts (bind-pose world space) ---------------------
  const parts = [];
  const W = (n) => worldPos[n];

  // Helpers -----------------------------------------------------------------
  function tag(geo, color, boneIndex) {
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      si[i * 4] = boneIndex;          // bound 100% to one bone
      sw[i * 4] = 1;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    // keep a consistent attribute set for merging
    if (!geo.attributes.uv) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    }
    parts.push(geo);
    return geo;
  }

  const Y = new THREE.Vector3(0, 1, 0);
  function limb(a, b, rTop, rBottom, color, boneName, segments = 8) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(rTop, rBottom, len, segments, 1, false);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir.clone().normalize());
    const mid = a.clone().add(b).multiplyScalar(0.5);
    geo.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    return tag(geo, color, idx(boneName));
  }
  function ball(x, y, z, r, color, boneName, scale = [1, 1, 1], wSeg = 10, hSeg = 8) {
    const geo = new THREE.SphereGeometry(r, wSeg, hSeg);
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion(),
      new THREE.Vector3(scale[0], scale[1], scale[2])));
    return tag(geo, color, idx(boneName));
  }
  function box(x, y, z, w, h, d, color, boneName, rotY = 0) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
    return tag(geo, color, idx(boneName));
  }

  // --- Torso / pelvis ------------------------------------------------------
  // Pelvis (pants) — short flattened block bound to Hips.
  const pelvis = new THREE.CylinderGeometry(0.17, 0.165, 0.22, 10, 1);
  pelvis.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0.85, 0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 0.78)));
  tag(pelvis, colors.pants, idx('mixamorigHips'));

  // Shirt — tapered flattened cylinder bound to Spine1.
  const torso = new THREE.CylinderGeometry(0.205, 0.17, 0.42, 12, 1);
  torso.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(0, 1.08, 0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 0.74)));
  tag(torso, colors.shirt, idx('mixamorigSpine1'));

  // Neck
  limb(W('mixamorigNeck'), new THREE.Vector3(0, 1.40, 0), 0.052, 0.058, colors.skin, 'mixamorigNeck', 8);

  // --- Head ----------------------------------------------------------------
  ball(HEAD_C.x, HEAD_C.y, HEAD_C.z, 0.26, colors.skin, 'mixamorigHead', [1.0, 1.08, 0.95], 14, 12);
  // Ears
  ball(0.255, 1.55, 0, 0.045, colors.skin, 'mixamorigHead', [0.8, 1, 1], 8, 6);
  ball(-0.255, 1.55, 0, 0.045, colors.skin, 'mixamorigHead', [0.8, 1, 1], 8, 6);

  // Hair — top cap + lower back/side piece (leaves the face open).
  const hairCap = new THREE.SphereGeometry(0.281, 16, 12, 0, Math.PI * 2, 0, 1.46);
  hairCap.applyMatrix4(new THREE.Matrix4().compose(
    HEAD_C, new THREE.Quaternion(), new THREE.Vector3(1.0, 1.08, 0.95)));
  tag(hairCap, colors.hair, idx('mixamorigHead'));

  // Lower back/side piece sits just inside the cap so its edges tuck away.
  const hairBack = new THREE.SphereGeometry(0.276, 16, 12, Math.PI * 1.04, Math.PI * 0.92, 0, 1.55);
  hairBack.applyMatrix4(new THREE.Matrix4().compose(
    HEAD_C, new THREE.Quaternion(), new THREE.Vector3(1.0, 1.08, 0.95)));
  tag(hairBack, colors.hair, idx('mixamorigHead'));

  // Face — eyes, brows, nose, mouth. Placed just proud of the face surface.
  ball(0.092, 1.58, 0.238, 1, colors.eyes, 'mixamorigHead', [0.037, 0.052, 0.03], 10, 8);
  ball(-0.092, 1.58, 0.238, 1, colors.eyes, 'mixamorigHead', [0.037, 0.052, 0.03], 10, 8);
  box(0.095, 1.64, 0.226, 0.07, 0.016, 0.02, colors.brows, 'mixamorigHead', 0);
  box(-0.095, 1.64, 0.226, 0.07, 0.016, 0.02, colors.brows, 'mixamorigHead', 0);
  ball(0, 1.548, 0.252, 0.03, colors.nose, 'mixamorigHead', [1, 0.9, 0.9], 8, 6);
  box(0, 1.478, 0.238, 0.075, 0.016, 0.02, colors.mouth, 'mixamorigHead', 0);

  // --- Arms ----------------------------------------------------------------
  // Left
  ball(W('mixamorigLeftArm').x, W('mixamorigLeftArm').y, 0, 0.072, colors.shirt, 'mixamorigLeftArm', [1, 1, 1], 8, 6);
  limb(W('mixamorigLeftArm'), W('mixamorigLeftForeArm'), 0.062, 0.058, colors.shirt, 'mixamorigLeftArm', 8);
  ball(W('mixamorigLeftForeArm').x, W('mixamorigLeftForeArm').y, 0, 0.056, colors.shirt, 'mixamorigLeftForeArm', [1, 1, 1], 8, 6);
  limb(W('mixamorigLeftForeArm'), W('mixamorigLeftHand'), 0.052, 0.05, colors.shirt, 'mixamorigLeftForeArm', 8);
  ball(0.63, 1.20, 0, 0.062, colors.skin, 'mixamorigLeftHand', [1.1, 1, 0.9], 8, 6);
  // Right
  ball(W('mixamorigRightArm').x, W('mixamorigRightArm').y, 0, 0.072, colors.shirt, 'mixamorigRightArm', [1, 1, 1], 8, 6);
  limb(W('mixamorigRightArm'), W('mixamorigRightForeArm'), 0.062, 0.058, colors.shirt, 'mixamorigRightArm', 8);
  ball(W('mixamorigRightForeArm').x, W('mixamorigRightForeArm').y, 0, 0.056, colors.shirt, 'mixamorigRightForeArm', [1, 1, 1], 8, 6);
  limb(W('mixamorigRightForeArm'), W('mixamorigRightHand'), 0.052, 0.05, colors.shirt, 'mixamorigRightForeArm', 8);
  ball(-0.63, 1.20, 0, 0.062, colors.skin, 'mixamorigRightHand', [1.1, 1, 0.9], 8, 6);

  // --- Legs ----------------------------------------------------------------
  for (const side of [
    { up: 'mixamorigLeftUpLeg', lo: 'mixamorigLeftLeg', ft: 'mixamorigLeftFoot', s: 1 },
    { up: 'mixamorigRightUpLeg', lo: 'mixamorigRightLeg', ft: 'mixamorigRightFoot', s: -1 },
  ]) {
    ball(W(side.up).x, W(side.up).y, 0, 0.092, colors.pants, side.up, [1, 1, 1], 8, 6); // hip
    limb(W(side.up), W(side.lo), 0.085, 0.072, colors.pants, side.up, 8);               // thigh
    ball(W(side.lo).x, W(side.lo).y, 0, 0.075, colors.pants, side.lo, [1, 1, 1], 8, 6);  // knee
    limb(W(side.lo), W(side.ft), 0.07, 0.058, colors.pants, side.lo, 8);                 // shin
    // Shoe — rounded block extending forward from the ankle.
    box(side.s * 0.12, 0.045, 0.045, 0.13, 0.10, 0.26, colors.shoes, side.ft, 0);
    ball(side.s * 0.12, 0.08, -0.02, 0.07, colors.shoes, side.ft, [1, 1, 1], 8, 6);       // ankle/heel
  }

  // --- 3. Merge & build the SkinnedMesh ------------------------------------
  const geometry = mergeGeometries(parts, false);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.78,
    metalness: 0.0,
  });

  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.add(root);
  mesh.bind(skeleton);
  mesh.normalizeSkinWeights();

  return {
    mesh,
    skeleton,
    bones,
    bonesByName,
    hipsRestY: root.position.y,
  };
}
