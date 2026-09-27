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

pub type ExportProgressFn<'a> = dyn Fn(f32, &str) + 'a;

fn report_export(progress: Option<&ExportProgressFn<'_>>, ratio: f32, label: &str) {
    if let Some(cb) = progress {
        cb(ratio.clamp(0.0, 1.0), label);
    }
}

#[allow(dead_code)] // Thin wrapper; runtime uses export_with_progress.
pub fn export(
    build: &BuildResult,
    format: ExportFormat,
    path: &Path,
    options: ExportOptions,
) -> Result<()> {
    export_with_progress(build, format, path, options, None)
}

pub fn export_with_progress(
    build: &BuildResult,
    format: ExportFormat,
    path: &Path,
    options: ExportOptions,
    progress: Option<&ExportProgressFn<'_>>,
) -> Result<()> {
    let data_version = build.data_version;
    let minecraft_version = build.minecraft_version.as_str();
    report_export(progress, 0.05, "Preparing export…");
    let result: Result<()> = match format {
        ExportFormat::VanillaNbt => {
            report_export(progress, 0.35, "Encoding vanilla structure…");
            std::fs::write(path, vanilla::encode(&build.structure, data_version)?)?;
            report_export(progress, 0.95, "Writing file…");
            Ok(())
        }
        ExportFormat::VanillaSplit => {
            report_export(progress, 0.35, "Splitting vanilla pieces…");
            vanilla::write_split_zip(&build.structure, path, minecraft_version, data_version)?;
            report_export(progress, 0.95, "Writing zip…");
            Ok(())
        }
        ExportFormat::LitematicV6 => {
            report_export(progress, 0.25, "Encoding Litematica v6…");
            std::fs::write(
                path,
                litematic::encode_build(build, 6, data_version, options.litematic_map_subregions)?,
            )?;
            report_export(progress, 0.95, "Writing file…");
            Ok(())
        }
        ExportFormat::LitematicV7 => {
            report_export(progress, 0.25, "Encoding Litematica…");
            std::fs::write(
                path,
                litematic::encode_build(build, 7, data_version, options.litematic_map_subregions)?,
            )?;
            report_export(progress, 0.95, "Writing file…");
            Ok(())
        }
        ExportFormat::SpongeV3 => {
            report_export(progress, 0.35, "Encoding Sponge schematic…");
            std::fs::write(path, sponge::encode(&build.structure, data_version)?)?;
            report_export(progress, 0.95, "Writing file…");
            Ok(())
        }
        ExportFormat::All => {
            write_all_bundle(build, path, options, progress)?;
            Ok(())
        }
    };
    report_export(progress, 1.0, "Export saved");
    result.with_context(|| format!("failed to write {}", path.display()))
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ExportOptions {
    /// When true, multi-map mosaics write one Litematica region per 128×128 map.
    pub litematic_map_subregions: bool,
}

fn write_all_bundle(
    build: &BuildResult,
    path: &Path,
    options: ExportOptions,
    progress: Option<&ExportProgressFn<'_>>,
) -> Result<()> {
    let data_version = build.data_version;
    let minecraft_version = build.minecraft_version.as_str();
    let file = File::create(path)?;
    let mut zip = ZipWriter::new(file);
    let options_zip = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut add = |name: &str, bytes: Vec<u8>| -> Result<()> {
        zip.start_file(name, options_zip)?;
        zip.write_all(&bytes)?;
        Ok(())
    };
    report_export(progress, 0.12, "Encoding vanilla structure…");
    add("mapart.nbt", vanilla::encode(&build.structure, data_version)?)?;
    let litematic_version = crate::versions::litematic_schematic_version(data_version);
    report_export(progress, 0.35, "Encoding Litematica…");
    add(
        "mapart.litematic",
        litematic::encode_build(
            build,
            litematic_version,
            data_version,
            options.litematic_map_subregions,
        )?,
    )?;
    report_export(progress, 0.58, "Encoding Sponge schematic…");
    add("mapart.schem", sponge::encode(&build.structure, data_version)?)?;
    report_export(progress, 0.72, "Writing materials…");
    add(
        "materials.json",
        serde_json::to_vec_pretty(&build.materials)?,
    )?;
    add("build.json", serde_json::to_vec_pretty(build)?)?;

    report_export(progress, 0.85, "Packing vanilla pieces…");
    let mut split = Cursor::new(Vec::new());
    vanilla::write_split(
        &build.structure,
        &mut split,
        minecraft_version,
        data_version,
    )?;
    add("vanilla-structure-pieces.zip", split.into_inner())?;
    report_export(progress, 0.95, "Writing zip…");
    zip.finish()?;
    Ok(())
}

fn gzip(bytes: &[u8]) -> Result<Vec<u8>> {
    use flate2::{write::GzEncoder, Compression};
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes)?;
    Ok(encoder.finish()?)
}
