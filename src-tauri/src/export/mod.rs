mod litematic;
mod sponge;
mod vanilla;

use crate::model::BuildResult;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{Cursor, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    VanillaNbt,
    VanillaSplit,
    LitematicV6,
    LitematicV7,
    SpongeV3,
    All,
}

pub fn export(build: &BuildResult, format: ExportFormat, path: &Path) -> Result<()> {
    let data_version = build.data_version;
    let minecraft_version = build.minecraft_version.as_str();
    let result: Result<()> = match format {
        ExportFormat::VanillaNbt => {
            std::fs::write(path, vanilla::encode(&build.structure, data_version)?)?;
            Ok(())
        }
        ExportFormat::VanillaSplit => {
            vanilla::write_split_zip(&build.structure, path, minecraft_version, data_version)
        }
        ExportFormat::LitematicV6 => {
            std::fs::write(path, litematic::encode(&build.structure, 6, data_version)?)?;
            Ok(())
        }
        ExportFormat::LitematicV7 => {
            std::fs::write(path, litematic::encode(&build.structure, 7, data_version)?)?;
            Ok(())
        }
        ExportFormat::SpongeV3 => {
            std::fs::write(path, sponge::encode(&build.structure, data_version)?)?;
            Ok(())
        }
        ExportFormat::All => write_all_bundle(build, path),
    };
    result.with_context(|| format!("failed to write {}", path.display()))
}

fn write_all_bundle(build: &BuildResult, path: &Path) -> Result<()> {
    let data_version = build.data_version;
    let minecraft_version = build.minecraft_version.as_str();
    let file = File::create(path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut add = |name: &str, bytes: Vec<u8>| -> Result<()> {
        zip.start_file(name, options)?;
        zip.write_all(&bytes)?;
        Ok(())
    };
    add("mapart.nbt", vanilla::encode(&build.structure, data_version)?)?;
    let litematic_version = crate::versions::litematic_schematic_version(data_version);
    add(
        "mapart.litematic",
        litematic::encode(&build.structure, litematic_version, data_version)?,
    )?;
    add("mapart.schem", sponge::encode(&build.structure, data_version)?)?;
    add(
        "materials.json",
        serde_json::to_vec_pretty(&build.materials)?,
    )?;
    add("build.json", serde_json::to_vec_pretty(build)?)?;

    let mut split = Cursor::new(Vec::new());
    vanilla::write_split(
        &build.structure,
        &mut split,
        minecraft_version,
        data_version,
    )?;
    add("vanilla-structure-pieces.zip", split.into_inner())?;
    zip.finish()?;
    Ok(())
}

fn gzip(bytes: &[u8]) -> Result<Vec<u8>> {
    use flate2::{write::GzEncoder, Compression};
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes)?;
    Ok(encoder.finish()?)
}
