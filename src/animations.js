// animations.js — hand-authored AnimationClips for the Mii rig.
//
// Each clip is expressed as per-bone Euler keyframes (degrees, XYZ order),
// which are baked into QuaternionKeyframeTracks. The Hips bone can also carry
// a position track (absolute local position) for bobbing / jumping.
//
// Bone rest orientations (T-pose): arms point straight out along ±X, legs
// point down along -Y. So "arms down" = rotate the arm bones ~±78° about Z.

import * as THREE from 'three';
import { BONE } from './mii.js';

const D = Math.PI / 180;
// Hip rest height + vertical-motion scale are set by createClips() so the
// clips follow the character's proportions (chibi hips sit lower than before).
let HIP_Y = 0.52;
let VSCALE = 0.52 / 0.84;

// Build one QuaternionKeyframeTrack from Euler keyframes.
function quatTrack(boneName, times, eulersDeg) {
  const values = new Float32Array(eulersDeg.length * 4);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < eulersDeg.length; i++) {
    const [x, y, z] = eulersDeg[i];
    e.set(x * D, y * D, z * D, 'XYZ');
    q.setFromEuler(e);
    values[i * 4] = q.x; values[i * 4 + 1] = q.y; values[i * 4 + 2] = q.z; values[i * 4 + 3] = q.w;
  }
  return new THREE.QuaternionKeyframeTrack(boneName + '.quaternion', times, values);
}

// Build a Hips position track from [dx, dy, dz] offsets added to the rest pose.
function hipTrack(times, offsets) {
  const values = new Float32Array(offsets.length * 3);
  for (let i = 0; i < offsets.length; i++) {
    values[i * 3] = offsets[i][0] * VSCALE;
    values[i * 3 + 1] = HIP_Y + offsets[i][1] * VSCALE;
    values[i * 3 + 2] = offsets[i][2] * VSCALE;
  }
  return new THREE.VectorKeyframeTrack(BONE.Hips + '.position', times, values);
}

