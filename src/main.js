// main.js — scene setup, Mii creation, animation switching, and the optional
// drag-and-drop Mixamo loader.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildMii, DEFAULT_COLORS } from './mii.js';
import { createClips } from './animations.js';
import { loadMixamoClip } from './mixamo.js';
import { defaultFaceTexture } from './face.js';

const canvas = document.getElementById('scene');
const statusEl = document.getElementById('status');
const buttonsEl = document.getElementById('buttons');

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = makeGradient('#bfe4f5', '#fbf3ea'); // soft sky -> warm cream
scene.fog = new THREE.Fog(0xf2ecf2, 11, 20);

// Soft image-based lighting for that premium, rounded "toy" look.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0.9, 1.15, 3.1);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.82, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.4;
controls.maxDistance = 7;
controls.maxPolarAngle = Math.PI * 0.54;

// ---------------------------------------------------------------------------
// Lighting — soft key + warm fill + cool rim, on top of the environment
// ---------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xfff4e8, 0xcfd6e6, 0.45));

const key = new THREE.DirectionalLight(0xfff2e0, 2.0);
key.position.set(2.6, 4.6, 2.8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 16;
key.shadow.camera.left = -2;
key.shadow.camera.right = 2;
key.shadow.camera.top = 2.5;
key.shadow.camera.bottom = -0.5;
key.shadow.bias = -0.0004;
key.shadow.radius = 5;
key.shadow.normalBias = 0.02;
scene.add(key);

const rim = new THREE.DirectionalLight(0xbfe0ff, 0.6);
rim.position.set(-3.5, 2.5, -3);
scene.add(rim);

// ---------------------------------------------------------------------------
// Stage — rounded pastel platform the character stands on
// ---------------------------------------------------------------------------
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(8, 64),
  new THREE.MeshStandardMaterial({ color: 0xf3eef0, roughness: 0.95, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const platform = new THREE.Mesh(
  new THREE.CylinderGeometry(0.75, 0.82, 0.06, 56),
  new THREE.MeshStandardMaterial({ color: 0xa9e0d2, roughness: 0.6, metalness: 0 })
);
platform.position.y = 0.03;
platform.receiveShadow = true;
platform.castShadow = true;
scene.add(platform);

// ---------------------------------------------------------------------------
// Mii + animation
// ---------------------------------------------------------------------------
// Current appearance state.
const look = { colors: { ...DEFAULT_COLORS }, headScale: 1 };
const faceTexture = defaultFaceTexture();
let facePanel = null;

// The face is a flat textured decal attached to the head bone (so it follows
// animation), hugging the front of the head — like a real Mii.
function attachFace(m) {
  if (facePanel) { facePanel.material.dispose(); facePanel.removeFromParent(); facePanel = null; }
  const mat = new THREE.MeshStandardMaterial({
    map: faceTexture, transparent: true, roughness: 0.6, metalness: 0, depthWrite: true, side: THREE.DoubleSide,
  });
  facePanel = new THREE.Mesh(m.faceGeometry, mat);
  facePanel.renderOrder = 2;
  m.headBone.add(facePanel);
}

let mii = buildMii(look);
mii.mesh.position.y = 0.06; // stand on the platform
scene.add(mii.mesh);
attachFace(mii);
frameCharacter(mii.topY);

// builtinClips are authored once; bone names are identical after any rebuild,
// so the same clips can be re-bound to a fresh mesh/mixer.
const builtinClips = createClips(mii.hipsRestY);
const importedClips = {};
const actions = {};
let current = null;
const BUILTIN = ['Idle', 'Wave', 'Walk', 'Run', 'Jump', 'Dance', 'T-Pose'];

// mixerRef lets us swap the active mixer when the Mii is rebuilt (randomize).
const mixerRef = { m: new THREE.AnimationMixer(mii.mesh) };
for (const name in builtinClips) actions[name] = mixerRef.m.clipAction(builtinClips[name]);

function play(name, fade = 0.3) {
  const next = actions[name];
  if (!next || next === current) return;
  next.reset();
  next.enabled = true;
  next.setEffectiveWeight(1);
  next.play();
  if (current) current.crossFadeTo(next, fade, false);
  current = next;
  setActiveButton(name);
  setStatus('Playing: ' + name);
}

// ---------------------------------------------------------------------------
// UI: animation buttons
// ---------------------------------------------------------------------------
function makeButton(name, group) {
  const b = document.createElement('button');
  b.textContent = name;
  b.className = 'anim-btn';
  b.dataset.anim = name;
  if (group) b.dataset.group = group;
  b.addEventListener('click', () => play(name));
  buttonsEl.appendChild(b);
  return b;
}
for (const name of BUILTIN) makeButton(name);

function setActiveButton(name) {
  for (const b of buttonsEl.children) {
    b.classList.toggle('active', b.dataset.anim === name);
  }
}
function setStatus(msg) { statusEl.textContent = msg; }

// ---------------------------------------------------------------------------
// Head-to-body ratio control (slider + presets) + randomize appearance
// ---------------------------------------------------------------------------
const toolsEl = document.getElementById('tools');
const ratioEl = document.getElementById('ratio');

// Preset ratio buttons, like the reference sheet (0.5 / 1 / 1.5 / 2)
const presetWrap = document.createElement('div');
presetWrap.id = 'presets';
ratioEl.appendChild(presetWrap);
const PRESETS = [['0.5×', 0.5], ['1×', 1], ['1.5×', 1.5], ['2×', 2]];
const presetBtns = {};
for (const [label, v] of PRESETS) {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = 'ratio-btn';
  b.addEventListener('click', () => setHeadScale(v));
  presetWrap.appendChild(b);
  presetBtns[v] = b;
}

// Slider for fine control. The implicit-surface rebuild is a bit heavy, so we
// update the label live while dragging and rebuild the mesh on release.
const slider = document.getElementById('headSlider');
const sliderVal = document.getElementById('headVal');
slider.addEventListener('input', () => updateRatioLabel(parseFloat(slider.value)));
slider.addEventListener('change', () => setHeadScale(parseFloat(slider.value)));

function updateRatioLabel(v) {
  sliderVal.textContent = v.toFixed(2).replace(/\.?0+$/, '') + '×';
  for (const key in presetBtns) presetBtns[key].classList.toggle('active', Math.abs(+key - v) < 0.001);
}
updateRatioLabel(1); // sync UI to default ratio without rebuilding

let rebuildQueued = false;
function setHeadScale(v) {
  look.headScale = v;
  slider.value = String(v);
  updateRatioLabel(v);
  if (!rebuildQueued) {
    rebuildQueued = true;
    requestAnimationFrame(() => { rebuildQueued = false; rebuildMii(); });
  }
}

const randomBtn = document.createElement('button');
randomBtn.textContent = '🎲 Randomize look';
randomBtn.className = 'tool-btn';
randomBtn.addEventListener('click', randomizeLook);
toolsEl.appendChild(randomBtn);

const HAIR_COLORS = ['#5a3a22', '#2b2320', '#1c1c1c', '#8a5a2b', '#c9a23f', '#b4442f', '#dcdcdc'];
const SHIRT_COLORS = ['#f5f6f8', '#e4504f', '#4f8be4', '#4caf6a', '#f2b33d', '#8b5cf6', '#2c2f38'];
const PANTS_COLORS = ['#8d93a0', '#3a4152', '#5a4636', '#2c2f38', '#6d7684'];
const SKINS = ['#f2c9a0', '#e8b48a', '#d49a6a', '#b07a4e', '#8a5a36'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function randomizeLook() {
  look.colors = {
    ...DEFAULT_COLORS,
    hair: pick(HAIR_COLORS),
    brows: '#3a2a18',
    shirt: pick(SHIRT_COLORS),
    pants: pick(PANTS_COLORS),
    skin: pick(SKINS),
  };
  look.colors.nose = look.colors.skin;
  rebuildMii();
}

function rebuildMii() {
  const playing = current ? Object.keys(actions).find((n) => actions[n] === current) : 'Idle';
  scene.remove(mii.mesh);
  mii.mesh.geometry.dispose();
  mii.mesh.material.dispose();
  mii = buildMii(look);
  mii.mesh.position.y = 0.06;
  scene.add(mii.mesh);
  attachFace(mii);
  frameCharacter(mii.topY);
  // rebuild mixer + actions against the new mesh/skeleton
  mixerRef.m.stopAllAction();
  const newMixer = new THREE.AnimationMixer(mii.mesh);
  mixerRef.m = newMixer;
  for (const k in actions) delete actions[k];
  current = null;
  // Bone names are identical after a rebuild, so clips are reusable as-is.
  for (const name in builtinClips) actions[name] = newMixer.clipAction(builtinClips[name]);
  for (const name in importedClips) actions[name] = newMixer.clipAction(importedClips[name]);
  play(playing || 'Idle', 0);
}

// Keep the whole character framed as its height changes with head size.
// Preserves the user's current orbit angle, only refits target height + distance.
function frameCharacter(topY) {
  const top = (topY || 1.6) + 0.06;         // + platform offset
  const center = top * 0.52;
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(0.5, 0.1, 1);
  dir.normalize();
  const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const dist = THREE.MathUtils.clamp((top * 0.62) / Math.tan(halfFov), 2.2, 6.5);
  controls.target.set(0, center, 0);
  camera.position.copy(controls.target).add(dir.multiplyScalar(dist));
  controls.update();
}

// ---------------------------------------------------------------------------
// Drag-and-drop / file input for Mixamo animations
// ---------------------------------------------------------------------------
const dropZone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
document.getElementById('importBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });

['dragenter', 'dragover'].forEach((ev) =>
  window.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('show'); }));
['dragleave', 'drop'].forEach((ev) =>
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'drop' || e.target === document || !e.relatedTarget) dropZone.classList.remove('show');
  }));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('show');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});

async function handleFile(file) {
  setStatus('Loading ' + file.name + ' …');
  try {
    const clip = await loadMixamoClip(file, mii.mesh);
    const name = clip.name || file.name;
    importedClips[name] = clip;
    actions[name] = mixerRef.m.clipAction(clip);
    if (!buttonsEl.querySelector(`[data-anim="${CSS.escape(name)}"]`)) {
      const b = makeButton(name, 'imported');
      b.classList.add('imported');
    }
    play(name);
    setStatus('Imported: ' + name);
  } catch (err) {
    console.error(err);
    setStatus('⚠ Could not import ' + file.name + ' — ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
play('Idle', 0);

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  mixerRef.m.update(dt);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeGradient(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
