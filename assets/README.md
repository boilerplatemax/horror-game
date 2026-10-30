# Assets

How downloaded asset packs are stored and indexed. Files are organized **by
pack** on disk (each pack is a self-contained unit with its own license); the
in‑editor Asset Library groups them **by category** and lets you filter by pack.

## Folder layout

```
assets/
  manifest.json              index of packs + every model/texture (below)
  models/<pack-id>/*.glb      model files, one folder per pack (.glb preferred; .gltf/.obj ok)
  textures/<pack-id>/*.png    texture files, one folder per pack
  licenses/<pack-id>.txt      the pack's original LICENSE / attribution text
```

`<pack-id>` is a short kebab-case slug, e.g. `kenney-furniture`, `quaternius-nature`.

## manifest.json

The player reads this to list assets. Paths are **relative to `assets/`**.

```json
{
  "packs": {
    "kenney-furniture": {
      "name": "Furniture Kit",
      "author": "Kenney",
      "license": "CC0-1.0",
      "source": "https://kenney.nl/assets/furniture-kit"
    }
  },
  "models": [
    { "id": "chair-a", "name": "Chair", "pack": "kenney-furniture",
      "category": "furniture", "path": "models/kenney-furniture/chair.glb", "scale": 1 }
  ],
  "textures": [
    { "id": "brick-01", "name": "Brick", "pack": "kenney-furniture",
      "category": "walls", "path": "textures/kenney-furniture/brick.png" }
  ]
}
```

- **id** — unique, stable, referenced by worlds (`ref`). Don't rename once used.
- **category** — free-form grouping for the editor, e.g. `furniture`, `props`,
  `walls`, `floors`, `nature`, `lighting`, `characters`, `decals`.
- **pack** — which pack it came from (groups + attributes it).
- **scale** — default import scale (models only).

## Adding a pack

1. Put files under `models/<pack-id>/` and/or `textures/<pack-id>/`.
2. Drop the pack's license text in `licenses/<pack-id>.txt`.
3. Add a `packs["<pack-id>"]` entry and one `models`/`textures` row per file.

## Formats & licensing

- The engine uses **Three.js r128** loaders: **`.glb`/`.gltf`** (GLTFLoader) and
  **`.obj`** (OBJLoader) for models, **`.png`** for textures. `.fbx`/`.blend`
  packs must be converted to `.glb` first (e.g. in Blender).
- Only commit assets you're licensed to redistribute (**CC0** is simplest;
  **CC‑BY** is fine but keep the attribution in `licenses/` and credit the author).
- If `assets/` grows past ~50 MB, enable **Git LFS** for `assets/**`.
