// mii.js — builds a charming, chibi-proportioned character as a single
// SkinnedMesh bound to a Mixamo-compatible humanoid skeleton.
//
// Charm comes from: big head + small rounded body, capsule limbs with
// overlapping ends (so joints blend), SMOOTH shading, soft PBR materials,
// and an expressive face (big shiny eyes with catchlights, blush, a smile).
//
// Rigging: every part is a primitive authored in the bind ("T") pose world
// space and bound 100% to a single bone (rigid skinning); capsule caps and
// joint balls overlap to hide the seams when limbs bend. All parts merge into
// ONE geometry carrying a per-vertex `color`, so a single smooth
// MeshStandardMaterial draws the whole character.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Palette — warm, cohesive, Animal-Crossing-ish
// ---------------------------------------------------------------------------
export const DEFAULT_COLORS = {
  skin:  '#ffce9e',
  nose:  '#f2b488',
  blush: '#ff9d8e',
  shirt: '#5ab7e6',
  pants: '#54628f',
  shoes: '#f3efe6',
  hair:  '#6b4327',
  brows: '#4a2e1a',
  eyeWhite: '#ffffff',
  pupil: '#2c2e3c',
  shine: '#ffffff',
  mouth: '#7c3b38',
};

// Skeleton: [mixamorigName, x, y, z, parent]. Bind (T) pose, +Z toward camera,
// character's LEFT is +X (Mixamo convention). Chibi proportions.
const SKELETON = [
  ['mixamorigHips',          0.00, 0.52, 0.00, null],
  ['mixamorigSpine',         0.00, 0.58, 0.00, 'mixamorigHips'],
  ['mixamorigSpine1',        0.00, 0.65, 0.00, 'mixamorigSpine'],
  ['mixamorigSpine2',        0.00, 0.73, 0.00, 'mixamorigSpine1'],
  ['mixamorigNeck',          0.00, 0.79, 0.00, 'mixamorigSpine2'],
  ['mixamorigHead',          0.00, 0.85, 0.00, 'mixamorigNeck'],

  ['mixamorigLeftShoulder',  0.07, 0.75, 0.00, 'mixamorigSpine2'],
  ['mixamorigLeftArm',       0.16, 0.73, 0.00, 'mixamorigLeftShoulder'],
  ['mixamorigLeftForeArm',   0.28, 0.73, 0.00, 'mixamorigLeftArm'],
  ['mixamorigLeftHand',      0.38, 0.73, 0.00, 'mixamorigLeftForeArm'],

  ['mixamorigRightShoulder', -0.07, 0.75, 0.00, 'mixamorigSpine2'],
  ['mixamorigRightArm',      -0.16, 0.73, 0.00, 'mixamorigRightShoulder'],
  ['mixamorigRightForeArm',  -0.28, 0.73, 0.00, 'mixamorigRightArm'],
  ['mixamorigRightHand',     -0.38, 0.73, 0.00, 'mixamorigRightForeArm'],

  ['mixamorigLeftUpLeg',      0.10, 0.50, 0.00, 'mixamorigHips'],
  ['mixamorigLeftLeg',        0.10, 0.28, 0.00, 'mixamorigLeftUpLeg'],
  ['mixamorigLeftFoot',       0.10, 0.07, 0.00, 'mixamorigLeftLeg'],

  ['mixamorigRightUpLeg',    -0.10, 0.50, 0.00, 'mixamorigHips'],
  ['mixamorigRightLeg',      -0.10, 0.28, 0.00, 'mixamorigRightUpLeg'],
  ['mixamorigRightFoot',     -0.10, 0.07, 0.00, 'mixamorigRightLeg'],
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

const HEAD_C = new THREE.Vector3(0, 1.20, 0);
const HEAD_R = 0.38;

export function buildMii(options = {}) {
  const colors = { ...DEFAULT_COLORS, ...(options.colors || {}) };

  // --- Bones ---------------------------------------------------------------
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
  const W = (n) => worldPos[n];

  // --- Geometry helpers ----------------------------------------------------
  const parts = [];
  function tag(geo, color, boneIndex) {
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color(color).convertSRGBToLinear();
    for (let i = 0; i < n; i++) {
      si[i * 4] = boneIndex;
      sw[i * 4] = 1;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (!geo.attributes.uv) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    }
    parts.push(geo);
    return geo;
  }

  const Y = new THREE.Vector3(0, 1, 0);
  function capsule(a, b, r, color, boneName) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CapsuleGeometry(r, Math.max(len, 0.001), 10, 18);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir.clone().normalize());
    const mid = a.clone().add(b).multiplyScalar(0.5);
    geo.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    return tag(geo, color, idx(boneName));
  }
  function ball(x, y, z, r, color, boneName, scale = [1, 1, 1], euler = null) {
    const geo = new THREE.SphereGeometry(r, 24, 18);
    const q = euler ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler)) : new THREE.Quaternion();
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale[0], scale[1], scale[2])));
    return tag(geo, color, idx(boneName));
  }
  function torusArc(x, y, z, R, tube, color, boneName, euler) {
    const geo = new THREE.TorusGeometry(R, tube, 10, 24, Math.PI);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler));
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
    return tag(geo, color, idx(boneName));
  }

  // --- Torso / hips / neck -------------------------------------------------
  ball(0, 0.52, 0, 1, colors.pants, 'mixamorigHips', [0.20, 0.14, 0.18]);   // hips/pants
  ball(0, 0.67, 0, 1, colors.shirt, 'mixamorigSpine1', [0.235, 0.24, 0.205]); // shirt body
  capsule(new THREE.Vector3(0, 0.74, 0), new THREE.Vector3(0, 0.84, 0), 0.055, colors.skin, 'mixamorigNeck');

  // --- Head ----------------------------------------------------------------
  ball(HEAD_C.x, HEAD_C.y, HEAD_C.z, HEAD_R, colors.skin, 'mixamorigHead', [1.0, 1.04, 0.97]);
  ball(0.372, 1.20, 0, 0.05, colors.skin, 'mixamorigHead', [0.7, 1, 1]);  // ears
  ball(-0.372, 1.20, 0, 0.05, colors.skin, 'mixamorigHead', [0.7, 1, 1]);

  // Hair: cap + lower back + a little fringe + cowlick.
  const hairCap = new THREE.SphereGeometry(0.40, 28, 22, 0, Math.PI * 2, 0, 1.4);
  hairCap.applyMatrix4(new THREE.Matrix4().compose(HEAD_C, new THREE.Quaternion(), new THREE.Vector3(1.01, 1.05, 0.99)));
  tag(hairCap, colors.hair, idx('mixamorigHead'));
  const hairBack = new THREE.SphereGeometry(0.395, 28, 22, Math.PI * 1.02, Math.PI * 0.96, 0, 1.62);
  hairBack.applyMatrix4(new THREE.Matrix4().compose(HEAD_C, new THREE.Quaternion(), new THREE.Vector3(1.01, 1.05, 0.99)));
  tag(hairBack, colors.hair, idx('mixamorigHead'));
  ball(0, 1.30, 0.30, 1, colors.hair, 'mixamorigHead', [0.22, 0.07, 0.08]);           // fringe
  ball(0.05, 1.56, -0.03, 0.055, colors.hair, 'mixamorigHead', [1, 1.6, 1], [0.5, 0, 0.3]); // cowlick

  // Face --------------------------------------------------------------------
  // eyes: white base + pupil + catchlight
  for (const s of [1, -1]) {
    ball(s * 0.15, 1.175, 0.335, 1, colors.eyeWhite, 'mixamorigHead', [0.085, 0.115, 0.05]);
    ball(s * 0.155, 1.17, 0.365, 1, colors.pupil, 'mixamorigHead', [0.058, 0.08, 0.045]);
    ball(s * 0.175, 1.20, 0.40, 0.02, colors.shine, 'mixamorigHead', [1, 1, 1]);
    // eyebrow
    ball(s * 0.15, 1.275, 0.33, 1, colors.brows, 'mixamorigHead', [0.075, 0.016, 0.03], [0, 0, s * -0.12]);
    // blush
    ball(s * 0.235, 1.115, 0.285, 1, colors.blush, 'mixamorigHead', [0.062, 0.045, 0.02]);
  }
  ball(0, 1.14, 0.37, 0.024, colors.nose, 'mixamorigHead', [1, 0.85, 0.9]);  // nose
  torusArc(0, 1.085, 0.355, 0.045, 0.013, colors.mouth, 'mixamorigHead', [0, 0, Math.PI]); // smile

  // --- Arms ----------------------------------------------------------------
  for (const s of [{ a: 'mixamorigLeftArm', f: 'mixamorigLeftForeArm', h: 'mixamorigLeftHand', g: 1 },
                   { a: 'mixamorigRightArm', f: 'mixamorigRightForeArm', h: 'mixamorigRightHand', g: -1 }]) {
    ball(W(s.a).x, W(s.a).y, 0, 0.068, colors.shirt, s.a);                 // shoulder
    capsule(W(s.a), W(s.f), 0.055, colors.shirt, s.a);                     // upper arm
    capsule(W(s.f), W(s.h), 0.05, colors.shirt, s.f);                      // forearm
    ball(s.g * 0.42, 0.73, 0, 0.07, colors.skin, s.h, [1.1, 1.0, 0.95]);   // mitten hand
  }

  // --- Legs ----------------------------------------------------------------
  for (const s of [{ u: 'mixamorigLeftUpLeg', l: 'mixamorigLeftLeg', f: 'mixamorigLeftFoot', g: 1 },
                   { u: 'mixamorigRightUpLeg', l: 'mixamorigRightLeg', f: 'mixamorigRightFoot', g: -1 }]) {
    ball(W(s.u).x, W(s.u).y, 0, 0.082, colors.pants, s.u);                 // hip
    capsule(W(s.u), W(s.l), 0.072, colors.pants, s.u);                     // thigh
    capsule(W(s.l), W(s.f), 0.06, colors.pants, s.l);                      // shin
    ball(s.g * 0.10, 0.05, 0.045, 1, colors.shoes, s.f, [0.085, 0.062, 0.125]); // rounded shoe
    ball(s.g * 0.10, 0.075, -0.015, 0.062, colors.shoes, s.f);            // heel
  }

  // --- Merge & build -------------------------------------------------------
  const geometry = mergeGeometries(parts, false);

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    roughness: 0.5,
    metalness: 0.0,
    envMapIntensity: 0.75,
  });

  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.castShadow = true;
  mesh.add(root);
  mesh.bind(skeleton);
  mesh.normalizeSkinWeights();

  return { mesh, skeleton, bones, bonesByName, hipsRestY: root.position.y };
}
