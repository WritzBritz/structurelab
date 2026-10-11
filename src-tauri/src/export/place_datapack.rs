//! Place datapack export: instant `/place template` or progressive `setblock` animation.

use crate::model::{PlacedBlock, Structure};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Write};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct Pos {
    x: i32,
    y: i32,
    z: i32,
}

/// How blocks are ordered when placing over time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DatapackPattern {
    #[default]
    Instant,
    /// Chunk-grouped progressive paste (FAWE-style order) with auto pace.
    Optimal,
    LayerYAsc,
    LayerYDesc,
    AxisZAsc,
    AxisXDesc,
    /// Manhattan shells from the occupied centre → out.
    RadialOut,
    /// Manhattan shells from outside → centre.
    RadialIn,
    /// Euclidean shells from the occupied centre → out.
    SphereOut,
    /// Euclidean shells from outside → centre.
    SphereIn,
    /// Square-ring spiral on XZ (outward), climbing by Y.
    SpiralOut,
    /// Square-ring spiral on XZ (inward).
    SpiralIn,
    /// Each Y layer spirals from its centre, bottom → top.
    LayerSpiral,
    /// Sweep along x+y+z.
    Diagonal,
    /// Interleave even/odd (x+y+z) parity, then Manhattan from centre.
    Checker,
    /// Golden-angle (phyllotaxis-style) spiral on XZ.
    GoldenSpiral,
    Random,
}

impl DatapackPattern {
    pub fn label(self) -> &'static str {
        match self {
            Self::Instant => "instant",
            Self::Optimal => "optimal",
            Self::LayerYAsc => "bottom-to-top",
            Self::LayerYDesc => "top-to-bottom",
            Self::AxisZAsc => "north-to-south",
            Self::AxisXDesc => "east-to-west",
            Self::RadialOut => "radial-out",
            Self::RadialIn => "radial-in",
            Self::SphereOut => "sphere-out",
            Self::SphereIn => "sphere-in",
            Self::SpiralOut => "spiral-out",
            Self::SpiralIn => "spiral-in",
            Self::LayerSpiral => "layer-spiral",
            Self::Diagonal => "diagonal",
            Self::Checker => "checker",
            Self::GoldenSpiral => "golden-spiral",
            Self::Random => "random",
        }
    }
}

/// Options for datapack placement encoding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatapackEncodeOptions {
    pub pattern: DatapackPattern,
    /// Blocks placed per animation step (min 1). Ignored for Instant.
    /// Soft-capped at 65_536 to stay under default `maxCommandChainLength`.
    pub blocks_per_tick: u32,
    /// Idle ticks between steps (0–20). Ignored for Instant.
    pub delay_ticks: u32,
    /// Seed for Random pattern. `0` derives from the datapack name.
    pub random_seed: u64,
}

impl Default for DatapackEncodeOptions {
    fn default() -> Self {
        Self {
            pattern: DatapackPattern::Instant,
            blocks_per_tick: 16,
            delay_ticks: 0,
            random_seed: 0,
        }
    }
}

impl DatapackEncodeOptions {
    fn clamped(self) -> Self {
        Self {
            pattern: self.pattern,
            blocks_per_tick: self.blocks_per_tick.clamp(1, 65_536),
            delay_ticks: self.delay_ticks.min(20),
            random_seed: self.random_seed,
        }
    }
}

/// Encode a place datapack zip.
///
/// Instant: one structure NBT + `/place template`.
/// Optimal: chunk-column structure pieces + progressive `/place template` (near-instant, low hitch).
/// Animated: ordered `setblock` steps + tick runner (`start` / `stop`).
pub fn encode_datapack(
    structure: &Structure,
    data_version: i32,
    name: &str,
    options: DatapackEncodeOptions,
) -> Result<Vec<u8>> {
    if structure.blocks.is_empty() {
        bail!("nothing to export — convert a build with at least one block first");
    }

    let options = options.clamped();
    let id = sanitize_datapack_name(name)?;
    let normalized = normalize_structure(structure);

    match options.pattern {
        DatapackPattern::Instant => encode_instant(&normalized, data_version, &id),
        DatapackPattern::Optimal => encode_optimal(
            &normalized,
            data_version,
            &id,
            options.blocks_per_tick,
            options.delay_ticks,
        ),
        _ => encode_animated(&normalized, data_version, &id, &options),
    }
}

