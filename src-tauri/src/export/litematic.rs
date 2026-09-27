use super::gzip;
use crate::model::{BlockState, BuildResult, MapTile, PlacedBlock, Structure, MAP_EDGE};
use anyhow::{ensure, Result};
use fastnbt::LongArray;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

#[derive(Serialize)]
struct Root {
    #[serde(rename = "Version")]
    version: i32,
    #[serde(rename = "SubVersion")]
    sub_version: i32,
    #[serde(rename = "MinecraftDataVersion")]
    minecraft_data_version: i32,
    #[serde(rename = "Metadata")]
    metadata: Metadata,
    #[serde(rename = "Regions")]
    regions: BTreeMap<String, Region>,
}

#[derive(Serialize)]
struct Metadata {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Author")]
    author: String,
    #[serde(rename = "Description")]
    description: String,
    #[serde(rename = "RegionCount")]
    region_count: i32,
    #[serde(rename = "TimeCreated")]
    time_created: i64,
    #[serde(rename = "TimeModified")]
    time_modified: i64,
    #[serde(rename = "TotalBlocks")]
    total_blocks: i32,
    #[serde(rename = "TotalVolume")]
    total_volume: i32,
    #[serde(rename = "EnclosingSize")]
    enclosing_size: Vector,
}

#[derive(Serialize)]
struct Vector {
    x: i32,
    y: i32,
    z: i32,
}

#[derive(Serialize)]
struct Region {
    #[serde(rename = "Position")]
    position: Vector,
    #[serde(rename = "Size")]
    size: Vector,
    #[serde(rename = "BlockStatePalette")]
    block_state_palette: Vec<PaletteEntry>,
    #[serde(rename = "BlockStates")]
    block_states: LongArray,
    #[serde(rename = "TileEntities")]
    tile_entities: Vec<BTreeMap<String, String>>,
    #[serde(rename = "Entities")]
    entities: Vec<BTreeMap<String, String>>,
    #[serde(rename = "PendingBlockTicks")]
    pending_block_ticks: Vec<BTreeMap<String, String>>,
    #[serde(rename = "PendingFluidTicks")]
    pending_fluid_ticks: Vec<BTreeMap<String, String>>,
}

#[derive(Serialize)]
struct PaletteEntry {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Properties", skip_serializing_if = "BTreeMap::is_empty")]
    properties: BTreeMap<String, String>,
}

/// Encode a single solid structure as one Litematica region (legacy behaviour).
pub fn encode(structure: &Structure, version: i32, data_version: i32) -> Result<Vec<u8>> {
    ensure!(
        !structure_volume_too_large(structure.size),
        "structure is too large for a single Litematica region"
    );
    encode_regions(
        &structure.name,
        saturate_i32(structure.blocks.len()),
        structure.size,
        vec![("Mapart".into(), structure.blocks.as_slice())],
        version,
        data_version,
    )
}

/// Encode a build. When `split_map_regions` is set and there is more than one map
/// tile, each 128×128 map becomes its own named `Regions` entry. Otherwise the
/// whole build is one region (legacy). Oversized single-region exports fail with
/// a clear error — enable the per-map toggle to export huge multi-map mosaics.
pub fn encode_build(
    build: &BuildResult,
    version: i32,
    data_version: i32,
    split_map_regions: bool,
) -> Result<Vec<u8>> {
    if split_map_regions && should_split_map_regions(build) {
        let groups = split_blocks_by_map_tile(build);
        ensure!(
            !groups.is_empty(),
            "no map tiles produced blocks for Litematica regions"
        );
        return encode_owned_regions(
            &build.structure.name,
            saturate_i32(build.structure.blocks.len()),
            build.structure.size,
            groups,
            version,
            data_version,
        );
    }
    if structure_volume_too_large(build.structure.size) {
        if should_split_map_regions(build) {
            anyhow::bail!(
                "structure is too large for a single Litematica region — enable Split maps into Litematica sub-regions to export"
            );
        }
        anyhow::bail!("structure is too large for a single Litematica region");
    }
    encode(&build.structure, version, data_version)
}

