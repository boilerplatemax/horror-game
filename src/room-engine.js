/* PSX Room Engine — build a room (from the Room Builder's JSON) for use in a game.
   const room = createPSXRoom(THREE, roomJSON);
   scene.add(room.root);
   room.colliders -> [{cx,cz,hx,hz,ymin,ymax}]  world-space axis-aligned boxes (x/z) for collision
   room.spawns    -> [{position:[x,y,z], rotationY}]  spawn markers, in placement order
   room.exits     -> [{position:[x,y,z], rotationY}]  exit markers, in placement order
   Same piece set and materials as the Room Builder; paste once per game. */
window.createPSXRoom = (function () {
  'use strict';
  var WALL_H = 2.3, WALL_T = 0.12;   // taller walls so the far wall fills the frame (less empty sky in 3rd person)
  var MAT = null, _glass = null;

  function buildMaterials(THREE) {
    if (MAT) return;
    function pixTex(draw){ var c=document.createElement('canvas'); c.width=c.height=16; draw(c.getContext('2d'));
      var t=new THREE.CanvasTexture(c); t.magFilter=t.minFilter=THREE.NearestFilter; t.wrapS=t.wrapT=THREE.RepeatWrapping; return t; }
    var texWood=pixTex(function(x){x.fillStyle='#8a5a32';x.fillRect(0,0,16,16);x.fillStyle='#784c28';for(var i=0;i<16;i+=4)x.fillRect(0,i,16,1);x.fillStyle='#95643a';x.fillRect(0,2,16,1);x.fillRect(0,10,16,1);});
    var texTile=pixTex(function(x){x.fillStyle='#6f7480';x.fillRect(0,0,16,16);x.fillStyle='#5c616c';x.fillRect(0,0,8,8);x.fillRect(8,8,8,8);x.fillStyle='#474b55';x.fillRect(0,7,16,1);x.fillRect(7,0,1,16);});
    var texFab=pixTex(function(x){x.fillStyle='#3f5e86';x.fillRect(0,0,16,16);x.fillStyle='#365075';for(var i=0;i<16;i+=2)for(var j=0;j<16;j+=2)x.fillRect(i,j,1,1);});
    function m(color,tex){ var mm=new THREE.MeshStandardMaterial({color:color,flatShading:true,metalness:0,roughness:1}); if(tex) mm.map=tex; return mm; }
    MAT={ wood:m(0xffffff,texWood), darkwood:m(0x6b4a2b), plaster:m(0xd9d2c2), brick:m(0xa8584a), ceil:m(0xc7bca6),
      stone:m(0x8c8f99), tile:m(0xffffff,texTile), fabricblue:m(0xffffff,texFab), fabricred:m(0xb4463c),
      green:m(0x5f8b57), metal:m(0x707682), black:m(0x1a1b22),
      glass:new THREE.MeshStandardMaterial({color:0xdaeff8,transparent:true,opacity:0.16,roughness:0.08,metalness:0,flatShading:true,depthWrite:false}) };
  }

  function box(sx,sy,sz,ox,oy,oz){ return {size:[sx,sy,sz],offset:[ox,oy,oz]}; }

  /* ---- imported model sources (GLB/OBJ embedded as data; ONE source → one or MANY placeable nodes,
         so a downloaded pack of many models becomes a whole library of pieces). Parsed once; cloned per placement. ---- */
  var MODELS = {}, SRCNODES = {};   // MODELS keyed by "sourceId::node" ('' node = the whole file)
  function b64ToBuf(b64){ var bin=atob(b64), len=bin.length, bytes=new Uint8Array(len); for(var i=0;i<len;i++) bytes[i]=bin.charCodeAt(i); return bytes.buffer; }
  function hasMesh(o){ var f=false; o.traverse(function(n){ if(n.isMesh) f=true; }); return f; }
  // keepScale: trust the model's own units (used for path-loaded packs already authored in metres).
  // Otherwise fit the footprint to ~0.85 of a tile, since a drag-dropped model's scale is unknown.
  function processModel(THREE, src, keepScale){
    src.traverse(function(o){ if(o.isMesh){ o.castShadow=false; o.receiveShadow=false;
      var ms = Array.isArray(o.material)?o.material:[o.material];
      ms.forEach(function(m){ if(!m) return; m.flatShading=true;
        // Many pack GLBs ship metallic PBR materials; with no environment map those render pure black.
        // Force the matte, non-metal look the rest of the engine uses (and the PSX style wants).
        if('metalness' in m) m.metalness=0; if('roughness' in m) m.roughness=1;
        // This engine renders with a linear output (no renderer.outputEncoding), like its own CanvasTextures.
        // GLTFLoader tags base-colour maps sRGB, which would render dark here — force Linear to match.
        if(m.map){ m.map.magFilter=THREE.NearestFilter; m.map.minFilter=THREE.NearestFilter; m.map.generateMipmaps=false; if('encoding' in m.map) m.map.encoding=THREE.LinearEncoding; m.map.needsUpdate=true; }
        m.needsUpdate=true; }); } });
    src.updateMatrixWorld(true);
    var bb=new THREE.Box3().setFromObject(src), size=new THREE.Vector3(), ctr=new THREE.Vector3(); bb.getSize(size); bb.getCenter(ctr);
    var maxh=Math.max(size.x,size.z)||1, s= keepScale ? 1 : 0.85/maxh;  // fit footprint to ~0.85 of a tile (user re-scales), or keep real metres
    src.position.set(-ctr.x, -bb.min.y, -ctr.z);                       // center x/z, drop base to y=0
    var wrap=new THREE.Group(); wrap.add(src); wrap.scale.setScalar(s);
    return { proto:wrap, size:{ x:size.x*s, y:size.y*s, z:size.z*s } };
  }
  function stub(){ return { proto:null, size:{x:0.4,y:0.4,z:0.4} }; }
  function registerSource(THREE, id, rootObj, keepScale){
    var kids = rootObj.children.filter(hasMesh), nodes = [], used = {};
    if(kids.length>1){                                                 // a pack: one placeable piece per top-level object
      kids.forEach(function(c,i){ var nm=(c.name||('part'+(i+1))).replace(/[^\w\-]/g,'_')||('part'+(i+1)); if(used[nm]) nm=nm+'_'+i; used[nm]=1;
        var pm=processModel(THREE, c.clone(true), keepScale); MODELS[id+'::'+nm]=pm; nodes.push({ node:nm, size:pm.size }); });
    }
    var whole=processModel(THREE, rootObj.clone(true), keepScale); MODELS[id+'::']=whole;   // whole file as one piece too
    if(kids.length<=1) nodes=[{ node:'', size:whole.size }];
    SRCNODES[id]=nodes; return nodes;
  }
  // asset builders; WH = this room's wall height (defaults to the module value). Jamb opening width is fixed so characters always fit.
  function defs(THREE, WH){
    WH = WH || WH;
    var JAMBS=[ box(0.16,WH,WALL_T,-0.42,WH/2,0), box(0.16,WH,WALL_T,0.42,WH/2,0) ];
    var FULLWALL=[ box(1,WH,WALL_T,0,WH/2,0) ];
    var OPEN_H = Math.min(WH - 0.15, 2.05);   // door/arch opening height — capped so tall rooms don't get giant doorways
    function B(w,h,d){ return new THREE.BoxGeometry(w,h,d); }
    function add(g,geo,key,paint,override){ var mm=new THREE.Mesh(geo, override||MAT[key]||MAT.plaster); mm.userData.paint=paint!==false&&!override; g.add(mm); return mm; }
    // jambs up to the opening height, then a header panel fills the wall from the opening up to the ceiling
    function jl(g){ add(g,B(0.16,OPEN_H,WALL_T),'plaster').position.set(-0.42,OPEN_H/2,0); add(g,B(0.16,OPEN_H,WALL_T),'plaster').position.set(0.42,OPEN_H/2,0); add(g,B(1.04,Math.max(0.12,WH-OPEN_H),WALL_T),'plaster').position.set(0,(OPEN_H+WH)/2,0); }
    function marker(g,color){
      var ring=new THREE.Mesh(new THREE.CylinderGeometry(0.36,0.36,0.03,20),new THREE.MeshStandardMaterial({color:color,emissive:color,emissiveIntensity:0.35,transparent:true,opacity:0.6,flatShading:true})); ring.userData.paint=false; ring.position.y=0.02; g.add(ring);
      var ar=new THREE.Mesh(new THREE.ConeGeometry(0.12,0.26,4),new THREE.MeshStandardMaterial({color:color,emissive:color,emissiveIntensity:0.4,flatShading:true})); ar.userData.paint=false; ar.rotation.x=Math.PI/2; ar.position.set(0,0.14,0.22); g.add(ar);
    }
    // Floors, walls and doors now come entirely from the modular asset pack (placed as models).
    // Only the spawn/exit markers stay built-in, since they are editor/engine primitives.
    return {
      spawn:{occupy:'marker',marker:'spawn',colliders:[],build:function(g){ marker(g,0x5fd38b); }},
      exit:{occupy:'marker',marker:'exit',colliders:[],build:function(g){ marker(g,0xe0675c); }}
    };
  }

  var DEFMAT={ spawn:'green', exit:'fabricred' };
  var USERMAT = {};   // imported-texture materials, keyed 'tex:<id>'
  function applyMat(group,key){ var mm=(key && key.indexOf('tex:')===0 ? USERMAT[key] : MAT[key]) || MAT.plaster; group.traverse(function(o){ if(o.isMesh&&o.userData.paint) o.material=mm; }); }

  // transform a local collider box by an object's position + Y rotation (0 or 90°) -> world AABB
  function worldAABB(b, pos, rot){
    var c=Math.cos(rot), s=Math.sin(rot);
    var ox=b.offset[0]*c + b.offset[2]*s, oz=-b.offset[0]*s + b.offset[2]*c;
    var hx=Math.abs(b.size[0]/2*c)+Math.abs(b.size[2]/2*s), hz=Math.abs(b.size[0]/2*s)+Math.abs(b.size[2]/2*c);
    var cy=pos[1]+b.offset[1];
    return { cx:pos[0]+ox, cz:pos[2]+oz, hx:hx, hz:hz, ymin:cy-b.size[1]/2, ymax:cy+b.size[1]/2 };
  }

  var make = function(THREE, data){
    buildMaterials(THREE);
    var WH = (data && +data.wallH) || WALL_H;   // per-room wall height, defaults to the module value
    var D = defs(THREE, WH);
    var root = new THREE.Group();
    var markers = new THREE.Group(); root.add(markers);   // spawn/exit arrows — hide in play, show in edit
    var ceiling = new THREE.Group(); ceiling.visible = false; root.add(ceiling);   // a tile over each floor cell — shown only in 1st person
    var colliders = [], spawns = [], exits = [];
    var deg = data && data.version >= 2;  // v2 stores rotationY in degrees; v1 in radians
    function rot(o){ return deg ? (o.rotationY||0)*Math.PI/180 : (o.rotationY||0); }
    (data && data.objects || []).forEach(function(o){
      if(o.asset==='model'){
        var key = (o.src!=null) ? (o.src+'::'+(o.node||'')) : (o.modelId!=null ? (o.modelId+'::') : null);
        var M = key ? MODELS[key] : null, g = new THREE.Group();
        if(M && M.proto) g.add(M.proto.clone(true));
        var sc = o.scale || 1; g.scale.setScalar(sc);
        g.position.set(o.position[0], o.position[1], o.position[2]); g.rotation.y = rot(o);
        g.traverse(function(m){ if(m.isMesh) m.userData.srcObj = o; });
        root.add(g);
        // any placed model may carry a light, so a lamp/ceiling-fixture model can actually illuminate the room
        if(o.light){ var L=o.light, pl=new THREE.PointLight(L.color!=null?L.color:0xffcf8a, L.intensity!=null?L.intensity:1, L.dist!=null?L.dist:6, L.decay!=null?L.decay:2);
          pl.position.set(o.position[0], (o.position[1]||0)+(L.y!=null?L.y:1.2), o.position[2]); root.add(pl); }
        var en = !(o.collision && o.collision.enabled===false);
        if(en){
          if(o.colliders && o.colliders.length){                         // explicit colliders (e.g. a modular wall's jambs leave the doorway open)
            o.colliders.forEach(function(b){ colliders.push(worldAABB({ size:b.size, offset:b.offset||[0,0,0] }, o.position, rot(o))); });
          } else if(M && M.size){                                        // default: one box from the model's footprint
            var z=M.size, b=box(Math.max(z.x*sc,0.2), Math.max(z.y*sc,0.2), Math.max(z.z*sc,0.2), 0, z.y*sc/2, 0); colliders.push(worldAABB(b, o.position, rot(o)));
          }
        }
        return;
      }
      var def = D[o.asset]; if(!def) return;
      var r = rot(o);
      var g = new THREE.Group(); def.build(g); applyMat(g, o.material || DEFMAT[o.asset]);
      g.position.set(o.position[0], o.position[1], o.position[2]); g.rotation.y = r;
      g.traverse(function(m){ if(m.isMesh) m.userData.srcObj = o; });   // lets the editor pick a placed piece
      (def.marker ? markers : root).add(g);
      if(def.marker==='spawn') spawns.push({ position:o.position.slice(), rotationY:r });
      else if(def.marker==='exit') exits.push({ position:o.position.slice(), rotationY:r });
      // colliders: respect per-object disable flag for furniture
      var enabled = !(o.collision && o.collision.enabled===false);
      if(enabled && def.colliders && def.colliders.length){
        def.colliders.forEach(function(b){ colliders.push(worldAABB(b, o.position, r)); });
      }
    });
    // floor bounds (local x/z) so a game can tell which room a point is in.
    // A room may state bounds explicitly (modular rooms use model floor slabs, not the 'floor' asset).
    var bx0=Infinity,bx1=-Infinity,bz0=Infinity,bz1=-Infinity,hasF=false;
    if(data && data.bounds){ var bd=data.bounds; bx0=bd.minx; bx1=bd.maxx; bz0=bd.minz; bz1=bd.maxz; hasF=true; }
    else (data && data.objects || []).forEach(function(o){
      var hw = 0;
      if(o.asset==='floor') hw = 0.5;   // legacy built-in floor tile
      else if(o.asset==='model' && /floor_ceiling/i.test(o.src||'') && Math.abs((o.position&&o.position[1])||0) < 0.3){ var mk=MODELS[o.src+'::'+(o.node||'')]; hw = mk ? Math.max(mk.size.x, mk.size.z)/2 : 2; }   // a pack floor slab near the floor
      if(hw>0){ hasF=true; var x=o.position[0], z=o.position[2]; if(x-hw<bx0)bx0=x-hw; if(x+hw>bx1)bx1=x+hw; if(z-hw<bz0)bz0=z-hw; if(z+hw>bz1)bz1=z+hw; }
    });
    if(hasF && !(data && data.noCeiling)){ var cp=new THREE.Mesh(new THREE.PlaneGeometry(bx1-bx0, bz1-bz0).rotateX(Math.PI/2), MAT.ceil); cp.position.set((bx0+bx1)/2, WH+0.02, (bz0+bz1)/2); ceiling.add(cp); }
    return { root:root, markers:markers, ceiling:ceiling, colliders:colliders, spawns:spawns, exits:exits, bounds: hasF?{minx:bx0,maxx:bx1,minz:bz0,maxz:bz1}:null };
  };
  // Single source of truth for the Build palette: whatever assets/materials this engine knows,
  // the editor shows. Add a prop to defs()+DEFMAT and it appears for both building and playing.
  var SWATCH={ wood:'#8a5a32',darkwood:'#6b4a2b',plaster:'#d9d2c2',brick:'#a8584a',stone:'#8c8f99',
    tile:'#6f7480',fabricblue:'#3f5e86',fabricred:'#b4463c',green:'#5f8b57',metal:'#707682',black:'#1a1b22',glass:'#aee3ef' };
  make.catalog = function(THREE){
    buildMaterials(THREE); var D = defs(THREE);
    var assets = Object.keys(D).map(function(k){ return { name:k, occupy:D[k].occupy, marker:D[k].marker||null, defMat:DEFMAT[k] }; });
    return { assets:assets, materials:Object.keys(MAT), swatch:SWATCH, wallH:WALL_H };
  };
  // Parse embedded model sources (id -> {name, fmt:'glb'|'obj', data:dataURI}) into the cache, then call done().
  // GLB parse is async, so callers that build rooms with models must wait for done(). Legacy {name, glb} is accepted.
  make.loadModels = function(THREE, models, done){
    models = models || {}; var ids = Object.keys(models).filter(function(id){ return !SRCNODES[id]; });
    if(!ids.length){ if(done) done(); return; }
    buildMaterials(THREE);
    var gltf = THREE.GLTFLoader ? new THREE.GLTFLoader() : null, objl = THREE.OBJLoader ? new THREE.OBJLoader() : null;
    var pend = ids.length; function fin(){ if(--pend<=0 && done) done(); }
    function fail(id, msg){ console.warn('[room-engine] model failed '+id, msg); SRCNODES[id]=[{node:'',size:{x:0.4,y:0.4,z:0.4}}]; MODELS[id+'::']=stub(); fin(); }
    ids.forEach(function(id){
      var rec = models[id];
      // Path records: fetch the file from assets/ and keep its real metres (a curated pack, not a stray import).
      if(rec && rec.path){
        var pfmt = rec.fmt || (/\.obj(\?|#|$)/i.test(rec.path) ? 'obj' : 'glb');
        fetch(rec.path).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.arrayBuffer(); }).then(function(buf){
          if(pfmt==='obj'){ if(!objl) return fail(id,'OBJLoader missing'); var grp=objl.parse(new TextDecoder().decode(buf)); registerSource(THREE, id, grp, true); fin(); }
          else { if(!gltf) return fail(id,'GLTFLoader missing');
            gltf.parse(buf, rec.path.replace(/[^\/]*$/,''), function(res){ try{ registerSource(THREE, id, res.scene, true); fin(); }catch(e){ fail(id, e&&e.message); } }, function(err){ fail(id, err&&err.message); }); }
        }).catch(function(e){ fail(id, e&&e.message); });
        return;
      }
      // Embedded records: base64 data URI from an in-editor import; scale is unknown, so normalise the footprint.
      var fmt = rec.fmt || (rec.obj ? 'obj' : 'glb'), data = rec.data || rec.glb || rec.obj || rec;
      var sx = String(data), b64 = sx.indexOf(',')>=0 ? sx.split(',')[1] : sx;
      try{
        if(fmt==='obj'){ if(!objl) return fail(id,'OBJLoader missing'); var grp = objl.parse(atob(b64)); registerSource(THREE, id, grp); fin(); }
        else { if(!gltf) return fail(id,'GLTFLoader missing');
          gltf.parse(b64ToBuf(b64), '', function(res){ try{ registerSource(THREE, id, res.scene); fin(); }catch(e){ fail(id, e&&e.message); } }, function(err){ fail(id, err&&err.message); }); }
      }catch(e){ fail(id, e&&e.message); }
    });
  };
  // Imported PNG/JPG textures (id -> {name, img:dataURI}) become paint materials 'tex:<id>'.
  make.loadTextures = function(THREE, textures, done){
    textures = textures || {}; buildMaterials(THREE);
    var ids = Object.keys(textures).filter(function(id){ return !USERMAT['tex:'+id]; });
    if(!ids.length){ if(done) done(); return; }
    var pend = ids.length; function fin(){ if(--pend<=0 && done) done(); }
    ids.forEach(function(id){
      var rec = textures[id], uri = (rec && (rec.img || rec.path)) || rec, rep = rec && rec.repeat, img = new Image();
      img.onload = function(){ try{ var t=new THREE.Texture(img); t.magFilter=t.minFilter=THREE.NearestFilter; t.generateMipmaps=false; t.wrapS=t.wrapT=THREE.RepeatWrapping;
        if(rep) t.repeat.set(rep[0], rep[1]);    // tile the image across a face (e.g. tall walls) instead of stretching one copy
        t.needsUpdate=true;
        USERMAT['tex:'+id]=new THREE.MeshStandardMaterial({ map:t, flatShading:true, roughness:1, metalness:0 }); }catch(e){ USERMAT['tex:'+id]=MAT.plaster; } fin(); };
      img.onerror = function(){ console.warn('[room-engine] texture failed '+id); USERMAT['tex:'+id]=MAT.plaster; fin(); };
      img.src = String(uri);
    });
  };
  make.hasTexture = function(id){ return !!USERMAT['tex:'+id]; };
  make.sourceNodes = function(id){ return SRCNODES[id] || null; };   // [{node, size}] placeable pieces for a source
  make.hasModel = function(key){ return !!MODELS[key]; };            // key = 'sourceId::node'
  make.modelSize = function(key){ return MODELS[key] ? MODELS[key].size : null; };
  return make;
})();
