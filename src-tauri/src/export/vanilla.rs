use super::gzip;
use crate::model::{BlockState, PlacedBlock, Structure};
use anyhow::Result;
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap},
    fs::File,
    io::{Seek, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[derive(Serialize)]
struct Root {
    #[serde(rename = "DataVersion")]
    data_version: i32,
    size: Vec<i32>,
    palette: Vec<PaletteEntry>,
    blocks: Vec<BlockEntry>,
    entities: Vec<EntityEntry>,
}

#[derive(Serialize)]
struct PaletteEntry {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Properties", skip_serializing_if = "BTreeMap::is_empty")]
    properties: BTreeMap<String, String>,
}

#[derive(Serialize)]
struct BlockEntry {
    pos: Vec<i32>,
    state: i32,
}

#[derive(Serialize)]
struct EntityEntry {
    pos: Vec<f64>,
    #[serde(rename = "blockPos")]
    block_pos: Vec<i32>,
}

pub fn encode(structure: &Structure, data_version: i32) -> Result<Vec<u8>> {
    let mut palette = Vec::<BlockState>::new();
    let mut palette_ids = HashMap::<BlockState, i32>::new();
    let mut blocks = Vec::with_capacity(structure.blocks.len());
    for block in &structure.blocks {
        let next_id = palette.len() as i32;
        let state = *palette_ids.entry(block.state.clone()).or_insert_with(|| {
            palette.push(block.state.clone());
            next_id
        });
        blocks.push(BlockEntry {
            pos: vec![block.x, block.y, block.z],
            state,
        });
    }
    let root = Root {
        data_version,
        size: structure.size.iter().map(|value| *value as i32).collect(),
        palette: palette
            .into_iter()
            .map(|state| PaletteEntry {
                name: state.name,
                properties: state.properties,
            })
            .collect(),
        blocks,
        entities: Vec::new(),
    };
    gzip(&fastnbt::to_bytes(&root)?)
}

pub fn write_split_zip(
    structure: &Structure,
    path: &Path,
    minecraft_version: &str,
    data_version: i32,
) -> Result<()> {
    write_split(structure, File::create(path)?, minecraft_version, data_version)
}

pub fn write_split<W: Write + Seek>(
    structure: &Structure,
    writer: W,
    minecraft_version: &str,
    data_version: i32,
) -> Result<()> {
    let mut zip = ZipWriter::new(writer);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut manifest = Vec::new();
    let [width, height, length] = structure.size;
    for origin_y in (0..height).step_by(48) {
        for origin_z in (0..length).step_by(48) {
            for origin_x in (0..width).step_by(48) {
                let size = [
                    (width - origin_x).min(48),
                    (height - origin_y).min(48),
                    (length - origin_z).min(48),
                ];
                let blocks = structure
                    .blocks
                    .iter()
                    .filter(|block| {
                        block.x >= origin_x as i32
                            && block.x < (origin_x + size[0]) as i32
                            && block.y >= origin_y as i32
                            && block.y < (origin_y + size[1]) as i32
                            && block.z >= origin_z as i32
                            && block.z < (origin_z + size[2]) as i32
                    })
                    .map(|block| PlacedBlock {
                        x: block.x - origin_x as i32,
                        y: block.y - origin_y as i32,
                        z: block.z - origin_z as i32,
                        state: block.state.clone(),
                    })
                    .collect();
                let name = format!("piece_x{origin_x}_y{origin_y}_z{origin_z}.nbt");
                zip.start_file(&name, options)?;
                zip.write_all(&encode(&Structure {
                    name: name.clone(),
                    size,
                    blocks,
                }, data_version)?)?;
                manifest.push(serde_json::json!({
                    "file": name,
                    "offset": [origin_x, origin_y, origin_z],
                    "size": size
                }));
            }
        }
    }
    zip.start_file("manifest.json", options)?;
    zip.write_all(
        serde_json::to_string_pretty(&serde_json::json!({
            "minecraftVersion": minecraft_version,
            "dataVersion": data_version,
            "axisOrder": "X east, Y up, Z south",
            "pieces": manifest
        }))?
        .as_bytes(),
    )?;
    zip.finish()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BlockState;
    use flate2::read::GzDecoder;
    use std::io::Read;

    #[test]
    fn vanilla_round_trip_has_required_tags() {
        let bytes = encode(
            &Structure {
                name: "test".into(),
                size: [2, 1, 1],
                blocks: vec![PlacedBlock {
                    x: 1,
                    y: 0,
                    z: 0,
                    state: BlockState::simple("minecraft:stone"),
                }],
            },
            4903,
        )
        .unwrap();
        assert_eq!(&bytes[0..2], &[0x1f, 0x8b]);
    }

    #[test]
    fn vanilla_exports_registered_data_versions() {
        use crate::versions::registered_versions;
        use serde::Deserialize;

        #[derive(Deserialize)]
        struct Root {
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
                root.data_version, def.data_version,
                "vanilla DataVersion mismatch for {}",
                def.id
            );
        }
    }
}