fn saturate_i32(value: usize) -> i32 {
    value.min(i32::MAX as usize) as i32
}

fn structure_volume_too_large(size: [u32; 3]) -> bool {
    let [width, height, length] = size;
    let volume = (width as u64)
        .saturating_mul(height as u64)
        .saturating_mul(length as u64);
    // Litematica stores region volume / TotalVolume as TAG_Int.
    volume > i32::MAX as u64
}

fn should_split_map_regions(build: &BuildResult) -> bool {
    build.maps_x > 1 || build.maps_y > 1
}

fn split_blocks_by_map_tile(build: &BuildResult) -> Vec<(String, Vec<PlacedBlock>)> {
    let tiles = if build.tiles.is_empty() {
        synthesize_tiles(build.maps_x, build.maps_y)
    } else {
        build.tiles.clone()
    };
    let northern_control = tiles.iter().any(|tile| tile.row == 0 && tile.start_z > 0);
    let southern_control = !northern_control
        && build.structure.size[2] == build.maps_y.saturating_mul(MAP_EDGE).saturating_add(1);
    let mut buckets: BTreeMap<(u32, u32), Vec<PlacedBlock>> = BTreeMap::new();
    let mut assigned = std::collections::HashSet::new();
    for block in &build.structure.blocks {
        let Some(tile) = tile_for_block(
            block,
            &tiles,
            northern_control,
            southern_control,
            build.maps_x,
            build.maps_y,
        ) else {
            continue;
        };
        assigned.insert((block.x, block.y, block.z));
        buckets
            .entry((tile.column, tile.row))
            .or_default()
            .push(block.clone());
    }
    if assigned.len() < build.structure.blocks.len() {
        let fallback = tiles
            .first()
            .map(|tile| (tile.column, tile.row))
            .unwrap_or((0, 0));
        for block in &build.structure.blocks {
            if !assigned.contains(&(block.x, block.y, block.z)) {
                buckets.entry(fallback).or_default().push(block.clone());
            }
        }
    }
    buckets
        .into_iter()
        .filter(|(_, blocks)| !blocks.is_empty())
        .map(|((column, row), blocks)| (format!("Map_C{column}_R{row}"), blocks))
        .collect()
}

fn synthesize_tiles(maps_x: u32, maps_y: u32) -> Vec<MapTile> {
    (0..maps_y)
        .flat_map(|row| {
            (0..maps_x).map(move |column| MapTile {
                column,
                row,
                start_x: column * MAP_EDGE,
                start_z: row * MAP_EDGE,
            })
        })
        .collect()
}

fn tile_for_block<'a>(
    block: &PlacedBlock,
    tiles: &'a [MapTile],
    northern_control: bool,
    southern_control: bool,
    maps_x: u32,
    maps_y: u32,
) -> Option<&'a MapTile> {
    let x = block.x.max(0) as u32;
    let z = block.z.max(0) as u32;
    for tile in tiles {
        let x0 = tile.start_x;
        let x1 = x0.saturating_add(MAP_EDGE);
        let z0 = if northern_control && tile.row == 0 {
            0
        } else {
            tile.start_z
        };
        let mut z1 = if northern_control && tile.row == 0 {
            tile.start_z.saturating_add(MAP_EDGE)
        } else {
            tile.start_z.saturating_add(MAP_EDGE)
        };
        if southern_control && tile.row + 1 == maps_y {
            z1 = z1.saturating_add(1);
        }
        if x >= x0 && x < x1 && z >= z0 && z < z1 {
            return Some(tile);
        }
    }
    let col = (x / MAP_EDGE).min(maps_x.saturating_sub(1));
    let row = if northern_control {
        if z == 0 {
            0
        } else {
            ((z - 1) / MAP_EDGE).min(maps_y.saturating_sub(1))
        }
    } else {
        (z / MAP_EDGE).min(maps_y.saturating_sub(1))
    };
    tiles
        .iter()
        .find(|tile| tile.column == col && tile.row == row)
}

