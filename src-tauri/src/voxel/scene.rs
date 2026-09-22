use super::convert::{
    build_from_shared, validate_shared_materials, SharedMaterialOptions, VoxelAssignment,
};
use super::import::MeshInfo;
use super::skin::{
    native_skin_grid_size, paint_cape_on_grid, paint_skin_outer_layers_ex, skin_to_voxels_at_unit,
    SkinOuterMode,
};
use super::skin_pose::{apply_skin_pose, pose_is_active, upscale_grid};
use super::voxelize::{
    clamp_voxel_dims, voxelize_mesh_with, UvTransform, VoxelFit, VoxelGrid,
};
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScenePartKind {
    Obj,
    Skin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenePartOptions {
    pub id: String,
    pub name: String,
    pub kind: ScenePartKind,
    pub file_name: String,
    /// Raw file bytes as base64 (decoded by the Tauri command before calling convert_scene).
    /// Prefer `data_path` for large OBJ files to avoid freezing the UI on huge IPC payloads.
    #[serde(default)]
    pub data_base64: String,
    /// Absolute path to staged file bytes (written via `stage_bytes_begin` / `stage_bytes_append`).
    #[serde(default)]
    pub data_path: Option<String>,
    pub position_x: i32,
    pub position_y: i32,
    pub position_z: i32,
    /// Scene placement rotation in degrees (separate from skin_pose limb rotations).
    #[serde(default)]
    pub rotation_x: f32,
    #[serde(default)]
    pub rotation_y: f32,
    #[serde(default)]
    pub rotation_z: f32,
    pub width: u32,
    pub height: u32,
    pub length: u32,
    #[serde(default)]
    pub fit: VoxelFit,
    #[serde(default)]
    pub hollow: bool,
    /// Honor texture alpha as cutouts (catalog entities).
    #[serde(default)]
    pub cutout: bool,
    #[serde(default)]
    pub slim_arms: bool,
    /// Extrude Minecraft second skin layer into a 3D shell (hats / jackets / etc.).
    #[serde(default = "default_true")]
    pub outer_3d: bool,
    /// `full` (player), `hat` (vanilla mobs), or `none`.
    #[serde(default)]
    pub skin_overlay: Option<String>,
    /// Vanilla skeleton / stray: 2×12×2 limbs.
    #[serde(default)]
    pub skeleton_limbs: bool,
    /// Optional Mine-imator character pose (bodypart ROT/BEND/POS) applied in voxel space.
    #[serde(default)]
    pub skin_pose: Option<super::skin_pose::SkinCharacterPose>,
    /// Blend and seal elbow/knee/waist voxels after posing (default on).
    #[serde(default = "default_true")]
    pub smooth_joints: bool,
    /// Optional cape PNG (64×32 or HD scale of that layout).
    #[serde(default)]
    pub cape_base64: Option<String>,
    /// Optional Wavefront .mtl bytes (base64), decoded by the Tauri command.
    #[serde(default)]
    pub mtl_base64: Option<String>,
    #[serde(default)]
    pub mtl_path: Option<String>,
    /// Optional texture files keyed by basename, values base64-encoded.
    #[serde(default)]
    pub textures_base64: BTreeMap<String, String>,
    /// Optional texture files keyed by basename, values are absolute staged paths.
    #[serde(default)]
    pub textures_paths: BTreeMap<String, String>,
    #[serde(default)]
    pub uv: UvTransform,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneConvertOptions {
    pub parts: Vec<ScenePartOptions>,
    #[serde(default)]
    pub disabled_color_ids: Vec<u8>,
    #[serde(default)]
    pub block_overrides: BTreeMap<u8, String>,
    #[serde(default)]
    pub block_pack: crate::model::StatueBlockPack,
    #[serde(default)]
    pub disabled_blocks: Vec<String>,
    #[serde(default)]
    pub block_substitutions: BTreeMap<String, String>,
    #[serde(default)]
    pub support_mode: super::convert::GravitySupportMode,
    #[serde(default = "default_support_block")]
    pub support_block: String,
    #[serde(default = "super::convert::default_model_matching")]
    pub colour_matching: crate::model::ColourMatching,
    #[serde(default = "super::convert::default_model_dither")]
    pub dither: crate::model::DitherMode,
    #[serde(default)]
    pub hue: f32,
    #[serde(default)]
    pub brightness: f32,
    #[serde(default)]
    pub contrast: f32,
    #[serde(default)]
    pub saturation: f32,
}

fn default_support_block() -> String {
    "minecraft:cobblestone".into()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenePartSummary {
    pub id: String,
    pub name: String,
    pub kind: ScenePartKind,
    pub occupied_voxels: u32,
    pub mesh: Option<MeshInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneVoxel {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub rgb: [u8; 3],
    /// Chosen block state (e.g. `minecraft:orange_wool`) for textured preview.
    pub block: String,
    /// Index into the scene parts list that owns this voxel.
    pub part: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneConversionResponse {
    pub parts: Vec<ScenePartSummary>,
    pub preview_data_url: String,
    pub occupied_voxels: u32,
    pub build: crate::model::BuildResult,
    /// Compact voxel list for the interactive 3D viewer.
    pub voxels: Vec<SceneVoxel>,
    pub size: [u32; 3],
}

/// Decoded part ready for voxelization (used after Tauri base64 decode).
pub struct DecodedScenePart {
    pub options: ScenePartOptions,
    pub data: Vec<u8>,
    pub sidecars: super::import::ObjSidecars,
    pub cape: Option<Vec<u8>>,
}

pub fn convert_scene(
    parts: &[DecodedScenePart],
    shared: &SharedMaterialOptions,
    minecraft_version: &str,
) -> Result<SceneConversionResponse> {
    ensure!(!parts.is_empty(), "add at least one model or skin");
    validate_shared_materials(shared, minecraft_version)?;

    let mut local_grids = Vec::with_capacity(parts.len());
    let mut summaries = Vec::with_capacity(parts.len());

    for part in parts {
        let opts = &part.options;
        ensure!(
            opts.width > 0 && opts.height > 0 && opts.length > 0,
            "part '{}' size cannot be zero",
            opts.name
        );
        let (width, height, length) = clamp_voxel_dims(opts.width, opts.height, opts.length);

        let (grid, mesh_info) = match opts.kind {
            ScenePartKind::Obj => {
                let (mesh, info) =
                    super::import::load_mesh_with_sidecars(&part.data, &opts.file_name, &part.sidecars)?;
                let grid = voxelize_mesh_with(
                    &mesh,
                    width,
                    height,
                    length,
                    opts.fit,
                    opts.hollow,
                    opts.cutout,
                    &opts.uv,
                )?;
                (grid, Some(info))
            }
            ScenePartKind::Skin => {
                // Paint at the statue voxel scale so HD skins keep shirt/face
                // texels instead of 1× nearest-neighbour then upscale.
                let (nw, nh, nl) = native_skin_grid_size(opts.slim_arms, opts.skeleton_limbs);
                let unit = integer_skin_scale(nw, nh, nl, width, height, length);
                let mut working = skin_to_voxels_at_unit(
                    &part.data,
                    opts.slim_arms,
                    false,
                    opts.skeleton_limbs,
                    unit,
                )?;
                let overlay = SkinOuterMode::from_options(opts.outer_3d, opts.skin_overlay.as_deref());
                if overlay != SkinOuterMode::None {
                    let image = image::load_from_memory(&part.data)
                        .map_err(|err| anyhow::anyhow!("failed to decode skin PNG: {err}"))?
                        .into_rgba8();
                    paint_skin_outer_layers_ex(
                        &mut working,
                        &image,
                        opts.slim_arms,
                        unit,
                        overlay,
                        opts.skeleton_limbs,
                    );
                }
                if let Some(cape_bytes) = part.cape.as_ref().filter(|b| !b.is_empty()) {
                    let cape_image = image::load_from_memory(cape_bytes)
                        .map_err(|err| anyhow::anyhow!("failed to decode cape PNG: {err}"))?
                        .into_rgba8();
                    paint_cape_on_grid(
                        &mut working,
                        &cape_image,
                        opts.slim_arms,
                        unit,
                        opts.skeleton_limbs,
                        overlay != SkinOuterMode::None,
                    )?;
                }
                let posed = opts
                    .skin_pose
                    .as_ref()
                    .is_some_and(|pose| pose_is_active(pose));
                if let Some(pose) = &opts.skin_pose {
                    if pose_is_active(pose) {
                        working = apply_skin_pose(
                            &working,
                            pose,
                            opts.slim_arms,
                            unit,
                            opts.smooth_joints,
                        );
                    }
                }
                let rest_w = nw.saturating_mul(unit).max(1);
                let rest_h = nh.saturating_mul(unit).max(1);
                let rest_l = nl.saturating_mul(unit).max(1);
                let mut grid = fit_skin_grid(
                    &working,
                    width,
                    height,
                    length,
                    opts.fit,
                    posed,
                    rest_w,
                    rest_h,
                    rest_l,
                )?;
                if opts.hollow {
                    super::voxelize::hollow_out(&mut grid);
                }
                (grid, None)
            }
        };

        let grid = rotate_voxel_grid(
            grid,
            opts.rotation_x,
            opts.rotation_y,
            opts.rotation_z,
        );

        let occupied = grid.occupied_count() as u32;
        summaries.push(ScenePartSummary {
            id: opts.id.clone(),
            name: opts.name.clone(),
            kind: opts.kind,
            occupied_voxels: occupied,
            mesh: mesh_info,
        });
        local_grids.push((opts.position_x, opts.position_y, opts.position_z, grid));
    }

    let (merged, part_of) = merge_grids(&local_grids)?;
    drop(local_grids);
    let occupied_voxels = merged.occupied_count() as u32;
    ensure!(occupied_voxels > 0, "merged scene is empty");

    let mut merged = merged;
    super::convert::adjust_grid_colours(
        &mut merged,
        shared.hue,
        shared.brightness,
        shared.contrast,
        shared.saturation,
    );

    let palette = crate::palette::load_palette_for(minecraft_version)?;
    let candidates = super::convert::model_candidates_for(&palette, shared);
    ensure!(!candidates.is_empty(), "no statue cubes are enabled");

    let assigned = super::convert::assign_model_colours(&merged, &candidates, shared);
    let build = build_from_shared(&merged, &palette, &candidates, shared, &assigned)?;
    // Models uses the 3D voxel viewer, not this PNG. Drawing every occupied cube
    // into an isometric image OOMs large converts.
    let preview_data_url = String::new();
    let voxels = collect_scene_voxels(&merged, &part_of, &candidates, &assigned);

    Ok(SceneConversionResponse {
        parts: summaries,
        preview_data_url,
        occupied_voxels,
        build,
        voxels,
        size: [merged.width, merged.height, merged.length],
    })
}

/// Largest integer voxels-per-skin-pixel that still fits in the statue box.
fn integer_skin_scale(
    native_w: u32,
    native_h: u32,
    native_l: u32,
    width: u32,
    height: u32,
    length: u32,
) -> u32 {
    if native_w == 0 || native_h == 0 || native_l == 0 {
        return 1;
    }
    let by_box = (width / native_w)
        .min(height / native_h)
        .min(length / native_l);
    by_box.max(1)
}

/// Place a skin grid into the requested statue box.
///
/// At the rest-pose size, posed figures are padded (or the canvas grows) so
/// tucked/outstretched limbs are not resampled. Any other W/H/L — custom size
/// included — is honoured by scaling into that exact box.
fn fit_skin_grid(
    source: &VoxelGrid,
    width: u32,
    height: u32,
    length: u32,
    fit: VoxelFit,
    posed: bool,
    rest_w: u32,
    rest_h: u32,
    rest_l: u32,
) -> Result<VoxelGrid> {
    if source.width == width && source.height == height && source.length == length {
        return Ok(source.clone());
    }

    let rest_box = width == rest_w && height == rest_h && length == rest_l;
    let fits_inside =
        source.width <= width && source.height <= height && source.length <= length;

    if posed && rest_box {
        if fits_inside {
            return Ok(pad_grid(source, width, height, length));
        }
        let out_w = source.width.max(width);
        let out_h = source.height.max(height);
        let out_l = source.length.max(length);
        let (out_w, out_h, out_l) = clamp_voxel_dims(out_w, out_h, out_l);
        return Ok(pad_grid(source, out_w, out_h, out_l));
    }

    let factor = (width / source.width.max(1))
        .min(height / source.height.max(1))
        .min(length / source.length.max(1));
    let upscaled = if factor >= 2 {
        Some(upscale_grid(source, factor))
    } else {
        None
    };
    let scaled = upscaled.as_ref().unwrap_or(source);
    if scaled.width == width && scaled.height == height && scaled.length == length {
        return Ok(scaled.clone());
    }
    let mode = if posed && fit == VoxelFit::Stretch {
        VoxelFit::Fit
    } else {
        fit
    };
    resample_grid(scaled, width, height, length, mode)
}

/// Centre source in X/Z inside a larger canvas; keep feet on Y=0.
fn pad_grid(source: &VoxelGrid, width: u32, height: u32, length: u32) -> VoxelGrid {
    let mut target = empty_grid(width, height, length);
    let ox = ((width as i32 - source.width as i32) / 2).max(0);
    let oy = 0_i32; // feet stay on the ground
    let oz = ((length as i32 - source.length as i32) / 2).max(0);
    for (x, y, z) in source.occupied_coords() {
        let Some(rgb) = source.rgb_at(x, y, z) else {
            continue;
        };
        let dx = ox + x as i32;
        let dy = oy + y as i32;
        let dz = oz + z as i32;
        if dx < 0 || dy < 0 || dz < 0 {
            continue;
        }
        let (dx, dy, dz) = (dx as u32, dy as u32, dz as u32);
        if dx >= width || dy >= height || dz >= length {
            continue;
        }
        target.put_rgb(
            dx,
            dy,
            dz,
            [rgb[0] as f32, rgb[1] as f32, rgb[2] as f32],
        );
    }
    target
}

pub fn resample_grid(
    source: &VoxelGrid,
    width: u32,
    height: u32,
    length: u32,
    fit: VoxelFit,
) -> Result<VoxelGrid> {
    ensure!(width > 0 && height > 0 && length > 0, "voxel size cannot be zero");
    let (width, height, length) = clamp_voxel_dims(width, height, length);

    let mut target = empty_grid(width, height, length);
    let (sx, sy, sz, ox, oy, oz) = match fit {
        VoxelFit::Stretch => (
            source.width as f32 / width as f32,
            source.height as f32 / height as f32,
            source.length as f32 / length as f32,
            0.0,
            0.0,
            0.0,
        ),
        VoxelFit::Fit => {
            let uniform = (width as f32 / source.width as f32)
                .min(height as f32 / source.height as f32)
                .min(length as f32 / source.length as f32);
            let used_w = source.width as f32 * uniform;
            let used_l = source.length as f32 * uniform;
            (
                1.0 / uniform,
                1.0 / uniform,
                1.0 / uniform,
                (width as f32 - used_w) * 0.5,
                0.0, // statues keep feet on Y=0; leftover height sits above the head
                (length as f32 - used_l) * 0.5,
            )
        }
    };

    for y in 0..height {
        for z in 0..length {
            for x in 0..width {
                let src_x = ((x as f32 - ox) * sx).floor() as i32;
                let src_y = ((y as f32 - oy) * sy).floor() as i32;
                let src_z = ((z as f32 - oz) * sz).floor() as i32;
                if src_x < 0 || src_y < 0 || src_z < 0 {
                    continue;
                }
                let (src_x, src_y, src_z) = (src_x as u32, src_y as u32, src_z as u32);
                if src_x >= source.width || src_y >= source.height || src_z >= source.length {
                    continue;
                }
                if let Some(rgb) = source.rgb_at(src_x, src_y, src_z) {
                    target.put_rgb(x, y, z, [rgb[0] as f32, rgb[1] as f32, rgb[2] as f32]);
                }
            }
        }
    }

    ensure!(
        target.occupied_count() > 0,
        "resampling produced an empty model; try a larger size"
    );
    Ok(target)
}

/// Rotate a local voxel grid by Euler degrees (order YXZ, matching Three.js preview).
fn rotate_voxel_grid(grid: VoxelGrid, rot_x_deg: f32, rot_y_deg: f32, rot_z_deg: f32) -> VoxelGrid {
    if rot_x_deg.abs() < 1e-4 && rot_y_deg.abs() < 1e-4 && rot_z_deg.abs() < 1e-4 {
        return grid;
    }

    let mut occupied = Vec::new();
    grid.for_each_occupied(|x, y, z, _| {
        if let Some(rgb) = grid.rgb_at(x, y, z) {
            occupied.push((x as f32, y as f32, z as f32, rgb));
        }
    });
    if occupied.is_empty() {
        return grid;
    }

    let cx = (grid.width.saturating_sub(1) as f32) * 0.5;
    let cy = (grid.height.saturating_sub(1) as f32) * 0.5;
    let cz = (grid.length.saturating_sub(1) as f32) * 0.5;
    let rx = rot_x_deg.to_radians();
    let ry = rot_y_deg.to_radians();
    let rz = rot_z_deg.to_radians();

    let mut transformed = Vec::with_capacity(occupied.len());
    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut min_z = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    let mut max_z = f32::NEG_INFINITY;

    for (x, y, z, rgb) in occupied {
        let (px, py, pz) = rotate_yxz(x - cx, y - cy, z - cz, rx, ry, rz);
        min_x = min_x.min(px);
        min_y = min_y.min(py);
        min_z = min_z.min(pz);
        max_x = max_x.max(px);
        max_y = max_y.max(py);
        max_z = max_z.max(pz);
        transformed.push((px, py, pz, rgb));
    }

    let raw_w = ((max_x.round() as i32) - (min_x.round() as i32) + 1).max(1) as u32;
    let raw_h = ((max_y.round() as i32) - (min_y.round() as i32) + 1).max(1) as u32;
    let raw_l = ((max_z.round() as i32) - (min_z.round() as i32) + 1).max(1) as u32;
    let (width, height, length) = clamp_voxel_dims(raw_w, raw_h, raw_l);
    let sx = width as f32 / raw_w as f32;
    let sy = height as f32 / raw_h as f32;
    let sz = length as f32 / raw_l as f32;

    let mut out = empty_grid(width, height, length);
    let ox = min_x.round();
    let oy = min_y.round();
    let oz = min_z.round();
    for (px, py, pz, rgb) in transformed {
        let x = ((px - ox) * sx).round() as i32;
        let y = ((py - oy) * sy).round() as i32;
        let z = ((pz - oz) * sz).round() as i32;
        if out.width == 0 || out.height == 0 || out.length == 0 {
            continue;
        }
        let x = x.clamp(0, out.width as i32 - 1) as u32;
        let y = y.clamp(0, out.height as i32 - 1) as u32;
        let z = z.clamp(0, out.length as i32 - 1) as u32;
        out.put_rgb(x, y, z, [rgb[0] as f32, rgb[1] as f32, rgb[2] as f32]);
    }
    out
}

/// Euler YXZ: yaw (Y), then pitch (X), then roll (Z).
fn rotate_yxz(x: f32, y: f32, z: f32, rx: f32, ry: f32, rz: f32) -> (f32, f32, f32) {
    // Y
    let (sy, cy) = ry.sin_cos();
    let (mut x, mut y, mut z) = (x * cy + z * sy, y, -x * sy + z * cy);
    // X
    let (sx, cx) = rx.sin_cos();
    (x, y, z) = (x, y * cx - z * sx, y * sx + z * cx);
    // Z
    let (sz, cz) = rz.sin_cos();
    (x * cz - y * sz, x * sz + y * cz, z)
}

fn merge_grids(parts: &[(i32, i32, i32, VoxelGrid)]) -> Result<(VoxelGrid, HashMap<usize, u16>)> {
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut min_z = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    let mut max_z = i32::MIN;

    for &(ox, oy, oz, ref grid) in parts {
        min_x = min_x.min(ox);
        min_y = min_y.min(oy);
        min_z = min_z.min(oz);
        max_x = max_x.max(ox + grid.width as i32 - 1);
        max_y = max_y.max(oy + grid.height as i32 - 1);
        max_z = max_z.max(oz + grid.length as i32 - 1);
    }

    ensure!(min_x <= max_x && min_y <= max_y && min_z <= max_z, "invalid merge bounds");
    let raw_w = (max_x - min_x + 1) as u32;
    let raw_h = (max_y - min_y + 1) as u32;
    let raw_l = (max_z - min_z + 1) as u32;
    let (width, height, length) = clamp_voxel_dims(raw_w, raw_h, raw_l);
    let sx = width as f32 / raw_w.max(1) as f32;
    let sy = height as f32 / raw_h.max(1) as f32;
    let sz = length as f32 / raw_l.max(1) as f32;

    let mut merged = empty_grid(width, height, length);
    let mut part_of = HashMap::new();
    for (part_index, &(ox, oy, oz, ref grid)) in parts.iter().enumerate() {
        let part_id = part_index as u16;
        for (x, y, z) in grid.occupied_coords() {
            let Some(rgb) = grid.rgb_at(x, y, z) else {
                continue;
            };
            let wx = ((ox + x as i32 - min_x) as f32 * sx).round() as i32;
            let wy = ((oy + y as i32 - min_y) as f32 * sy).round() as i32;
            let wz = ((oz + z as i32 - min_z) as f32 * sz).round() as i32;
            if wx < 0 || wy < 0 || wz < 0 {
                continue;
            }
            let (wx, wy, wz) = (wx as u32, wy as u32, wz as u32);
            if wx >= merged.width || wy >= merged.height || wz >= merged.length {
                continue;
            }
            // Later parts overwrite earlier voxels.
            merged.put_rgb(
                wx,
                wy,
                wz,
                [rgb[0] as f32, rgb[1] as f32, rgb[2] as f32],
            );
            part_of.insert(merged.index(wx, wy, wz), part_id);
        }
    }
    merged.ensure_occupied_budget()?;
    Ok((merged, part_of))
}

fn voxel_is_exposed(grid: &VoxelGrid, x: u32, y: u32, z: u32) -> bool {
    const OFFSETS: [(i32, i32, i32); 6] = [
        (1, 0, 0),
        (-1, 0, 0),
        (0, 1, 0),
        (0, -1, 0),
        (0, 0, 1),
        (0, 0, -1),
    ];
    for (dx, dy, dz) in OFFSETS {
        let nx = x as i32 + dx;
        let ny = y as i32 + dy;
        let nz = z as i32 + dz;
        if nx < 0 || ny < 0 || nz < 0 {
            return true;
        }
        if nx >= grid.width as i32 || ny >= grid.height as i32 || nz >= grid.length as i32 {
            return true;
        }
        if grid.rgb_at(nx as u32, ny as u32, nz as u32).is_none() {
            return true;
        }
    }
    false
}

/// Pick `keep` points spread through `points` (scan order) so a Y-major list
/// still covers feet and head instead of only the first N cells.
fn subsample_uniform(points: &[(u32, u32, u32)], keep: usize) -> Vec<(u32, u32, u32)> {
    if keep == 0 || points.is_empty() {
        return Vec::new();
    }
    if keep >= points.len() {
        return points.to_vec();
    }
    (0..keep)
        .map(|i| points[i * points.len() / keep])
        .collect()
}

/// Occupied cells to show in the 3D voxel viewer. Export still uses every block.
///
/// Solid (hollow-off) statues routinely exceed `max`. Scanning Y from 0 and
/// stopping early chopped heads/arms off big builds. Prefer the exposed shell,
/// then fill leftover budget from the interior, both subsampled across the AABB.
fn select_preview_cells(grid: &VoxelGrid, max: usize) -> Vec<(u32, u32, u32)> {
    let occupied = grid.occupied_coords();
    if occupied.len() <= max {
        return occupied;
    }

    let mut surface = Vec::new();
    let mut interior = Vec::new();
    for &(x, y, z) in &occupied {
        if voxel_is_exposed(grid, x, y, z) {
            surface.push((x, y, z));
        } else {
            interior.push((x, y, z));
        }
    }

    let mut out = subsample_uniform(&surface, surface.len().min(max));
    let remain = max.saturating_sub(out.len());
    if remain > 0 {
        out.extend(subsample_uniform(&interior, remain));
    }
    out
}

fn collect_scene_voxels(
    grid: &VoxelGrid,
    part_of: &HashMap<usize, u16>,
    candidates: &[crate::palette::PaletteCandidate],
    assigned: &VoxelAssignment,
) -> Vec<SceneVoxel> {
    const MAX_PREVIEW: usize = 250_000;
    let fallback = candidates.len().saturating_sub(1);
    select_preview_cells(grid, MAX_PREVIEW)
        .into_iter()
        .map(|(x, y, z)| {
            let index = grid.index(x, y, z);
            let rgb = grid.rgb_at(x, y, z).unwrap_or([180, 180, 180]);
            let chosen = assigned.get(&index).copied().unwrap_or(0);
            let candidate = &candidates[chosen.min(fallback)];
            SceneVoxel {
                x: x as i32,
                y: y as i32,
                z: z as i32,
                rgb,
                // Keep source mesh/MTL colour for Editor preview; block is for In-game / export.
                block: candidate.block.canonical_name(),
                part: part_of.get(&index).copied().unwrap_or(u16::MAX),
            }
        })
        .collect()
}

fn empty_grid(width: u32, height: u32, length: u32) -> VoxelGrid {
    VoxelGrid::empty(width, height, length)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_grid(width: u32, height: u32, length: u32, rgb: [u8; 3]) -> VoxelGrid {
        let mut grid = empty_grid(width, height, length);
        for y in 0..height {
            for z in 0..length {
                for x in 0..width {
                    grid.put_rgb(
                        x,
                        y,
                        z,
                        [rgb[0] as f32, rgb[1] as f32, rgb[2] as f32],
                    );
                }
            }
        }
        grid
    }

    #[test]
    fn merges_two_parts_with_offset() {
        let a = solid_grid(2, 2, 2, [255, 0, 0]);
        let b = solid_grid(2, 2, 2, [0, 0, 255]);
        let (merged, _) = merge_grids(&[(0, 0, 0, a), (3, 0, 0, b)]).unwrap();
        assert_eq!(merged.width, 5);
        assert!(merged.rgb_at(0, 0, 0).is_some());
        assert!(merged.rgb_at(3, 0, 0).is_some());
        assert!(merged.rgb_at(2, 0, 0).is_none());
    }

    #[test]
    fn later_part_overwrites_overlap() {
        let a = solid_grid(2, 2, 2, [255, 0, 0]);
        let b = solid_grid(2, 2, 2, [0, 255, 0]);
        let (merged, part_of) = merge_grids(&[(0, 0, 0, a), (1, 0, 0, b)]).unwrap();
        assert_eq!(merged.rgb_at(1, 0, 0), Some([0, 255, 0]));
        assert_eq!(merged.rgb_at(0, 0, 0), Some([255, 0, 0]));
        assert_eq!(part_of.get(&merged.index(1, 0, 0)).copied(), Some(1));
        assert_eq!(part_of.get(&merged.index(0, 0, 0)).copied(), Some(0));
    }

    #[test]
    fn skin_scene_builds_a_tall_3d_statue_not_a_flat_map() {
        use super::ScenePartKind;
        use crate::voxel::convert::SharedMaterialOptions;
        use image::{Rgba, RgbaImage};

        let mut image = RgbaImage::from_pixel(64, 64, Rgba([40, 120, 200, 255]));
        // Opaque face pixels so UV sampling succeeds.
        for y in 8..16 {
            for x in 8..16 {
                image.put_pixel(x, y, Rgba([220, 180, 140, 255]));
            }
        }
        let mut bytes = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let part = DecodedScenePart {
            options: ScenePartOptions {
                id: "skin".into(),
                name: "steve.png".into(),
                kind: ScenePartKind::Skin,
                file_name: "steve.png".into(),
                data_base64: String::new(),
                position_x: 0,
                position_y: 0,
                position_z: 0,
                rotation_x: 0.0,
                rotation_y: 0.0,
                rotation_z: 0.0,
                width: 32,
                height: 64,
                length: 16,
                fit: VoxelFit::Fit,
                hollow: false,
                cutout: false,
                slim_arms: false,
                outer_3d: true,
                skin_overlay: None,
                skeleton_limbs: false,
                skin_pose: None,
                smooth_joints: true,
                cape_base64: None,
                mtl_base64: None,
                mtl_path: None,
                textures_base64: Default::default(),
                textures_paths: Default::default(),
                data_path: None,
                uv: Default::default(),
            },
            data: bytes.into_inner(),
            sidecars: Default::default(),
            cape: None,
        };
        let shared = SharedMaterialOptions {
            disabled_color_ids: Vec::new(),
            block_overrides: Default::default(),
            support_mode: crate::voxel::convert::GravitySupportMode::Off,
            support_block: "minecraft:cobblestone".into(),
            ..Default::default()
        };
        let response = convert_scene(&[part], &shared, "26.2").unwrap();
        assert!(response.build.height >= 30, "height={}", response.build.height);
        assert!(response.build.length >= 6, "length={}", response.build.length);
        assert!(response.build.width >= 12, "width={}", response.build.width);
        assert!(response.occupied_voxels > 500);
        assert!(!response.voxels.is_empty());
        assert_eq!(response.size[0], response.build.width);
        assert_eq!(response.size[2], response.build.length);
        assert!(response.size[1] >= 30);
        // Must not collapse into a single mapart-like slab.
        assert!(response.build.height > response.build.length);
    }

    #[test]
    fn skin_hollow_removes_interior_voxels() {
        use super::ScenePartKind;
        use crate::voxel::convert::SharedMaterialOptions;
        use image::{Rgba, RgbaImage};

        let mut image = RgbaImage::from_pixel(64, 64, Rgba([40, 120, 200, 255]));
        for y in 8..16 {
            for x in 8..16 {
                image.put_pixel(x, y, Rgba([220, 180, 140, 255]));
            }
        }
        let mut bytes = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let png = bytes.into_inner();
        let make_part = |hollow: bool| DecodedScenePart {
            options: ScenePartOptions {
                id: "skin".into(),
                name: "steve.png".into(),
                kind: ScenePartKind::Skin,
                file_name: "steve.png".into(),
                data_base64: String::new(),
                position_x: 0,
                position_y: 0,
                position_z: 0,
                rotation_x: 0.0,
                rotation_y: 0.0,
                rotation_z: 0.0,
                width: 32,
                height: 64,
                length: 16,
                fit: VoxelFit::Fit,
                hollow,
                cutout: false,
                slim_arms: false,
                outer_3d: false,
                skin_overlay: None,
                skeleton_limbs: false,
                skin_pose: None,
                smooth_joints: true,
                cape_base64: None,
                mtl_base64: None,
                mtl_path: None,
                textures_base64: Default::default(),
                textures_paths: Default::default(),
                data_path: None,
                uv: Default::default(),
            },
            data: png.clone(),
            sidecars: Default::default(),
            cape: None,
        };
        let shared = SharedMaterialOptions {
            disabled_color_ids: Vec::new(),
            block_overrides: Default::default(),
            support_mode: crate::voxel::convert::GravitySupportMode::Off,
            support_block: "minecraft:cobblestone".into(),
            ..Default::default()
        };
        let solid = convert_scene(&[make_part(false)], &shared, "26.2").unwrap();
        let hollow = convert_scene(&[make_part(true)], &shared, "26.2").unwrap();
        assert!(
            hollow.occupied_voxels < solid.occupied_voxels,
            "hollow={} solid={}",
            hollow.occupied_voxels,
            solid.occupied_voxels
        );
        assert!(hollow.occupied_voxels > 50, "shell should remain");
    }

    fn solid_skin_png() -> Vec<u8> {
        use image::{Rgba, RgbaImage};
        let mut image = RgbaImage::from_pixel(64, 64, Rgba([40, 120, 200, 255]));
        for y in 8..16 {
            for x in 8..16 {
                image.put_pixel(x, y, Rgba([220, 180, 140, 255]));
            }
        }
        let mut bytes = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn skin_part(
        width: u32,
        height: u32,
        length: u32,
        pose: Option<super::super::skin_pose::SkinCharacterPose>,
    ) -> DecodedScenePart {
        DecodedScenePart {
            options: ScenePartOptions {
                id: "skin".into(),
                name: "steve.png".into(),
                kind: ScenePartKind::Skin,
                file_name: "steve.png".into(),
                data_base64: String::new(),
                position_x: 0,
                position_y: 0,
                position_z: 0,
                rotation_x: 0.0,
                rotation_y: 0.0,
                rotation_z: 0.0,
                width,
                height,
                length,
                fit: VoxelFit::Fit,
                hollow: false,
                cutout: false,
                slim_arms: false,
                outer_3d: false,
                skin_overlay: None,
                skeleton_limbs: false,
                skin_pose: pose,
                smooth_joints: true,
                cape_base64: None,
                mtl_base64: None,
                mtl_path: None,
                textures_base64: Default::default(),
                textures_paths: Default::default(),
                data_path: None,
                uv: Default::default(),
            },
            data: solid_skin_png(),
            sidecars: Default::default(),
            cape: None,
        }
    }

    fn empty_shared() -> crate::voxel::convert::SharedMaterialOptions {
        crate::voxel::convert::SharedMaterialOptions {
            disabled_color_ids: Vec::new(),
            block_overrides: Default::default(),
            support_mode: crate::voxel::convert::GravitySupportMode::Off,
            support_block: "minecraft:cobblestone".into(),
            ..Default::default()
        }
    }

    #[test]
    fn integer_skin_scale_uses_floor_of_the_statue_box() {
        // Classic rest grid is 18×34×10. Custom 50×94×28 is not an exact N×.
        assert_eq!(integer_skin_scale(18, 34, 10, 50, 94, 28), 2);
        assert_eq!(integer_skin_scale(18, 34, 10, 36, 68, 20), 2);
        assert_eq!(integer_skin_scale(18, 34, 10, 9, 17, 5), 1);
        assert_eq!(integer_skin_scale(18, 34, 10, 18, 34, 10), 1);
    }

    #[test]
    fn skin_custom_size_sets_the_output_box() {
        let response = convert_scene(&[skin_part(50, 94, 28, None)], &empty_shared(), "26.2").unwrap();
        assert_eq!(response.size, [50, 94, 28]);
        assert_eq!(response.build.width, 50);
        assert_eq!(response.build.length, 28);
        // Build height is the occupied statue, not empty Fit letterbox above the head.
        assert!(
            response.build.height <= 94 && response.build.height >= 60,
            "occupied height should sit in the custom box, height={}",
            response.build.height
        );
        let native = convert_scene(&[skin_part(18, 34, 10, None)], &empty_shared(), "26.2").unwrap();
        assert!(
            response.occupied_voxels > native.occupied_voxels,
            "custom={} native={}",
            response.occupied_voxels,
            native.occupied_voxels
        );
    }

    #[test]
    fn posed_skin_custom_size_still_sets_the_output_box() {
        use crate::voxel::skin_pose::{SkinCharacterPose, SkinPartPose};
        let mut parts = std::collections::BTreeMap::new();
        parts.insert(
            "right_arm".into(),
            SkinPartPose {
                pos: [0.0; 3],
                rot: [-90.0, 0.0, 0.0],
                bend: [0.0; 3],
                scale: [1.0; 3],
            },
        );
        let pose = SkinCharacterPose {
            root: SkinPartPose::default(),
            parts,
            joint_style: Some("blockbench".into()),
        };
        let response =
            convert_scene(&[skin_part(50, 94, 28, Some(pose))], &empty_shared(), "26.2").unwrap();
        assert_eq!(response.size, [50, 94, 28]);
        assert!(response.occupied_voxels > 500);
    }

    #[test]
    fn fit_resample_keeps_feet_on_ground() {
        let source = solid_grid(4, 4, 2, [10, 20, 30]);
        let out = resample_grid(&source, 4, 8, 4, VoxelFit::Fit).unwrap();
        assert_eq!(out.height, 8);
        assert!(
            out.rgb_at(0, 0, 1).is_some(),
            "classic-in-a-slimmer-box leftover height must not lift the feet"
        );
        assert!(
            out.rgb_at(0, 7, 1).is_none(),
            "Fit letterbox belongs above the head"
        );
    }

    #[test]
    fn small_solid_preview_keeps_every_voxel() {
        let grid = solid_grid(4, 6, 4, [10, 20, 30]);
        let cells = select_preview_cells(&grid, 250_000);
        assert_eq!(cells.len(), 4 * 6 * 4);
    }

    #[test]
    fn large_solid_preview_keeps_the_top_instead_of_chopping_from_y0() {
        // 8×20×8 = 1280 occupied. A Y-major first-N cap of 200 only reaches y=3
        // (64 cells per layer). Surface-first subsample must still include the head.
        let grid = solid_grid(8, 20, 8, [200, 80, 40]);
        let cells = select_preview_cells(&grid, 200);
        assert!(cells.len() <= 200);
        assert!(
            cells.iter().any(|&(_, y, _)| y == 0),
            "preview must keep the feet"
        );
        assert!(
            cells.iter().any(|&(_, y, _)| y == 19),
            "preview must keep the head of a solid statue over the cap"
        );
        assert!(cells.iter().any(|&(x, _, _)| x == 0));
        assert!(cells.iter().any(|&(x, _, _)| x == 7));
        assert!(cells.iter().any(|&(_, _, z)| z == 0));
        assert!(cells.iter().any(|&(_, _, z)| z == 7));
    }

    #[test]
    fn rotate_voxel_grid_90_y_keeps_voxels() {
        let mut grid = empty_grid(3, 1, 1);
        grid.put_rgb(2, 0, 0, [10.0, 20.0, 30.0]);
        let rotated = rotate_voxel_grid(grid, 0.0, 90.0, 0.0);
        let count = rotated.occupied_count();
        assert_eq!(count, 1);
        assert!(rotated.width >= 1 && rotated.length >= 1);
    }
}
