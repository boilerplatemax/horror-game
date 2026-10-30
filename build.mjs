// Builds docs/index.html — a single, self-contained page — from the template in src/,
// the engines in src/, and the libraries in vendor/. Zero dependencies; run with: node build.mjs
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const r = (...p) => join(root, ...p);
const read = (f) => readFileSync(r(f), 'utf8');

let html = read('src/index-template.html');

// Libraries: served from vendor/ next to the page (no CDN — works fully offline and on GitHub Pages).
html = html.replace(/<script src="https:\/\/cdnjs[^"]*three\.min\.js"><\/script>/, '<script src="vendor/three.min.js"></script>');
html = html.replace('<script>/*__GLTF_LOADER__*/</script>', '<script src="vendor/GLTFLoader.js"></script>');
html = html.replace('<script>/*__OBJ_LOADER__*/</script>', '<script src="vendor/OBJLoader.js"></script>');

// Engines: inlined into the page (replace with a function so $ in the code isn't treated specially).
html = html.replace('/*__CHAR_ENGINE__*/', () => read('src/char-engine.js'));
html = html.replace('/*__ROOM_ENGINE__*/', () => read('src/room-engine.js'));
html = html.replace('/*__GAME__*/', () => read('src/game.js'));

// Sanity check: no placeholders left behind.
const leftover = (html.match(/\/\*__[A-Z_]+__\*\//g) || []);
if (leftover.length) { console.error('Unfilled placeholders:', leftover); process.exit(1); }

rmSync(r('docs'), { recursive: true, force: true });
mkdirSync(r('docs'), { recursive: true });
writeFileSync(r('docs/index.html'), html);
cpSync(r('vendor'), r('docs/vendor'), { recursive: true });
if (existsSync(r('assets'))) cpSync(r('assets'), r('docs/assets'), { recursive: true });
if (existsSync(r('worlds'))) cpSync(r('worlds'), r('docs/worlds'), { recursive: true });

console.log(`Built docs/index.html (${Math.round(html.length / 1024)} KB) + vendor/assets/worlds.`);