fn encode_regions(
    name: &str,
    total_blocks: i32,
    enclosing: [u32; 3],
    regions_in: Vec<(String, &[PlacedBlock])>,
    version: i32,
    data_version: i32,
) -> Result<Vec<u8>> {
    let owned = regions_in
        .into_iter()
        .map(|(region_name, blocks)| (region_name, blocks.to_vec()))
        .collect::<Vec<_>>();
    encode_owned_regions(
        name,
        total_blocks,
        enclosing,
        owned,
        version,
        data_version,
    )
}

fn encode_owned_regions(
    name: &str,
    total_blocks: i32,
    enclosing: [u32; 3],
    regions_in: Vec<(String, Vec<PlacedBlock>)>,
    version: i32,
    data_version: i32,
) -> Result<Vec<u8>> {
    ensure!(
        version == 6 || version == 7,
        "supported Litematica profiles are v6 and v7"
    );
    let [width, height, length] = enclosing;
    ensure!(!regions_in.is_empty(), "Litematica needs at least one region");
    // EnclosingSize is three ints — each axis must fit; the product (TotalVolume)
    // is informational and is clamped when the mosaic is enormous.
    ensure!(
        width <= i32::MAX as u32 && height <= i32::MAX as u32 && length <= i32::MAX as u32,
        "structure axis exceeds Litematica EnclosingSize (int32)"
    );

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let mut regions = BTreeMap::new();
    let mut total_volume = 0_i32;
    for (region_name, blocks) in &regions_in {
        let (region, volume) = encode_one_region(blocks)?;
        total_volume = total_volume.saturating_add(volume);
        regions.insert(region_name.clone(), region);
    }

    let enclosing_volume = (width as u64)
        .saturating_mul(height as u64)
        .saturating_mul(length as u64);
    // Prefer summed region volumes; fall back to enclosing product when smaller
    // metadata is wanted. Always clamp to i32 — Litematica v5+ stores TAG_Int.
    let meta_volume = if enclosing_volume > 0 && enclosing_volume <= i32::MAX as u64 {
        (enclosing_volume as i32).max(total_volume)
    } else {
        total_volume
    };

    let description = if regions.len() > 1 {
        "Generated with StructureLab · one Litematica region per map tile".into()
    } else {
        "Generated with StructureLab".into()
    };

    let root = Root {
        version,
        sub_version: 1,
        minecraft_data_version: data_version,
        metadata: Metadata {
            name: name.to_string(),
            author: "StructureLab".into(),
            description,
            region_count: saturate_i32(regions.len()),
            time_created: now,
            time_modified: now,
            total_blocks,
            total_volume: meta_volume,
            enclosing_size: Vector {
                x: width as i32,
                y: height as i32,
                z: length as i32,
            },
        },
        regions,
    };
    gzip(&fastnbt::to_bytes(&root)?)
}