fn encode_instant(structure: &Structure, data_version: i32, id: &str) -> Result<Vec<u8>> {
    let nbt = super::vanilla::encode(structure, data_version)
        .context("encode vanilla structure for datapack")?;

    let (pack_format, function_dir, structure_dir, _) = datapack_layout(data_version);
    let function_cmd = format!("function structurelab:{id}");
    let template_id = format!("structurelab:{id}");
    let mcfunction = format!(
        "\
# StructureLab one-shot place ({id})
# Stand (or use a command block) at the build corner, then run:
# /{function_cmd}
place template {template_id} ~ ~ ~
"
    );

    let pack_mcmeta = pack_mcmeta(pack_format, &function_cmd);
    let readme = format!(
        "StructureLab place datapack (instant)\n\
\n\
Name: {id}\n\
Mode: instant (place template)\n\
\n\
Setup:\n\
  1. Extract this zip into your world's datapacks folder so you have:\n\
       <world>/datapacks/<any_folder>/pack.mcmeta\n\
  2. In-game: /reload\n\
  3. Stand at the build corner (feet = origin) OR put a command block there\n\
  4. Run once:\n\
       /{function_cmd}\n\
\n\
That runs: place template {template_id} ~ ~ ~\n\
\n\
Cheats / permission level 2 required.\n\
"
    );

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        write_bytes(&mut zip, "pack.mcmeta", pack_mcmeta.as_bytes(), opts)?;
        write_bytes(&mut zip, "README.txt", readme.as_bytes(), opts)?;
        write_bytes(
            &mut zip,
            &format!("data/structurelab/{function_dir}/{id}.mcfunction"),
            mcfunction.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("data/structurelab/{structure_dir}/{id}.nbt"),
            &nbt,
            opts,
        )?;
        zip.finish()?;
    }
    Ok(cursor.into_inner())
}

