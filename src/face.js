// face.js — the face is a flat textured decal that hugs the front of the head
// (like a real Mii), not 3D eyeballs. The face is drawn on a canvas.

import * as THREE from 'three';

// Draw a clean, friendly default face on a transparent canvas.
export function defaultFaceTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.clearRect(0, 0, S, S);

  const cx = S / 2;
  // blush (soft)
  for (const bx of [S * 0.19, S * 0.81]) {
    const g = x.createRadialGradient(bx, S * 0.56, 2, bx, S * 0.56, S * 0.11);
    g.addColorStop(0, 'rgba(255,120,110,0.55)');
    g.addColorStop(1, 'rgba(255,120,110,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(bx, S * 0.56, S * 0.11, 0, 7); x.fill();
  }
  // eyes
  for (const ex of [S * 0.31, S * 0.69]) {
    const ey = S * 0.46, ew = S * 0.082, eh = S * 0.115;
    x.fillStyle = '#2a2b36';
    x.beginPath(); x.ellipse(ex, ey, ew, eh, 0, 0, 7); x.fill();
    x.fillStyle = '#ffffff';
    x.beginPath(); x.arc(ex + ew * 0.35, ey - eh * 0.4, ew * 0.32, 0, 7); x.fill();
  }
  // eyebrows
  x.strokeStyle = '#4a2e1a'; x.lineWidth = S * 0.02; x.lineCap = 'round';
  for (const bx of [S * 0.31, S * 0.69]) {
    x.beginPath();
    x.moveTo(bx - S * 0.058, S * 0.335);
    x.quadraticCurveTo(bx, S * 0.305, bx + S * 0.058, S * 0.335);
    x.stroke();
  }
  // nose
  x.fillStyle = 'rgba(180,120,80,0.55)';
  x.beginPath(); x.arc(cx, S * 0.57, S * 0.015, 0, 7); x.fill();
  // smile
  x.strokeStyle = '#7c3b38'; x.lineWidth = S * 0.03; x.lineCap = 'round';
  x.beginPath();
  x.moveTo(cx - S * 0.11, S * 0.66);
  x.quadraticCurveTo(cx, S * 0.76, cx + S * 0.11, S * 0.66);
  x.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Build a face patch that hugs the front of a surface of revolution (the head).
// radiusAt(y) gives the head's cross-section radius at world height y; the patch
// spans [yBottom, yTop] vertically and ±angH horizontally, sitting `eps` proud
// of the surface. Returned geometry is in head-bone-local space (yOffset).
export function buildFacePatch({ radiusAt, yBottom, yTop, angH = 0.8, eps = 0.01, zScale = 1, yOffset = 0 }) {
  const segH = 20, segV = 18, row = segH + 1;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    const y = yBottom + v * (yTop - yBottom);
    const r = radiusAt(y);
    for (let i = 0; i <= segH; i++) {
      const u = i / segH;
      const phi = (u * 2 - 1) * angH;
      let px = r * Math.sin(phi), pz = r * Math.cos(phi) * zScale;
      const l = Math.hypot(px, pz) || 1;
      px += eps * px / l; pz += eps * pz / l;
      pos.push(px, y + yOffset, pz);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < segV; j++) for (let i = 0; i < segH; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
