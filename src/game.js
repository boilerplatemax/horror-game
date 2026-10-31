/* PSX Level Player — loads/edits a world of rooms + characters and lets you walk it.
   Open archways are SEAMLESS: the neighbouring room is loaded and positioned so the doorways line up,
   and you walk across with no teleport. Closed doors teleport on E. Depends on createPSXRoom / createPSXCharacter. */
(function () {
  'use strict';
  var THREE = window.THREE, $ = function (id) { return document.getElementById(id); };
  if (!THREE || !window.createPSXRoom || !window.createPSXCharacter) { $('hudMsg').textContent = 'Engines failed to load.'; return; }

  /* ---------- scene ---------- */
  var stage = $('stage');
  var scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x46506b, 20, 52);
  var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); stage.appendChild(renderer.domElement);
  var camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  // gradient sky dome — so gaps above the walls and views through windows read as the outdoors
  var sky = new THREE.Mesh(new THREE.SphereGeometry(140, 24, 14), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(0x24427a) }, uHorizon: { value: new THREE.Color(0xe7c79f) }, uBottom: { value: new THREE.Color(0x141620) } },
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 uTop,uHorizon,uBottom; void main(){ float h=normalize(vP).y; vec3 c = h>=0.0 ? mix(uHorizon,uTop,pow(h,0.4)) : mix(uHorizon,uBottom,clamp(-h*3.0,0.0,1.0)); gl_FragColor=vec4(c,1.0); }'
  }));
  sky.renderOrder = -1; scene.add(sky);
  // distant ground so a view through a window reads as outdoors (ground → horizon → sky), hidden under room floors
  var terrain = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3f4a39, roughness: 1, metalness: 0, flatShading: true }));
  terrain.position.y = -0.18; scene.add(terrain);
  // soft blob shadows under characters so they feel grounded instead of floating
  var blobTex = (function () { var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d'); var gr = x.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); var t = new THREE.CanvasTexture(c); return t; })();
  function makeBlob(r) { var m = new THREE.Mesh(new THREE.PlaneGeometry(r || 0.6, r || 0.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })); m.position.y = 0.03; m.renderOrder = 2; return m; }
  var playerBlob = makeBlob(0.58); scene.add(playerBlob);
  // cool fill + warm key; lamps add warm pools, so lit spaces read moody instead of evenly flat
  var amb = new THREE.AmbientLight(0x8a94b4, 0.52); scene.add(amb);
  var dl = new THREE.DirectionalLight(0xffe7c2, 0.5); dl.position.set(6, 12, 4); scene.add(dl);
  var dl2 = new THREE.DirectionalLight(0x6b79a4, 0.16); dl2.position.set(-5, 4, -6); scene.add(dl2);
  // player flashlight (great at night / for horror) — toggled with the Flashlight button or F
  var flash = new THREE.SpotLight(0xffeccf, 0, 17, 0.6, 0.65, 1.3); flash.position.set(0, 1.2, 0); scene.add(flash); scene.add(flash.target); var flashOn = false, flashBase = 2.4;
  var flickerLights = [], flickerOn = false;   // lamps/braziers stutter when world.flicker is set (horror)
  function collectFlicker() { flickerLights = []; loaded.forEach(function (inst) { inst.ro.root.traverse(function (o) { if (o.isPointLight) flickerLights.push({ l: o, base: o.intensity, ph: Math.random() * 10, spd: 7 + Math.random() * 9 }); }); }); }
  function updateFlicker(t) {
    for (var i = 0; i < flickerLights.length; i++) {
      var f = flickerLights[i];
      var n = 0.9 + 0.06 * Math.sin(t * f.spd + f.ph) + 0.04 * Math.sin(t * f.spd * 2.6 + f.ph * 1.7);   // gentle shimmer
      if (Math.sin(t * 0.9 + f.ph * 4) > 0.985) n *= 0.55;                                               // brief, soft brown-out
      f.l.intensity = f.base * n;
    }
  }

  // --- color-grade post pass: contrast, saturation, warm tint, vignette, film grain ---
  var rt = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  var postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  var grade = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: rt.texture }, uRes: { value: new THREE.Vector2(2, 2) }, uTime: { value: 0 },
      uContrast: { value: 1.11 }, uSat: { value: 1.14 }, uTint: { value: new THREE.Color(1.07, 1.0, 0.9) }, uLift: { value: new THREE.Vector3(0.0, 0.012, 0.03) }, uVig: { value: 0.44 }, uGrain: { value: 0.05 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
    fragmentShader: ['varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime,uContrast,uSat,uVig,uGrain; uniform vec3 uTint,uLift;',
      'void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb;',
      ' c=(c-0.5)*uContrast+0.5;',
      ' float l=dot(c,vec3(0.299,0.587,0.114)); c=mix(vec3(l),c,uSat);',
      ' c=c*uTint+uLift;',
      ' float d=distance(vUv,vec2(0.5)); c*=mix(1.0-uVig,1.0,smoothstep(0.82,0.3,d));',
      ' float g=fract(sin(dot(vUv*uRes+uTime,vec2(12.9898,78.233)))*43758.5453); c+=(g-0.5)*uGrain;',
      ' gl_FragColor=vec4(clamp(c,0.0,1.0),1.0); }'].join('\n')
  });
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), grade));

  // --- time-of-day presets: sky, fog, lights, terrain and grade tint in one switch (set per world) ---
  var TIMES = {
    day:      { top: 0x4a7fc0, hor: 0xcfe0ea, bot: 0x2a3340, fog: 0x9fb0c4, fogN: 24, fogF: 62, amb: 0xbfcadd, ambI: 0.72, key: 0xfff3d8, keyI: 0.8, fill: 0x8fa0c0, fillI: 0.28, terr: 0x5a6b48, tint: [1.03, 1.0, 0.96], flash: 1.0 },
    dawn:     { top: 0x3a4e86, hor: 0xf0c69a, bot: 0x201a2a, fog: 0x6a5f74, fogN: 20, fogF: 54, amb: 0xb9a8c0, ambI: 0.56, key: 0xffd9a8, keyI: 0.62, fill: 0x7a6f9a, fillI: 0.2, terr: 0x4a4a40, tint: [1.07, 1.0, 0.92], flash: 1.6 },
    dusk:     { top: 0x24427a, hor: 0xe7c79f, bot: 0x141620, fog: 0x46506b, fogN: 20, fogF: 52, amb: 0x8a94b4, ambI: 0.52, key: 0xffe7c2, keyI: 0.5, fill: 0x6b79a4, fillI: 0.16, terr: 0x3f4a39, tint: [1.07, 1.0, 0.9], flash: 2.4 },
    night:    { top: 0x0a1430, hor: 0x1b2644, bot: 0x04060c, fog: 0x0a1020, fogN: 12, fogF: 40, amb: 0x2a3256, ambI: 0.26, key: 0x4a5a85, keyI: 0.22, fill: 0x1c2740, fillI: 0.1, terr: 0x161c28, tint: [0.92, 0.97, 1.12], flash: 3.4 },
    overcast: { top: 0x8a95a4, hor: 0xbcc3cc, bot: 0x4a505a, fog: 0x9aa2ac, fogN: 18, fogF: 48, amb: 0xb0b8c2, ambI: 0.72, key: 0xccd0d6, keyI: 0.3, fill: 0x9098a0, fillI: 0.22, terr: 0x5a6058, tint: [0.98, 1.0, 1.03], flash: 1.3 },
    blackout: { top: 0x05070e, hor: 0x0a0e16, bot: 0x020304, fog: 0x04060a, fogN: 5, fogF: 19, amb: 0x0c1018, ambI: 0.09, key: 0x12161f, keyI: 0.05, fill: 0x0a0e16, fillI: 0.04, terr: 0x080a0e, tint: [0.9, 0.96, 1.12], flash: 4.4 }
  };
  var TIME_NAMES = Object.keys(TIMES);
  function applyTimeOfDay(name) {
    var t = TIMES[name] || TIMES.dusk;
    sky.material.uniforms.uTop.value.setHex(t.top); sky.material.uniforms.uHorizon.value.setHex(t.hor); sky.material.uniforms.uBottom.value.setHex(t.bot);
    scene.fog.color.setHex(t.fog); scene.fog.near = t.fogN; scene.fog.far = t.fogF;
    amb.color.setHex(t.amb); amb.intensity = t.ambI; dl.color.setHex(t.key); dl.intensity = t.keyI; dl2.color.setHex(t.fill); dl2.intensity = t.fillI;
    terrain.material.color.setHex(t.terr); grade.uniforms.uTint.value.setRGB(t.tint[0], t.tint[1], t.tint[2]);
    flashBase = t.flash; if (flashOn) flash.intensity = flashBase;
  }
  function toggleFlash() { flashOn = !flashOn; flash.intensity = flashOn ? flashBase : 0; if ($('btnFlash')) $('btnFlash').classList.toggle('on', flashOn); }
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
  scene.add(ground);

  /* ---------- state ---------- */
  var mode = 'play', world = null, draft = null, editActive = null;
  // play (streaming): loaded rooms around an anchor, union colliders, teleport doors, seamless connections
  var loaded = [], pColliders = [], teleportExits = [], conns = [], anchor = null, npcs = [], actors = [];
  // edit (single room)
  var roomObj = null, roomGroup = null;
  var player = null, pPos = new THREE.Vector3(), pYaw = 0, pAnim = 'idle';
  var CHAR_H = 1.2, PR = 0.22, lowres = false, EXIT_NEAR = 1.3, FACE_DOT = 0.3, EXIT_FACE = 0.33, HANDOVER = 1.3, TRANS_COOL = 0.4, transCool = 0;
  var TALK_NEAR = 3.0;   // how close you must stand to talk to an NPC (tweak freely)
  var TALK_HINT = TALK_NEAR + 2.4;   // tapping an NPC within this nudges "step closer"; farther than this stays silent

  /* ---------- shared asset catalog (single source of truth: the room engine) ---------- */
  var CAT = window.createPSXRoom.catalog ? window.createPSXRoom.catalog(THREE) : { assets: [], materials: [], swatch: {} };
  var PIECES = [], MATS = CAT.materials.slice(), SWCOL = CAT.swatch || {}, catDefMat = {}, occMap = {};
  CAT.assets.forEach(function (a) { PIECES.push(a.name); catDefMat[a.name] = a.defMat; occMap[a.name] = a.occupy; });
  function occupyOf(a) { return occMap[a] || 'furniture'; }
  var PLABEL = { floor: 'Floor', wall: 'Wall', door: 'Door', spawn: 'Spawn ▸', exit: 'Exit ▸' };   // only the room skeleton is built-in; everything else is a pack model
  // build-mode state
  var editSub = 'build', armedPiece = null, eraserOn = false, placeRotDeg = 0, placeScale = 1, pieceMat = {};
  var editGrid = new THREE.GridHelper(48, 48, 0x394063, 0x23273c); editGrid.position.y = 0.002; editGrid.visible = false; scene.add(editGrid);

  function parseSpec(spec) {
    if (spec && typeof spec === 'object') return spec;
    if (typeof spec === 'string') { var s = spec.trim(); if (!s) return null; if (s.indexOf('PSX1') === 0) return s; try { return JSON.parse(s); } catch (e) { return null; } }
    return null;
  }
  var _psx = false;
  function configurePSX() { if (_psx) return; var u = window.createPSXCharacter.uniforms; if (u) { if (u.jitter) u.jitter.value = 0; if (u.affine) u.affine.value = 0; } _psx = true; }
  function charFrom(spec) { var api = window.createPSXCharacter(THREE, parseSpec(spec) || { outfit: 'tank', hairStyle: 'buzz' }); configurePSX(); api.root.scale.setScalar(CHAR_H / (api.height || 1.7)); return api; }

  // Y-rotation of a point, and the inverse of a room's (theta, t) transform
  function rotY(x, z, t) { var c = Math.cos(t), s = Math.sin(t); return [x * c + z * s, -x * s + z * c]; }
  function invXform(wx, wz, theta, tx, tz) { return rotY(wx - tx, wz - tz, -theta); }
  function xformAABB(c, theta, tx, tz) { var p = rotY(c.cx, c.cz, theta), sw = Math.abs(Math.sin(theta)) > 0.5; return { cx: p[0] + tx, cz: p[1] + tz, hx: sw ? c.hz : c.hx, hz: sw ? c.hx : c.hz, ymin: c.ymin, ymax: c.ymax }; }

  function clearAll() {
    loaded.forEach(function (inst) { scene.remove(inst.ro.root); }); loaded = [];
    if (roomGroup) { scene.remove(roomGroup); roomGroup = null; }
    npcs.forEach(function (n) { scene.remove(n.api.root); if (n.blob) { scene.remove(n.blob); n.blob = null; } }); npcs = [];
    pColliders = []; teleportExits = []; conns = [];
  }

  // spawn a character for a room placed at transform xf (default identity)
  function spawnNpc(nd, xf) {
    xf = xf || { theta: 0, tx: 0, tz: 0 };
    var api = charFrom(nd.code), at = nd.at || [0, 0], w = rotY(at[0], at[1], xf.theta), wx = w[0] + xf.tx, wz = w[1] + xf.tz;
    var yaw = (nd.face || 0) * Math.PI / 180 + xf.theta;
    api.root.position.set(wx, 0, wz); api.root.rotation.y = yaw; try { api.play(nd.anim || 'idle'); } catch (e) {}
    scene.add(api.root);
    var npcObj = { api: api, data: nd, collider: { cx: wx, cz: wz, hx: 0.34, hz: 0.34, ymin: 0, ymax: 1.4 }, home: [wx, wz], anim: nd.anim || 'idle', state: {} };
    api.root.userData.__npc = npcObj; return npcObj;
  }

  /* ---------- play: streaming scene build ---------- */
  function buildInstance(rd) { var ro = window.createPSXRoom(THREE, rd.room || { objects: [] }); ro.markers.visible = false; return { ro: ro, rd: rd, exits: ro.exits, spawns: ro.spawns }; }
  function placeInstance(inst, theta, tx, tz) {
    inst.ro.root.rotation.y = theta; inst.ro.root.position.set(tx, 0, tz); scene.add(inst.ro.root);
    inst.theta = theta; inst.tx = tx; inst.tz = tz; inst.doorTargets = [];
    inst.ro.colliders.forEach(function (c) { pColliders.push(xformAABB(c, theta, tx, tz)); });
    loaded.push(inst);
  }
  // NPCs are world-level actors so they can roam between rooms and persist where they end up
  function buildActors() {
    actors = [];
    Object.keys(world.rooms).forEach(function (rn) {
      (world.rooms[rn].npcs || []).forEach(function (nd, i) {
        actors.push({ id: rn + '#' + i, room: rn, pos: (nd.at || [0, 0]).slice(), face: nd.face || 0, data: nd, api: null, inst: null, state: {}, anim: nd.anim || 'idle', home: null, collider: null });
      });
    });
  }
  function spawnActor(a, inst) {
    if (!a.api) { a.api = charFrom(a.data.code); scene.add(a.api.root); a.api.root.userData.__npc = a; }
    a.inst = inst;
    var w = rotY(a.pos[0], a.pos[1], inst.theta), wx = w[0] + inst.tx, wz = w[1] + inst.tz;
    a.api.root.position.set(wx, 0, wz); a.api.root.rotation.y = (a.face || 0) * Math.PI / 180 + inst.theta;
    a.collider = { cx: wx, cz: wz, hx: 0.34, hz: 0.34, ymin: 0, ymax: 1.4 }; a.home = [wx, wz];
    a.state.tgt = null; a.state.phase = null; a.anim = a.data.anim || 'idle'; try { a.api.play(a.anim); } catch (e) {}
  }
  // each frame: keep an actor's persistent room+local position in sync with where it has walked to
  function updateActorRoom(a) {
    var p = a.api.root.position;
    for (var i = 0; i < loaded.length; i++) {
      var inst = loaded[i], bb = inst.ro.bounds; if (!bb) continue;
      var loc = invXform(p.x, p.z, inst.theta, inst.tx, inst.tz);
      if (loc[0] >= bb.minx - 0.15 && loc[0] <= bb.maxx + 0.15 && loc[1] >= bb.minz - 0.15 && loc[1] <= bb.maxz + 0.15) { if (a.room !== inst.name) { a.room = inst.name; a.inst = inst; } a.pos = [loc[0], loc[1]]; return; }
    }
    if (a.inst) { var l = invXform(p.x, p.z, a.inst.theta, a.inst.tx, a.inst.tz); a.pos = [l[0], l[1]]; }
  }
  // Build the anchor room at origin, plus each open-archway neighbour positioned so the doorways meet.
  // Flood-fill the whole chain of rooms reachable through OPEN archways, positioned so the doorways line up,
  // into one static scene. Walking between them needs no rebuild (no stutter). Closed doors stay as teleports
  // and get a solid barrier so you can't walk out through the gap.
  function buildScene(startName) {
    clearAll(); anchor = startName; loaded = []; pColliders = []; teleportExits = []; conns = []; npcs = [];
    if (!world.rooms[startName]) return null;
    var placed = {}, queue = [{ name: startName, align: null }], root = null;
    while (queue.length) {
      var job = queue.shift(); if (placed[job.name]) continue;
      var rd = world.rooms[job.name]; var inst = buildInstance(rd); inst.name = job.name;
      var theta = 0, tx = 0, tz = 0;
      if (job.align) { var al = job.align, nex = inst.exits[al.arrive] || inst.exits[0];
        if (nex) { theta = al.fAng + Math.PI - nex.rotationY;
          var fB = [Math.sin(nex.rotationY), Math.cos(nex.rotationY)], dBl = [nex.position[0] + 0.5 * fB[0], nex.position[2] + 0.5 * fB[1]], rb = rotY(dBl[0], dBl[1], theta);
          tx = al.dA[0] - rb[0]; tz = al.dA[1] - rb[1]; } }
      placeInstance(inst, theta, tx, tz); placed[job.name] = inst; if (!root) root = inst;
      (rd.exits || []).forEach(function (m, i) {
        if (!m || !m.to || !world.rooms[m.to]) return;
        var ex = inst.exits[i]; if (!ex) return;
        var exAng = ex.rotationY + theta, fA = [Math.sin(exAng), Math.cos(exAng)];
        var dloc = [ex.position[0] + 0.5 * Math.sin(ex.rotationY), ex.position[2] + 0.5 * Math.cos(ex.rotationY)];
        var dw = rotY(dloc[0], dloc[1], theta), dA = [dw[0] + tx, dw[1] + tz];
        var exw = rotY(ex.position[0], ex.position[2], theta), exWorld = [exw[0] + tx, exw[1] + tz];
        if (m.auto) {
          inst.doorTargets.push([[dA[0] - fA[0] * 0.6, dA[1] - fA[1] * 0.6], [dA[0] + fA[0] * 1.3, dA[1] + fA[1] * 1.3]]);
          if (!placed[m.to]) queue.push({ name: m.to, align: { dA: dA, fAng: exAng, arrive: m.arrive || 0 } });
        } else {
          teleportExits.push({ x: exWorld[0], z: exWorld[1], to: m.to, arrive: m.arrive || 0, dx: fA[0], dz: fA[1] });
          var bx = Math.abs(fA[0]) > 0.5 ? [0.12, 0.5] : [0.5, 0.12];   // barrier across a closed doorway
          pColliders.push({ cx: dA[0], cz: dA[1], hx: bx[0], hz: bx[1], ymin: 0, ymax: 1.5 });
        }
      });
    }
    actors.forEach(function (a) { a.api = null; a.inst = null; });
    npcs = [];
    loaded.forEach(function (inst2) { actors.forEach(function (a) { if (a.room === inst2.name) { spawnActor(a, inst2); npcs.push(a); } }); });
    setCeilings(fpv); collectFlicker();
    $('hudRoom').textContent = world.rooms[startName].label || startName;
    return root;
  }
  function setCeilings(vis) { loaded.forEach(function (inst) { if (inst.ro && inst.ro.ceiling) inst.ro.ceiling.visible = vis; }); }
  function enterRoom(name, arriveIdx) {
    var center = buildScene(name); if (!center) { $('hudMsg').textContent = 'Room "' + name + '" is missing.'; return; }
    var sp = center.spawns[arriveIdx != null ? arriveIdx : 0] || center.spawns[0];
    if (sp) { pPos.set(sp.position[0], 0, sp.position[2]); pYaw = sp.rotationY || 0; var rr = resolve(pPos.x, pPos.z, playerColliders(), PR); pPos.x = rr[0]; pPos.z = rr[1]; }
    else { pPos.set(0, 0, 0); pYaw = 0; }
    transCool = TRANS_COOL; camYaw = pYaw; if (player) player.root.position.copy(pPos); closeDlg();
  }
  // which loaded room is the player standing in (updates the HUD label without any rebuild)
  function updatePlayerRoom() {
    for (var i = 0; i < loaded.length; i++) { var inst = loaded[i], bb = inst.ro.bounds; if (!bb) continue;
      var loc = invXform(pPos.x, pPos.z, inst.theta, inst.tx, inst.tz);
      if (loc[0] >= bb.minx - 0.1 && loc[0] <= bb.maxx + 0.1 && loc[1] >= bb.minz - 0.1 && loc[1] <= bb.maxz + 0.1) { var lab = world.rooms[inst.name].label || inst.name; if ($('hudRoom').textContent !== lab) $('hudRoom').textContent = lab; return; } }
  }
  function loadWorld(w) {
    window.createPSXRoom.loadTextures(THREE, w.textures || {}, function () {
      window.createPSXRoom.loadModels(THREE, w.models || {}, function () { loadWorldNow(w); });
    });
  }
  function loadWorldNow(w) {
    world = w; mode = 'play'; applyMode(); applyTimeOfDay(w.sky || 'dusk'); flickerOn = !!w.flicker; buildActors();
    if (player) scene.remove(player.root); player = charFrom(world.player); player.root.visible = !fpv; scene.add(player.root);
    enterRoom(world.start, 0);
    lookHint();
  }

  /* ---------- edit: single room ---------- */
  function buildRoom(rd) { roomObj = window.createPSXRoom(THREE, rd || { objects: [] }); roomGroup = roomObj.root; roomObj.markers.visible = true; scene.add(roomGroup); }

  /* ---------- collision ---------- */
  function resolve(x, z, list, r) {
    r = r || PR;
    for (var pass = 0; pass < 3; pass++) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        var qx = Math.max(c.cx - c.hx, Math.min(x, c.cx + c.hx)), qz = Math.max(c.cz - c.hz, Math.min(z, c.cz + c.hz));
        var dx = x - qx, dz = z - qz, d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-6) { var d = Math.sqrt(d2), p = r - d; x += dx / d * p; z += dz / d * p; }
          else { var ox = (c.hx + r) - Math.abs(x - c.cx), oz = (c.hz + r) - Math.abs(z - c.cz); if (ox < oz) x += (x < c.cx ? -ox : ox); else z += (z < c.cz ? -oz : oz); }
        }
      }
    }
    return [x, z];
  }
  function playerColliders() { return pColliders; }   // player walks through NPCs; NPCs still collide with walls

  /* ---------- NPC behaviours ---------- */
  function npcAnim(n, a) { if (a !== n.anim) { n.anim = a; try { n.api.play(a); } catch (e) {} } }
  function faceTo(n, yaw, dt) { var cy = n.api.root.rotation.y, d = ((yaw - cy + Math.PI) % (Math.PI * 2)) - Math.PI; n.api.root.rotation.y = cy + d * Math.min(1, dt * 8); }
  function moveNpc(n, tx, tz, speed, dt) {
    var p = n.api.root.position, dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
    if (dist < 0.08) { npcAnim(n, 'idle'); return true; }
    var step = Math.min(dist, speed * dt), nx = p.x + dx / dist * step, nz = p.z + dz / dist * step;
    var r = resolve(nx, nz, pColliders, 0.24);
    // don't walk through the player: push out of their personal space, then re-settle against walls
    var minD = 0.24 + PR + 0.1, adx = r[0] - pPos.x, adz = r[1] - pPos.z, ad = Math.hypot(adx, adz);
    if (ad < minD) {
      if (ad > 1e-3) { r[0] = pPos.x + adx / ad * minD; r[1] = pPos.z + adz / ad * minD; }
      r = resolve(r[0], r[1], pColliders, 0.24);
      // if sliding around them made almost no headway, wait this frame and face them
      if (Math.hypot(r[0] - p.x, r[1] - p.z) < speed * dt * 0.35) { npcAnim(n, 'idle'); faceTo(n, Math.atan2(pPos.x - p.x, pPos.z - p.z), dt); return false; }
    }
    p.x = r[0]; p.z = r[1]; n.collider.cx = r[0]; n.collider.cz = r[1];
    faceTo(n, Math.atan2(dx, dz), dt); npcAnim(n, 'walk'); return false;
  }
  var BEHAVIORS = {
    idle: function (n, dt, ctx) { npcAnim(n, 'idle'); },
    facePlayer: function (n, dt, ctx) { var p = n.api.root.position; faceTo(n, Math.atan2(ctx.px - p.x, ctx.pz - p.z), dt); npcAnim(n, 'idle'); },
    wander: function (n, dt, ctx) {
      var st = n.state, p = n.api.root.position;
      if (st.pause > 0) { st.pause -= dt; npcAnim(n, 'idle'); return; }
      if (!st.tgt) { var rad = n.data.radius || 2, a = Math.random() * Math.PI * 2, d = 0.4 + Math.random() * rad; st.tgt = [n.home[0] + Math.sin(a) * d, n.home[1] + Math.cos(a) * d]; st.stuck = 0; st.lx = p.x; st.lz = p.z; }
      if (moveNpc(n, st.tgt[0], st.tgt[1], n.data.speed || 1.0, dt)) { st.tgt = null; st.pause = 0.8 + Math.random() * 1.8; return; }
      var moved = Math.hypot(p.x - st.lx, p.z - st.lz); st.lx = p.x; st.lz = p.z;
      st.stuck = moved < (n.data.speed || 1.0) * dt * 0.4 ? (st.stuck || 0) + dt : 0;
      if (st.stuck > 0.5) { st.tgt = null; st.pause = 0.4 + Math.random() * 0.8; }
    },
    patrol: function (n, dt, ctx) {
      var path = n.data.path; if (!path || !path.length) { npcAnim(n, 'idle'); return; }
      var st = n.state; if (st.idx == null) st.idx = 0; var t = path[st.idx % path.length];
      if (moveNpc(n, t[0], t[1], n.data.speed || 1.2, dt)) st.idx = (st.idx + 1) % path.length;
    },
    // wander a room, then head out through a random open archway into the connected room — then repeat there
    roam: function (n, dt, ctx) {
      var st = n.state, p = n.api.root.position;
      if (st.phase == null || st.phase === 'wander') {
        if (st.phase == null) { st.phase = 'wander'; st.t = 1.5 + Math.random() * 3; }
        BEHAVIORS.wander(n, dt, ctx); st.t -= dt;
        if (st.t <= 0) { var dts = n.inst && n.inst.doorTargets; if (dts && dts.length) { st.phase = 'toDoor'; st.door = dts[Math.floor(Math.random() * dts.length)]; st.step = 0; st.rstuck = 0; st.lx = p.x; st.lz = p.z; } else st.t = 1.5 + Math.random() * 2; }
      } else if (st.phase === 'toDoor') {
        var tgt = st.step === 0 ? st.door[0] : st.door[1];
        if (moveNpc(n, tgt[0], tgt[1], n.data.speed || 1.1, dt)) { if (st.step === 0) st.step = 1; else { st.phase = 'wander'; st.t = 2 + Math.random() * 3; st.tgt = null; } }
        else { var mv = Math.hypot(p.x - st.lx, p.z - st.lz); st.lx = p.x; st.lz = p.z; st.rstuck = mv < (n.data.speed || 1.1) * dt * 0.4 ? (st.rstuck || 0) + dt : 0; if (st.rstuck > 1.2) { st.phase = 'wander'; st.t = 1 + Math.random(); st.tgt = null; } }
      }
    },
    // horror: freezes and stares while you look at it, creeps toward you the moment you look away
    stalker: function (n, dt, ctx) {
      var p = n.api.root.position, dx = ctx.px - p.x, dz = ctx.pz - p.z, dist = Math.hypot(dx, dz) || 1e-4;
      var seen = ((-dx) * ctx.fx + (-dz) * ctx.fz) / dist > 0.3 && dist < 14;   // NPC sits within the player's forward view
      if (seen || dist < 0.85) { faceTo(n, Math.atan2(dx, dz), dt); npcAnim(n, 'idle'); }
      else { npcAnim(n, (n.data.speed || 1.4) > 2 ? 'run' : 'walk'); moveNpc(n, ctx.px, ctx.pz, n.data.speed || 1.4, dt); }
    }
  };

  /* ---------- dialogue + emotions ---------- */
  // a line is "text" or { text, emote }; emote swaps the NPC's facial expression (and the portrait)
  var EXPR_KEYS = ['smile', 'browTilt', 'browY', 'brow', 'browArch', 'eyeSize', 'eyeShape', 'eyeY', 'eyeTilt', 'mouthW', 'lipFull', 'mouthY'];
  // big, readable expressions — many controls pushed near their limits so the face reads at portrait size
  var EMOTES = {
    neutral: {},
    happy: { smile: 1, mouthW: 1.45, lipFull: 1.4, browY: 0.45, browArch: 1.8, eyeShape: 0.9, eyeTilt: 0.35, eyeSize: 1.05 },
    sad: { smile: -0.95, browTilt: -1, browY: -0.55, browArch: 1.5, eyeShape: 1.3, eyeY: -0.3, eyeTilt: -0.7, lipFull: 1.25, mouthY: -0.45 },
    angry: { smile: -0.85, browTilt: 1, browY: -0.8, brow: 1.9, browArch: 0, eyeShape: 0.66, eyeSize: 0.92, eyeTilt: 0.55, mouthW: 0.78, mouthY: -0.2 },
    surprised: { smile: 0.25, eyeSize: 1.4, eyeShape: 1.5, browY: 1, browArch: 2, mouthW: 0.85, lipFull: 1.8, mouthY: -0.35 },
    worried: { smile: -0.55, browTilt: -0.95, browY: -0.1, browArch: 1.5, eyeShape: 1.3, eyeSize: 1.18, eyeTilt: -0.35, mouthW: 0.82 },
    smug: { smile: 0.75, browTilt: 0.55, browY: 0.12, browArch: 0.5, eyeShape: 0.68, eyeTilt: 0.35, mouthW: 1.2, mouthY: 0.12 },
    laugh: { smile: 1, mouthW: 1.45, lipFull: 1.8, browY: 0.5, browArch: 1.9, eyeShape: 0.66, eyeSize: 0.75, eyeTilt: 0.45 },
    scared: { smile: -0.35, eyeSize: 1.4, eyeShape: 1.5, browY: 0.85, browTilt: -0.7, browArch: 1.8, lipFull: 1.6, mouthW: 0.74, mouthY: -0.3 },
    annoyed: { smile: -0.45, browTilt: 0.75, browY: -0.35, eyeShape: 0.74, eyeTilt: 0.25, mouthW: 0.9, mouthY: 0.05 }
  };
  var EMOTE_NAMES = Object.keys(EMOTES);
  function lineText(l) { return typeof l === 'string' ? l : (l && l.text) || ''; }
  function lineEmote(l) { return (l && typeof l === 'object' && l.emote) || null; }
  function applyEmote(n, name) {
    if (!n || !n.api || !dlg.faceBase) return;
    var e = EMOTES[name] || {}, patch = {};
    EXPR_KEYS.forEach(function (k) { patch[k] = (e[k] != null) ? e[k] : (dlg.faceBase[k] != null ? dlg.faceBase[k] : undefined); });
    try { n.api.set(patch); } catch (err) {}
  }
  /* Dialogue is JSON-driven and composable. A conversation can be:
       "a line"  |  ["line", {text,emote}, …]                         (linear)
       { random:  [ <conv>, <conv>, … ] }   pick one at random each talk   ({oneOf} = alias)
       { cycle:   [ <conv>, … ] }           advance through them on repeat talks
       { sequence:[ <conv>, … ] }           step forward, then hold on the last
       { start:"id", nodes:{ id:{ say:[…], emote?, choices:[{text,to}], goto:"id" } } }   branching graph
     Any element can nest (random of graphs, a node whose say is picked, …). */
  function hasDialogue(d) { if (!d) return false; if (typeof d === 'string') return !!d; if (Array.isArray(d)) return d.length > 0; if (typeof d === 'object') return !!(d.random || d.oneOf || d.cycle || d.sequence || d.nodes || d.say || d.lines || d.text); return false; }
  function toLine(l) { return (typeof l === 'string') ? { text: l } : { text: (l && l.text) || '', emote: (l && l.emote) || null }; }
  function normNode(nd) {
    if (nd == null) return { say: [] };
    if (typeof nd === 'string') return { say: [{ text: nd }] };
    if (Array.isArray(nd)) return { say: nd.map(toLine) };
    var say = (nd.say || nd.lines || (nd.text != null ? [nd] : [])).map(toLine);
    return { say: say, choices: nd.choices || null, goto: nd.goto || nd.next || null };
  }
  function pickSet(d, n) {
    n.state = n.state || {};
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      if (d.random) return pickSet(d.random[Math.floor(Math.random() * d.random.length)], n);
      if (d.oneOf) return pickSet(d.oneOf[Math.floor(Math.random() * d.oneOf.length)], n);
      if (d.cycle) { var i = (n.state.dc = (n.state.dc || 0)) % d.cycle.length; n.state.dc++; return pickSet(d.cycle[i], n); }
      if (d.sequence) { n.state.ds = (n.state.ds == null) ? 0 : Math.min(n.state.ds + 1, d.sequence.length - 1); return pickSet(d.sequence[n.state.ds], n); }
    }
    return d;
  }
  function compileDialogue(d, n) {
    d = pickSet(d, n); if (d == null) return null;
    if (typeof d === 'object' && !Array.isArray(d) && d.nodes) return { start: d.start || Object.keys(d.nodes)[0], nodes: d.nodes };
    return { start: '_', nodes: { _: d } };
  }
  var dlg = { open: false, who: '', npc: null, faceBase: null, graph: null, node: null, seq: null, idx: 0, sel: 0, choiceEls: null };
  function startDialogue(n) {
    if (!hasDialogue(n.data.dialogue)) return;
    dlg.graph = compileDialogue(n.data.dialogue, n); if (!dlg.graph) return;
    dlg.open = true; dlg.npc = n; dlg.who = n.data.name || 'NPC'; dlg.sel = 0;
    // turn to face the NPC (first-person view is driven by camYaw; keep the body in sync)
    if (n.api && n.api.root) { var pp = n.api.root.position, a = Math.atan2(pp.x - pPos.x, pp.z - pPos.z); camYaw = a; pYaw = a; fpPitch = 0; }
    var st = (n.api && n.api.settings) || {}; dlg.faceBase = {}; EXPR_KEYS.forEach(function (k) { dlg.faceBase[k] = st[k]; });
    enterNode(dlg.graph.start);
  }
  function enterNode(id) { var nd = normNode(dlg.graph.nodes[id]); dlg.node = nd; dlg.seq = nd.say.length ? nd.say : [{ text: '' }]; dlg.idx = 0; dlg.sel = 0; showDlg(); }
  function showDlg() {
    var line = dlg.seq[dlg.idx];
    $('dialogue').style.display = 'flex'; $('dlgWho').textContent = dlg.who; $('dlgLine').textContent = lineText(line);
    if (joyEl) joyEl.style.visibility = 'hidden';
    applyEmote(dlg.npc, lineEmote(line) || 'neutral');
    var last = dlg.idx >= dlg.seq.length - 1;
    renderChoices(last && dlg.node.choices && dlg.node.choices.length ? dlg.node.choices : null);
  }
  function renderChoices(choices) {
    var box = $('dlgChoices'), adv = $('dlgAdv');
    box.innerHTML = ''; dlg.choiceEls = null;
    if (choices) {
      adv.style.display = 'none'; box.style.display = 'flex'; $('dialogue').classList.add('choosing');
      if (dlg.sel == null || dlg.sel >= choices.length) dlg.sel = 0;
      dlg.choiceEls = choices.map(function (c, i) {
        var b = document.createElement('button'); b.className = 'dchoice' + (i === dlg.sel ? ' sel' : '');
        b.textContent = (i + 1) + '.  ' + (c.text || ('Option ' + (i + 1)));
        b.onmouseenter = function () { dlg.sel = i; highlightChoices(); };
        b.onclick = function (ev) { ev.stopPropagation(); choose(i); }; box.appendChild(b); return b;
      });
    } else { adv.style.display = 'block'; box.style.display = 'none'; $('dialogue').classList.remove('choosing'); }
  }
  function highlightChoices() { if (dlg.choiceEls) dlg.choiceEls.forEach(function (b, i) { b.classList.toggle('sel', i === dlg.sel); }); }
  function choose(i) { var ch = dlg.node.choices; if (!ch || !ch[i]) return closeDlg(); var to = ch[i].to; if (to && dlg.graph.nodes[to]) enterNode(to); else closeDlg(); }
  // dialogue runs entirely from the keyboard (or a click) so the pointer stays locked — no click needed after talking
  function dlgChoosing() { return !!(dlg.node && dlg.idx >= dlg.seq.length - 1 && dlg.node.choices && dlg.node.choices.length); }
  function dlgConfirm() { if (dlgChoosing()) choose(dlg.sel || 0); else advanceDialogue(); }
  function dlgKey(k, e) {
    if (dlgChoosing()) {
      var n = dlg.node.choices.length;
      if (k === 'arrowup' || k === 'arrowleft' || k === 'w') { dlg.sel = (dlg.sel - 1 + n) % n; highlightChoices(); e.preventDefault(); return; }
      if (k === 'arrowdown' || k === 'arrowright' || k === 's') { dlg.sel = (dlg.sel + 1) % n; highlightChoices(); e.preventDefault(); return; }
      if (k.length === 1 && k >= '1' && k <= '9') { var idx = +k - 1; if (idx < n) choose(idx); e.preventDefault(); return; }
      if (k === 'enter' || k === ' ' || k === 'e') { choose(dlg.sel || 0); e.preventDefault(); return; }
    } else if (k === 'enter' || k === ' ' || k === 'e') { advanceDialogue(); e.preventDefault(); return; }
  }
  function closeDlg() { if (dlg.npc && dlg.faceBase) applyEmote(dlg.npc, 'neutral'); dlg.open = false; dlg.npc = null; dlg.faceBase = null; dlg.graph = null; dlg.node = null; dlg.seq = null; $('dialogue').style.display = 'none'; $('dialogue').classList.remove('choosing'); if (joyEl) joyEl.style.visibility = ''; }
  function advanceDialogue() {
    if (dlg.node && dlg.idx >= dlg.seq.length - 1 && dlg.node.choices && dlg.node.choices.length) return; // waiting on a choice
    dlg.idx++;
    if (dlg.idx < dlg.seq.length) { showDlg(); return; }
    if (dlg.node && dlg.node.goto && dlg.graph.nodes[dlg.node.goto]) enterNode(dlg.node.goto); else closeDlg();
  }

  // live portrait: borrow the speaking NPC's real 3D head into a tiny scene and render it in the dialogue box
  var portRenderer = null, portScene = null, portCam = null;
  function initPortrait() {
    if (portRenderer) return; var host = $('portrait'); if (!host) return;
    portRenderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    portRenderer.setPixelRatio(1); portRenderer.setSize(96, 96, false); host.appendChild(portRenderer.domElement);
    portScene = new THREE.Scene(); portScene.background = new THREE.Color(0x14161e);
    portScene.add(new THREE.AmbientLight(0xb9c0da, 0.85));
    var pd = new THREE.DirectionalLight(0xfff0d6, 0.95); pd.position.set(1.5, 2.5, 2); portScene.add(pd);
    var pr = new THREE.DirectionalLight(0x6b79a4, 0.3); pr.position.set(-2, 1, -1.5); portScene.add(pr);
    portCam = new THREE.PerspectiveCamera(30, 1, 0.03, 20);
  }
  function renderPortrait(n) {
    initPortrait(); if (!portRenderer || !n || !n.api) return;
    var root = n.api.root, pos = root.position, hy = CHAR_H * 0.9, ry = root.rotation.y, fx = Math.sin(ry), fz = Math.cos(ry);
    portCam.position.set(pos.x + fx * 0.52, hy + 0.03, pos.z + fz * 0.52); portCam.lookAt(pos.x, hy, pos.z);
    var prev = root.parent; portScene.add(root);                 // borrow the real head
    portRenderer.render(portScene, portCam);
    if (prev) prev.add(root); else scene.add(root);              // return it before the main render
  }

  /* ---------- prompts / interact ---------- */
  var nearExit = null, nearNpc = null;
  function labelOf(name) { return (world && world.rooms[name] && (world.rooms[name].label || name)) || name; }
  function updateInteract(dt) {
    nearExit = null; nearNpc = null;
    if (transCool > 0) transCool -= dt;
    updatePlayerRoom();
    var faceYaw = fpv ? camYaw : pYaw, fx = Math.sin(faceYaw), fz = Math.cos(faceYaw);
    // Gaze picker: the E action is whatever you're looking at most directly.
    // Range only decides *candidacy*; FACE_DOT is how roughly you must face it;
    // the small distance term + talk lean break near-ties. Add future E-targets
    // (items, levers, …) with another consider(kind, x, z, range, data) call.
    var bestAct = null, bestScore = -1;
    function consider(kind, x, z, range, data, dirx, dirz) {
      var dx = x - pPos.x, dz = z - pPos.z, dist = Math.hypot(dx, dz);
      if (dist > range) return;
      var gaze, minFace;
      if (dirx != null) { gaze = fx * dirx + fz * dirz; minFace = EXIT_FACE; }            // a door: you must face the way it leads
      else { gaze = dist < 0.001 ? 1 : (fx * dx + fz * dz) / dist; minFace = FACE_DOT; }   // a thing (NPC): look at it
      if (gaze < minFace) return;
      var score = gaze - dist * 0.04 + (kind === 'npc' ? 0.02 : 0);    // whichever you face most wins; near-ties lean to talk
      if (score > bestScore) { bestScore = score; bestAct = { kind: kind, data: data }; }
    }
    if (transCool <= 0) teleportExits.forEach(function (ez) { consider('exit', ez.x, ez.z, EXIT_NEAR, ez, ez.dx, ez.dz); });
    npcs.forEach(function (n) { if (hasDialogue(n.data.dialogue)) { var pp = n.api.root.position; consider('npc', pp.x, pp.z, TALK_NEAR, n); } });
    if (bestAct) { if (bestAct.kind === 'exit') nearExit = bestAct.data; else nearNpc = bestAct.data; }
    var el = $('hudExit');
    if (dlg.open) { el.style.display = 'none'; return; }
    if (nearExit) { el.style.display = 'block'; el.textContent = 'Press E to enter ' + labelOf(nearExit.to); }
    else if (nearNpc) { el.style.display = 'block'; el.textContent = 'Press E to talk to ' + (nearNpc.data.name || 'them'); }
    else el.style.display = 'none';
  }
  function interact() { if (dlg.open) { advanceDialogue(); return; } if (nearExit) { enterRoom(nearExit.to, nearExit.arrive); return; } if (nearNpc) startDialogue(nearNpc); }

  /* ---------- keyboard ---------- */
  var keys = {};
  window.addEventListener('keydown', function (e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    var k = e.key.toLowerCase(); keys[k] = true;
    if (mode === 'play' && dlg.open) { dlgKey(k, e); return; }   // dialogue is keyboard-driven; don't fall through to move/interact
    if (k === 'e' && mode === 'play') interact();
    if (k === 'f' && mode === 'play') toggleFlash();
    if (k === 'r' && mode === 'edit' && editSub === 'build') { placeRotDeg = (placeRotDeg + 90) % 360; renderBuild(); }
    if (k === 'escape' && mode === 'edit') { armedPiece = null; eraserOn = false; if (editSub === 'build') renderBuild(); $('hudMsg').textContent = ''; }
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });

  /* ---------- cameras + pointer ---------- */
  var camYaw = 0, camPitch = 0.62, camDist = 4.0, fpv = true, fpPitch = 0, EYE = CHAR_H * 0.9, TP_LOOK = 1.3;
  var editCam = { yaw: 0.8, pitch: 0.78, dist: 13, target: new THREE.Vector3(0, 0.4, 0) };
  var dom = renderer.domElement, drag = null, placeNpcArmed = false, locked = false, lockMove = 0;
  var cl = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  function lookHint() { if (mode === 'play' && !dlg.open) $('hudMsg').textContent = locked ? '' : 'Click to look · WASD to move · Esc frees the cursor'; }
  document.addEventListener('pointerlockchange', function () { locked = (document.pointerLockElement === dom); lookHint(); });
  dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  // Mouselook: click once to grab the pointer, then moving the mouse turns the camera (no button held).
  document.addEventListener('mousemove', function (e) {
    if (!locked || mode !== 'play' || dlg.open) return;    // freeze the view while talking
    camYaw -= e.movementX * 0.0026;
    if (fpv) fpPitch = cl(fpPitch - e.movementY * 0.0026, -0.95, 0.95); else camPitch = cl(camPitch - e.movementY * 0.0026, 0.1, 1.2);
    lockMove += Math.abs(e.movementX) + Math.abs(e.movementY);
  });
  dom.addEventListener('pointerdown', function (e) {
    if (mode === 'play') {
      if (dlg.open) { dlgConfirm(); return; }                                 // dialogue: a click advances / confirms the choice
      if (!locked) { try { dom.requestPointerLock(); } catch (x) {} return; }  // click once to grab mouselook
      lockMove = 0; drag = { btn: e.button, locked: true }; return;           // locked: a still click = interact
    }
    try { dom.setPointerCapture(e.pointerId); } catch (x) {}
    drag = { x: e.clientX, y: e.clientY, moved: false, btn: e.button };
  });
  dom.addEventListener('pointermove', function (e) {                           // drag-look fallback: edit orbit, or play when not locked
    if (!drag || drag.locked) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; drag.x = e.clientX; drag.y = e.clientY;
    if (mode === 'play') { camYaw -= dx * 0.006; if (fpv) fpPitch = cl(fpPitch - dy * 0.006, -0.95, 0.95); else camPitch = cl(camPitch - dy * 0.006, 0.1, 1.2); }
    else { editCam.yaw -= dx * 0.006; editCam.pitch = cl(editCam.pitch - dy * 0.006, 0.2, 1.35); }
  });
  dom.addEventListener('pointerup', function (e) {
    if (drag && drag.locked) { if (e.button === 0 && lockMove < 8) interact(); drag = null; return; }   // click while locked = interact
    if (drag && !drag.moved && e.button === 0) onClick(e); drag = null;
  });
  dom.addEventListener('wheel', function (e) { e.preventDefault(); var f = 1 + Math.sign(e.deltaY) * 0.12; if (mode === 'play') camDist = Math.max(1.6, Math.min(9, camDist * f)); else editCam.dist = Math.max(4, Math.min(30, editCam.dist * f)); }, { passive: false });
  var ray = new THREE.Raycaster(), nd2 = new THREE.Vector2();
  function groundPoint(e) { var r = dom.getBoundingClientRect(); nd2.x = ((e.clientX - r.left) / r.width) * 2 - 1; nd2.y = -((e.clientY - r.top) / r.height) * 2 + 1; ray.setFromCamera(nd2, camera); var h = ray.intersectObject(ground, false); return h.length ? h[0].point : null; }
  function copyCoord(p) { var x = +p.x.toFixed(2), z = +p.z.toFixed(2); try { if (navigator.clipboard) navigator.clipboard.writeText('[' + x + ', ' + z + ']'); } catch (err) {} $('hudMsg').textContent = 'Copied [' + x + ', ' + z + ']'; }
  function raycastNpc(e) { var r = dom.getBoundingClientRect(); nd2.x = ((e.clientX - r.left) / r.width) * 2 - 1; nd2.y = -((e.clientY - r.top) / r.height) * 2 + 1; ray.setFromCamera(nd2, camera); var hits = ray.intersectObjects(npcs.map(function (n) { return n.api.root; }), true); if (!hits.length) return null; var o = hits[0].object; while (o) { if (o.userData && o.userData.__npc) return o.userData.__npc; o = o.parent; } return null; }
  function onClick(e) {
    if (mode === 'edit') {
      if (editSub === 'build') {
        if (eraserOn) { eraseAt(e); return; }
        var pb = groundPoint(e); if (!pb) return;
        if (armedPiece) { placePiece(pb); return; }
        return;
      }
      var p = groundPoint(e); if (!p) return;
      if (placeNpcArmed) { var rm = draft.rooms[editActive]; rm.npcs = rm.npcs || []; rm.npcs.push({ code: '', at: [+p.x.toFixed(2), +p.z.toFixed(2)], face: 0, anim: 'idle', behavior: 'idle' }); placeNpcArmed = false; $('epPlaceNpc').classList.remove('on'); showEditRoom(); renderPanel(); return; }
      return;
    }
    // play: tap to talk / advance / use a door — works with mouse and touch
    if (dlg.open) { advanceDialogue(); return; }
    var hit = raycastNpc(e);
    if (hit && hasDialogue(hit.data.dialogue)) {
      var dd = Math.hypot(pPos.x - hit.api.root.position.x, pPos.z - hit.api.root.position.z);
      if (dd <= TALK_NEAR) startDialogue(hit);
      else if (dd <= TALK_HINT) $('hudMsg').textContent = 'Step closer to talk.';
      // farther than TALK_HINT: they're across the room — don't nag
      return;
    }
    if (nearExit) { interact(); return; }
  }

  /* ---------- build mode (fold-in of the Room Builder, over the shared catalog) ---------- */
  function snapCell(p) { return [Math.round(p.x - 0.5) + 0.5, 0, Math.round(p.z - 0.5) + 0.5]; }
  function snapEdge(p) {
    var vi = Math.round(p.x), dv = Math.abs(p.x - vi), hj = Math.round(p.z), dh = Math.abs(p.z - hj);
    if (dv <= dh) return { pos: [vi, 0, Math.round(p.z - 0.5) + 0.5], rot: 90 };   // wall on a vertical grid line
    return { pos: [Math.round(p.x - 0.5) + 0.5, 0, hj], rot: 0 };                   // wall on a horizontal grid line
  }
  function slotKey(o) {
    var oc = occupyOf(o.asset), p = o.position, deg = Math.round((((o.rotationY || 0) % 360) + 360) % 360);
    if (oc === 'edge') { return (deg === 90 || deg === 270) ? 'Ev|' + Math.round(p[0]) + '|' + Math.round(p[2] - 0.5) : 'Eh|' + Math.round(p[0] - 0.5) + '|' + Math.round(p[2]); }
    if (oc === 'floor') return 'F|' + Math.round(p[0] - 0.5) + '|' + Math.round(p[2] - 0.5);
    return oc.charAt(0) + '|' + o.asset + '|' + Math.round(p[0] - 0.5) + '|' + Math.round(p[2] - 0.5);
  }
  function activeObjs() { var rm = draft.rooms[editActive]; rm.room = rm.room || { version: 2, objects: [] }; if (rm.room.version == null) rm.room.version = 2; rm.room.objects = rm.room.objects || []; return rm.room.objects; }
  function placePiece(p) {
    if (!armedPiece) return;
    var isModel = armedPiece.indexOf('model:') === 0, asset = isModel ? 'model' : armedPiece;
    var oc = occupyOf(asset), pos, rot;
    if (oc === 'edge') { var s = snapEdge(p); pos = s.pos; rot = s.rot; } else { pos = snapCell(p); rot = placeRotDeg; }
    var obj;
    if (isModel) { var rest = armedPiece.slice(6), ci = rest.indexOf('::'), src = ci >= 0 ? rest.slice(0, ci) : rest, node = ci >= 0 ? rest.slice(ci + 2) : ''; obj = { asset: 'model', src: src, node: node, position: pos, rotationY: rot, scale: placeScale }; }
    else obj = { asset: asset, position: pos, rotationY: rot, material: pieceMat[asset] || catDefMat[asset] };
    var objs = activeObjs(), key = slotKey(obj), hit = -1;
    for (var i = 0; i < objs.length; i++) { if (slotKey(objs[i]) === key) { hit = i; break; } }
    if (hit >= 0) { if (oc === 'edge' || oc === 'floor') objs.splice(hit, 1); else return; }  // swap walls/floors; don't stack dup furniture
    objs.push(obj); showEditRoom(); renderPanel();
  }
  function raycastPiece(e) {
    if (!roomGroup) return null; var r = dom.getBoundingClientRect();
    nd2.x = ((e.clientX - r.left) / r.width) * 2 - 1; nd2.y = -((e.clientY - r.top) / r.height) * 2 + 1; ray.setFromCamera(nd2, camera);
    var hits = ray.intersectObject(roomGroup, true);
    for (var i = 0; i < hits.length; i++) { var o = hits[i].object; while (o) { if (o.userData && o.userData.srcObj) return o.userData.srcObj; o = o.parent; } }
    return null;
  }
  function eraseAt(e) { var o = raycastPiece(e); if (!o) return; var objs = activeObjs(), i = objs.indexOf(o); if (i >= 0) { objs.splice(i, 1); showEditRoom(); renderPanel(); } }
  function setSub(s) {
    editSub = s;
    $('epTabBuild').classList.toggle('on', s === 'build'); $('epTabCompose').classList.toggle('on', s === 'compose');
    $('buildSecs').style.display = s === 'build' ? '' : 'none'; $('composeSecs').style.display = s === 'compose' ? '' : 'none';
    armedPiece = null; eraserOn = false; placeNpcArmed = false; if ($('epPlaceNpc')) $('epPlaceNpc').classList.remove('on');
    editGrid.visible = (mode === 'edit' && s === 'build'); $('hudMsg').textContent = '';
    if (s === 'build') renderBuild();
  }
  function renderBuild() {
    var lib = $('epPieceLib'); lib.innerHTML = '';
    PIECES.forEach(function (name) {
      var b = document.createElement('button'); b.className = 'pcBtn' + (name === armedPiece && !eraserOn ? ' on' : '');
      b.textContent = PLABEL[name] || name;
      b.onclick = function () { eraserOn = false; armedPiece = (armedPiece === name ? null : name); renderBuild(); $('hudMsg').textContent = armedPiece ? 'Click the floor grid to place ' + (PLABEL[armedPiece] || armedPiece) : ''; };
      lib.appendChild(b);
    });
    if (draft && draft.models) Object.keys(draft.models).forEach(function (src) {
      var nodes = window.createPSXRoom.sourceNodes(src) || [{ node: '' }], multi = nodes.length > 1, srcName = (draft.models[src].name || src);
      nodes.forEach(function (nd) {
        var tag = 'model:' + src + '::' + (nd.node || ''), nm = multi ? (nd.node || 'part') : srcName;
        var b = document.createElement('button'); b.className = 'pcBtn modelBtn' + (tag === armedPiece && !eraserOn ? ' on' : '');
        b.textContent = '▸ ' + nm; b.title = srcName + (multi ? ' · ' + nm : '');
        b.onclick = function () { eraserOn = false; armedPiece = (armedPiece === tag ? null : tag); renderBuild(); $('hudMsg').textContent = armedPiece ? 'Click the floor to place ' + nm : ''; };
        lib.appendChild(b);
      });
    });
    var mEl = $('epPieceMat'); mEl.innerHTML = '';
    var cur = armedPiece ? (pieceMat[armedPiece] || catDefMat[armedPiece]) : null;
    MATS.forEach(function (mk) {
      var s = document.createElement('button'); s.className = 'sw' + (mk === cur ? ' on' : ''); s.title = mk; s.style.background = SWCOL[mk] || '#888';
      s.onclick = function () { if (!armedPiece) { $('hudMsg').textContent = 'Pick a piece first.'; return; } pieceMat[armedPiece] = mk; renderBuild(); };
      mEl.appendChild(s);
    });
    if (draft && draft.textures) Object.keys(draft.textures).forEach(function (id) {
      var key = 'tex:' + id, s = document.createElement('button'); s.className = 'sw' + (key === cur ? ' on' : ''); s.title = draft.textures[id].name || id;
      s.style.backgroundImage = 'url(' + draft.textures[id].img + ')'; s.style.backgroundSize = 'cover'; s.style.imageRendering = 'pixelated';
      s.onclick = function () { if (!armedPiece) { $('hudMsg').textContent = 'Pick a piece first.'; return; } pieceMat[armedPiece] = key; renderBuild(); };
      mEl.appendChild(s);
    });
    $('epRotLbl').textContent = placeRotDeg + '°';
    $('epScaleLbl').textContent = placeScale.toFixed(1) + '×';
    $('epEraser').classList.toggle('on', eraserOn);
  }

  /* ---------- model importer (embed GLB → offline, travels with the world) ---------- */
  function bufToB64(buf) { var b = new Uint8Array(buf), CH = 0x8000, parts = []; for (var i = 0; i < b.length; i += CH) parts.push(String.fromCharCode.apply(null, b.subarray(i, i + CH))); return btoa(parts.join('')); }
  function addModelFromBuffer(fname, buf) {
    var models = (draft.models = draft.models || {});
    var m = (fname || '').toLowerCase().match(/\.(glb|gltf|obj)$/), fmt = (m && m[1] === 'obj') ? 'obj' : 'glb';
    var cleanName = (fname || 'model').replace(/\.(glb|gltf|obj)$/i, '');
    var base = cleanName.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') || 'model';
    var id = base, k = 2; while (models[id]) id = base + k++;
    models[id] = { name: cleanName, fmt: fmt, data: 'data:' + (fmt === 'obj' ? 'text/plain' : 'model/gltf-binary') + ';base64,' + bufToB64(buf) };
    $('hudMsg').textContent = 'Parsing ' + cleanName + '…';
    window.createPSXRoom.loadModels(THREE, models, function () {
      var nodes = window.createPSXRoom.sourceNodes(id);
      if (!nodes || (nodes.length === 1 && !window.createPSXRoom.hasModel(id + '::' + (nodes[0].node || '')))) { delete models[id]; $('hudMsg').textContent = 'Could not read that file (not a valid .glb/.gltf/.obj).'; renderBuild(); return; }
      setSub('build'); eraserOn = false; armedPiece = 'model:' + id + '::' + (nodes[0].node || ''); renderBuild();
      $('hudMsg').textContent = nodes.length > 1
        ? '✓ Imported "' + cleanName + '" — ' + nodes.length + ' pieces added to the palette.'
        : '✓ Imported "' + cleanName + '" — click the floor to place it (size/rotate on the right).';
    });
  }
  function importModelFile(f) { if (!f) return; var r = new FileReader(); r.onload = function () { try { addModelFromBuffer(f.name, r.result); } catch (e) { $('hudMsg').textContent = 'Import failed: ' + e.message; } }; r.readAsArrayBuffer(f); }
  function addTextureFromDataURL(fname, uri) {
    var textures = (draft.textures = draft.textures || {});
    var cleanName = (fname || 'texture').replace(/\.(png|jpg|jpeg|webp)$/i, '');
    var base = cleanName.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') || 'tex';
    var id = base, k = 2; while (textures[id]) id = base + k++;
    textures[id] = { name: cleanName, img: uri };
    window.createPSXRoom.loadTextures(THREE, textures, function () {
      if (!window.createPSXRoom.hasTexture(id)) { delete textures[id]; $('hudMsg').textContent = 'Could not read that image.'; renderBuild(); return; }
      renderBuild();
      $('hudMsg').textContent = armedPiece ? ('✓ "' + cleanName + '" added — click the matching swatch to paint ' + (PLABEL[armedPiece] || armedPiece) + ' with it.') : ('✓ Texture "' + cleanName + '" added. Pick a piece, then click its swatch.');
    });
  }
  function importTextureFile(f) { if (!f) return; var r = new FileReader(); r.onload = function () { addTextureFromDataURL(f.name, r.result); }; r.readAsDataURL(f); }

  /* ---------- edit mode ---------- */
  function showEditRoom() {
    clearAll(); if (player) player.root.visible = false;
    var rm = draft.rooms[editActive]; if (!rm) return;
    if ($('epWHLbl')) $('epWHLbl').textContent = activeWH().toFixed(1);
    buildRoom(rm.room);
    (rm.npcs || []).forEach(function (nd) { npcs.push(spawnNpc(nd)); });
  }
  function enterEdit() {
    draft = world ? JSON.parse(JSON.stringify(world)) : JSON.parse(JSON.stringify(SAMPLE));
    if (!draft.rooms) draft.rooms = {};
    editActive = (draft.start && draft.rooms[draft.start]) ? draft.start : Object.keys(draft.rooms)[0] || null;
    try { document.exitPointerLock(); } catch (x) {}   // mouselook is play-only; free the cursor for the editor
    mode = 'edit'; applyMode(); applyTimeOfDay(draft.sky || 'dusk'); showEditRoom(); renderPanel(); setSub(editSub || 'build');
  }
  function applyMode() {
    var editing = mode === 'edit';
    $('editPanel').classList.toggle('open', editing);
    $('btnMode').textContent = editing ? '▶ Play' : 'Edit';
    $('btnMode').classList.toggle('on', editing);
    $('hudLabel').textContent = editing ? 'EDITING' : 'ROOM';
    $('hudExit').style.display = 'none'; closeDlg();
    editGrid.visible = editing && editSub === 'build';
    playerBlob.visible = !editing;
    if (editing) editCam.target.set(0, 0.4, 0);
  }
  function toggleMode() { if (mode === 'play') enterEdit(); else { loadWorld(JSON.parse(JSON.stringify(draft))); } }

  function opt(val, label, sel) { return '<option value="' + val + '"' + (val === sel ? ' selected' : '') + '>' + label + '</option>'; }
  function renderPanel() {
    var names = Object.keys(draft.rooms);
    $('epStart').innerHTML = names.map(function (n) { return opt(n, draft.rooms[n].label || n, draft.start); }).join('');
    $('epPlayer').value = typeof draft.player === 'string' ? draft.player : (draft.player ? JSON.stringify(draft.player) : '');
    $('epSky').value = draft.sky || 'dusk'; $('epFlicker').checked = !!draft.flicker;
    $('epRoomSel').innerHTML = names.map(function (n) { return opt(n, draft.rooms[n].label || n, editActive); }).join('');
    $('hudRoom').textContent = editActive ? (draft.rooms[editActive].label || editActive) : '—';
    var rm = draft.rooms[editActive] || { npcs: [], exits: [] }; rm.npcs = rm.npcs || [];
    var list = $('epNpcList'); list.innerHTML = '';
    var ANIMS = ['idle', 'walk', 'run', 'sneak'], BEHS = ['idle', 'wander', 'patrol', 'facePlayer', 'roam', 'stalker'];
    rm.npcs.forEach(function (npc, i) {
      var card = document.createElement('div'); card.className = 'npc-card';
      card.innerHTML =
        '<div class="hd"><b>NPC ' + (i + 1) + '</b><button class="del" data-del="' + i + '">Delete</button></div>' +
        '<div class="ep-row"><label>Character</label><input data-f="code" data-i="' + i + '" value="' + (typeof npc.code === 'string' ? npc.code.replace(/"/g, '&quot;') : (npc.code ? JSON.stringify(npc.code).replace(/"/g, '&quot;') : '')) + '" placeholder="PSX1… / blank = default"></div>' +
        '<div class="ep-row"><label>At</label><span class="mini">[' + npc.at[0] + ', ' + npc.at[1] + ']</span><button data-face="' + i + '">Face ' + (npc.face || 0) + '°</button></div>' +
        '<div class="ep-row"><label>Anim</label><select data-f="anim" data-i="' + i + '">' + ANIMS.map(function (a) { return opt(a, a, npc.anim || 'idle'); }).join('') + '</select></div>' +
        '<div class="ep-row"><label>Behavior</label><select data-f="behavior" data-i="' + i + '">' + BEHS.map(function (a) { return opt(a, a, npc.behavior || 'idle'); }).join('') + '</select></div>' +
        '<div class="ep-row"><label>Dialogue</label><select class="dlgmode" data-dm="' + i + '">' + DLG_MODES.map(function (m) { return opt(m[0], m[1], dlgMode(npc.dialogue)); }).join('') + '</select></div>' +
        '<div class="dlged" data-dlged="' + i + '"></div>';
      list.appendChild(card);
    });
    rm.npcs.forEach(function (_, i) { renderDlgEditor(i); });
    var exEl = $('epExitList'); exEl.innerHTML = ''; rm.exits = rm.exits || [];
    var nEx = (roomObj && roomObj.exits ? roomObj.exits.length : 0);
    $('epExitEmpty').style.display = nEx ? 'none' : '';
    for (var i = 0; i < nEx; i++) {
      var ex = rm.exits[i] || {};
      var row = document.createElement('div'); row.className = 'npc-card';
      row.innerHTML = '<div class="ep-row"><label>Exit ' + i + ' →</label><select data-ex="' + i + '" data-exf="to"><option value="">(none)</option>' + names.map(function (n) { return opt(n, draft.rooms[n].label || n, ex.to); }).join('') + '</select></div>' +
        '<div class="ep-row"><label>Arrive</label><input data-ex="' + i + '" data-exf="arrive" type="number" min="0" style="max-width:52px" value="' + (ex.arrive || 0) + '"><label style="min-width:auto"><input type="checkbox" data-ex="' + i + '" data-exf="auto"' + (ex.auto ? ' checked' : '') + '> open (seamless)</label></div>';
      exEl.appendChild(row);
    }
    wirePanelInputs();
  }
  function wirePanelInputs() {
    $('epNpcList').querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { draft.rooms[editActive].npcs.splice(+b.dataset.del, 1); showEditRoom(); renderPanel(); }; });
    $('epNpcList').querySelectorAll('[data-face]').forEach(function (b) { b.onclick = function () { var npc = draft.rooms[editActive].npcs[+b.dataset.face]; npc.face = ((npc.face || 0) + 90) % 360; showEditRoom(); renderPanel(); }; });
    $('epNpcList').querySelectorAll('[data-f]').forEach(function (el) {
      el.onchange = function () {
        var npc = draft.rooms[editActive].npcs[+el.dataset.i], f = el.dataset.f;
        if (f === 'code') { npc.code = el.value; showEditRoom(); }
        else npc[f] = el.value;
        if (f === 'anim') showEditRoom();
      };
    });
    $('epExitList').querySelectorAll('[data-ex]').forEach(function (el) {
      el.onchange = function () { var rm = draft.rooms[editActive], i = +el.dataset.ex; rm.exits[i] = rm.exits[i] || {}; var f = el.dataset.exf; rm.exits[i][f] = f === 'arrive' ? (+el.value || 0) : f === 'auto' ? el.checked : el.value; };
    });
    $('epNpcList').querySelectorAll('[data-dm]').forEach(function (sel) {
      sel.onchange = function () { var i = +sel.dataset.dm, npc = draft.rooms[editActive].npcs[i]; npc.dialogue = toMode(npc.dialogue, sel.value); renderDlgEditor(i); };
    });
  }

  /* ---------- dialogue authoring (visual editor for the JSON dialogue engine) ---------- */
  var DLG_MODES = [['linear', 'Linear'], ['random', 'Random'], ['cycle', 'Cycle'], ['sequence', 'Sequence'], ['branching', 'Branching']];
  function dlgMode(d) { if (d == null || typeof d === 'string' || Array.isArray(d)) return 'linear'; if (d.random) return 'random'; if (d.cycle) return 'cycle'; if (d.sequence) return 'sequence'; if (d.nodes) return 'branching'; return 'linear'; }
  function normLineObj(l) { return (typeof l === 'string') ? { text: l, emote: 'neutral' } : { text: (l && l.text) || '', emote: (l && l.emote) || 'neutral' }; }
  function flattenLines(d) {
    if (d == null) return []; if (typeof d === 'string') return [normLineObj(d)]; if (Array.isArray(d)) return d.map(normLineObj);
    if (d.random || d.cycle || d.sequence) { var a = d.random || d.cycle || d.sequence, f = a[0]; return Array.isArray(f) ? f.map(normLineObj) : (f != null ? [normLineObj(f)] : []); }
    if (d.nodes) { var s = d.nodes[d.start || Object.keys(d.nodes)[0]], say = (s && (s.say || s.lines)) || []; return say.map(normLineObj); }
    return [];
  }
  function toMode(d, mode) {
    var lines = flattenLines(d); if (!lines.length) lines = [{ text: '', emote: 'neutral' }];
    if (mode === 'random') return { random: [lines] }; if (mode === 'cycle') return { cycle: [lines] }; if (mode === 'sequence') return { sequence: [lines] };
    if (mode === 'branching') return { start: 'root', nodes: { root: { say: lines } } };
    return lines;
  }
  function mkEl(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function emoteSel(cur, on) { var s = mkEl('select', 'dlg-sel'); EMOTE_NAMES.forEach(function (n) { var o = mkEl('option', null, n); o.value = n; if (n === (cur || 'neutral')) o.selected = true; s.appendChild(o); }); s.onchange = function () { on(s.value); }; return s; }
  function nodeTargetSel(g, cur, on) { var s = mkEl('select', 'dlg-sel'); var oe = mkEl('option', null, '(end)'); oe.value = ''; s.appendChild(oe); Object.keys(g.nodes).forEach(function (nid) { var o = mkEl('option', null, nid); o.value = nid; if (nid === cur) o.selected = true; s.appendChild(o); }); if (!cur) oe.selected = true; s.onchange = function () { on(s.value); }; return s; }
  function lineRowEl(arr, li, rr) {
    var row = mkEl('div', 'dlg-line');
    var inp = mkEl('input', 'dlg-txt'); inp.value = arr[li].text || ''; inp.placeholder = 'line text'; inp.oninput = function () { arr[li].text = inp.value; };
    row.appendChild(inp); row.appendChild(emoteSel(arr[li].emote, function (v) { arr[li].emote = v; }));
    var up = mkEl('button', 'mini-btn', '↑'); up.onclick = function () { if (li > 0) { var t = arr[li - 1]; arr[li - 1] = arr[li]; arr[li] = t; rr(); } };
    var dn = mkEl('button', 'mini-btn', '↓'); dn.onclick = function () { if (li < arr.length - 1) { var t = arr[li + 1]; arr[li + 1] = arr[li]; arr[li] = t; rr(); } };
    var del = mkEl('button', 'mini-btn del', '✕'); del.onclick = function () { arr.splice(li, 1); if (!arr.length) arr.push({ text: '', emote: 'neutral' }); rr(); };
    row.appendChild(up); row.appendChild(dn); row.appendChild(del); return row;
  }
  function linesBlockEl(arr, rr) {
    var wrap = mkEl('div', 'dlg-lines'); arr.forEach(function (_, li) { wrap.appendChild(lineRowEl(arr, li, rr)); });
    var add = mkEl('button', 'mini-btn add', '+ line'); add.onclick = function () { arr.push({ text: '', emote: 'neutral' }); rr(); }; wrap.appendChild(add); return wrap;
  }
  function renderDlgEditor(i) {
    var host = $('epNpcList').querySelector('[data-dlged="' + i + '"]'); if (!host) return;
    var npc = draft.rooms[editActive].npcs[i], rr = function () { renderDlgEditor(i); }, mode = dlgMode(npc.dialogue);
    host.innerHTML = '';
    if (mode === 'linear') {
      if (!Array.isArray(npc.dialogue)) npc.dialogue = toMode(npc.dialogue, 'linear'); npc.dialogue = npc.dialogue.map(normLineObj);
      host.appendChild(linesBlockEl(npc.dialogue, rr));
    } else if (mode === 'random' || mode === 'cycle' || mode === 'sequence') {
      var sets = npc.dialogue[mode], noun = mode === 'random' ? 'Option ' : mode === 'cycle' ? 'Turn ' : 'Step ';
      sets.forEach(function (set, si) {
        if (!Array.isArray(set)) { set = [normLineObj(set)]; sets[si] = set; } else sets[si] = set.map(normLineObj);
        var block = mkEl('div', 'dlg-variant'), hd = mkEl('div', 'dlg-vhd'); hd.appendChild(mkEl('span', 'dlg-vlbl', noun + (si + 1)));
        var dv = mkEl('button', 'mini-btn del', '✕'); dv.onclick = function () { sets.splice(si, 1); if (!sets.length) sets.push([{ text: '', emote: 'neutral' }]); rr(); };
        hd.appendChild(dv); block.appendChild(hd); block.appendChild(linesBlockEl(sets[si], rr)); host.appendChild(block);
      });
      var av = mkEl('button', 'mini-btn add', '+ ' + noun.trim().toLowerCase()); av.onclick = function () { sets.push([{ text: '', emote: 'neutral' }]); rr(); }; host.appendChild(av);
    } else if (mode === 'branching') {
      var g = npc.dialogue; g.nodes = g.nodes || {}; g.start = g.start || Object.keys(g.nodes)[0] || 'root'; if (!g.nodes[g.start]) g.nodes[g.start] = { say: [{ text: '', emote: 'neutral' }] };
      Object.keys(g.nodes).forEach(function (nid) {
        var node = g.nodes[nid]; node.say = (node.say || node.lines || []).map(normLineObj); if (node.lines) delete node.lines;
        var block = mkEl('div', 'dlg-node'), hd = mkEl('div', 'dlg-vhd'); hd.appendChild(mkEl('span', 'dlg-vlbl', nid + (nid === g.start ? ' · start' : '')));
        if (nid !== g.start) { var dn = mkEl('button', 'mini-btn del', '✕ node'); dn.onclick = function () { delete g.nodes[nid]; Object.keys(g.nodes).forEach(function (k) { var nn = g.nodes[k]; if (nn.goto === nid) delete nn.goto; if (nn.choices) nn.choices.forEach(function (c) { if (c.to === nid) c.to = ''; }); }); rr(); }; hd.appendChild(dn); }
        block.appendChild(hd); block.appendChild(linesBlockEl(node.say, rr));
        node.choices = node.choices || [];
        if (node.choices.length) {
          node.choices.forEach(function (c, ci) {
            var crow = mkEl('div', 'dlg-choice'); var ct = mkEl('input', 'dlg-txt'); ct.value = c.text || ''; ct.placeholder = 'choice text'; ct.oninput = function () { c.text = ct.value; };
            crow.appendChild(ct); crow.appendChild(mkEl('span', 'arrow', '→')); crow.appendChild(nodeTargetSel(g, c.to, function (v) { c.to = v; }));
            var del = mkEl('button', 'mini-btn del', '✕'); del.onclick = function () { node.choices.splice(ci, 1); rr(); }; crow.appendChild(del); block.appendChild(crow);
          });
          var ac = mkEl('button', 'mini-btn add', '+ choice'); ac.onclick = function () { node.choices.push({ text: '', to: '' }); rr(); }; block.appendChild(ac);
        } else {
          var row = mkEl('div', 'dlg-choice'); row.appendChild(mkEl('span', 'arrow', 'then →')); row.appendChild(nodeTargetSel(g, node.goto || '', function (v) { if (v) node.goto = v; else delete node.goto; }));
          var toC = mkEl('button', 'mini-btn add', '+ choices'); toC.onclick = function () { delete node.goto; node.choices.push({ text: '', to: '' }); rr(); }; row.appendChild(toC); block.appendChild(row);
        }
        host.appendChild(block);
      });
      var an = mkEl('button', 'mini-btn add', '+ node'); an.onclick = function () { var k = 2; while (g.nodes['n' + k]) k++; g.nodes['n' + k] = { say: [{ text: '', emote: 'neutral' }] }; rr(); }; host.appendChild(an);
    }
  }
  $('epTabBuild').onclick = function () { setSub('build'); };
  $('epTabCompose').onclick = function () { setSub('compose'); };
  $('epRotPiece').onclick = function () { placeRotDeg = (placeRotDeg + 90) % 360; renderBuild(); };
  $('epEraser').onclick = function () { eraserOn = !eraserOn; if (eraserOn) armedPiece = null; renderBuild(); $('hudMsg').textContent = eraserOn ? 'Click a piece to remove it.' : ''; };
  $('epScaleDn').onclick = function () { placeScale = Math.max(0.3, Math.round((placeScale - 0.2) * 10) / 10); renderBuild(); };
  $('epScaleUp').onclick = function () { placeScale = Math.min(4, Math.round((placeScale + 0.2) * 10) / 10); renderBuild(); };
  $('epImportBtn').onclick = function () { $('epImportFile').click(); };
  $('epImportFile').onchange = function () { importModelFile(this.files && this.files[0]); this.value = ''; };
  $('epTexBtn').onclick = function () { $('epTexFile').click(); };
  $('epTexFile').onchange = function () { importTextureFile(this.files && this.files[0]); this.value = ''; };
  $('epImportUrl').onclick = function () {
    var u = $('epImportUrlIn').value.trim(); if (!u) return; $('hudMsg').textContent = 'Fetching model…';
    fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(function (b) { addModelFromBuffer(u.split('/').pop().split('?')[0] || 'model.glb', b); $('epImportUrlIn').value = ''; })
      .catch(function (e) { $('hudMsg').textContent = 'Fetch failed (' + e.message + '). Download the .glb and use Import instead.'; });
  };
  $('epNewRoom').onclick = function () {
    var base = 'room', name = base, k = 2; while (draft.rooms[name]) name = base + k++;
    draft.rooms[name] = { label: name, room: { version: 2, grid: { size: 12, cell: 1 }, objects: [] }, npcs: [], exits: [] };
    editActive = name; showEditRoom(); renderPanel(); setSub('build'); $('hudMsg').textContent = 'New empty room — lay down floor tiles, then walls.';
  };
  function activeWH() { var r = draft.rooms[editActive]; return (r && r.room && +r.room.wallH) || 2.3; }
  function setWH(v) { var r = draft.rooms[editActive]; r.room = r.room || { version: 2, objects: [] }; r.room.wallH = Math.max(1.6, Math.min(4.5, Math.round(v * 10) / 10)); $('epWHLbl').textContent = r.room.wallH.toFixed(1); showEditRoom(); }
  $('epWHDn').onclick = function () { setWH(activeWH() - 0.2); };
  $('epWHUp').onclick = function () { setWH(activeWH() + 0.2); };
  $('epBlank').onclick = function () {
    var keepPlayer = (draft && draft.player) || { gender: 'male', outfit: 'tank', hairStyle: 'buzz' };
    var keepModels = (draft && draft.models) || {}, keepTex = (draft && draft.textures) || {};
    draft = { start: 'room', player: keepPlayer, models: keepModels, textures: keepTex, rooms: { room: { label: 'Room', room: { version: 2, grid: { size: 12, cell: 1 }, objects: [] }, npcs: [], exits: [] } } };
    editActive = 'room'; showEditRoom(); renderPanel(); setSub('build');
    $('hudMsg').textContent = 'Blank world. Lay a floor, or import models and place them. Your imported models are kept.';
  };
  $('epStart').onchange = function () { draft.start = this.value; };
  $('epSky').onchange = function () { draft.sky = this.value; applyTimeOfDay(this.value); };
  $('epFlicker').onchange = function () { draft.flicker = this.checked; flickerOn = this.checked; };
  $('epPlayer').onchange = function () { draft.player = this.value; };
  $('epRoomSel').onchange = function () { editActive = this.value; showEditRoom(); renderPanel(); };
  $('epPlaceNpc').onclick = function () { placeNpcArmed = !placeNpcArmed; this.classList.toggle('on', placeNpcArmed); $('hudMsg').textContent = placeNpcArmed ? 'Click the floor to drop an NPC' : ''; };
  $('epDelRoom').onclick = function () { var n = Object.keys(draft.rooms); if (n.length <= 1) { $('hudMsg').textContent = 'Keep at least one room.'; return; } delete draft.rooms[editActive]; if (draft.start === editActive) draft.start = Object.keys(draft.rooms)[0]; editActive = Object.keys(draft.rooms)[0]; showEditRoom(); renderPanel(); };
  $('epExport').onclick = function () { $('epOut').value = JSON.stringify(draft, null, 2); };
  $('epCopy').onclick = function () { if (!$('epOut').value) $('epOut').value = JSON.stringify(draft, null, 2); try { navigator.clipboard && navigator.clipboard.writeText($('epOut').value); } catch (e) {} $('hudMsg').textContent = 'World JSON copied.'; };
  $('epPlaytest').onclick = function () { loadWorld(JSON.parse(JSON.stringify(draft))); };
  $('epAddRoom').onclick = function () { $('roomName').value = ''; $('roomJson').value = ''; $('roomMsg').textContent = ''; $('roomModal').classList.add('open'); };
  $('roomCancel').onclick = function () { $('roomModal').classList.remove('open'); };
  $('roomAdd').onclick = function () {
    var name = $('roomName').value.trim(); if (!name) { $('roomMsg').textContent = 'Name it first.'; return; }
    if (draft.rooms[name]) { $('roomMsg').textContent = 'That name is taken.'; return; }
    var rjson; try { rjson = JSON.parse($('roomJson').value); } catch (e) { $('roomMsg').textContent = 'Room JSON error: ' + e.message; return; }
    draft.rooms[name] = { label: name, room: rjson, npcs: [], exits: [] };
    editActive = name; $('roomModal').classList.remove('open'); showEditRoom(); renderPanel();
  };

  $('btnMode').onclick = toggleMode;
  $('btnLoadWorld').onclick = function () { $('loader').classList.toggle('open'); if ($('worldBox').value.trim() === '') $('worldBox').value = JSON.stringify(SAMPLE, null, 2); };
  $('btnApplyWorld').onclick = function () { try { loadWorld(JSON.parse($('worldBox').value)); $('loader').classList.remove('open'); } catch (e) { $('loaderMsg').textContent = 'JSON error: ' + e.message; } };
  $('btnSample').onclick = function () { $('worldBox').value = JSON.stringify(SAMPLE, null, 2); $('loaderMsg').textContent = 'Sample pasted. Press Load.'; };
  $('loaderClose').onclick = function () { $('loader').classList.remove('open'); };

  /* ---------- resize + loop ---------- */
  function resize() { var w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; camera.aspect = w / h; camera.updateProjectionMatrix(); var s = lowres ? 0.55 : 1; renderer.setPixelRatio(lowres ? 1 : Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)), false); var sz = new THREE.Vector2(); renderer.getDrawingBufferSize(sz); rt.setSize(Math.max(1, sz.x), Math.max(1, sz.y)); grade.uniforms.uRes.value.set(sz.x, sz.y); }
  window.addEventListener('resize', resize);
  $('btnLowres').onclick = function () { lowres = !lowres; $('btnLowres').classList.toggle('on', lowres); resize(); };
  $('btnView').onclick = function () { fpv = !fpv; $('btnView').textContent = fpv ? '3rd person' : '1st person'; $('btnView').classList.toggle('on', fpv); if (player) player.root.visible = !fpv; setCeilings(fpv); };
  $('btnView').textContent = fpv ? '3rd person' : '1st person'; $('btnView').classList.toggle('on', fpv);   // sync the toggle to the default view
  $('btnFlash').onclick = function () { if (mode === 'play') toggleFlash(); };
  $('hudExit').onclick = function () { if (mode === 'play') interact(); };

  /* mobile joystick (shows on touch devices; also usable with a mouse) */
  var joyVec = { x: 0, y: 0 }, joyId = null, joyEl = $('joy'), joyKnob = $('joyKnob');
  if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) joyEl.classList.add('show');
  function joyMove(e) { var r = joyEl.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, dx = e.clientX - cx, dy = e.clientY - cy, R = 42, m = Math.hypot(dx, dy); if (m > R) { dx = dx / m * R; dy = dy / m * R; } joyVec.x = dx / R; joyVec.y = dy / R; joyKnob.style.left = (36 + dx) + 'px'; joyKnob.style.top = (36 + dy) + 'px'; }
  function joyEnd() { joyId = null; joyVec.x = 0; joyVec.y = 0; joyKnob.style.left = '36px'; joyKnob.style.top = '36px'; }
  joyEl.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); joyId = e.pointerId; try { joyEl.setPointerCapture(e.pointerId); } catch (x) {} joyMove(e); });
  joyEl.addEventListener('pointermove', function (e) { if (joyId === e.pointerId) { e.preventDefault(); e.stopPropagation(); joyMove(e); } });
  joyEl.addEventListener('pointerup', joyEnd); joyEl.addEventListener('pointercancel', joyEnd);

  var clock = new THREE.Clock();
  function setAnim(a) { if (a !== pAnim) { pAnim = a; try { player.play(a); } catch (e) {} } }
  function stepPlay(dt) {
    if (!player) return; var ctx = { px: pPos.x, pz: pPos.z, fx: Math.sin(camYaw), fz: Math.cos(camYaw) };
    npcs.forEach(function (n) {
      if (dlg.open && n === dlg.npc) { var pp = n.api.root.position; faceTo(n, Math.atan2(pPos.x - pp.x, pPos.z - pp.z), dt); npcAnim(n, 'idle'); }
      else (BEHAVIORS[n.data.behavior] || BEHAVIORS.idle)(n, dt, ctx);
      if (n.inst) updateActorRoom(n);
      n.api.update(dt);
      if (!n.blob) { n.blob = makeBlob(0.56); scene.add(n.blob); }
      n.blob.position.set(n.api.root.position.x, 0.03, n.api.root.position.z);
    });
    if (!dlg.open) {
      var fwd = (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0) - joyVec.y;
      var strafe = (keys['a'] || keys['arrowleft'] ? 1 : 0) - (keys['d'] || keys['arrowright'] ? 1 : 0) - joyVec.x;
      var mag = Math.min(1, Math.hypot(fwd, strafe));
      if (mag > 0.15) { var ang = Math.atan2(strafe, fwd) + camYaw, spd = (keys['shift'] ? 4.3 : 2.4) * mag * dt; var r = resolve(pPos.x + Math.sin(ang) * spd, pPos.z + Math.cos(ang) * spd, playerColliders(), PR); pPos.x = r[0]; pPos.z = r[1]; pYaw = ang; setAnim(mag > 0.75 && keys['shift'] ? 'run' : 'walk'); }
      else setAnim('idle');
    } else setAnim('idle');
    player.root.position.set(pPos.x, 0, pPos.z);
    playerBlob.position.set(pPos.x, 0.03, pPos.z); playerBlob.visible = !fpv;
    var cy = player.root.rotation.y, d = ((pYaw - cy + Math.PI) % (Math.PI * 2)) - Math.PI; player.root.rotation.y = cy + d * Math.min(1, dt * 12);
    player.update(dt);
    if (fpv) { var cpF = Math.cos(fpPitch); camera.position.set(pPos.x, EYE, pPos.z); camera.lookAt(pPos.x + Math.sin(camYaw) * cpF, EYE + Math.sin(fpPitch), pPos.z + Math.cos(camYaw) * cpF); }
    else { var sp = Math.sin(camPitch); camera.position.set(pPos.x + camDist * sp * Math.sin(camYaw + Math.PI), TP_LOOK + camDist * Math.cos(camPitch), pPos.z + camDist * sp * Math.cos(camYaw + Math.PI)); camera.lookAt(pPos.x, TP_LOOK, pPos.z); }
    updateInteract(dt);
    if (flickerOn) updateFlicker(performance.now() * 0.001);
    if (flashOn) {
      if (fpv) { var cpF = Math.cos(fpPitch); flash.position.set(pPos.x, EYE, pPos.z); flash.target.position.set(pPos.x + Math.sin(camYaw) * cpF * 6, EYE + Math.sin(fpPitch) * 6, pPos.z + Math.cos(camYaw) * cpF * 6); }
      else { flash.position.set(pPos.x, 1.25, pPos.z); flash.target.position.set(pPos.x + Math.sin(pYaw) * 6, 0.25, pPos.z + Math.cos(pYaw) * 6); }
    }
    if (dlg.open && dlg.npc) renderPortrait(dlg.npc);
  }
  function stepEdit(dt) { npcs.forEach(function (n) { n.api.update(dt); }); var t = editCam.target, sp = Math.sin(editCam.pitch); camera.position.set(t.x + editCam.dist * sp * Math.sin(editCam.yaw), t.y + editCam.dist * Math.cos(editCam.pitch), t.z + editCam.dist * sp * Math.cos(editCam.yaw)); camera.lookAt(t); }
  (function loop() { requestAnimationFrame(loop); var dt = Math.min(clock.getDelta(), 0.05); if (mode === 'play') stepPlay(dt); else stepEdit(dt);
    sky.position.copy(camera.position);
    renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null); grade.uniforms.uTime.value = performance.now() * 0.001; renderer.render(postScene, postCam); })();

  /* ---------- sample world (rotation in degrees, format v2) ---------- */
  function genRoom(w, d, cfg) {
    cfg = cfg || {}; var gi = cfg.gi || 1, gj = cfg.gj || 1, HALF = 6, objs = [], doors = cfg.doors || [];
    function cell(i, j) { return [i + 0.5 - HALF, 0, j + 0.5 - HALF]; }
    function vpos(vi, zj) { return [vi - HALF, 0, zj + 0.5 - HALF]; }
    function hpos(xi, hj) { return [xi + 0.5 - HALF, 0, hj - HALF]; }
    function wall(pos, r) { return { asset: 'wall', position: pos, rotationY: r, material: cfg.wallMat || 'plaster' }; }
    for (var i = 0; i < w; i++) for (var j = 0; j < d; j++) objs.push({ asset: 'floor', position: cell(gi + i, gj + j), rotationY: 0, material: cfg.floorMat || 'tile' });
    var occ = {};
    doors.forEach(function (dr) { occ[dr.side === 'N' ? 'h|' + (gi + dr.at) + '|' + (gj + d) : dr.side === 'S' ? 'h|' + (gi + dr.at) + '|' + gj : dr.side === 'E' ? 'v|' + (gi + w) + '|' + (gj + dr.at) : 'v|' + gi + '|' + (gj + dr.at)] = 1; });
    for (var c = 0; c < w; c++) { if (!occ['h|' + (gi + c) + '|' + (gj + d)]) objs.push(wall(hpos(gi + c, gj + d), 0)); if (!occ['h|' + (gi + c) + '|' + gj]) objs.push(wall(hpos(gi + c, gj), 0)); }
    for (var rI = 0; rI < d; rI++) { if (!occ['v|' + (gi + w) + '|' + (gj + rI)]) objs.push(wall(vpos(gi + w, gj + rI), 90)); if (!occ['v|' + gi + '|' + (gj + rI)]) objs.push(wall(vpos(gi, gj + rI), 90)); }
    doors.forEach(function (dr) {
      var piece = dr.type || 'door', pos, rot, inside, sRot, eRot;
      if (dr.side === 'N') { pos = hpos(gi + dr.at, gj + d); rot = 0; inside = cell(gi + dr.at, gj + d - 1); sRot = 180; eRot = 0; }
      else if (dr.side === 'S') { pos = hpos(gi + dr.at, gj); rot = 0; inside = cell(gi + dr.at, gj); sRot = 0; eRot = 180; }
      else if (dr.side === 'E') { pos = vpos(gi + w, gj + dr.at); rot = 90; inside = cell(gi + w - 1, gj + dr.at); sRot = 270; eRot = 90; }
      else { pos = vpos(gi, gj + dr.at); rot = 90; inside = cell(gi, gj + dr.at); sRot = 90; eRot = 270; }
      objs.push({ asset: piece, position: pos, rotationY: rot, material: dr.mat || 'wood' });
      objs.push({ asset: 'spawn', position: inside, rotationY: sRot, material: 'green' });
      objs.push({ asset: 'exit', position: inside, rotationY: eRot, material: 'fabricred' });
    });
    (cfg.furniture || []).forEach(function (f) { objs.push({ asset: f[0], position: cell(gi + f[1], gj + f[2]), rotationY: f[3] || 0, material: f[4] || null }); });
    var out = { version: 2, grid: { size: 12, cell: 1 }, objects: objs.map(function (o) { if (!o.material) delete o.material; return o; }) };
    if (cfg.wallH) out.wallH = cfg.wallH;
    return out;
  }
  function cc(gi, gj, i, j) { return [gi + i + 0.5 - 6, gj + j + 0.5 - 6]; }

  // "Vacancy" — an abandoned tenement floor, dusk. A central corridor links the lobby, a bedroom,
  // a living room and a cold storage room, all dressed with the PSX horror pack (loaded by path).
  // Furniture is placed in tile coordinates (i across width, j across depth); models keep real metres.
  var SAMPLE = (function () {
    var USED = {};
    // a pack model placed in a room: i/j are tile coords (fractional ok), o.y lifts it off the floor,
    // o.light attaches a point light (so a lamp model actually illuminates), o.solid:false = walk-through
    function mo(id, i, j, rot, o) { o = o || {}; USED[id] = 1; var m = { asset: 'model', src: id, node: '', position: [i - 4.5, o.y || 0, j - 4.5], rotationY: rot || 0, scale: o.scale || 1, collision: { enabled: o.solid !== false } }; if (o.light) m.light = o.light; return m; }
    // gentle decay (<2) spreads a ceiling lamp across the whole room; the pack's textures are dark, so lamps run bright
    var CEIL = { color: 0xffd9a8, intensity: 2.2, dist: 11, decay: 1.25, y: 2.3 };   // warm pool under a ceiling lamp
    var DESK = { color: 0xffcf8a, intensity: 1.1, dist: 4.5, decay: 1.4, y: 0.55 };  // a small table/bedside lamp
    // Pack textures re-skin the built-in floor/wall/door geometry (the pack has no architecture models).
    // Walls are 1.04 wide x 2.7 tall, so wall maps tile ~2.6x vertically to stay square; floors/doors = one copy.
    var T = 'assets/textures/psx-horror/';
    var TEX = {
      wall_a: { path: T + 'wall_6.png', repeat: [1, 2.6] }, wall_b: { path: T + 'concrete_2.png', repeat: [1, 2.6] },
      floor_tile: { path: T + 'tiles_floor_1.png', repeat: [1, 1] }, floor_concrete: { path: T + 'concrete_1.png', repeat: [1, 1] },
      floor_wood: { path: T + 'wood_3.png', repeat: [1, 1] }, floor_wood2: { path: T + 'wood_4.png', repeat: [1, 1] },
      floor_metal: { path: T + 'floor_3_metal.png', repeat: [1, 1] }, door_w: { path: T + 'wood_5.png', repeat: [1, 1] }
    };
    var DOORW = 'tex:door_w';
    var rooms = {};

    var lob = genRoom(6, 5, { floorMat: 'tex:floor_tile', wallMat: 'tex:wall_a', wallH: 2.7, doors: [{ side: 'E', at: 2, type: 'door', mat: DOORW }] });
    lob.objects.push(
      mo('furniture/dinner_table_1', 1.4, 3.7, 0), mo('furniture/chair_mp_1', 1.4, 4.3, 180),
      mo('large-props/vending_machine_1', 0.7, 2.3, 90), mo('furniture/sofa_1', 3.4, 0.8, 0),
      mo('furniture/armchair_1', 4.7, 1.5, 215), mo('furniture/coffee_table_1', 3.9, 1.6, 0),
      mo('small-props/potted_cactus_mp_1', 5.3, 4.3, 0, { solid: false }),
      mo('lighting/ceiling_lamp_1_on', 3, 2.5, 0, { y: 2.52, solid: false, light: CEIL }),
      mo('decals/cobweb_1', 0.6, 4.4, 0, { y: 1.9, solid: false }));
    rooms.lobby = { label: 'Lobby', room: lob, exits: [{ to: 'corridor', arrive: 0 }],
      npcs: [{ code: { gender: 'female', outfit: 'dress', hairStyle: 'long' }, at: cc(1, 1, 2.2, 3.4), face: 90, behavior: 'facePlayer', name: 'Survivor',
        dialogue: { random: [
          [{ text: 'You\'re real. Thank god.', emote: 'surprised' }, { text: 'The power\'s been out for days.', emote: 'worried' }],
          [{ text: 'Check the apartments down the hall. Take anything useful.', emote: 'neutral' }],
          [{ text: 'Don\'t linger in the storage room. It\'s cold in there. Wrong-cold.', emote: 'scared' }] ] } }] };

    // corridor hub: door order W,N,S,E fixes spawn indices 0..3 that the other rooms arrive at
    var cor = genRoom(7, 3, { floorMat: 'tex:floor_concrete', wallMat: 'tex:wall_b', wallH: 2.7, doors: [
      { side: 'W', at: 1, type: 'door', mat: DOORW }, { side: 'N', at: 2, type: 'door', mat: DOORW }, { side: 'S', at: 4, type: 'door', mat: DOORW }, { side: 'E', at: 1, type: 'door', mat: DOORW }] });
    cor.objects.push(
      mo('large-props/metal_barrel_mp_1', 5.7, 0.6, 0), mo('large-props/cardboard_box_1', 6.0, 2.3, 20),
      mo('large-props/pipe_1', 0.6, 2.6, 0, { solid: false }),
      mo('small-props/painting_1', 3.5, 2.9, 180, { y: 1.3, solid: false }),
      mo('decals/cobweb_2', 6.4, 2.5, 0, { y: 1.95, solid: false }),
      mo('lighting/ceiling_lamp_2_on', 3.5, 1.5, 0, { y: 2.52, solid: false, light: CEIL }));
    rooms.corridor = { label: 'Corridor', room: cor,
      exits: [{ to: 'lobby', arrive: 0 }, { to: 'bedroom', arrive: 0 }, { to: 'living', arrive: 0 }, { to: 'storage', arrive: 0 }] };

    var bed = genRoom(6, 6, { floorMat: 'tex:floor_wood', wallMat: 'tex:wall_a', wallH: 2.7, doors: [{ side: 'S', at: 2, type: 'door', mat: DOORW }] });
    bed.objects.push(
      mo('furniture/bed_1', 1.9, 4.1, 90), mo('furniture/bedside_table_1', 0.7, 5.0, 0),
      mo('furniture/wardrobe_mp_1', 4.9, 5.2, 180), mo('furniture/old_mattress_mp_1', 4.4, 1.3, 70, { solid: false }),
      mo('furniture/shelf_mp_2', 5.4, 2.6, 180), mo('lighting/lamp_3_on', 0.7, 5.0, 0, { y: 0.52, solid: false, light: DESK }),
      mo('small-props/clock_1', 3.0, 5.6, 180, { y: 1.7, solid: false }),
      mo('small-props/photo_frame_mp_1', 5.4, 2.6, 180, { y: 1.05, solid: false }),
      mo('decals/cobweb_4', 5.4, 5.4, 0, { y: 1.9, solid: false }),
      mo('lighting/ceiling_lamp_1_on', 3, 3, 0, { y: 2.52, solid: false, light: CEIL }));
    rooms.bedroom = { label: 'Bedroom', room: bed, exits: [{ to: 'corridor', arrive: 1 }] };

    var liv = genRoom(7, 6, { floorMat: 'tex:floor_wood2', wallMat: 'tex:wall_a', wallH: 2.7, doors: [{ side: 'N', at: 3, type: 'door', mat: DOORW }] });
    liv.objects.push(
      mo('large-props/carpet_mp_1', 3.3, 2.8, 0, { solid: false }), mo('furniture/sofa_3', 3.3, 1.0, 0),
      mo('furniture/armchair_1', 1.1, 2.6, 70), mo('furniture/coffee_table_1', 3.3, 2.6, 0),
      mo('furniture/tv_table_1', 3.3, 5.1, 180), mo('electronics/tv_mp_1', 3.3, 5.0, 180, { y: 0.52, solid: false }),
      mo('furniture/shelf_mp_2', 6.2, 4.6, 180), mo('small-props/book_mp_1', 3.1, 2.6, 0, { y: 0.42, solid: false }),
      mo('small-props/potted_cactus_mp_1', 6.3, 1.0, 0, { solid: false }),
      mo('electronics/ceiling_fan_mp_1', 1.6, 3, 0, { y: 2.3, solid: false }),
      mo('lighting/ceiling_lamp_1_on', 3.3, 3.2, 0, { y: 2.52, solid: false, light: CEIL }),
      mo('lighting/lamp_5_on', 6.2, 4.6, 180, { y: 0.95, solid: false, light: DESK }),
      mo('decals/cobweb_5', 0.6, 5.4, 0, { y: 1.9, solid: false }));
    rooms.living = { label: 'Living Room', room: liv, exits: [{ to: 'corridor', arrive: 2 }] };

    var sto = genRoom(6, 5, { floorMat: 'tex:floor_metal', wallMat: 'tex:wall_b', wallH: 2.7, doors: [{ side: 'W', at: 2, type: 'door', mat: DOORW }] });
    sto.objects.push(
      mo('large-props/wooden_crate_1', 4.6, 4.2, 0), mo('large-props/wooden_crate_3', 5.2, 4.2, 20),
      mo('large-props/supply_crate_1', 4.4, 0.8, 15), mo('large-props/metal_barrel_mp_1', 1.5, 4.3, 0),
      mo('large-props/metal_barrel_mp_1', 2.1, 4.2, 0), mo('large-props/cardboard_box_1', 5.4, 2.4, 0),
      mo('furniture/shelf_mp_2', 5.5, 1.3, 180), mo('small-props/jerrycan_1', 1.3, 0.8, 30),
      mo('small-props/car_battery_1', 2.0, 0.9, 0, { solid: false }),
      mo('decals/cobweb_1', 5.4, 4.4, 0, { y: 1.9, solid: false }),
      mo('lighting/ceiling_lamp_2_on', 3, 2.5, 0, { y: 2.52, solid: false, light: { color: 0xbfd0e0, intensity: 1.7, dist: 10, decay: 1.25, y: 2.3 } }));
    rooms.storage = { label: 'Storage', room: sto, exits: [{ to: 'corridor', arrive: 3 }] };

    var models = {};
    Object.keys(USED).sort().forEach(function (id) { models[id] = { name: id.split('/').pop(), path: 'assets/models/' + id + '.glb' }; });
    return { start: 'lobby', sky: 'dusk', flicker: true, player: { gender: 'male', outfit: 'flannel', hairStyle: 'buzz' }, textures: TEX, models: models, rooms: rooms };
  })();

  resize(); loadWorld(SAMPLE);

  /* ---------- test hook ---------- */
  window.__game = {
    mode: function () { return mode; }, room: function () { return anchor; }, pos: function () { return [pPos.x, pPos.z]; },
    loadedCount: function () { return loaded.length; }, loadedNames: function () { return loaded.map(function (l) { return l.name; }); },
    connCount: function () { return conns.length; }, teleportCount: function () { return teleportExits.length; },
    npcCount: function () { return npcs.length; }, colliderCount: function () { return pColliders.length; },
    setPlayer: function (x, z, yawDeg) { pPos.set(x, 0, z); pYaw = (yawDeg || 0) * Math.PI / 180; transCool = 0; }, tick: function (dt) { updateInteract(dt || 0.1); return anchor; },
    enterEdit: enterEdit, exportWorld: function () { return JSON.stringify(draft); }, activeRoom: function () { return editActive; },
    markersVis: function () { return (loaded[0] && loaded[0].ro.markers) ? loaded[0].ro.markers.visible : (roomObj ? roomObj.markers.visible : null); },
    jitter: function () { var u = window.createPSXCharacter.uniforms; return u && u.jitter ? u.jitter.value : 'n/a'; },
    actorInfo: function () { return actors.map(function (a) { return { name: a.data.name, room: a.room, loaded: !!a.api }; }); },
    moveActorScene: function (nm, x, z) { var a = actors.filter(function (q) { return a2(q) === nm; })[0]; function a2(q) { return q.data.name; } if (a && a.api) { a.api.root.position.set(x, 0, z); updateActorRoom(a); return a.room; } return null; },
    tryStep: function (dx, dz) { var r = resolve(pPos.x + dx, pPos.z + dz, playerColliders(), PR); pPos.x = r[0]; pPos.z = r[1]; return [pPos.x, pPos.z]; },
    sky: function (n) { applyTimeOfDay(n); }, flash: function () { toggleFlash(); return flashOn; },
    target: function () { return nearExit ? ('exit:' + nearExit.to) : nearNpc ? ('npc:' + nearNpc.data.name) : null; },
    talk: function (i) { if (npcs[i]) startDialogue(npcs[i]); return dlg.open; },
    talkObj: function (data) { startDialogue({ data: data, api: npcs[0] ? npcs[0].api : null, state: {} }); return dlg.open; },
    advance: function () { advanceDialogue(); return dlg.open ? dlg.idx : -1; },
    dlgLine: function () { return dlg.open ? lineText(dlg.seq[dlg.idx]) : null; },
    dlgChoices: function () { return dlg.open && dlg.node && dlg.node.choices && dlg.idx >= dlg.seq.length - 1 ? dlg.node.choices.map(function (c) { return c.text; }) : null; },
    dlgChoose: function (i) { choose(i); return dlg.open ? lineText(dlg.seq[dlg.idx]) : null; },
    dlgCompile: function (data, state) { var fake = { data: { dialogue: data }, state: state || {} }; var g = compileDialogue(data, fake); var nd = normNode(g.nodes[g.start]); return { line: lineText(nd.say[0] || ''), hasChoices: !!(nd.choices && nd.choices.length), state: fake.state }; },
    npcSmile: function (i) { return npcs[i] && npcs[i].api.settings ? npcs[i].api.settings.smile : null; },
    npcPos: function (i) { var n = npcs[i]; return n ? [n.api.root.position.x, n.api.root.position.z] : null; },
    stepNpc: function (i, dt) { var n = npcs[i]; if (n) (BEHAVIORS[n.data.behavior] || BEHAVIORS.idle)(n, dt || 0.1, { px: pPos.x, pz: pPos.z, fx: Math.sin(camYaw), fz: Math.cos(camYaw) }); return this.npcPos(i); },
    look: function (deg) { camYaw = (deg || 0) * Math.PI / 180; return camYaw; },
    npcName: function (i) { return npcs[i] && npcs[i].data ? npcs[i].data.name : null; },
    lightCount: function () { return flickerLights.length; },
    importTex: function (name, uri, cb) { var t = draft.textures = draft.textures || {}; var id = (name || 't').toLowerCase().replace(/[^a-z0-9]+/g, '-'); t[id] = { name: name || id, img: uri }; window.createPSXRoom.loadTextures(THREE, t, function () { renderBuild(); if (cb) cb(window.createPSXRoom.hasTexture(id)); }); return id; },
    build: {
      sub: function () { return editSub; }, setSub: setSub,
      pieces: function () { return PIECES.slice(); }, materials: function () { return MATS.slice(); },
      arm: function (name) { setSub('build'); eraserOn = false; armedPiece = name; renderBuild(); },
      rot: function (d) { placeRotDeg = (((d % 360) + 360) % 360); renderBuild(); },
      mat: function (m) { if (armedPiece) { pieceMat[armedPiece] = m; renderBuild(); } },
      place: function (x, z) { placePiece({ x: x, z: z }); return activeObjs().length; },
      objCount: function () { return activeObjs().length; },
      lastObj: function () { var o = activeObjs(); return o[o.length - 1]; },
      eraseNear: function (x, z) { var objs = activeObjs(), bi = -1, bd = 1e9; for (var i = 0; i < objs.length; i++) { var p = objs[i].position, d = Math.hypot(p[0] - x, p[2] - z); if (d < bd) { bd = d; bi = i; } } if (bi >= 0 && bd < 0.9) { objs.splice(bi, 1); showEditRoom(); renderPanel(); return true; } return false; },
      gridVisible: function () { return editGrid.visible; },
      importUri: function (name, uri, fmt, cb) { var m = draft.models = draft.models || {}; var id = (name || 'm').toLowerCase().replace(/[^a-z0-9]+/g, '-'); m[id] = { name: name || id, fmt: fmt || 'glb', data: uri }; window.createPSXRoom.loadModels(THREE, m, function () { var nd = window.createPSXRoom.sourceNodes(id); armedPiece = 'model:' + id + '::' + (nd && nd[0] ? (nd[0].node || '') : ''); renderBuild(); if (cb) cb({ nodes: nd }); }); return id; },
      nodes: function (src) { return window.createPSXRoom.sourceNodes(src); },
      models: function () { return draft && draft.models ? Object.keys(draft.models) : []; },
      blank: function () { $('epBlank').onclick(); },
      scale: function (s) { placeScale = s; renderBuild(); }
    }
  };
})();
