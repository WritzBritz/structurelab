# StructureLab

Desktop toolkit for Minecraft — **map art**, **pixel art**, and model → structure workflows.
Runs on **Windows**, **macOS**, and **Linux** (Tauri).

## Supported formats

**Maps & pixel art (image import)**  
PNG · JPEG · WebP · GIF · SVG · HEIC · HEIF · AVIF · BMP · TIFF · ICO  
(GIF uses the first frame; SVG is rasterized at its intrinsic size.)

**Models (import)**  
Wavefront `.obj` · glTF / GLB · Autodesk `.fbx` · COLLADA `.dae` · MagicaVoxel `.vox` · Blockbench `.bbmodel` · Mine-imator `.miobject` / `.mimodel` · Maya `.mb` / `.ma` · Minecraft skin `.png`

**Model companions** (drop beside the mesh, or add after)  
Wavefront `.mtl` · textures PNG / JPEG / WebP / BMP / GIF / TGA / TIFF · Unity `.meta` / `.mat` (FBX material remap) · extra Mine-imator `.mimodel`

**Structure export**  
Vanilla `.nbt` · Structure Block 48×48×48 piece bundles (`.zip`) · Litematica `.litematic` (v6 on 1.20–1.20.4, v7 on 1.20.6+; chosen from that version’s DataVersion) · Sponge v3 `.schem` (WorldEdit / FAWE) · all of the above in one `.zip`

## Tools

- **Maps** — turn images into **map art** (Minecraft map-item colours, multi-map mosaics, floor only, flat or staircase) or **pixel art** (in-world cubes, one block deep, floor or wall)
- **Models** — import meshes, skins, and the Minecraft entity catalog; pose / voxelize to a block grid; export with the same structure formats

## Minecraft versions

Pick a target game version in the app. That choice only affects **export files** (NBT DataVersion, Litematica v6 vs v7) and **which blocks exist** in that release. The Models catalog (old and new mobs) is not filtered by version.

StructureLab ships palettes for these releases (asset milestones only — not every patch):

**26.2** · **26.1** · **1.21.11** · **1.21.6** · **1.21.4** · **1.21** · **1.20.6** · **1.20.4** · **1.20**

Exports (NBT / Litematica / Sponge) use that version’s Minecraft **DataVersion**. Preview icons and block face textures already in the repo are copied into `minecraft/{version}/` at build (`npm run sync:assets`). The builder does not download vanilla assets. Missing preview PNGs show a warning (purple/black tile); export still uses that block. **Add from Minecraft** can download missing catalog entity textures from Mojang’s asset index.

## Building from source

Build helpers live under `builder/` (one folder per OS). Most people should use **GitHub Releases** instead.

**Linux**

```bash
bash builder/linux/build.sh
```

**Windows**

```text
builder\windows\build-installer.bat
builder\windows\build-portable.bat
```

Both builders read `version` from `package.json` and write versioned files at the repo root, e.g. **`StructureLab-<version>-x64-setup.exe`** and **`StructureLab-<version>-x64-portable.zip`**.

Each build copies **`minecraft/{version}/`** folders (palette JSON + block icons + face textures already in the repo) for every era under `src-tauri/resources/minecraft/`. It does not download vanilla assets. Portable zip keeps them next to the exe; the NSIS installer places them under the app resource tree (resolved via Tauri’s resource dir on each OS).

**macOS**

```bash
bash builder/macos/build.sh
```

Or on any OS:

```bash
npm install
npm run sync:assets
npm run tauri build
```

Installers land under `src-tauri/target/release/bundle/` (`.exe` / `.msi` on Windows,
`.dmg` / `.app` on macOS, `.AppImage` / `.deb` / `.rpm` on Linux).

On **Windows GNU** portable / installer scripts (`builder/windows/`), the Rust target dir is
`src-tauri/target-gnu/` instead of `src-tauri/target/` — look for
`structurelab.exe` under `src-tauri/target-gnu/x86_64-pc-windows-gnu/release/`.

GitHub Actions (`.github/workflows/ci.yml`) builds on Windows, macOS, and Linux.

## Maps & pixel art

**Map art** matches Minecraft’s map-item colours for that version (including darker / brighter staircase shades) and can span multiple 128×128 map tiles (`ceil(width / 128) × ceil(height / 128)`). Size can also be an exact block width × length.

**Pixel art** maps image pixels to in-world cubes, one block deep. Facing can be the **floor** or a **wall** (south / north / east / west). With Vanilla defaults it matches every full cube that exists in the selected Minecraft version (texture average), not the 62 map-item colours. Wool / concrete / terracotta / carpet presets still restrict the pool. Map art cannot use wall facing — map shading only works on the floor.

### Build

