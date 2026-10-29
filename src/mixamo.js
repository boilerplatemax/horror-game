// mixamo.js — load an animation from a user-dropped .fbx / .glb / .gltf file
// and retarget it onto the Mii's skeleton.
//
// Because the Mii skeleton uses Mixamo bone names (mixamorigHips, …), a clip
// exported from Mixamo (which also uses those names) maps onto it 1:1. We use
// SkeletonUtils.retargetClip to transfer the motion between skeletons of
// different proportions (it preserves our bone lengths and applies only the
// source's rotations).

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { retargetClip } from 'three/addons/utils/SkeletonUtils.js';

// Find the first SkinnedMesh in a loaded hierarchy (the retarget source).
function findSkinned(root) {
  let found = null;
  root.traverse((o) => { if (!found && o.isSkinnedMesh) found = o; });
  return found;
}

// Strip position tracks so the retargeted motion plays in place (Mixamo FBX
// files are in centimetres, so raw hip translation would throw the Mii across
// the scene). Rotations carry the whole performance for our purposes.
function stripPositions(clip) {
  clip.tracks = clip.tracks.filter((tr) => !tr.name.endsWith('.position'));
  return clip;
}

export async function loadMixamoClip(file, targetMesh) {
  const url = URL.createObjectURL(file);
  const name = file.name.replace(/\.(fbx|glb|gltf)$/i, '');
  const ext = file.name.split('.').pop().toLowerCase();

  try {
    let source, clip;

    if (ext === 'fbx') {
      source = await new FBXLoader().loadAsync(url);
      clip = source.animations && source.animations[0];
    } else if (ext === 'glb' || ext === 'gltf') {
      const gltf = await new GLTFLoader().loadAsync(url);
      source = gltf.scene;
      clip = gltf.animations && gltf.animations[0];
      if (!findSkinned(source)) source = gltf.scene;
    } else {
      throw new Error('Unsupported file type: .' + ext);
    }

    if (!clip) throw new Error('No animation found in ' + file.name);

    // retargetClip needs an Object3D source with a skeleton.
    const sourceMesh = findSkinned(source) || source;

    const retargeted = retargetClip(targetMesh, sourceMesh, clip, {
      hip: 'mixamorigHips',
      preserveHipPosition: false,
      names: {}, // identical bone names -> identity mapping
    });
    retargeted.name = name;
    return stripPositions(retargeted);
  } finally {
    URL.revokeObjectURL(url);
  }
}