/// Near-instant paste: one vanilla structure per 16×16 column, placed a few per tick.
///
/// `/place template` loads NBT natively (far cheaper than thousands of `setblock`s).
/// Spreading columns across ticks mirrors FAWE's chunk dispatch and avoids the
/// single-tick hitch of Instant on huge builds.
fn encode_optimal(
    structure: &Structure,
    data_version: i32,
    id: &str,
    pieces_per_tick_hint: u32,
    delay_ticks: u32,
) -> Result<Vec<u8>> {
    let pieces = split_chunk_column_pieces(structure);
    if pieces.is_empty() {
        bail!("nothing to export — convert a build with at least one block first");
    }

    let auto = optimal_pieces_per_tick(&pieces);
    // Frontend sends columns/tick in blocks_per_tick for Optimal (duration UI).
    let pieces_per_tick = if pieces_per_tick_hint > 0 {
        pieces_per_tick_hint.min(pieces.len() as u32).max(1)
    } else {
        auto
    };
    let delay = delay_ticks.min(20);
    let steps: Vec<&[ChunkPiece]> = pieces.chunks(pieces_per_tick as usize).collect();
    let step_count = steps.len();

    let (pack_format, function_dir, structure_dir, tags_function_dir) =
        datapack_layout(data_version);
    let function_cmd = format!("function structurelab:{id}");
    let stop_cmd = format!("function structurelab:{id}/stop");
    let tag = format!("structurelab.build.{id}");

    let pack_mcmeta = pack_mcmeta(pack_format, &function_cmd);
    let readme = format!(
        "StructureLab place datapack (optimal)\n\
\n\
Name: {id}\n\
Mode: optimal (chunked place template)\n\
Structure pieces: {}\n\
Pieces per tick: {pieces_per_tick}\n\
Delay ticks between steps: {delay}\n\
Steps: {step_count}\n\
\n\
Setup:\n\
  1. Extract this zip into your world's datapacks folder so you have:\n\
       <world>/datapacks/<any_folder>/pack.mcmeta\n\
  2. In-game: /reload\n\
  3. Stand at the build corner (feet = origin) OR put a command block there\n\
  4. Start:\n\
       /{function_cmd}\n\
  5. Stop early (optional):\n\
       /{stop_cmd}\n\
\n\
Places 16×16 columns with /place template a few per tick — much closer to Instant\n\
than setblock animation, without dumping the whole build in one freeze.\n\
Cheats / permission level 2 required.\n\
",
        pieces.len()
    );

    let root_fn = format!(
        "\
# StructureLab optimal place ({id})
# Chunked place template
function structurelab:{id}/start
"
    );

    let start_fn = format!(
        "\
# Cancel any previous run of this build, then start at the caller's position.
kill @e[type=marker,tag={tag}]
scoreboard objectives add structurelab.step dummy
scoreboard objectives add structurelab.wait dummy
summon marker ~ ~ ~ {{Tags:[\"structurelab.build\",\"{tag}\"]}}
scoreboard players set @e[type=marker,tag={tag},limit=1,sort=nearest] structurelab.step 0
scoreboard players set @e[type=marker,tag={tag},limit=1,sort=nearest] structurelab.wait 0
"
    );

    let stop_fn = format!(
        "\
# Stop this build's animation.
kill @e[type=marker,tag={tag}]
"
    );

    let finish_fn = format!(
        "\
# Animation complete.
kill @s
"
    );

    let mut tick_fn = String::new();
    tick_fn.push_str(&format!(
        "\
# Per-marker tick for {id} (optimal)
execute if score @s structurelab.wait matches 1.. run scoreboard players remove @s structurelab.wait 1
execute if score @s structurelab.wait matches 1.. run return fail
function structurelab:{id}/dispatch
scoreboard players add @s structurelab.step 1
"
    ));
    if delay > 0 {
        tick_fn.push_str(&format!(
            "scoreboard players set @s structurelab.wait {delay}\n"
        ));
    }
    tick_fn.push_str(&format!(
        "execute if score @s structurelab.step matches {step_count}.. run function structurelab:{id}/finish\n"
    ));

    let tick_all_fn = format!(
        "\
# Drive all active markers for this pack.
execute as @e[type=marker,tag={tag}] at @s run function structurelab:{id}/tick
"
    );

    let mut dispatch_fn = String::from("# Dispatch current optimal step\n");
    for (i, _) in steps.iter().enumerate() {
        dispatch_fn.push_str(&format!(
            "execute if score @s structurelab.step matches {i} run function structurelab:{id}/step_{i}\n"
        ));
    }

    let tick_tag = format!(
        "{{\n  \"values\": [\n    \"structurelab:{id}/tick_all\"\n  ]\n}}\n"
    );

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        write_bytes(&mut zip, "pack.mcmeta", pack_mcmeta.as_bytes(), opts)?;
        write_bytes(&mut zip, "README.txt", readme.as_bytes(), opts)?;

        let base = format!("data/structurelab/{function_dir}");
        write_bytes(
            &mut zip,
            &format!("{base}/{id}.mcfunction"),
            root_fn.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("{base}/{id}/start.mcfunction"),
            start_fn.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("{base}/{id}/stop.mcfunction"),
            stop_fn.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("{base}/{id}/finish.mcfunction"),
            finish_fn.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("{base}/{id}/tick.mcfunction"),
            tick_fn.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("{base}/{id}/tick_all.mcfunction"),
            tick_all_fn.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("{base}/{id}/dispatch.mcfunction"),
            dispatch_fn.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("data/minecraft/tags/{tags_function_dir}/tick.json"),
            tick_tag.as_bytes(),
            opts,
        )?;

        for (i, step_pieces) in steps.iter().enumerate() {
            let mut body = String::from("# Place chunk-column templates\n");
            for piece in *step_pieces {
                body.push_str(&format!(
                    "place template structurelab:{id}/p{} ~{} ~{} ~{}\n",
                    piece.index, piece.origin_x, piece.origin_y, piece.origin_z
                ));
            }
            write_bytes(
                &mut zip,
                &format!("{base}/{id}/step_{i}.mcfunction"),
                body.as_bytes(),
                opts,
            )?;
        }

        for piece in &pieces {
            let nbt = super::vanilla::encode(&piece.structure, data_version).with_context(|| {
                format!("encode optimal piece {} for datapack", piece.index)
            })?;
            write_bytes(
                &mut zip,
                &format!("data/structurelab/{structure_dir}/{id}/p{}.nbt", piece.index),
                &nbt,
                opts,
            )?;
        }

        zip.finish()?;
    }
    Ok(cursor.into_inner())
}

struct ChunkPiece {
    index: usize,
    origin_x: i32,
    origin_y: i32,
    origin_z: i32,
    structure: Structure,
}

fn split_chunk_column_pieces(structure: &Structure) -> Vec<ChunkPiece> {
    let [width, _height, length] = structure.size;
    let mut pieces = Vec::new();
    let mut index = 0usize;
    for origin_z in (0..length).step_by(16) {
        for origin_x in (0..width).step_by(16) {
            let size_x = (width - origin_x).min(16);
            let size_z = (length - origin_z).min(16);
            let blocks: Vec<PlacedBlock> = structure
                .blocks
                .iter()
                .filter(|block| {
                    block.x >= origin_x as i32
                        && block.x < (origin_x + size_x) as i32
                        && block.z >= origin_z as i32
                        && block.z < (origin_z + size_z) as i32
                })
                .map(|block| PlacedBlock {
                    x: block.x - origin_x as i32,
                    y: block.y,
                    z: block.z - origin_z as i32,
                    state: block.state.clone(),
                })
                .collect();
            if blocks.is_empty() {
                continue;
            }
            let mut max_x = 0i32;
            let mut max_y = 0i32;
            let mut max_z = 0i32;
            for b in &blocks {
                max_x = max_x.max(b.x);
                max_y = max_y.max(b.y);
                max_z = max_z.max(b.z);
            }
            pieces.push(ChunkPiece {
                index,
                origin_x: origin_x as i32,
                origin_y: 0,
                origin_z: origin_z as i32,
                structure: Structure {
                    name: format!("p{index}"),
                    size: [
                        (max_x + 1).max(1) as u32,
                        (max_y + 1).max(1) as u32,
                        (max_z + 1).max(1) as u32,
                    ],
                    blocks,
                },
            });
            index += 1;
        }
    }
    pieces
}

/// How many column templates to place each tick on a low-spec client.
fn optimal_pieces_per_tick(pieces: &[ChunkPiece]) -> u32 {
    if pieces.is_empty() {
        return 1;
    }
    let total_blocks: usize = pieces.iter().map(|p| p.structure.blocks.len()).sum();
    let avg = total_blocks / pieces.len().max(1);
    let n = pieces.len();
    let ppt = if avg > 12_000 {
        1
    } else if avg > 4_000 {
        2
    } else if avg > 1_500 {
        4
    } else if n > 96 {
        6
    } else if n > 24 {
        8
    } else {
        // Small footprint — dump most columns quickly (near Instant).
        12
    };
    ppt.min(n as u32).max(1)
}

fn encode_animated(
    structure: &Structure,
    data_version: i32,
    id: &str,
    options: &DatapackEncodeOptions,
) -> Result<Vec<u8>> {
    let mut blocks = structure.blocks.clone();
    let seed = if options.random_seed == 0 {
        hash_name(id)
    } else {
        options.random_seed
    };
    sort_blocks(&mut blocks, options.pattern, seed);

    let chunk_size = options.blocks_per_tick as usize;
    let steps: Vec<&[PlacedBlock]> = blocks.chunks(chunk_size).collect();
    if steps.is_empty() {
        bail!("nothing to export — convert a build with at least one block first");
    }
    let step_count = steps.len();
    let delay = options.delay_ticks;
    let pattern_label = options.pattern.label();

    let (pack_format, function_dir, _, tags_function_dir) = datapack_layout(data_version);
    let function_cmd = format!("function structurelab:{id}");
    let stop_cmd = format!("function structurelab:{id}/stop");
    let tag = format!("structurelab.build.{id}");

    let pack_mcmeta = pack_mcmeta(pack_format, &function_cmd);
    let readme = format!(
        "StructureLab place datapack (animated)\n\
\n\
Name: {id}\n\
Mode: {pattern_label}\n\
Blocks per step: {}\n\
Delay ticks between steps: {delay}\n\
Steps: {step_count}\n\
\n\
Setup:\n\
  1. Extract this zip into your world's datapacks folder so you have:\n\
       <world>/datapacks/<any_folder>/pack.mcmeta\n\
  2. In-game: /reload\n\
  3. Stand at the build corner (feet = origin) OR put a command block there\n\
  4. Start:\n\
       /{function_cmd}\n\
  5. Stop early (optional):\n\
       /{stop_cmd}\n\
\n\
Uses a marker entity + tick function to place blocks over time.\n\
Cheats / permission level 2 required.\n\
",
        options.blocks_per_tick
    );

    // Root entry → start
    let root_fn = format!(
        "\
# StructureLab animated place ({id})
# Pattern: {pattern_label}
function structurelab:{id}/start
"
    );

    let start_fn = format!(
        "\
# Cancel any previous run of this build, then start at the caller's position.
kill @e[type=marker,tag={tag}]
scoreboard objectives add structurelab.step dummy
scoreboard objectives add structurelab.wait dummy
summon marker ~ ~ ~ {{Tags:[\"structurelab.build\",\"{tag}\"]}}
scoreboard players set @e[type=marker,tag={tag},limit=1,sort=nearest] structurelab.step 0
scoreboard players set @e[type=marker,tag={tag},limit=1,sort=nearest] structurelab.wait 0
"
    );

    let stop_fn = format!(
        "\
# Stop this build's animation.
kill @e[type=marker,tag={tag}]
"
    );

    let finish_fn = format!(
        "\
# Animation complete.
kill @s
"
    );

    // Per-marker tick: wait → dispatch → increment → finish
    let mut tick_fn = String::new();
    tick_fn.push_str(&format!(
        "\
# Per-marker tick for {id}
execute if score @s structurelab.wait matches 1.. run scoreboard players remove @s structurelab.wait 1
execute if score @s structurelab.wait matches 1.. run return fail
function structurelab:{id}/dispatch
scoreboard players add @s structurelab.step 1
"
    ));
    if delay > 0 {
        tick_fn.push_str(&format!(
            "scoreboard players set @s structurelab.wait {delay}\n"
        ));
    }
    tick_fn.push_str(&format!(
        "execute if score @s structurelab.step matches {step_count}.. run function structurelab:{id}/finish\n"
    ));

    let tick_all_fn = format!(
        "\
# Drive all active markers for this pack.
execute as @e[type=marker,tag={tag}] at @s run function structurelab:{id}/tick
"
    );

    let mut dispatch_fn = String::from("# Dispatch current step\n");
    for (i, _) in steps.iter().enumerate() {
        dispatch_fn.push_str(&format!(
            "execute if score @s structurelab.step matches {i} run function structurelab:{id}/step_{i}\n"
        ));
    }

    let tick_tag = "{\n  \"values\": [\n    \"structurelab:{id}/tick_all\"\n  ]\n}\n"
        .replace("{id}", id);

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        write_bytes(&mut zip, "pack.mcmeta", pack_mcmeta.as_bytes(), opts)?;
        write_bytes(&mut zip, "README.txt", readme.as_bytes(), opts)?;
        write_bytes(
            &mut zip,
            &format!("data/minecraft/tags/{tags_function_dir}/tick.json"),
            tick_tag.as_bytes(),
            opts,
        )?;

        let base = format!("data/structurelab/{function_dir}");
        write_bytes(
            &mut zip,
            &format!("{base}/{id}.mcfunction"),
            root_fn.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("{base}/{id}/start.mcfunction"),
            start_fn.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("{base}/{id}/stop.mcfunction"),
            stop_fn.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("{base}/{id}/finish.mcfunction"),
            finish_fn.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("{base}/{id}/tick.mcfunction"),
            tick_fn.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("{base}/{id}/tick_all.mcfunction"),
            tick_all_fn.as_bytes(),
            opts,
        )?;
        write_bytes(
            &mut zip,
            &format!("{base}/{id}/dispatch.mcfunction"),
            dispatch_fn.as_bytes(),
            opts,
        )?;

        for (i, chunk) in steps.iter().enumerate() {
            let body = encode_step_function(chunk);
            write_bytes(
                &mut zip,
                &format!("{base}/{id}/step_{i}.mcfunction"),
                body.as_bytes(),
                opts,
            )?;
        }

        zip.finish()?;
    }
    Ok(cursor.into_inner())
}

fn encode_step_function(blocks: &[PlacedBlock]) -> String {
    let mut out = String::with_capacity(blocks.len() * 48);
    out.push_str("# Place batch\n");
    for block in blocks {
        let state = block.state.canonical_name();
        out.push_str(&format!(
            "setblock ~{} ~{} ~{} {state} replace\n",
            block.x, block.y, block.z
        ));
    }
    out
}

fn sort_blocks(blocks: &mut [PlacedBlock], pattern: DatapackPattern, seed: u64) {
    match pattern {
        DatapackPattern::Instant => {}
        // FAWE groups edits by chunk so lighting/packets stay chunk-scoped.
        // Mirror that order: finish one 16×16 column before spreading out.
        DatapackPattern::Optimal => {
            blocks.sort_by(|a, b| {
                let ca = (a.x.div_euclid(16), a.z.div_euclid(16));
                let cb = (b.x.div_euclid(16), b.z.div_euclid(16));
                ca.cmp(&cb)
                    .then_with(|| a.y.cmp(&b.y))
                    .then_with(|| a.x.cmp(&b.x))
                    .then_with(|| a.z.cmp(&b.z))
            });
        }
        DatapackPattern::LayerYAsc => {
            blocks.sort_by(|a, b| (a.y, a.x, a.z).cmp(&(b.y, b.x, b.z)));
        }
        DatapackPattern::LayerYDesc => {
            blocks.sort_by(|a, b| (b.y, a.x, a.z).cmp(&(a.y, b.x, b.z)));
        }
        DatapackPattern::AxisZAsc => {
            // North (−Z) → south (+Z)
            blocks.sort_by(|a, b| (a.z, a.y, a.x).cmp(&(b.z, b.y, b.x)));
        }
        DatapackPattern::AxisXDesc => {
            // East (+X) → west (−X)
            blocks.sort_by(|a, b| (b.x, a.y, a.z).cmp(&(a.x, b.y, b.z)));
        }
        DatapackPattern::RadialOut => {
            let (cx, cy, cz) = occupied_center(blocks);
            blocks.sort_by(|a, b| {
                radial_key(a, cx, cy, cz)
                    .cmp(&radial_key(b, cx, cy, cz))
                    .then_with(|| (a.y, a.x, a.z).cmp(&(b.y, b.x, b.z)))
            });
        }
        DatapackPattern::RadialIn => {
            let (cx, cy, cz) = occupied_center(blocks);
            blocks.sort_by(|a, b| {
                radial_key(b, cx, cy, cz)
                    .cmp(&radial_key(a, cx, cy, cz))
                    .then_with(|| (a.y, a.x, a.z).cmp(&(b.y, b.x, b.z)))
            });
        }
        DatapackPattern::SphereOut => {
            let (cx, cy, cz) = occupied_center(blocks);
            blocks.sort_by(|a, b| {
                sphere_key(a, cx, cy, cz)
                    .total_cmp(&sphere_key(b, cx, cy, cz))
                    .then_with(|| (a.y, a.x, a.z).cmp(&(b.y, b.x, b.z)))
            });
        }
        DatapackPattern::SphereIn => {
            let (cx, cy, cz) = occupied_center(blocks);
            blocks.sort_by(|a, b| {
                sphere_key(b, cx, cy, cz)
                    .total_cmp(&sphere_key(a, cx, cy, cz))
                    .then_with(|| (a.y, a.x, a.z).cmp(&(b.y, b.x, b.z)))
            });
        }
        DatapackPattern::SpiralOut => {
            let (cx, _cy, cz) = occupied_center(blocks);
            blocks.sort_by(|a, b| {
                spiral_key(a, cx, cz)
                    .partial_cmp(&spiral_key(b, cx, cz))
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| (a.y, a.x, a.z).cmp(&(b.y, b.x, b.z)))
            });
        }
        DatapackPattern::SpiralIn => {
            let (cx, _cy, cz) = occupied_center(blocks);
            blocks.sort_by(|a, b| {
                spiral_key(b, cx, cz)
                    .partial_cmp(&spiral_key(a, cx, cz))
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| (a.y, a.x, a.z).cmp(&(b.y, b.x, b.z)))
            });
        }
        DatapackPattern::LayerSpiral => {
            let (cx, _cy, cz) = occupied_center(blocks);
            blocks.sort_by(|a, b| {
                a.y.cmp(&b.y).then_with(|| {
                    spiral_key(a, cx, cz)
                        .partial_cmp(&spiral_key(b, cx, cz))
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then_with(|| (a.x, a.z).cmp(&(b.x, b.z)))
                })
            });
        }
        DatapackPattern::Diagonal => {
            blocks.sort_by(|a, b| {
                (a.x + a.y + a.z)
                    .cmp(&(b.x + b.y + b.z))
                    .then_with(|| (a.y, a.x, a.z).cmp(&(b.y, b.x, b.z)))
            });
        }
        DatapackPattern::Checker => {
            let (cx, cy, cz) = occupied_center(blocks);
            blocks.sort_by(|a, b| {
                let pa = (a.x + a.y + a.z).rem_euclid(2);
                let pb = (b.x + b.y + b.z).rem_euclid(2);
                pa.cmp(&pb).then_with(|| {
                    radial_key(a, cx, cy, cz)
                        .cmp(&radial_key(b, cx, cy, cz))
                        .then_with(|| (a.y, a.x, a.z).cmp(&(b.y, b.x, b.z)))
                })
            });
        }
        DatapackPattern::GoldenSpiral => {
            let (cx, _cy, cz) = occupied_center(blocks);
            blocks.sort_by(|a, b| {
                golden_key(a, cx, cz)
                    .partial_cmp(&golden_key(b, cx, cz))
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| (a.y, a.x, a.z).cmp(&(b.y, b.x, b.z)))
            });
        }
        DatapackPattern::Random => {
            seeded_shuffle(blocks, seed);
        }
    }
}

fn occupied_center(blocks: &[PlacedBlock]) -> (f64, f64, f64) {
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut min_z = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    let mut max_z = i32::MIN;
    for b in blocks {
        min_x = min_x.min(b.x);
        min_y = min_y.min(b.y);
        min_z = min_z.min(b.z);
        max_x = max_x.max(b.x);
        max_y = max_y.max(b.y);
        max_z = max_z.max(b.z);
    }
    (
        (min_x + max_x) as f64 * 0.5,
        (min_y + max_y) as f64 * 0.5,
        (min_z + max_z) as f64 * 0.5,
    )
}

fn radial_key(b: &PlacedBlock, cx: f64, cy: f64, cz: f64) -> i64 {
    let dx = (b.x as f64 - cx).abs();
    let dy = (b.y as f64 - cy).abs();
    let dz = (b.z as f64 - cz).abs();
    (dx + dy + dz).round() as i64
}

fn sphere_key(b: &PlacedBlock, cx: f64, cy: f64, cz: f64) -> f64 {
    let dx = b.x as f64 - cx;
    let dy = b.y as f64 - cy;
    let dz = b.z as f64 - cz;
    dx * dx + dy * dy + dz * dz
}

/// Chebyshev ring on XZ + polar angle, then Y — classic square spiral feel.
fn spiral_key(b: &PlacedBlock, cx: f64, cz: f64) -> (i32, f64, i32) {
    let dx = b.x as f64 - cx;
    let dz = b.z as f64 - cz;
    let ring = dx.abs().max(dz.abs()).round() as i32;
    let angle = dz.atan2(dx);
    (ring, angle, b.y)
}

/// Phyllotaxis-style: sort by radius, then golden-angle phase.
fn golden_key(b: &PlacedBlock, cx: f64, cz: f64) -> (i32, f64, i32) {
    const GOLDEN: f64 = 2.399_963_229_728_653; // ≈ π(3−√5)
    let dx = b.x as f64 - cx;
    let dz = b.z as f64 - cz;
    let radius = (dx * dx + dz * dz).sqrt();
    let ring = radius.round() as i32;
    let angle = dz.atan2(dx);
    let phase = (angle - GOLDEN * radius).rem_euclid(std::f64::consts::TAU);
    (ring, phase, b.y)
}

fn seeded_shuffle(blocks: &mut [PlacedBlock], seed: u64) {
    if blocks.len() <= 1 {
        return;
    }
    let mut state = seed | 1;
    for i in (1..blocks.len()).rev() {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1);
        let j = (state >> 33) as usize % (i + 1);
        blocks.swap(i, j);
    }
}