fn encode_one_region(blocks: &[PlacedBlock]) -> Result<(Region, i32)> {
    ensure!(!blocks.is_empty(), "region has no blocks");
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut min_z = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    let mut max_z = i32::MIN;
    for block in blocks {
        min_x = min_x.min(block.x);
        min_y = min_y.min(block.y);
        min_z = min_z.min(block.z);
        max_x = max_x.max(block.x);
        max_y = max_y.max(block.y);
        max_z = max_z.max(block.z);
    }
    let size_x = (max_x - min_x + 1) as usize;
    let size_y = (max_y - min_y + 1) as usize;
    let size_z = (max_z - min_z + 1) as usize;
    let volume = size_x * size_y * size_z;
    ensure!(
        volume <= i32::MAX as usize,
        "region is too large for Litematica"
    );

    let air = BlockState::simple("minecraft:air");
    let mut palette = vec![air.clone()];
    let mut ids = HashMap::from([(air, 0_u32)]);
    let mut values = vec![0_u32; volume];
    for block in blocks {
        let next_id = palette.len() as u32;
        let id = *ids.entry(block.state.clone()).or_insert_with(|| {
            palette.push(block.state.clone());
            next_id
        });
        let lx = (block.x - min_x) as usize;
        let ly = (block.y - min_y) as usize;
        let lz = (block.z - min_z) as usize;
        let index = lx + lz * size_x + ly * size_x * size_z;
        values[index] = id;
    }
    let bits = (32 - (palette.len().saturating_sub(1) as u32).leading_zeros()).max(2) as usize;
    let packed = pack_tight(&values, bits);
    Ok((
        Region {
            position: Vector {
                x: min_x,
                y: min_y,
                z: min_z,
            },
            size: Vector {
                x: size_x as i32,
                y: size_y as i32,
                z: size_z as i32,
            },
            block_state_palette: palette
                .into_iter()
                .map(|state| PaletteEntry {
                    name: state.name,
                    properties: state.properties,
                })
                .collect(),
            block_states: LongArray::new(packed),
            tile_entities: Vec::new(),
            entities: Vec::new(),
            pending_block_ticks: Vec::new(),
            pending_fluid_ticks: Vec::new(),
        },
        volume as i32,
    ))
}

