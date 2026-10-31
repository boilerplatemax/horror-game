# Assets

How downloaded asset packs are stored and indexed. Files are organized **by
pack** on disk (each pack is a self-contained unit with its own license); the
in‑editor Asset Library groups them **by category** and lets you filter by pack.

## Folder layout

```
assets/
  manifest.json               index of packs + every model/texture (below)
  models/<group>/*.glb         model files grouped by kind (.glb preferred; .gltf/.obj ok)
  textures/<pack-id>/*.png     texture files, one folder per pack
  licenses/<pack-id>.txt       the pack's original LICENSE / attribution text
```

`<group>` is a short kebab-case kind, and doubles as the first half of each model's `id`
(e.g. `furniture/bed_1`, `large-props/metal_barrel_mp_1`). The current pack lives under
`models/{decals,electronics,furniture,items-weapons,large-props,lighting,small-props}/`
and `textures/psx-horror/`, all attributed to the single `psx-horror` pack.

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

- **id** — unique, stable, referenced by worlds. Don't rename once used.
- **category** — free-form grouping for the editor (e.g. `furniture`, `prop`, `lighting`, `decal`).
- **group** — the on-disk folder under `models/` (also the first half of the id).
- **pack** — which pack it came from (groups + attributes it).
- **scale** — default import scale (models only). This pack is authored in real metres, so `1`.

## How a world loads these

A world references assets by **path**, so nothing is embedded as base64. Its top-level
`models` map lists each used asset (page-relative path, under `assets/`):

```json
"models": { "furniture/bed_1": { "name": "bed_1", "path": "assets/models/furniture/bed_1.glb" } }
```

and a room object places it:

```json
{ "asset": "model", "src": "furniture/bed_1", "node": "", "position": [x, y, z],
  "rotationY": 90, "scale": 1, "collision": { "enabled": true },
  "light": { "color": 16767400, "intensity": 1.15, "dist": 7.5, "y": 2.3 } }
```

- Path-loaded models keep their **real metres** (the engine does not re-fit the footprint);
  base-anchored (base dropped to y=0, centred on x/z). GLTF base-colour maps are forced to
  the engine's linear space and matte PBR so metallic packs don't render black.
- **collision.enabled: false** — walk-through (floor clutter, wall/ceiling decor).
- **light** — optional point light on any model (`{ color, intensity, dist, decay, y }`),
  so a lamp fixture actually illuminates.
- **colliders** — explicit collider boxes `[{ size:[x,y,z], offset:[x,y,z] }]` instead of the
  model's bounding box, so e.g. a modular archway can wall off the span yet leave the opening passable.

A room may also set `bounds: {minx,maxx,minz,maxz}` (used for room detection when the floor is made of
model slabs, not the `floor` asset) and `noCeiling: true` (skip the auto ceiling plane; the room supplies
its own). The **modular-structures** group (`models/modular/*.glb`) is a 4m-grid architecture kit — arched
walls, floor/ceiling slabs, pillars, doorways, stairs, tunnels — assembled by the `modRoom` builder in
`src/game.js` into the default world, "The Undercroft".

The pack has no architecture *models*, so the built-in floor/wall/door geometry is
**re-skinned** with pack *textures*: a world's `textures` map loads them by path and a
piece's `material` is set to `tex:<id>`. Texture records take an optional
`repeat: [u, v]` so a map tiles across a tall wall instead of stretching one copy.

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