fn hash_name(name: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in name.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn pack_mcmeta(pack_format: i32, function_cmd: &str) -> String {
    format!(
        "{{\n  \"pack\": {{\n    \"pack_format\": {pack_format},\n    \"description\": \"StructureLab — /{function_cmd}\"\n  }}\n}}\n"
    )
}

fn write_bytes<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    path: &str,
    bytes: &[u8],
    opts: SimpleFileOptions,
) -> Result<()> {
    zip.start_file(path, opts)?;
    zip.write_all(bytes)?;
    Ok(())
}

/// Minecraft resource path: lowercase `[a-z0-9_-]`, 1–64 chars.
pub fn sanitize_datapack_name(raw: &str) -> Result<String> {
    let mut out = String::new();
    for ch in raw.trim().chars() {
        let mapped = match ch {
            'A'..='Z' => ch.to_ascii_lowercase(),
            'a'..='z' | '0'..='9' | '_' | '-' => ch,
            ' ' | '\t' | '.' | '/' | '\\' => '_',
            _ => '_',
        };
        if out.ends_with('_') && mapped == '_' {
            continue;
        }
        out.push(mapped);
        if out.len() >= 64 {
            break;
        }
    }
    let out = out.trim_matches('_').to_string();
    if out.is_empty() {
        bail!("datapack name is empty — use letters, numbers, _ or -");
    }
    if !out
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    {
        bail!("datapack name must start with a letter or number");
    }
    Ok(out)
}