fn pack_tight(values: &[u32], bits: usize) -> Vec<i64> {
    let mut output = vec![0_u64; (values.len() * bits).div_ceil(64)];
    let mask = if bits == 64 {
        u64::MAX
    } else {
        (1_u64 << bits) - 1
    };
    for (index, value) in values.iter().enumerate() {
        let bit_index = index * bits;
        let long_index = bit_index / 64;
        let offset = bit_index % 64;
        output[long_index] |= (*value as u64 & mask) << offset;
        if offset + bits > 64 {
            output[long_index + 1] |= (*value as u64 & mask) >> (64 - offset);
        }
    }
    output.into_iter().map(|value| value as i64).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{PlacedBlock, Structure};

    #[test]
    fn tight_packing_crosses_long_boundaries() {
        let values = (0..30).map(|value| value % 7).collect::<Vec<_>>();
        let packed = pack_tight(&values, 3);
        assert_eq!(packed.len(), 2);
        for (index, expected) in values.iter().enumerate() {
            let bit = index * 3;
            let long = bit / 64;
            let offset = bit % 64;
            let mut actual = (packed[long] as u64) >> offset;
            if offset + 3 > 64 {
                actual |= (packed[long + 1] as u64) << (64 - offset);
            }
            assert_eq!((actual & 7) as u32, *expected);
        }
    }

    #[test]
    fn both_compatibility_profiles_are_gzipped_nbt() {
        let structure = Structure {
            name: "asymmetric".into(),
            size: [2, 3, 5],
            blocks: vec![PlacedBlock {
                x: 1,
                y: 2,
                z: 4,
                state: BlockState::simple("minecraft:oak_stairs"),
            }],
        };
        for version in [6, 7] {
            let bytes = encode(&structure, version, 3839).unwrap();
            assert_eq!(&bytes[0..2], &[0x1f, 0x8b]);
        }
    }

    fn decode_root(bytes: &[u8]) -> std::collections::HashMap<String, fastnbt::Value> {
        use flate2::read::GzDecoder;
        use std::io::Read;

        let mut raw = Vec::new();
        GzDecoder::new(bytes).read_to_end(&mut raw).unwrap();
        let root: fastnbt::Value = fastnbt::from_bytes(&raw).unwrap();
        let fastnbt::Value::Compound(map) = root else {
            panic!("expected compound");
        };
        map
    }

    fn region_count(map: &std::collections::HashMap<String, fastnbt::Value>) -> i32 {
        let fastnbt::Value::Compound(meta) = map.get("Metadata").unwrap() else {
            panic!("metadata");
        };
        let fastnbt::Value::Int(count) = meta.get("RegionCount").unwrap() else {
            panic!("region count");
        };
        *count
    }

    #[test]
    fn oversized_single_region_off_fails_clearly() {
        let mut blocks = Vec::new();
        for z in [0_i32, 200, 400] {
            for x in [0_i32, 200, 400] {
                blocks.push(PlacedBlock {
                    x,
                    y: 0,
                    z,
                    state: BlockState::simple("minecraft:stone"),
                });
            }
        }
        let build = BuildResult {
            structure: Structure {
                name: "huge".into(),
                size: [8000, 200, 2000],
                blocks,
            },
            width: 8000,
            length: 2000,
            height: 200,
            min_y: 0,
            maps_x: 1,
            maps_y: 1,
            tiles: Vec::new(),
            materials: Vec::new(),
            warnings: Vec::new(),
            minecraft_version: "1.21".into(),
            data_version: 3953,
        };
        assert!(structure_volume_too_large(build.structure.size));
        let err = encode_build(&build, 7, 3953, false).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("too large for a single Litematica region"),
            "unexpected error: {msg}"
        );
        assert!(
            !msg.contains("Split maps"),
            "single-map error should not mention the multi-map toggle: {msg}"
        );
    }

    #[test]
    fn oversized_multi_map_off_fails_with_toggle_hint() {
        let build = BuildResult {
            structure: Structure {
                name: "huge-mosaic".into(),
                size: [8000, 200, 2000],
                blocks: vec![PlacedBlock {
                    x: 0,
                    y: 0,
                    z: 0,
                    state: BlockState::simple("minecraft:stone"),
                }],
            },
            width: 8000,
            length: 2000,
            height: 200,
            min_y: 0,
            maps_x: 2,
            maps_y: 2,
            tiles: synthesize_tiles(2, 2),
            materials: Vec::new(),
            warnings: Vec::new(),
            minecraft_version: "1.21".into(),
            data_version: 3953,
        };
        let err = encode_build(&build, 7, 3953, false).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("Split maps into Litematica sub-regions"),
            "unexpected error: {msg}"
        );
    }

    #[test]
    fn oversized_multi_map_on_exports_map_regions() {
        let mut blocks = Vec::new();
        for row in 0..2_i32 {
            for col in 0..2_i32 {
                blocks.push(PlacedBlock {
                    x: col * 128 + 10,
                    y: 0,
                    z: row * 128 + 10,
                    state: BlockState::simple("minecraft:stone"),
                });
            }
        }
        let build = BuildResult {
            structure: Structure {
                name: "huge-mosaic".into(),
                size: [8000, 200, 2000],
                blocks,
            },
            width: 8000,
            length: 2000,
            height: 200,
            min_y: 0,
            maps_x: 2,
            maps_y: 2,
            tiles: synthesize_tiles(2, 2),
            materials: Vec::new(),
            warnings: Vec::new(),
            minecraft_version: "1.21".into(),
            data_version: 3953,
        };
        assert!(structure_volume_too_large(build.structure.size));
        let map = decode_root(&encode_build(&build, 7, 3953, true).unwrap());
        assert_eq!(region_count(&map), 4);
        let fastnbt::Value::Compound(regions) = map.get("Regions").unwrap() else {
            panic!("regions");
        };
        assert!(regions.contains_key("Map_C0_R0"));
        assert!(regions.contains_key("Map_C1_R0"));
        assert!(regions.contains_key("Map_C0_R1"));
        assert!(regions.contains_key("Map_C1_R1"));
    }

    #[test]
    fn split_map_regions_writes_one_region_per_tile() {
        let mut blocks = Vec::new();
        for z in 0..256_i32 {
            for x in 0..256_i32 {
                blocks.push(PlacedBlock {
                    x,
                    y: 0,
                    z,
                    state: BlockState::simple("minecraft:white_concrete"),
                });
            }
        }
        let build = BuildResult {
            structure: Structure {
                name: "mosaic".into(),
                size: [256, 1, 256],
                blocks,
            },
            width: 256,
            length: 256,
            height: 1,
            min_y: 0,
            maps_x: 2,
            maps_y: 2,
            tiles: synthesize_tiles(2, 2),
            materials: Vec::new(),
            warnings: Vec::new(),
            minecraft_version: "1.21".into(),
            data_version: 3953,
        };
        let map = decode_root(&encode_build(&build, 7, 3953, true).unwrap());
        assert_eq!(region_count(&map), 4);
        let fastnbt::Value::Compound(regions) = map.get("Regions").unwrap() else {
            panic!("regions");
        };
        assert!(regions.contains_key("Map_C0_R0"));
        assert!(regions.contains_key("Map_C1_R0"));
        assert!(regions.contains_key("Map_C0_R1"));
        assert!(regions.contains_key("Map_C1_R1"));
    }

    #[test]
    fn map_subregion_toggle_off_is_single_mapart_region() {
        // 4×4 footprint under i32::MAX — Off must be exactly one "Mapart" region.
        let mut blocks = Vec::new();
        for row in 0..4_i32 {
            for col in 0..4_i32 {
                let z = if row == 0 {
                    0
                } else {
                    129 + (row - 1) * 128
                };
                blocks.push(PlacedBlock {
                    x: col * 128,
                    y: row * 30,
                    z,
                    state: BlockState::simple("minecraft:stone"),
                });
            }
        }
        let build = BuildResult {
            structure: Structure {
                name: "mid".into(),
                size: [512, 144, 513],
                blocks,
            },
            width: 512,
            length: 513,
            height: 144,
            min_y: 0,
            maps_x: 4,
            maps_y: 4,
            tiles: synthesize_tiles(4, 4),
            materials: Vec::new(),
            warnings: Vec::new(),
            minecraft_version: "1.21".into(),
            data_version: 3953,
        };
        assert!(!structure_volume_too_large(build.structure.size));

        let off = decode_root(&encode_build(&build, 7, 3953, false).unwrap());
        assert_eq!(region_count(&off), 1);
        let fastnbt::Value::Compound(off_regions) = off.get("Regions").unwrap() else {
            panic!("regions");
        };
        assert!(off_regions.contains_key("Mapart"));
        assert!(!off_regions.keys().any(|k| k.starts_with("Map_C")));

        let on = decode_root(&encode_build(&build, 7, 3953, true).unwrap());
        assert_eq!(region_count(&on), 16);
        let fastnbt::Value::Compound(on_regions) = on.get("Regions").unwrap() else {
            panic!("regions");
        };
        assert!(on_regions.contains_key("Map_C0_R0"));
        assert!(on_regions.contains_key("Map_C3_R3"));
        assert!(!on_regions.contains_key("Mapart"));
    }

    #[test]
    fn litematic_exports_registered_data_versions() {
        use crate::versions::registered_versions;
        use flate2::read::GzDecoder;
        use serde::Deserialize;
        use std::io::Read;

        #[derive(Deserialize)]
        struct Root {
            #[serde(rename = "Version")]
            version: i32,
            #[serde(rename = "MinecraftDataVersion")]
            minecraft_data_version: i32,
        }

        let structure = Structure {
            name: "dv".into(),
            size: [1, 1, 1],
            blocks: vec![PlacedBlock {
                x: 0,
                y: 0,
                z: 0,
                state: BlockState::simple("minecraft:stone"),
            }],
        };
        for def in registered_versions() {
            let schematic = crate::versions::litematic_schematic_version(def.data_version);
            let bytes = encode(&structure, schematic, def.data_version).unwrap();
            let mut raw = Vec::new();
            GzDecoder::new(bytes.as_slice())
                .read_to_end(&mut raw)
                .unwrap();
            let root: Root = fastnbt::from_bytes(&raw).unwrap();
            assert_eq!(
                root.version, schematic,
                "litematic Version mismatch for {}",
                def.id
            );
            assert_eq!(
                root.minecraft_data_version, def.data_version,
                "litematic MinecraftDataVersion mismatch for {}",
                def.id
            );
        }
    }
}
