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

Two ways in: models/textures **imported** in the Build tab are embedded in the
world JSON as data URIs (self-contained, but heavy), and — now wired up — assets
**loaded by path** from `/assets`, so a world can reference hundreds of files
without bloating its JSON.

- Files live under `assets/models/<group>/*.glb` and `assets/textures/<pack>/*.png`,
  indexed by `assets/manifest.json`. See **[assets/README.md](assets/README.md)**
  for the layout, the manifest schema, and the world `models` + model-object fields.
- A world's top-level `models` map lists each used asset as
  `"<group>/<name>": { "name": "...", "path": "assets/models/<group>/<name>.glb" }`,
  and a room places it with `{ "asset": "model", "src": "<group>/<name>", "position": [...] }`.
  Path-loaded models keep their real metres; embedded imports are still re-fit and
  both flows stay supported.
- Because the player and `/assets` share an origin, the page `fetch`es them with no
  CORS issues. The bundled **psx-horror** pack (~490 models, ~215 textures) drives
  the default world.

If `assets/` grows past ~50 MB (it has), consider **Git LFS** for `assets/**`. For
now the files are committed directly; individual files are small (<1 MB each), so
GitHub Pages serves them fine.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys `docs/` on every push to `main`.
In your repo: **Settings → Pages → Build and deployment → Source: GitHub Actions.**
Your game goes live at `https://<user>.github.io/<repo>/`.

## Roadmap

Load-by-path is now wired up (via the world `models` map + `src`). Still open:

- An **Asset Library** panel in the Build tab that reads `assets/manifest.json` and
  lists all pack models/textures for one-click placement by path (no embedding).
  Today the Build palette only shows the assets a loaded world already references.
- **Export (refs)** alongside the current embedded export.
- A texture material that loads a pack `.png` by path for floors/walls (the engine's
  `loadTextures` already accepts `{ path }`; the editor UI to pick one is pending).

Keep it dependency-free and static; Three.js stays r128.
