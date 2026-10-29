// mii.js — builds a charming chibi character as a single SkinnedMesh bound to
// a Mixamo-compatible humanoid skeleton.
//
// Proportions follow a tall-ish "Mii" template: egg head, a long tapered
// TUBE torso (capsules, not a ball), thin tube limbs with little ball hands
// and feet. The head size is adjustable (options.headScale) so you can slide
// the head-to-body ratio from small to huge.
//
// Rigging: every part is a primitive authored in the bind ("T") pose world
// space, bound 100% to one bone (rigid skinning); capsule caps and joint balls
// overlap so seams blend when limbs bend. All parts merge into ONE geometry
// with a per-vertex `color`, drawn by a single smooth MeshStandardMaterial.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
// character's LEFT is +X (Mixamo convention). Taller, lankier template.
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

const HEAD_BASE_R = 0.26;         // base egg radius (headScale = 1)
const HEAD_YSCALE = 1.12;         // egg is taller than wide
const HEAD_ANCHOR_Y = 1.02;       // head's underside rests here, regardless of size

export function buildMii(options = {}) {
  const colors = { ...DEFAULT_COLORS, ...(options.colors || {}) };
  const h = Math.max(0.3, Math.min(3, options.headScale || 1)); // head-to-body ratio

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
  function capsule(a, b, r, color, boneName, sz = 1) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CapsuleGeometry(r, Math.max(len, 0.001), 10, 18);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir.clone().normalize());
    const mid = a.clone().add(b).multiplyScalar(0.5);
    geo.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, sz)));
    return tag(geo, color, idx(boneName));
  }
  function ball(x, y, z, r, color, boneName, scale = [1, 1, 1], euler = null) {
    const geo = new THREE.SphereGeometry(r, 24, 18);
    const q = euler ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler)) : new THREE.Quaternion();
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale[0], scale[1], scale[2])));
    return tag(geo, color, idx(boneName));
  }

  // --- Torso: long tapered TUBE (two flattened capsules) -------------------
  capsule(new THREE.Vector3(0, 0.70, 0), new THREE.Vector3(0, 0.98, 0), 0.118, colors.shirt, 'mixamorigSpine1', 0.82); // shirt
  capsule(new THREE.Vector3(0, 0.60, 0), new THREE.Vector3(0, 0.72, 0), 0.108, colors.pants, 'mixamorigHips', 0.82);   // pelvis/pants
  capsule(new THREE.Vector3(0, 1.00, 0), new THREE.Vector3(0, 1.08, 0), 0.044, colors.skin, 'mixamorigNeck');          // neck

  // --- Head (scales with `h`) ---------------------------------------------
  const C = new THREE.Vector3(0, HEAD_ANCHOR_Y + HEAD_BASE_R * HEAD_YSCALE * h, 0);
  const headBall = (ox, oy, oz, r, scale, color, euler = null) =>
    ball(C.x + h * ox, C.y + h * oy, C.z + h * oz, r * h, color, 'mixamorigHead', scale, euler);

  headBall(0, 0, 0, HEAD_BASE_R, [1.0, HEAD_YSCALE, 0.95], colors.skin);         // head egg
  headBall(0.252, -0.01, 0, 0.045, [0.6, 1, 1], colors.skin);                    // ears
  headBall(-0.252, -0.01, 0, 0.045, [0.6, 1, 1], colors.skin);

  // hair cap + lower back + fringe + cowlick (all scale with head)
  const hairMat = new THREE.Matrix4().compose(C, new THREE.Quaternion(), new THREE.Vector3(h * 1.02, h * HEAD_YSCALE * 1.01, h * 0.97));
  const hairCap = new THREE.SphereGeometry(HEAD_BASE_R + 0.012, 28, 22, 0, Math.PI * 2, 0, 1.42);
  hairCap.applyMatrix4(hairMat); tag(hairCap, colors.hair, idx('mixamorigHead'));
  const hairBack = new THREE.SphereGeometry(HEAD_BASE_R + 0.006, 28, 22, Math.PI * 1.02, Math.PI * 0.96, 0, 1.6);
  hairBack.applyMatrix4(hairMat); tag(hairBack, colors.hair, idx('mixamorigHead'));

  // face
  for (const s of [1, -1]) {
    headBall(s * 0.105, -0.005, 0.205, 0.062, [1.0, 1.32, 0.52], colors.eyeWhite);
    headBall(s * 0.112, -0.012, 0.235, 0.042, [1.0, 1.3, 0.6], colors.pupil);
    headBall(s * 0.132, 0.03, 0.262, 0.016, [1, 1, 1], colors.shine);
    headBall(s * 0.108, 0.07, 0.212, 0.044, [1.35, 0.26, 0.5], colors.brows, [0, 0, s * -0.16]);
    headBall(s * 0.172, -0.058, 0.178, 0.046, [1.2, 0.85, 0.34], colors.blush);
  }
  headBall(0, -0.03, 0.245, 0.021, [1, 0.85, 0.9], colors.nose);
  // smile
  {
    const geo = new THREE.TorusGeometry(0.042 * h, 0.011 * h, 10, 24, Math.PI);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI));
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(C.x, C.y - h * 0.088, C.z + h * 0.222), q, new THREE.Vector3(1, 1, 1)));
    tag(geo, colors.mouth, idx('mixamorigHead'));
  }

  // --- Arms (thin tubes + ball hands) --------------------------------------
  for (const s of [{ a: 'mixamorigLeftArm', f: 'mixamorigLeftForeArm', hd: 'mixamorigLeftHand', g: 1 },
                   { a: 'mixamorigRightArm', f: 'mixamorigRightForeArm', hd: 'mixamorigRightHand', g: -1 }]) {
    ball(W(s.a).x, W(s.a).y, 0, 0.056, colors.shirt, s.a);                // shoulder
    capsule(W(s.a), W(s.f), 0.043, colors.shirt, s.a);                    // upper arm
    capsule(W(s.f), W(s.hd), 0.039, colors.shirt, s.f);                   // forearm
    ball(s.g * 0.545, 0.96, 0, 0.06, colors.skin, s.hd, [1.05, 1.0, 0.95]); // ball hand
  }

  // --- Legs (thin tubes + little feet) -------------------------------------
  for (const s of [{ u: 'mixamorigLeftUpLeg', l: 'mixamorigLeftLeg', f: 'mixamorigLeftFoot', g: 1 },
                   { u: 'mixamorigRightUpLeg', l: 'mixamorigRightLeg', f: 'mixamorigRightFoot', g: -1 }]) {
    ball(W(s.u).x, W(s.u).y, 0, 0.066, colors.pants, s.u);                // hip
    capsule(W(s.u), W(s.l), 0.052, colors.pants, s.u);                    // thigh
    capsule(W(s.l), W(s.f), 0.045, colors.pants, s.l);                    // shin
    ball(s.g * 0.095, 0.045, 0.05, 1, colors.shoes, s.f, [0.07, 0.052, 0.11]); // shoe
    ball(s.g * 0.095, 0.075, -0.015, 0.052, colors.shoes, s.f);           // heel
  }

  // --- Merge & build -------------------------------------------------------
  const geometry = mergeGeometries(parts, false);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: false, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.75,
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.castShadow = true;
  mesh.add(root);
  mesh.bind(skeleton);
  mesh.normalizeSkinWeights();

  const topY = C.y + h * HEAD_BASE_R * HEAD_YSCALE + h * 0.08; // incl. hair
  return { mesh, skeleton, bones, bonesByName, hipsRestY: root.position.y, topY, headScale: h };
}
