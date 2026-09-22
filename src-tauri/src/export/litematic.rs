use super::gzip;
use crate::model::{BlockState, Structure};
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

pub fn encode(structure: &Structure, version: i32, data_version: i32) -> Result<Vec<u8>> {
    ensure!(
        version == 6 || version == 7,
        "supported Litematica profiles are v6 and v7"
    );
    let [width, height, length] = structure.size;
    let volume = width as usize * height as usize * length as usize;
    ensure!(
        volume <= i32::MAX as usize,
        "structure is too large for Litematica metadata"
    );

    let air = BlockState::simple("minecraft:air");
    let mut palette = vec![air.clone()];
    let mut ids = HashMap::from([(air, 0_u32)]);
    let mut values = vec![0_u32; volume];
    for block in &structure.blocks {
        let next_id = palette.len() as u32;
        let id = *ids.entry(block.state.clone()).or_insert_with(|| {
            palette.push(block.state.clone());
            next_id
        });
        let index = block.x as usize
            + block.z as usize * width as usize
            + block.y as usize * width as usize * length as usize;
        values[index] = id;
    }
    let bits = (32 - (palette.len().saturating_sub(1) as u32).leading_zeros()).max(2) as usize;
    let packed = pack_tight(&values, bits);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let vector = || Vector {
        x: width as i32,
        y: height as i32,
        z: length as i32,
    };
    let region = Region {
        position: Vector { x: 0, y: 0, z: 0 },
        size: vector(),
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
    };
    let root = Root {
        version,
        sub_version: 1,
        minecraft_data_version: data_version,
        metadata: Metadata {
            name: structure.name.clone(),
            author: "StructureLab".into(),
            description: "Generated with StructureLab".into(),
            region_count: 1,
            time_created: now,
            time_modified: now,
            total_blocks: structure.blocks.len() as i32,
            total_volume: volume as i32,
            enclosing_size: vector(),
        },
        regions: BTreeMap::from([("Mapart".into(), region)]),
    };
    gzip(&fastnbt::to_bytes(&root)?)
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
