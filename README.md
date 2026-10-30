# PSX Level Maker

A PS1-style, low-poly **browser level maker + player**. Build rooms on a grid,
drop in characters, author branching dialogue, set the time of day, and walk
the world in first or third person — all in one self-contained page, no backend.

Built with **Three.js r128** (vendored, no CDN). Everything runs from a plain
static file server and deploys to GitHub Pages.

## Quick start

```bash
node build.mjs          # assembles docs/index.html from src/ + vendor/
# then serve docs/ with any static server, e.g.:
python3 -m http.server -d docs 8080      # http://localhost:8080
# or:  npx serve docs
```

Open the page, click **Edit** to build, **▶ Play** to walk around.

## How it's wired

The player is one HTML page assembled from a template + three engine scripts:

```
src/
  index-template.html   the page shell (HUD, panels, <script> slots)
  char-engine.js        window.createPSXCharacter — low-poly characters + faces
  room-engine.js        window.createPSXRoom — rooms, materials, imported models/textures
  game.js               the runtime: movement, cameras, dialogue, the in-page editor
vendor/
  three.min.js          Three.js r128
  GLTFLoader.js         glTF/glb loader (r128)
  OBJLoader.js          .obj loader (r128)
build.mjs               injects src/ into the template, copies vendor/assets/worlds -> docs/
docs/                   build output (gitignored; regenerated + deployed by CI)
assets/                 model + texture files, served at /assets  (see "Assets" below)
worlds/                 saved world JSON exports
```

`build.mjs` references the libraries from `vendor/` and inlines the three
engines into `docs/index.html`. **Edit the files in `src/`, then rebuild** —
never edit `docs/index.html` by hand (it's overwritten).

## Content model

Three layers, kept separate so the engines can change without breaking content:

- **Characters** — a `"PSX1.…"` code string or a settings object (`createPSXCharacter`).
- **Rooms** — a room JSON of placed objects (`createPSXRoom`).
- **World** — one JSON tying it together: `start`, `player`, `sky`, `flicker`,
  and per room its `room`, `npcs` (with behaviours + dialogue), and `exits`.

The in-page **Edit** mode authors all of this visually (Build / Compose tabs),
and **Export world JSON** gives you a world file to drop in `worlds/`.

## Assets

Today, models (`.glb/.gltf/.obj`) and textures (`.png`) imported in the Build
tab are **embedded** in the world JSON as data URIs — self-contained, but heavy.

This repo is set up to move to **file-based assets** served from `/assets`:

- Put model files in `assets/models/`, textures in `assets/textures/`.
- List them in `assets/manifest.json`:
  ```json
  {
    "models":   [{ "id": "chair", "name": "Chair", "path": "models/chair.glb", "scale": 1 }],
    "textures": [{ "id": "brick", "name": "Brick", "path": "textures/brick.png" }]
  }
  ```
- Because the player and `/assets` are served from the same origin, the page can
  `fetch` them with no CORS issues.

> **Load-by-path isn't wired up yet** — see Roadmap. Until then, use the Build
> tab's Import buttons (embeds the file). Download CC0 packs (Kenney, Quaternius,
> Poly Pizza) or convert itch `.blend`/`.fbx` packs to `.glb` in Blender first.

If `assets/` grows past ~50 MB, enable **Git LFS** for `assets/**` and note it here.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys `docs/` on every push to `main`.
In your repo: **Settings → Pages → Build and deployment → Source: GitHub Actions.**
Your game goes live at `https://<user>.github.io/<repo>/`.

## Roadmap — load assets by path

The next step (great first task for a coding agent): make the player load assets
from `/assets` by reference, in addition to the current embedded flow.

- A model placement may be `{ "asset": "model", "ref": "models/chair.glb", "node": "...", "position": [...], "rotationY": 0, "scale": 1 }` — fetched + parsed (GLTFLoader for glb/gltf, OBJLoader for obj) and cached, exactly like today's embedded path. Keep `{ src/modelId + embedded data }` working for back-compat.
- A material `"texref:textures/brick.png"` loads that texture.
- Add an **Asset Library** panel in the Build tab that reads `assets/manifest.json`
  and lists models/textures for one-click placement by `ref` (no embedding).
- Add **Export (refs)** alongside the current embedded export.

Keep it dependency-free and static; Three.js stays r128; don't change the game's
visual behaviour — this is about asset storage and hosting only.
