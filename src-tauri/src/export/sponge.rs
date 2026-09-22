use super::gzip;
use crate::model::{BlockState, Structure};
use anyhow::{ensure, Result};
use fastnbt::{ByteArray, IntArray};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

#[derive(Serialize)]
struct Root {
    #[serde(rename = "Schematic")]
    schematic: Schematic,
}

#[derive(Serialize)]
struct Schematic {
    #[serde(rename = "Version")]
    version: i32,
    #[serde(rename = "DataVersion")]
    data_version: i32,
    #[serde(rename = "Width")]
    width: i16,
    #[serde(rename = "Height")]
    height: i16,
    #[serde(rename = "Length")]
    length: i16,
    #[serde(rename = "Offset")]
    offset: IntArray,
    #[serde(rename = "Metadata")]
    metadata: Metadata,
    #[serde(rename = "Blocks")]
    blocks: Blocks,
}

#[derive(Serialize)]
struct Metadata {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Author")]
    author: String,
}

#[derive(Serialize)]
struct Blocks {
    #[serde(rename = "Palette")]
    palette: BTreeMap<String, i32>,
    #[serde(rename = "Data")]
    data: ByteArray,
    #[serde(rename = "BlockEntities")]
    block_entities: Vec<BTreeMap<String, String>>,
}

pub fn encode(structure: &Structure, data_version: i32) -> Result<Vec<u8>> {
    let [width, height, length] = structure.size;
    ensure!(
        width > 0
            && height > 0
            && length > 0
            && width <= 65_535
            && height <= 65_535
            && length <= 65_535,
        "Sponge dimensions must be within 1..=65535"
    );
    let volume = width as usize * height as usize * length as usize;
    let air = BlockState::simple("minecraft:air");
    let mut states = vec![air.clone()];
    let mut ids = HashMap::from([(air, 0_u32)]);
    let mut dense = vec![0_u32; volume];
    for block in &structure.blocks {
        let next = states.len() as u32;
        let id = *ids.entry(block.state.clone()).or_insert_with(|| {
            states.push(block.state.clone());
            next
        });
        let index = block.x as usize
            + block.z as usize * width as usize
            + block.y as usize * width as usize * length as usize;
        dense[index] = id;
    }
    let palette = states
        .into_iter()
        .enumerate()
        .map(|(id, state)| (state.canonical_name(), id as i32))
        .collect();
    let mut varints = Vec::<i8>::with_capacity(dense.len());
    for value in dense {
        write_varint(value, &mut varints);
    }
    let root = Root {
        schematic: Schematic {
            version: 3,
            data_version,
            width: width as u16 as i16,
            height: height as u16 as i16,
            length: length as u16 as i16,
            offset: IntArray::new(vec![0, 0, 0]),
            metadata: Metadata {
                name: structure.name.clone(),
                author: "StructureLab".into(),
            },
            blocks: Blocks {
                palette,
                data: ByteArray::new(varints),
                block_entities: Vec::new(),
            },
        },
    };
    gzip(&fastnbt::to_bytes(&root)?)
}

fn write_varint(mut value: u32, output: &mut Vec<i8>) {
    loop {
        if value & !0x7f == 0 {
            output.push(value as u8 as i8);
            return;
        }
        output.push(((value & 0x7f) | 0x80) as u8 as i8);
        value >>= 7;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{PlacedBlock, Structure};

    #[test]
    fn sponge_varints_are_independent_values() {
        let mut bytes = Vec::new();
        write_varint(1, &mut bytes);
        write_varint(128, &mut bytes);
        assert_eq!(bytes, vec![1, -128, 1]);
    }

    #[test]
    fn asymmetric_sponge_fixture_serializes() {
        let bytes = encode(
            &Structure {
                name: "asymmetric".into(),
                size: [2, 3, 5],
                blocks: vec![PlacedBlock {
                    x: 1,
                    y: 2,
                    z: 4,
                    state: BlockState::simple("minecraft:stone"),
                }],
            },
            3839,
        )
        .unwrap();
        assert_eq!(&bytes[0..2], &[0x1f, 0x8b]);
    }

    #[test]
    fn sponge_exports_registered_data_versions() {
        use crate::versions::registered_versions;
        use flate2::read::GzDecoder;
        use serde::Deserialize;
        use std::io::Read;

        #[derive(Deserialize)]
        struct Root {
            #[serde(rename = "Schematic")]
            schematic: Schematic,
        }
        #[derive(Deserialize)]
        struct Schematic {
            #[serde(rename = "DataVersion")]
            data_version: i32,
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
            let bytes = encode(&structure, def.data_version).unwrap();
            let mut raw = Vec::new();
            GzDecoder::new(bytes.as_slice())
                .read_to_end(&mut raw)
                .unwrap();
            let root: Root = fastnbt::from_bytes(&raw).unwrap();
            assert_eq!(
                root.schematic.data_version, def.data_version,
                "sponge DataVersion mismatch for {}",
                def.id
            );
        }
    }
}