- **Flat** — one layer. Map art and pixel art.
- **Staircase** — map art on the floor only. Minecraft picks map shade from the block to the **north** (dark = one step down, normal = same height, bright = one step up). Default max height is **128**; **Auto height** keeps the unconstrained stair plan and only re-plans near modern world height (~320). A tight max-height cap re-plans shades of the same map colours instead of flattening the 2D assignment. Default layout is **from the ground up** (control row on y=0, column only builds up); **Off** keeps exact stairs and still sits each column on the ground. Start edge is north (image top) or south (image bottom); an extra **Support** control row sits on that edge (click Support to pick the block; default cobblestone). Supports under carpets and other gravity blocks are **on** by default.

### Colour matching (map art)

Default is **StructureLab perceptual mix**. It works with any palette (full map colours, carpet, wool, …) and targets the blended colour a viewer sees instead of each pixel alone, so a build can show tones no single block has. Each colour gets a luminance-ordered mixing plan placed by an 8×8 Bayer cell; leftover error is diffused so fine detail still tracks locally. Mix supplies its own dithering, so the dither dropdown is ignored while it is selected.

Other map matchers:

- **rebane2001 MapartCraft “better colour”** — [MapartCraft](https://github.com/rebane2001/mapartcraft) redstonehelper Lab distance (not standard CIE D65 Lab)
- **CIEDE2000** — CIE ΔE₀₀ in Lab
- **Oklab + hue guard** — Oklab/HyAB with stronger hue weights on sparse packs such as carpet

Dither when Mix is off: Floyd–Steinberg (MapartCraft-style), Atkinson, ordered 4×4, or none.

Measured against Floyd–Steinberg on blurred (perceived) error across gradients and detailed images: Mix is about 20% lower error on average, up to 55% on wide gradients, and never more than a few percent worse in the hardest case (busy detail on a full palette). The gains are largest on limited packs such as carpet and on small maparts. The approach follows the spatial/dithered colour quantization work of Puzicha, Held, Ketterer, Buhmann & Fellner (ECCV 1998; IEEE TIP 2000) and Joel Yliluoma's [arbitrary-palette positional dithering](https://bisqwit.iki.fi/story/howto/dither/jy/).

Map art always stays on the map-item palette because a filled map cannot show more. Models (below) match real cube textures unless you pick a restricted pack.

## Models

Import any of the formats above, pose parts if you want, set width / height / length in blocks, voxelize, then export with the same structure formats as Maps.

**Minecraft entity catalog** (Add from Minecraft) is not filtered by the selected game version. Version only gates export DataVersion and which cubes exist when matching.

### Format notes

- **OBJ** — Wavefront mesh + `.mtl` and folder / dropped textures.
- **glTF / GLB** — glTF 2.0 static meshes (Draco compression is fine). Skinned / animated meshes are skipped. External `.bin` and images next to a `.gltf` are picked up automatically.
- **FBX:** ASCII 6.x and 7.x plus binary 6400+ (typical Mixamo / Blender / Maya 7.4). Missing textures still import the mesh using material colour. External textures next to the file (including Blender `*.fbm/` copies), embedded Video media, TGA, and skinned meshes baked at rest pose with a native bone rig (binary / ASCII 7). Binary 6.x is not supported — re-export as FBX 7.4 binary or ASCII.
- **Unity FBX packages:** if a `.fbx.meta` and `.mat` files sit with the model, StructureLab remaps materials the way Unity’s ModelImporter does (`externalObjects` → `_MainTex` / `_BaseMap` guid). Prefab renderer overrides are not applied to a raw FBX.
- **COLLADA `.dae`** — mesh + materials; late-dropped textures re-run the loader.
- **MagicaVoxel `.vox`** — voxel models (version 150 / 200); previewed as voxels, converted as cubes.
- **Blockbench `.bbmodel`** — cube projects become OBJ; Minecraft skin editor projects become a skin statue (embed the PNG or drop it with the file).
- **Mine-imator** — `.miobject` mesh plus `.mimodel` pose / parts.
- **Maya (best-effort):** FOR4 (≤2013) and FOR8 (2014+) binary plus ASCII; baked `MESH` polygon plugs; Autodesk `MTransformationMatrix` DAG locals (`t/r/s/jo/rp/rpt/sp/ro`, bindPose `bps`, FK→bind twin); orphaned-pivot restore when keep-transform cancels world≈I; shadingEngine materials via `CWFL`/`CONN`; UV face-vertex maps when present. Not a full Maya DG / skinCluster / constraint evaluator — props with cancelled locals keep authored mesh scale (freeze / re-export in Maya if oversized). Prefer OBJ/glTF from Maya for complex animated skins.
- **Skins** — 64×64 (and HD multiples) player PNGs, slim arms, optional 3D second layer, cape PNG, and Mine-imator-style limb pose.

### Matching & convert

Default block pack is **Everything** — every honest 1×1×1 building cube in that Minecraft version (including full copper weathering stages). **Common** skips noisy decorative cubes. Wool / concrete / terracotta / stone / solid presets restrict further. Statues do not place fluids, falling sand, flowers, fire, or furniture-like blocks (brewing stands, lightning rods, and similar).

Default colour matching is **StructureLab smooth** (Oklab nearest cube, then a two-cube mix when that average is closer; 3D ordered grain; eyes stay a single cube). **Perceptual mix** is available for large statues. Hue-aware Lab is better for small / detailed work. MapartCraft’s map-item metric is listed but not recommended for 3D.

Convert stores occupied voxels only (air is not allocated). There is an occupied-block cap (**8 million**). The convert box height is clamped to one Minecraft world column (**384**); width and length cap at **4096**. Errors anywhere in the app are copyable; panics write `logs/crashes/` next to the exe (or under the temp dir if that folder is not writable). The rolling app log is `logs/structurelab.log`.

## Development

Shared requirements on every OS:

- Node.js 22 or newer
- Rust stable

Then install the platform toolchain:

### Windows

You need **either** MSVC **or** the GNU dev script below (same linker as the portable/installer builds).

**Option A — GNU dev (no Visual Studio):** if `npm run tauri dev` fails with `link.exe not found`, use:

```text
builder\windows\dev.bat
```

That runs Vite hot-reload plus a debug Tauri binary with a Windows GNU linker (downloaded once into a local cache on first use, ~700 MB).

**Option B — MSVC:** install Visual Studio 2022 Build Tools with the **Desktop development with C++** workload, then:

```powershell
npm install
npm run tauri dev
```

- Visual Studio 2022 Build Tools with the Desktop C++ workload (Option B only)
- WebView2 Runtime (usually already on Windows 10/11)

### macOS

- Xcode Command Line Tools (`xcode-select --install`)

```bash
npm install
npm run tauri dev
```

### Linux (Ubuntu 22.04+, Debian, Mint)

```bash
bash builder/linux/install-deps.sh --build
npm install
npm run tauri dev
```

Checks (all platforms):

```bash
npm run lint
npm run sync:assets
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

## Project layout

- `src/` — home hub and shared React helpers
- `src/tools/maps/` — map art and pixel art workspace
- `src/tools/models/` — model → Minecraft workspace
- `src-tauri/src/converter.rs` — maps conversion
- `src-tauri/src/voxel/` — mesh/skin import and voxelization
- `src-tauri/src/export/` — vanilla, Litematic, and Sponge serializers
- `src-tauri/src/crash.rs` — rolling log and crash files
- `src-tauri/resources/minecraft/{version}/blocks.json` — source palettes (synced into `minecraft/{version}/` at build time)
- `minecraft/{version}/` — assembled assets for the running app (portable / dev; gitignored at repo root)
  - `blocks.json`, `block-icons/`, `block-textures/` — browse or replace PNGs, restart app
- `public/block-icons/`, `public/block-textures/`, `public/entity-textures/` — tracked Vite fallbacks used when assembled packs are missing
- `builder/` — OS build helpers and `npm run sync:assets` (not packaged into the app)

Run `npm run sync:assets` after pulling so `minecraft/{version}/` matches the palettes. Per-version face-texture overrides under `src-tauri/resources/minecraft/*/block-textures/` are optional and gitignored.

## Credits

StructureLab is developed by **WritzBritz**.

Map art matching draws on:

- **[rebane2001](https://github.com/rebane2001)** — [MapartCraft](https://github.com/rebane2001/mapartcraft), including the “better colour” Lab matcher used as one of StructureLab’s map-art modes
- **[redstonehelper](https://github.com/redstonehelper)** — [MapConverter](https://github.com/redstonehelper/MapConverter); MapartCraft credits their `rgb2lab` for that Lab space
- **[Joel Yliluoma (bisqwit)](https://github.com/bisqwit)** — [arbitrary-palette positional dithering](https://bisqwit.iki.fi/story/howto/dither/jy/)
- Puzicha, Held, Ketterer, Buhmann & Fellner — spatial / dithered colour quantization (ECCV 1998; IEEE TIP 2000)
- Sharma, Wu & Dalal — CIEDE2000 implementation notes (Color Res Appl, 2005)

Export formats follow community specs:

- **[masa (maruohon)](https://github.com/maruohon)** — [Litematica](https://github.com/maruohon/litematica) `.litematic` schematic
- [Sponge](https://github.com/SpongePowered) / WorldEdit — Sponge v3 `.schem`

The desktop shell is [Tauri](https://github.com/tauri-apps/tauri). Much of the codebase was written with [Cursor](https://cursor.com) AI-assisted editing — acknowledged here once rather than on every commit.

## License

StructureLab is released under the [MIT License](LICENSE).

Bundled Minecraft block previews and palette data are for in-app use only; game assets
remain subject to [Mojang's usage guidelines](https://www.minecraft.net/en-us/usage-guidelines).