fn normalize_structure(structure: &Structure) -> Structure {
    let origin = structure_origin(&structure.blocks);
    let blocks: Vec<PlacedBlock> = structure
        .blocks
        .iter()
        .map(|b| PlacedBlock {
            x: b.x - origin.x,
            y: b.y - origin.y,
            z: b.z - origin.z,
            state: b.state.clone(),
        })
        .collect();
    let mut max_x = 0i32;
    let mut max_y = 0i32;
    let mut max_z = 0i32;
    for b in &blocks {
        max_x = max_x.max(b.x);
        max_y = max_y.max(b.y);
        max_z = max_z.max(b.z);
    }
    Structure {
        name: structure.name.clone(),
        size: [
            (max_x + 1).max(0) as u32,
            (max_y + 1).max(0) as u32,
            (max_z + 1).max(0) as u32,
        ],
        blocks,
    }
}

fn structure_origin(blocks: &[PlacedBlock]) -> Pos {
    let mut min = Pos {
        x: i32::MAX,
        y: i32::MAX,
        z: i32::MAX,
    };
    for b in blocks {
        min.x = min.x.min(b.x);
        min.y = min.y.min(b.y);
        min.z = min.z.min(b.z);
    }
    min
}

/// 1.21+ uses singular `function/` + `structure/` (+ `tags/function`); 1.20.x uses plurals.
fn datapack_layout(data_version: i32) -> (i32, &'static str, &'static str, &'static str) {
    // DataVersion 3955 = 1.21
    if data_version >= 3955 {
        (48, "function", "structure", "function")
    } else {
        (26, "functions", "structures", "functions")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BlockState, PlacedBlock, Structure};
    use std::collections::HashSet;
    use std::io::Read;
    use zip::ZipArchive;

    fn stone() -> BlockState {
        BlockState::simple("minecraft:stone")
    }

    fn dirt() -> BlockState {
        BlockState::simple("minecraft:dirt")
    }

    fn structure(blocks: Vec<PlacedBlock>) -> Structure {
        Structure {
            name: "test".into(),
            size: [8, 8, 8],
            blocks,
        }
    }

    fn sample_blocks() -> Vec<PlacedBlock> {
        vec![
            PlacedBlock {
                x: 0,
                y: 2,
                z: 0,
                state: stone(),
            },
            PlacedBlock {
                x: 0,
                y: 0,
                z: 0,
                state: dirt(),
            },
            PlacedBlock {
                x: 1,
                y: 1,
                z: 0,
                state: stone(),
            },
            PlacedBlock {
                x: 0,
                y: 1,
                z: 1,
                state: dirt(),
            },
        ]
    }

    fn zip_names(bytes: &[u8]) -> HashSet<String> {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut names = HashSet::new();
        for i in 0..archive.len() {
            let file = archive.by_index(i).unwrap();
            names.insert(file.name().to_string());
        }
        names
    }

    fn zip_file(bytes: &[u8], path: &str) -> String {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut file = archive.by_name(path).unwrap();
        let mut out = String::new();
        file.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn datapack_zip_contains_function() {
        let bytes = encode_datapack(
            &structure(sample_blocks()),
            3955,
            "My Statue",
            DatapackEncodeOptions::default(),
        )
        .unwrap();
        assert!(bytes.len() > 40);
        assert_eq!(&bytes[0..2], b"PK");
        let names = zip_names(&bytes);
        assert!(names.contains("data/structurelab/function/my_statue.mcfunction"));
        assert!(names.contains("data/structurelab/structure/my_statue.nbt"));
        let root = zip_file(&bytes, "data/structurelab/function/my_statue.mcfunction");
        assert!(root.contains("place template structurelab:my_statue"));
    }

    #[test]
    fn animated_zip_has_steps_no_nbt() {
        let options = DatapackEncodeOptions {
            pattern: DatapackPattern::LayerYAsc,
            blocks_per_tick: 2,
            delay_ticks: 1,
            random_seed: 0,
        };
        let bytes =
            encode_datapack(&structure(sample_blocks()), 3955, "build", options).unwrap();
        let names = zip_names(&bytes);
        assert!(names.contains("data/structurelab/function/build.mcfunction"));
        assert!(names.contains("data/structurelab/function/build/start.mcfunction"));
        assert!(names.contains("data/structurelab/function/build/tick.mcfunction"));
        assert!(names.contains("data/structurelab/function/build/step_0.mcfunction"));
        assert!(names.contains("data/structurelab/function/build/step_1.mcfunction"));
        assert!(names.contains("data/minecraft/tags/function/tick.json"));
        assert!(!names.iter().any(|n| n.ends_with(".nbt")));

        let step0 = zip_file(&bytes, "data/structurelab/function/build/step_0.mcfunction");
        // Bottom-to-top: y=0 first
        assert!(step0.contains("setblock ~0 ~0 ~0 minecraft:dirt"));
        let root = zip_file(&bytes, "data/structurelab/function/build.mcfunction");
        assert!(root.contains("function structurelab:build/start"));
        assert!(!root.contains("place template"));
    }

    #[test]
    fn optimal_zip_uses_chunked_place_templates() {
        let mut blocks = Vec::new();
        for x in [0, 17] {
            for z in [0, 17] {
                blocks.push(PlacedBlock {
                    x,
                    y: 0,
                    z,
                    state: stone(),
                });
            }
        }
        let options = DatapackEncodeOptions {
            pattern: DatapackPattern::Optimal,
            blocks_per_tick: 16,
            delay_ticks: 0,
            random_seed: 0,
        };
        let bytes =
            encode_datapack(&structure(blocks), 3955, "fast", options).unwrap();
        let names = zip_names(&bytes);
        assert!(names.contains("data/structurelab/structure/fast/p0.nbt"));
        assert!(names.iter().any(|n| n.contains("/fast/p") && n.ends_with(".nbt")));
        assert!(names.contains("data/structurelab/function/fast/step_0.mcfunction"));
        let step0 = zip_file(&bytes, "data/structurelab/function/fast/step_0.mcfunction");
        assert!(
            step0.contains("place template structurelab:fast/p"),
            "optimal steps must place templates, got:\n{step0}"
        );
        assert!(!step0.contains("setblock"));
    }

    #[test]
    fn spiral_out_starts_near_centre() {
        let mut blocks = vec![
            PlacedBlock {
                x: 0,
                y: 0,
                z: 0,
                state: dirt(),
            },
            PlacedBlock {
                x: 2,
                y: 0,
                z: 2,
                state: stone(),
            },
            PlacedBlock {
                x: 1,
                y: 0,
                z: 1,
                state: stone(),
            },
            PlacedBlock {
                x: 3,
                y: 0,
                z: 0,
                state: dirt(),
            },
        ];
        sort_blocks(&mut blocks, DatapackPattern::SpiralOut, 0);
        let (cx, _, cz) = occupied_center(&blocks);
        let first_ring = spiral_key(&blocks[0], cx, cz).0;
        let last_ring = spiral_key(blocks.last().unwrap(), cx, cz).0;
        assert!(first_ring <= last_ring);
        assert_eq!(first_ring, 1);
    }

    #[test]
    fn radial_out_orders_by_manhattan() {
        let mut blocks = sample_blocks();
        sort_blocks(&mut blocks, DatapackPattern::RadialOut, 0);
        let (cx, cy, cz) = occupied_center(&blocks);
        let mut last = -1i64;
        for b in &blocks {
            let d = radial_key(b, cx, cy, cz);
            assert!(d >= last);
            last = d;
        }
    }

    #[test]
    fn optimal_groups_by_chunk_then_y() {
        let mut blocks = vec![
            PlacedBlock {
                x: 17,
                y: 0,
                z: 1,
                state: dirt(),
            },
            PlacedBlock {
                x: 1,
                y: 2,
                z: 1,
                state: stone(),
            },
            PlacedBlock {
                x: 1,
                y: 0,
                z: 1,
                state: stone(),
            },
            PlacedBlock {
                x: 17,
                y: 1,
                z: 1,
                state: dirt(),
            },
        ];
        sort_blocks(&mut blocks, DatapackPattern::Optimal, 0);
        // Chunk (0,0) before (1,0); within chunk, lower Y first.
        assert_eq!((blocks[0].x, blocks[0].y), (1, 0));
        assert_eq!((blocks[1].x, blocks[1].y), (1, 2));
        assert_eq!((blocks[2].x, blocks[2].y), (17, 0));
        assert_eq!((blocks[3].x, blocks[3].y), (17, 1));
    }

    #[test]
    fn layer_y_asc_orders_by_height() {
        let mut blocks = sample_blocks();
        sort_blocks(&mut blocks, DatapackPattern::LayerYAsc, 0);
        let ys: Vec<i32> = blocks.iter().map(|b| b.y).collect();
        assert_eq!(ys, vec![0, 1, 1, 2]);
    }

    #[test]
    fn random_is_deterministic_for_seed() {
        let mut a = sample_blocks();
        let mut b = sample_blocks();
        sort_blocks(&mut a, DatapackPattern::Random, 42);
        sort_blocks(&mut b, DatapackPattern::Random, 42);
        assert_eq!(a, b);
        let mut c = sample_blocks();
        sort_blocks(&mut c, DatapackPattern::Random, 99);
        assert_ne!(a, c);
    }

    #[test]
    fn sanitize_datapack_name_basics() {
        assert_eq!(sanitize_datapack_name("My Statue!").unwrap(), "my_statue");
        assert_eq!(sanitize_datapack_name("  build  ").unwrap(), "build");
        assert!(sanitize_datapack_name("???").is_err());
    }

    #[test]
    fn empty_structure_errors() {
        let result = encode_datapack(
            &structure(vec![]),
            3955,
            "build",
            DatapackEncodeOptions::default(),
        );
        assert!(result.is_err());
    }
}