// clip(name, duration, def) where def maps short bone alias -> { t, k }
//   t = times array, k = array of [x,y,z] euler degrees (same length as t)
// Special key `hips` = { t, k:[[dx,dy,dz],...] } for the Hips position track.
function clip(name, duration, def) {
  const tracks = [];
  for (const key in def) {
    if (key === 'hips') {
      tracks.push(hipTrack(def.hips.t, def.hips.k));
    } else {
      tracks.push(quatTrack(BONE[key], def[key].t, def[key].k));
    }
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

// Natural "arms down" base rotations.
const LARM_DOWN = -78, RARM_DOWN = 78;

export function createClips(hipsRestY = 0.52) {
  HIP_Y = hipsRestY;
  VSCALE = hipsRestY / 0.84;
  const clips = {};

  // ---- T-Pose (shows the rig) --------------------------------------------
  clips['T-Pose'] = clip('T-Pose', 0.5, {
    LArm: { t: [0], k: [[0, 0, 0]] },
    RArm: { t: [0], k: [[0, 0, 0]] },
  });

  // ---- Idle (subtle breathing + sway) ------------------------------------
  clips['Idle'] = clip('Idle', 4, {
    Spine:  { t: [0, 2, 4], k: [[0, 0, 0], [4, 0, 0], [0, 0, 0]] },
    Spine1: { t: [0, 2, 4], k: [[0, 0, 0], [2, 0, 0], [0, 0, 0]] },
    Head:   { t: [0, 1, 2, 3, 4], k: [[0, 0, 0], [0, 6, 0], [0, 0, 0], [0, -6, 0], [0, 0, 0]] },
    LArm:   { t: [0, 2, 4], k: [[0, 0, LARM_DOWN], [3, 0, LARM_DOWN - 2], [0, 0, LARM_DOWN]] },
    RArm:   { t: [0, 2, 4], k: [[0, 0, RARM_DOWN], [3, 0, RARM_DOWN + 2], [0, 0, RARM_DOWN]] },
    LFore:  { t: [0], k: [[0, 0, -6]] },
    RFore:  { t: [0], k: [[0, 0, 6]] },
    hips:   { t: [0, 2, 4], k: [[0, 0, 0], [0, 0.012, 0], [0, 0, 0]] },
  });

  // ---- Wave (right arm raised, forearm waving) ---------------------------
  {
    const t = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4];
    const wave = (a) => a.map((z) => [-4, 0, z]);
    clips['Wave'] = clip('Wave', 2.4, {
      LArm:  { t: [0], k: [[0, 0, LARM_DOWN]] },
      LFore: { t: [0], k: [[0, 0, -6]] },
      RArm:  { t: [0], k: [[-5, 0, -22]] },  // upper arm up & well out so the hand clears the head
      RFore: { t, k: wave([-34, -62, -34, -10, -34, -62, -34, -10, -34]) },
      RHand: { t: [0, 0.6, 1.2, 1.8, 2.4], k: [[0, 0, 0], [0, 0, 20], [0, 0, 0], [0, 0, 20], [0, 0, 0]] },
      Head:  { t: [0], k: [[0, -8, 3]] },
      Spine: { t: [0, 1.2, 2.4], k: [[0, 0, 0], [2, 0, 0], [0, 0, 0]] },
    });
  }

  // ---- Walk ---------------------------------------------------------------
  {
    const t = [0, 0.25, 0.5, 0.75, 1.0];
    clips['Walk'] = clip('Walk', 1.0, {
      LUpLeg: { t, k: [[28, 0, 0], [0, 0, 0], [-26, 0, 0], [0, 0, 0], [28, 0, 0]] },
      RUpLeg: { t, k: [[-26, 0, 0], [0, 0, 0], [28, 0, 0], [0, 0, 0], [-26, 0, 0]] },
      LLeg:   { t, k: [[6, 0, 0], [34, 0, 0], [6, 0, 0], [12, 0, 0], [6, 0, 0]] },
      RLeg:   { t, k: [[6, 0, 0], [12, 0, 0], [6, 0, 0], [34, 0, 0], [6, 0, 0]] },
      LArm:   { t, k: [[-22, 0, LARM_DOWN], [0, 0, LARM_DOWN], [22, 0, LARM_DOWN], [0, 0, LARM_DOWN], [-22, 0, LARM_DOWN]] },
      RArm:   { t, k: [[22, 0, RARM_DOWN], [0, 0, RARM_DOWN], [-22, 0, RARM_DOWN], [0, 0, RARM_DOWN], [22, 0, RARM_DOWN]] },
      LFore:  { t: [0], k: [[0, 0, -12]] },
      RFore:  { t: [0], k: [[0, 0, 12]] },
      Spine:  { t, k: [[0, 0, 0], [0, -5, 0], [0, 0, 0], [0, 5, 0], [0, 0, 0]] },
      hips:   { t, k: [[0, 0, 0], [0, 0.022, 0], [0, 0, 0], [0, 0.022, 0], [0, 0, 0]] },
    });
  }

  // ---- Run ----------------------------------------------------------------
  {
    const t = [0, 0.175, 0.35, 0.525, 0.7];
    clips['Run'] = clip('Run', 0.7, {
      LUpLeg: { t, k: [[48, 0, 0], [5, 0, 0], [-42, 0, 0], [5, 0, 0], [48, 0, 0]] },
      RUpLeg: { t, k: [[-42, 0, 0], [5, 0, 0], [48, 0, 0], [5, 0, 0], [-42, 0, 0]] },
      LLeg:   { t, k: [[18, 0, 0], [78, 0, 0], [22, 0, 0], [45, 0, 0], [18, 0, 0]] },
      RLeg:   { t, k: [[22, 0, 0], [45, 0, 0], [18, 0, 0], [78, 0, 0], [22, 0, 0]] },
      Spine:  { t: [0], k: [[20, 0, 0]] },
      Spine1: { t: [0], k: [[8, 0, 0]] },
      LArm:   { t, k: [[-38, 0, -70], [0, 0, -70], [34, 0, -70], [0, 0, -70], [-38, 0, -70]] },
      RArm:   { t, k: [[34, 0, 70], [0, 0, 70], [-38, 0, 70], [0, 0, 70], [34, 0, 70]] },
      LFore:  { t: [0], k: [[0, 0, -48]] },
      RFore:  { t: [0], k: [[0, 0, 48]] },
      hips:   { t, k: [[0, -0.01, 0], [0, 0.03, 0], [0, -0.01, 0], [0, 0.03, 0], [0, -0.01, 0]] },
    });
  }

  // ---- Jump (crouch, launch, apex, land) ---------------------------------
  {
    const t = [0, 0.3, 0.5, 0.9, 1.2, 1.5, 1.8];
    clips['Jump'] = clip('Jump', 1.8, {
      hips:   { t, k: [[0, 0, 0], [0, -0.16, 0], [0, 0.18, 0], [0, 0.32, 0], [0, 0.18, 0], [0, -0.16, 0], [0, 0, 0]] },
      LUpLeg: { t, k: [[0, 0, 0], [34, 0, 0], [6, 0, 0], [12, 0, 0], [6, 0, 0], [34, 0, 0], [0, 0, 0]] },
      RUpLeg: { t, k: [[0, 0, 0], [34, 0, 0], [6, 0, 0], [12, 0, 0], [6, 0, 0], [34, 0, 0], [0, 0, 0]] },
      LLeg:   { t, k: [[4, 0, 0], [62, 0, 0], [12, 0, 0], [8, 0, 0], [12, 0, 0], [62, 0, 0], [4, 0, 0]] },
      RLeg:   { t, k: [[4, 0, 0], [62, 0, 0], [12, 0, 0], [8, 0, 0], [12, 0, 0], [62, 0, 0], [4, 0, 0]] },
      LArm:   { t, k: [[0, 0, LARM_DOWN], [34, 0, -45], [10, 0, 70], [0, 0, 112], [10, 0, 70], [34, 0, -45], [0, 0, LARM_DOWN]] },
      RArm:   { t, k: [[0, 0, RARM_DOWN], [34, 0, 45], [10, 0, -70], [0, 0, -112], [10, 0, -70], [34, 0, 45], [0, 0, RARM_DOWN]] },
      Spine:  { t, k: [[0, 0, 0], [22, 0, 0], [-6, 0, 0], [-10, 0, 0], [-6, 0, 0], [22, 0, 0], [0, 0, 0]] },
    });
  }

  // ---- Dance (bouncy, arms up, hips sway) --------------------------------
  {
    const t = [0, 0.5, 1.0, 1.5, 2.0];
    clips['Dance'] = clip('Dance', 2.0, {
      hips:   { t, k: [[0, 0, 0], [0.06, -0.04, 0], [0, 0, 0], [-0.06, -0.04, 0], [0, 0, 0]] },
      Spine:  { t, k: [[0, 0, 0], [3, 16, 0], [0, 0, 0], [3, -16, 0], [0, 0, 0]] },
      Head:   { t, k: [[6, 0, 0], [0, 10, 0], [6, 0, 0], [0, -10, 0], [6, 0, 0]] },
      LArm:   { t, k: [[0, 0, 62], [10, 0, 86], [0, 0, 62], [10, 0, 86], [0, 0, 62]] },
      RArm:   { t, k: [[0, 0, -62], [10, 0, -86], [0, 0, -62], [10, 0, -86], [0, 0, -62]] },
      LFore:  { t, k: [[0, 0, 30], [0, 0, 10], [0, 0, 30], [0, 0, 10], [0, 0, 30]] },
      RFore:  { t, k: [[0, 0, -30], [0, 0, -10], [0, 0, -30], [0, 0, -10], [0, 0, -30]] },
      LLeg:   { t, k: [[8, 0, 0], [26, 0, 0], [8, 0, 0], [20, 0, 0], [8, 0, 0]] },
      RLeg:   { t, k: [[8, 0, 0], [20, 0, 0], [8, 0, 0], [26, 0, 0], [8, 0, 0]] },
    });
  }

  return clips;
}
