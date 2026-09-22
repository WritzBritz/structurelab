use super::import::{load_mesh, MeshInfo};
#[cfg(test)]
use super::import::Mesh;
use super::voxelize::{voxelize_mesh_with, UvTransform, VoxelFit, VoxelGrid};
#[cfg(test)]
use super::voxelize::voxelize_mesh;
use crate::converter::{
    block_needs_under_support, mixing_plan_from_pool, nearest_colour, BAYER_8, MIX_DIFFUSION,
    MIX_PLAN_SIZE,
};
use crate::model::{
    BlockState, BuildResult, ColourMatching, DitherMode, MapTile, MaterialCount, PlacedBlock,
    StatueBlockPack, Structure,
};
use crate::palette::{
    load_palette_for, perceptual_distance, rgb_to_lab, rgb_to_oklab, statue_color_distance,
    statue_oklab_distance, warm_pink_drift, PaletteCandidate,
};
use anyhow::{ensure, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    io::Cursor,
};

/// Palette index per occupied voxel. Missing = air (not stored).
pub type VoxelAssignment = HashMap<usize, usize>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum GravitySupportMode {
    /// Place gravity / carpet blocks as-is with no under-support.
    #[default]
    Off,
    /// Place a nearby solid block of the closest matching colour under gravity blocks.
    MatchColor,
    /// Place the chosen fixed support block under gravity blocks.
    Fixed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConvertOptions {
    pub width: u32,
    pub height: u32,
    pub length: u32,
    #[serde(default)]
    pub fit: VoxelFit,
    #[serde(default)]
    pub hollow: bool,
    /// Honor texture alpha as cutouts (catalog entities). Default fills
    /// transparent texels with vertex colour for character meshes.
    #[serde(default)]
    pub cutout: bool,
    #[serde(default)]
    pub disabled_color_ids: Vec<u8>,
    #[serde(default)]
    pub block_overrides: BTreeMap<u8, String>,
    #[serde(default)]
    pub block_pack: StatueBlockPack,
    /// Cube ids turned off in the Models materials list (`oak_planks`).
    #[serde(default)]
    pub disabled_blocks: Vec<String>,
    /// After matching, place this cube instead (`minecraft:oak_planks` → spruce).
    #[serde(default)]
    pub block_substitutions: BTreeMap<String, String>,
    #[serde(default)]
    pub support_mode: GravitySupportMode,
    #[serde(default = "default_support_block")]
    pub support_block: String,
    #[serde(default = "default_model_matching")]
    pub colour_matching: ColourMatching,
    #[serde(default = "default_model_dither")]
    pub dither: DitherMode,
    /// Hue rotate in degrees (−180…180). Applied to voxel colours before matching.
    #[serde(default)]
    pub hue: f32,
    #[serde(default)]
    pub brightness: f32,
    #[serde(default)]
    pub contrast: f32,
    #[serde(default)]
    pub saturation: f32,
    #[serde(default)]
    pub uv: UvTransform,
}

#[derive(Debug, Clone)]
pub struct SharedMaterialOptions {
    pub disabled_color_ids: Vec<u8>,
    pub block_overrides: BTreeMap<u8, String>,
    pub block_pack: StatueBlockPack,
    pub disabled_blocks: Vec<String>,
    pub block_substitutions: BTreeMap<String, String>,
    pub support_mode: GravitySupportMode,
    pub support_block: String,
    pub colour_matching: ColourMatching,
    pub dither: DitherMode,
    pub hue: f32,
    pub brightness: f32,
    pub contrast: f32,
    pub saturation: f32,
}

impl Default for SharedMaterialOptions {
    fn default() -> Self {
        Self {
            disabled_color_ids: Vec::new(),
            block_overrides: BTreeMap::new(),
            block_pack: StatueBlockPack::Everything,
            disabled_blocks: Vec::new(),
            block_substitutions: BTreeMap::new(),
            support_mode: GravitySupportMode::Off,
            support_block: default_support_block(),
            colour_matching: default_model_matching(),
            dither: default_model_dither(),
            hue: 0.0,
            brightness: 0.0,
            contrast: 0.0,
            saturation: 0.0,
        }
    }
}

impl From<&ModelConvertOptions> for SharedMaterialOptions {
    fn from(options: &ModelConvertOptions) -> Self {
        Self {
            disabled_color_ids: options.disabled_color_ids.clone(),
            block_overrides: options.block_overrides.clone(),
            block_pack: options.block_pack,
            disabled_blocks: options.disabled_blocks.clone(),
            block_substitutions: options.block_substitutions.clone(),
            support_mode: options.support_mode,
            support_block: options.support_block.clone(),
            colour_matching: options.colour_matching,
            dither: options.dither,
            hue: options.hue,
            brightness: options.brightness,
            contrast: options.contrast,
            saturation: options.saturation,
        }
    }
}

fn default_support_block() -> String {
    "minecraft:cobblestone".into()
}

pub(crate) fn default_model_matching() -> ColourMatching {
    ColourMatching::StructureLabSmooth
}

pub(crate) fn default_model_dither() -> DitherMode {
    DitherMode::None
}

impl Default for VoxelFit {
    fn default() -> Self {
        Self::Fit
    }
}

impl Default for ModelConvertOptions {
    fn default() -> Self {
        Self {
            width: 64,
            height: 64,
            length: 64,
            fit: VoxelFit::Fit,
            hollow: false,
            cutout: false,
            disabled_color_ids: Vec::new(),
            block_overrides: BTreeMap::new(),
            block_pack: StatueBlockPack::Everything,
            disabled_blocks: Vec::new(),
            block_substitutions: BTreeMap::new(),
            support_mode: GravitySupportMode::Off,
            support_block: default_support_block(),
            colour_matching: default_model_matching(),
            dither: default_model_dither(),
            hue: 0.0,
            brightness: 0.0,
            contrast: 0.0,
            saturation: 0.0,
            uv: UvTransform::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConversionResponse {
    pub mesh: MeshInfo,
    pub preview_data_url: String,
    pub occupied_voxels: u32,
    pub build: BuildResult,
}

pub fn convert_model(
    data: &[u8],
    file_name: &str,
    options: &ModelConvertOptions,
    minecraft_version: &str,
) -> Result<ModelConversionResponse> {
    let (mesh, mesh_info) = load_mesh(data, file_name)?;
    let mut grid = voxelize_mesh_with(
        &mesh,
        options.width,
        options.height,
        options.length,
        options.fit,
        options.hollow,
        options.cutout,
        &options.uv,
    )?;
    let occupied_voxels = grid.occupied_count() as u32;
    let shared = SharedMaterialOptions::from(options);
    validate_shared_materials(&shared, minecraft_version)?;
    adjust_grid_colours(
        &mut grid,
        shared.hue,
        shared.brightness,
        shared.contrast,
        shared.saturation,
    );

    let palette = load_palette_for(minecraft_version)?;
    let palette_candidates = model_candidates_for(&palette, &shared);
    ensure!(!palette_candidates.is_empty(), "no statue cubes are enabled");

    let assigned = assign_model_colours(&grid, &palette_candidates, &shared);
    let build = build_from_shared(&grid, &palette, &palette_candidates, &shared, &assigned)?;
    let preview_data_url = encode_preview_grid(&grid, &palette_candidates, &assigned)?;
    Ok(ModelConversionResponse {
        mesh: mesh_info,
        preview_data_url,
        occupied_voxels,
        build,
    })
}

pub fn model_candidates_for(
    palette: &crate::palette::PaletteFile,
    options: &SharedMaterialOptions,
) -> Vec<PaletteCandidate> {
    crate::palette::candidates_for_models_appearance_pack(
        palette,
        &options.disabled_color_ids,
        &options.block_overrides,
        options.block_pack,
    )
    .into_iter()
    .filter(|candidate| !cube_is_disabled(&candidate.block, &options.disabled_blocks))
    .map(|mut candidate| {
        candidate.block = substitute_cube(&candidate.block, &options.block_substitutions);
        candidate
    })
    .collect()
}

fn cube_is_disabled(block: &BlockState, disabled: &[String]) -> bool {
    if disabled.is_empty() {
        return false;
    }
    let canon = block.canonical_name();
    let id = crate::palette::block_id(&canon);
    disabled.iter().any(|entry| {
        let key = crate::palette::block_id(entry);
        key == id || entry == &canon
    })
}

fn substitute_cube(block: &BlockState, substitutions: &BTreeMap<String, String>) -> BlockState {
    if substitutions.is_empty() {
        return block.clone();
    }
    let canon = block.canonical_name();
    let id = crate::palette::block_id(&canon);
    let next = substitutions
        .get(&canon)
        .or_else(|| substitutions.get(id))
        .or_else(|| substitutions.get(&format!("minecraft:{id}")));
    match next {
        Some(state) if crate::palette::is_statue_prop_block(state) => block.clone(),
        Some(state) => BlockState::parse(state).unwrap_or_else(|| block.clone()),
        None => block.clone(),
    }
}

pub fn validate_shared_materials(
    options: &SharedMaterialOptions,
    minecraft_version: &str,
) -> Result<()> {
    let palette = load_palette_for(minecraft_version)?;
    for (color_id, state) in &options.block_overrides {
        let color = palette
            .colors
            .iter()
            .find(|color| color.id == *color_id)
            .ok_or_else(|| anyhow::anyhow!("unknown map color ID {color_id}"))?;
        ensure!(
            crate::palette::is_known_block_state(&palette, state),
            "{state} is not a valid Minecraft block (override for {})",
            color.name
        );
    }
    for state in options.block_substitutions.values() {
        ensure!(
            crate::palette::is_known_block_state(&palette, state),
            "{state} is not a valid Minecraft block (cube replacement)"
        );
    }
    if options.support_mode == GravitySupportMode::Fixed {
        ensure!(
            crate::palette::is_known_block_state(&palette, &options.support_block),
            "{} is not a valid Minecraft support block",
            options.support_block
        );
    }
    Ok(())
}

pub fn build_from_shared(
    grid: &VoxelGrid,
    palette: &crate::palette::PaletteFile,
    candidates: &[PaletteCandidate],
    options: &SharedMaterialOptions,
    assigned: &VoxelAssignment,
) -> Result<BuildResult> {
    let fixed_support = BlockState::parse(&options.support_block)
        .unwrap_or_else(|| BlockState::simple("minecraft:cobblestone"));
    let mut blocks = Vec::new();
    let occupied = grid.occupied_count();
    blocks
        .try_reserve(occupied)
        .map_err(|_| {
            anyhow::anyhow!(
                "not enough memory to place {occupied} blocks. Try a smaller size or Hollow."
            )
        })?;
    let mut warnings = Vec::new();
    let mut matched_supports = 0_u32;

    for (x, y, z) in occupied_scan_order(grid) {
        let Some(rgb) = grid.rgb_at(x, y, z) else {
            continue;
        };
        let chosen = assigned
            .get(&grid.index(x, y, z))
            .copied()
            .unwrap_or_else(|| nearest_model_colour(rgb_f32(rgb), candidates, options.colour_matching));
        let candidate = &candidates[chosen];
        let color = palette
            .colors
            .iter()
            .find(|entry| entry.id == candidate.color_id);
        let needs_support = options.support_mode != GravitySupportMode::Off
            && block_needs_under_support(color, &candidate.block);
        if needs_support {
            let support_y = if y > 0 && grid.rgb_at(x, y - 1, z).is_none() {
                Some(y as i32 - 1)
            } else if y == 0 {
                Some(-1)
            } else {
                None
            };
            if let Some(support_y) = support_y {
                let support_state = match options.support_mode {
                    GravitySupportMode::Off => fixed_support.clone(),
                    GravitySupportMode::Fixed => fixed_support.clone(),
                    GravitySupportMode::MatchColor => {
                        matched_supports += 1;
                        matching_support_block(
                            rgb,
                            color,
                            palette,
                            candidates,
                            options.colour_matching,
                        )
                    }
                };
                blocks.push(PlacedBlock {
                    x: x as i32,
                    y: support_y,
                    z: z as i32,
                    state: support_state,
                });
            }
        }
        blocks.push(PlacedBlock {
            x: x as i32,
            y: y as i32,
            z: z as i32,
            state: candidate.block.clone(),
        });
    }

    ensure!(!blocks.is_empty(), "no blocks were generated from the model");

    match options.support_mode {
        GravitySupportMode::MatchColor if matched_supports > 0 => {
            warnings.push(
                "Gravity / carpet blocks are underpinned with the closest solid colour match."
                    .into(),
            );
        }
        GravitySupportMode::Fixed
            if blocks
                .iter()
                .any(|block| block.state.canonical_name() == fixed_support.canonical_name()) =>
        {
            warnings.push(format!(
                "Fixed support blocks ({}) are placed under gravity-affected blocks and carpets.",
                fixed_support.canonical_name()
            ));
        }
        GravitySupportMode::Off => {
            let mut warned = BTreeSet::new();
            for placed in &blocks {
                if !block_needs_under_support(None, &placed.state) {
                    continue;
                }
                let name = placed.state.canonical_name();
                if warned.insert(name.clone()) {
                    warnings.push(format!(
                        "{name} is gravity-affected and was placed without under-support.",
                    ));
                }
            }
        }
        _ => {}
    }
    warnings.sort();
    warnings.dedup();

    let min_y = blocks.iter().map(|block| block.y).min().unwrap_or(0);
    for block in &mut blocks {
        block.y -= min_y;
    }
    let max_y = blocks.iter().map(|block| block.y).max().unwrap_or(0);
    let height = max_y as u32 + 1;
    let mut counts = BTreeMap::<String, u64>::new();
    for block in &blocks {
        *counts.entry(block.state.canonical_name()).or_default() += 1;
    }
    let materials = counts
        .into_iter()
        .map(|(block, count)| MaterialCount {
            block,
            count,
            stacks: count / 64,
            remainder: count % 64,
        })
        .collect();

    Ok(BuildResult {
        structure: Structure {
            name: format!("StructureLab model ({})", palette.data_version),
            size: [grid.width, height, grid.length],
            blocks,
        },
        width: grid.width,
        length: grid.length,
        height,
        min_y,
        maps_x: 1,
        maps_y: 1,
        tiles: vec![MapTile {
            column: 0,
            row: 0,
            start_x: 0,
            start_z: 0,
        }],
        materials,
        warnings,
        minecraft_version: palette.minecraft_version.clone(),
        data_version: palette.data_version,
    })
}

fn rgb_f32(rgb: [u8; 3]) -> [f32; 3] {
    [rgb[0] as f32, rgb[1] as f32, rgb[2] as f32]
}

fn rgb_u8(rgb: [f32; 3]) -> [u8; 3] {
    [
        rgb[0].round().clamp(0.0, 255.0) as u8,
        rgb[1].round().clamp(0.0, 255.0) as u8,
        rgb[2].round().clamp(0.0, 255.0) as u8,
    ]
}

fn rgb_to_hsv(rgb: [f32; 3]) -> [f32; 3] {
    let r = (rgb[0] / 255.0).clamp(0.0, 1.0);
    let g = (rgb[1] / 255.0).clamp(0.0, 1.0);
    let b = (rgb[2] / 255.0).clamp(0.0, 1.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    let hue = if delta < 1e-6 {
        0.0
    } else if (max - r).abs() < 1e-6 {
        60.0 * (((g - b) / delta) % 6.0)
    } else if (max - g).abs() < 1e-6 {
        60.0 * (((b - r) / delta) + 2.0)
    } else {
        60.0 * (((r - g) / delta) + 4.0)
    };
    let sat = if max < 1e-6 { 0.0 } else { delta / max };
    [hue.rem_euclid(360.0), sat, max]
}

fn hsv_to_rgb(hsv: [f32; 3]) -> [f32; 3] {
    let h = hsv[0].rem_euclid(360.0);
    let s = hsv[1].clamp(0.0, 1.0);
    let v = hsv[2].clamp(0.0, 1.0);
    let hi = ((h / 60.0).floor() as i32).rem_euclid(6);
    let f = h / 60.0 - (h / 60.0).floor();
    let p = v * (1.0 - s);
    let q = v * (1.0 - f * s);
    let t = v * (1.0 - (1.0 - f) * s);
    let (r, g, b) = match hi {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    };
    [r * 255.0, g * 255.0, b * 255.0]
}

/// Same brightness / contrast / saturation as map art, plus a hue rotate.
pub(crate) fn adjust_rgb(
    rgb: [f32; 3],
    hue: f32,
    brightness: f32,
    contrast: f32,
    saturation: f32,
) -> [f32; 3] {
    let mut rgb = rgb;
    let hue = hue.clamp(-180.0, 180.0);
    if hue.abs() > 1e-4 {
        let mut hsv = rgb_to_hsv(rgb);
        hsv[0] = (hsv[0] + hue).rem_euclid(360.0);
        rgb = hsv_to_rgb(hsv);
    }
    let brightness = brightness.clamp(-100.0, 100.0) * 2.55;
    let contrast = (contrast.clamp(-100.0, 100.0) + 100.0) / 100.0;
    let saturation = (saturation.clamp(-100.0, 100.0) + 100.0) / 100.0;
    for channel in &mut rgb {
        *channel = ((*channel - 127.5) * contrast + 127.5 + brightness).clamp(0.0, 255.0);
    }
    let luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    for channel in &mut rgb {
        *channel = (luminance + (*channel - luminance) * saturation).clamp(0.0, 255.0);
    }
    rgb
}

pub(crate) fn adjust_grid_colours(
    grid: &mut VoxelGrid,
    hue: f32,
    brightness: f32,
    contrast: f32,
    saturation: f32,
) {
    if hue.abs() < 1e-6
        && brightness.abs() < 1e-6
        && contrast.abs() < 1e-6
        && saturation.abs() < 1e-6
    {
        return;
    }
    for coords in grid.occupied_coords() {
        let (x, y, z) = coords;
        grid.with_cell_mut(x, y, z, false, |cell| {
            if !cell.occupied {
                return;
            }
            let (sum, n) = if cell.base_samples > 0 {
                (cell.base_sum, cell.base_samples)
            } else if cell.overlay_samples > 0 {
                (cell.overlay_sum, cell.overlay_samples)
            } else if cell.samples > 0 {
                (cell.color_sum, cell.samples)
            } else {
                return;
            };
            let rgb = [
                sum[0] / n as f32,
                sum[1] / n as f32,
                sum[2] / n as f32,
            ];
            let adj = adjust_rgb(rgb, hue, brightness, contrast, saturation);
            cell.color_sum = adj;
            cell.samples = 1;
            if cell.base_samples > 0 {
                cell.base_sum = adj;
                cell.base_samples = 1;
            } else if cell.overlay_samples > 0 {
                cell.overlay_sum = adj;
                cell.overlay_samples = 1;
            }
        });
    }
}

/// Models matching uses the hue-aware metric so nearest colour stays nearest.
fn nearest_model_colour(
    rgb: [f32; 3],
    candidates: &[PaletteCandidate],
    matching: ColourMatching,
) -> usize {
    if matching == ColourMatching::HueAwareLab {
        let sample = rgb_u8(rgb);
        return candidates
            .iter()
            .enumerate()
            .min_by(|(_, left), (_, right)| {
                statue_color_distance(sample, left.rgb)
                    .total_cmp(&statue_color_distance(sample, right.rgb))
            })
            .map(|(index, _)| index)
            .unwrap_or(0);
    }
    nearest_colour(rgb, candidates, matching)
}

const MODEL_MIX_POOL: usize = 16;

fn model_mix_pool(target: [u8; 3], candidates: &[PaletteCandidate]) -> Vec<usize> {
    let lab = rgb_to_lab(target);
    let mut ranked: Vec<(f32, usize)> = candidates
        .iter()
        .enumerate()
        .filter(|(_, candidate)| warm_pink_drift(target, candidate.rgb) < 6.0)
        .map(|(index, candidate)| (perceptual_distance(lab, candidate.lab), index))
        .collect();
    if ranked.len() < 4 {
        ranked = candidates
            .iter()
            .enumerate()
            .map(|(index, candidate)| (perceptual_distance(lab, candidate.lab), index))
            .collect();
    }
    ranked.sort_by(|left, right| left.0.total_cmp(&right.0));
    ranked
        .into_iter()
        .take(MODEL_MIX_POOL)
        .map(|(_, index)| index)
        .collect()
}

/// `allow_solid` keeps a single block when one colour clearly wins, which stops
/// small statues speckling.
fn model_mixing_plan(
    target: [u8; 3],
    candidates: &[PaletteCandidate],
    allow_solid: bool,
) -> [usize; MIX_PLAN_SIZE] {
    let pool = model_mix_pool(target, candidates);
    if pool.is_empty() {
        return [0; MIX_PLAN_SIZE];
    }
    if pool.len() == 1 {
        return [pool[0]; MIX_PLAN_SIZE];
    }
    if allow_solid {
        let lab = rgb_to_lab(target);
        let first = perceptual_distance(lab, candidates[pool[0]].lab);
        let second = perceptual_distance(lab, candidates[pool[1]].lab);
        if second > first * 1.22 + 180.0 {
            return [pool[0]; MIX_PLAN_SIZE];
        }
    }
    mixing_plan_from_pool(target, candidates, &pool)
}

fn nearest_oklab(sample: [f32; 3], candidates: &[PaletteCandidate]) -> usize {
    let ok = rgb_to_oklab(rgb_u8(sample));
    candidates
        .iter()
        .enumerate()
        .min_by(|(_, left), (_, right)| {
            statue_oklab_distance(ok, left.oklab)
                .total_cmp(&statue_oklab_distance(ok, right.oklab))
        })
        .map(|(index, _)| index)
        .unwrap_or(0)
}

/// Inverse-distance mix of the two nearest Oklab cubes. A 5-bit RGB cache and a
/// “only mix if 8% closer” rule made every peach voxel the same block as the
/// old scan. Bayer grain stays 3D; error diffusion is still off.
fn smooth_plan(target: [u8; 3], candidates: &[PaletteCandidate]) -> [usize; MIX_PLAN_SIZE] {
    let sample = rgb_to_oklab(target);
    let mut ranked: Vec<(f32, usize)> = candidates
        .iter()
        .enumerate()
        .filter(|(_, candidate)| !crate::palette::statue_is_washed(sample, candidate.oklab))
        .map(|(index, candidate)| (statue_oklab_distance(sample, candidate.oklab), index))
        .collect();
    if ranked.len() < 2 {
        ranked = candidates
            .iter()
            .enumerate()
            .map(|(index, candidate)| (statue_oklab_distance(sample, candidate.oklab), index))
            .collect();
    }
    ranked.sort_by(|left, right| left.0.total_cmp(&right.0));
    let nearest = ranked.first().map(|entry| entry.1).unwrap_or(0);
    let mut plan = [nearest; MIX_PLAN_SIZE];
    if ranked.len() < 2 {
        return plan;
    }
    let d1 = ranked[0].0;
    let d2 = ranked[1].0;
    let second = ranked[1].1;
    if d1 < 1e-6 || d2 > d1 * 2.6 {
        return plan;
    }
    let mut t_second = d1 / (d1 + d2);
    t_second = cap_mix_luma(target, candidates[nearest].rgb, candidates[second].rgb, t_second);
    let n_second = ((t_second * MIX_PLAN_SIZE as f32).round() as usize).clamp(0, MIX_PLAN_SIZE);
    if n_second == 0 {
        return plan;
    }
    let dark_first =
        relative_luma(candidates[nearest].rgb) <= relative_luma(candidates[second].rgb);
    let (lo, hi, n_hi) = if dark_first {
        (nearest, second, n_second)
    } else {
        (second, nearest, MIX_PLAN_SIZE.saturating_sub(n_second))
    };
    for slot in plan.iter_mut().take(MIX_PLAN_SIZE.saturating_sub(n_hi)) {
        *slot = lo;
    }
    for slot in plan.iter_mut().skip(MIX_PLAN_SIZE.saturating_sub(n_hi)) {
        *slot = hi;
    }
    plan
}

/// Keep the dithered pair from pulling area lightness more than a few luma steps.
fn cap_mix_luma(sample: [u8; 3], a: [u8; 3], b: [u8; 3], t_b: f32) -> f32 {
    let ys = relative_luma(sample);
    let ya = relative_luma(a);
    let yb = relative_luma(b);
    let mixed = ya * (1.0 - t_b) + yb * t_b;
    if (mixed - ys).abs() <= 14.0 {
        return t_b.clamp(0.0, 0.45);
    }
    let denom = yb - ya;
    if denom.abs() < 1e-3 {
        return 0.0;
    }
    let target_y = ys.clamp(ys - 14.0, ys + 14.0);
    ((target_y - ya) / denom).clamp(0.0, 0.45)
}

fn relative_luma(rgb: [u8; 3]) -> f32 {
    0.2126 * rgb[0] as f32 + 0.7152 * rgb[1] as f32 + 0.0722 * rgb[2] as f32
}

fn is_lightness_outlier(grid: &VoxelGrid, x: u32, y: u32, z: u32) -> bool {
    let Some(rgb) = grid.rgb_at(x, y, z) else {
        return false;
    };
    let l = rgb_to_oklab(rgb)[0];
    let dirs = [
        (1_i32, 0, 0),
        (-1, 0, 0),
        (0, 1, 0),
        (0, -1, 0),
        (0, 0, 1),
        (0, 0, -1),
    ];
    let mut n = 0_u32;
    let mut sum = 0.0_f32;
    for (dx, dy, dz) in dirs {
        let nx = x as i32 + dx;
        let ny = y as i32 + dy;
        let nz = z as i32 + dz;
        if nx < 0
            || ny < 0
            || nz < 0
            || nx >= grid.width as i32
            || ny >= grid.height as i32
            || nz >= grid.length as i32
        {
            continue;
        }
        if let Some(neighbour) = grid.rgb_at(nx as u32, ny as u32, nz as u32) {
            n += 1;
            sum += rgb_to_oklab(neighbour)[0];
        }
    }
    n >= 3 && (l - sum / n as f32).abs() > 0.14
}

fn occupied_scan_order(grid: &VoxelGrid) -> Vec<(u32, u32, u32)> {
    let mut coords = grid.occupied_coords();
    coords.sort_unstable_by_key(|&(x, y, z)| (y, z, x));
    coords
}

/// Oklab pair-mix + 3D Bayer. No Floyd–Steinberg: error diffusion was what
/// brightened faces and smeared pupils into skin.
fn assign_smooth(
    grid: &VoxelGrid,
    candidates: &[PaletteCandidate],
    assigned: &mut VoxelAssignment,
) {
    let mut plans: HashMap<[u8; 3], [usize; MIX_PLAN_SIZE]> = HashMap::new();
    for (x, y, z) in occupied_scan_order(grid) {
        let Some(rgb) = grid.rgb_at(x, y, z) else {
            continue;
        };
        let index = grid.index(x, y, z);
        if is_lightness_outlier(grid, x, y, z) {
            assigned.insert(index, nearest_oklab(rgb_f32(rgb), candidates));
            continue;
        }
        let plan = *plans.entry(rgb).or_insert_with(|| smooth_plan(rgb, candidates));
        let bayer = BAYER_8[(z as usize + y as usize * 3) % 8][x as usize % 8] as usize;
        assigned.insert(index, plan[bayer * MIX_PLAN_SIZE / 64]);
    }
}

/// Assign a palette index to every occupied voxel.
pub fn assign_model_colours(
    grid: &VoxelGrid,
    candidates: &[PaletteCandidate],
    options: &SharedMaterialOptions,
) -> VoxelAssignment {
    let mut assigned = VoxelAssignment::new();
    if candidates.is_empty() {
        return assigned;
    }
    if options.colour_matching == ColourMatching::StructureLabMix {
        assign_mix(grid, candidates, &mut assigned);
        return assigned;
    }
    if options.colour_matching == ColourMatching::StructureLabSmooth {
        assign_smooth(grid, candidates, &mut assigned);
        return assigned;
    }
    match options.dither {
        DitherMode::None => {
            for (x, y, z) in occupied_scan_order(grid) {
                let Some(rgb) = grid.rgb_at(x, y, z) else {
                    continue;
                };
                assigned.insert(
                    grid.index(x, y, z),
                    nearest_model_colour(
                        rgb_f32(rgb),
                        candidates,
                        options.colour_matching,
                    ),
                );
            }
        }
        DitherMode::Ordered => {
            const BAYER: [[f32; 4]; 4] = [
                [0.0, 8.0, 2.0, 10.0],
                [12.0, 4.0, 14.0, 6.0],
                [3.0, 11.0, 1.0, 9.0],
                [15.0, 7.0, 13.0, 5.0],
            ];
            for (x, y, z) in occupied_scan_order(grid) {
                let Some(rgb) = grid.rgb_at(x, y, z) else {
                    continue;
                };
                let offset =
                    (BAYER[z as usize % 4][x as usize % 4] / 16.0 - 0.5) * 28.0;
                let sample = [
                    (rgb[0] as f32 + offset).clamp(0.0, 255.0),
                    (rgb[1] as f32 + offset).clamp(0.0, 255.0),
                    (rgb[2] as f32 + offset).clamp(0.0, 255.0),
                ];
                assigned.insert(
                    grid.index(x, y, z),
                    nearest_model_colour(sample, candidates, options.colour_matching),
                );
            }
        }
        DitherMode::FloydSteinberg | DitherMode::Atkinson => {
            assign_error_diffusion(grid, candidates, options, &mut assigned);
        }
    }
    assigned
}

fn assign_error_diffusion(
    grid: &VoxelGrid,
    candidates: &[PaletteCandidate],
    options: &SharedMaterialOptions,
    assigned: &mut VoxelAssignment,
) {
    let width = grid.width as usize;
    let length = grid.length as usize;
    let floyd = options.dither == DitherMode::FloydSteinberg;
    let taps: &[(isize, isize, f32)] = if floyd {
        &[
            (1, 0, 7.0 / 16.0),
            (-1, 1, 3.0 / 16.0),
            (0, 1, 5.0 / 16.0),
            (1, 1, 1.0 / 16.0),
        ]
    } else {
        &[
            (1, 0, 1.0 / 8.0),
            (2, 0, 1.0 / 8.0),
            (-1, 1, 1.0 / 8.0),
            (0, 1, 1.0 / 8.0),
            (1, 1, 1.0 / 8.0),
            (0, 2, 1.0 / 8.0),
        ]
    };
    for y in 0..grid.height {
        let mut work = vec![[0.0_f32; 3]; width * length];
        for z in 0..grid.length {
            for x in 0..grid.width {
                if let Some(rgb) = grid.rgb_at(x, y, z) {
                    work[z as usize * width + x as usize] = rgb_f32(rgb);
                }
            }
        }
        for z in 0..length {
            for x in 0..width {
                if grid.rgb_at(x as u32, y, z as u32).is_none() {
                    continue;
                }
                let index = z * width + x;
                let sample = work[index];
                let chosen = nearest_model_colour(sample, candidates, options.colour_matching);
                assigned.insert(grid.index(x as u32, y, z as u32), chosen);
                let target = candidates[chosen].rgb;
                let error = [
                    sample[0] - target[0] as f32,
                    sample[1] - target[1] as f32,
                    sample[2] - target[2] as f32,
                ];
                for &(dx, dz, weight) in taps {
                    let nx = x as isize + dx;
                    let nz = z as isize + dz;
                    if nx < 0 || nz < 0 || nx >= width as isize || nz >= length as isize {
                        continue;
                    }
                    if grid.rgb_at(nx as u32, y, nz as u32).is_none() {
                        continue;
                    }
                    let next = nz as usize * width + nx as usize;
                    for channel in 0..3 {
                        work[next][channel] =
                            (work[next][channel] + error[channel] * weight).clamp(0.0, 255.0);
                    }
                }
            }
        }
    }
}

fn assign_mix(
    grid: &VoxelGrid,
    candidates: &[PaletteCandidate],
    assigned: &mut VoxelAssignment,
) {
    let mut plans: HashMap<[u8; 3], [usize; MIX_PLAN_SIZE]> = HashMap::new();
    let width = grid.width as usize;
    let length = grid.length as usize;
    for y in 0..grid.height {
        let mut work = vec![[0.0_f32; 3]; width * length];
        for z in 0..grid.length {
            for x in 0..grid.width {
                if let Some(rgb) = grid.rgb_at(x, y, z) {
                    work[z as usize * width + x as usize] = rgb_f32(rgb);
                }
            }
        }
        for z in 0..length {
            for x in 0..width {
                if grid.rgb_at(x as u32, y, z as u32).is_none() {
                    continue;
                }
                let index = z * width + x;
                let sample = work[index];
                let key = [
                    (sample[0].round().clamp(0.0, 255.0) as u8) >> 3,
                    (sample[1].round().clamp(0.0, 255.0) as u8) >> 3,
                    (sample[2].round().clamp(0.0, 255.0) as u8) >> 3,
                ];
                let plan = *plans.entry(key).or_insert_with(|| {
                    let half = 1_u8 << 2;
                    model_mixing_plan(
                        key.map(|c| (c << 3).saturating_add(half)),
                        candidates,
                        true,
                    )
                });
                let chosen = plan[BAYER_8[z % 8][x % 8] as usize * MIX_PLAN_SIZE / 64];
                assigned.insert(grid.index(x as u32, y, z as u32), chosen);
                let picked = candidates[chosen].rgb;
                let error = [
                    (sample[0] - picked[0] as f32) * MIX_DIFFUSION,
                    (sample[1] - picked[1] as f32) * MIX_DIFFUSION,
                    (sample[2] - picked[2] as f32) * MIX_DIFFUSION,
                ];
                for &(dx, dz, weight) in &[
                    (1_isize, 0_isize, 7.0 / 16.0),
                    (-1, 1, 3.0 / 16.0),
                    (0, 1, 5.0 / 16.0),
                    (1, 1, 1.0 / 16.0),
                ] {
                    let nx = x as isize + dx;
                    let nz = z as isize + dz;
                    if nx < 0 || nz < 0 || nx >= width as isize || nz >= length as isize {
                        continue;
                    }
                    if grid.rgb_at(nx as u32, y, nz as u32).is_none() {
                        continue;
                    }
                    let next = nz as usize * width + nx as usize;
                    for channel in 0..3 {
                        work[next][channel] =
                            (work[next][channel] + error[channel] * weight).clamp(0.0, 255.0);
                    }
                }
            }
        }
    }
}

/// Prefer a solid non-gravity block from the same map colour, else the closest solid colour.
fn matching_support_block(
    rgb: [u8; 3],
    source_color: Option<&crate::palette::MapColor>,
    palette: &crate::palette::PaletteFile,
    candidates: &[PaletteCandidate],
    matching: ColourMatching,
) -> BlockState {
    if let Some(color) = source_color {
        let same_color_solid = candidates.iter().find(|candidate| {
            candidate.color_id == color.id
                && !block_needs_under_support(Some(color), &candidate.block)
        });
        if let Some(candidate) = same_color_solid {
            return candidate.block.clone();
        }
        // Try any alternative on this map colour that does not need under-support.
        for state in std::iter::once(color.block.as_str()).chain(color.alternatives.iter().map(String::as_str)) {
            if crate::palette::is_infested_block(state) {
                continue;
            }
            if let Some(parsed) = BlockState::parse(state) {
                if !block_needs_under_support(Some(color), &parsed) {
                    return parsed;
                }
            }
        }
    }

    let solid: Vec<PaletteCandidate> = candidates
        .iter()
        .filter(|candidate| {
            let color = palette
                .colors
                .iter()
                .find(|entry| entry.id == candidate.color_id);
            !block_needs_under_support(color, &candidate.block)
        })
        .cloned()
        .collect();
    if solid.is_empty() {
        return BlockState::simple("minecraft:stone");
    }
    let idx = nearest_model_colour(rgb_f32(rgb), &solid, matching);
    solid
        .get(idx)
        .map(|candidate| candidate.block.clone())
        .unwrap_or_else(|| BlockState::simple("minecraft:stone"))
}

pub fn encode_preview_grid(
    grid: &VoxelGrid,
    candidates: &[PaletteCandidate],
    assigned: &VoxelAssignment,
) -> Result<String> {
    const MAX_ISO_CUBES: usize = 24_000;
    const MAX_ISO_PIXELS: u64 = 1_200_000;
    // True isometric cubes so 3D statues don't look like flat mapart sprites.
    let mut order = grid.occupied_coords();
    if order.len() > MAX_ISO_CUBES {
        let step = (order.len() + MAX_ISO_CUBES - 1) / MAX_ISO_CUBES;
        order = order.into_iter().step_by(step.max(1)).collect();
    }
    let tile = if order.len() > 8_000 { 4_i32 } else { 8_i32 };
    // Far to near for painter's algorithm.
    order.sort_by_key(|&(x, y, z)| (x as i32 + z as i32 + y as i32, x, z));

    let mut min_sx = i32::MAX;
    let mut min_sy = i32::MAX;
    let mut max_sx = i32::MIN;
    let mut max_sy = i32::MIN;
    for &(x, y, z) in &order {
        for (cx, cy, cz) in cube_corners(x as i32, y as i32, z as i32) {
            let (sx, sy) = project_iso(cx, cy, cz, tile);
            min_sx = min_sx.min(sx);
            min_sy = min_sy.min(sy);
            max_sx = max_sx.max(sx);
            max_sy = max_sy.max(sy);
        }
    }
    if order.is_empty() {
        min_sx = 0;
        min_sy = 0;
        max_sx = tile;
        max_sy = tile;
    }
    let pad = tile;
    let width = (max_sx - min_sx + pad * 2).max(tile) as u32;
    let height = (max_sy - min_sy + pad * 2).max(tile) as u32;
    if width == 0
        || height == 0
        || (width as u64).saturating_mul(height as u64) > MAX_ISO_PIXELS
    {
        return Ok(String::new());
    }
    let origin_x = -min_sx + pad;
    let origin_y = -min_sy + pad;
    let mut image = RgbaImage::from_pixel(width, height, Rgba([12, 16, 22, 255]));

    for (x, y, z) in order {
        let rgb = grid.rgb_at(x, y, z).unwrap_or([180, 180, 180]);
        let chosen = assigned.get(&grid.index(x, y, z)).copied().unwrap_or(0);
        let color = candidates.get(chosen).map(|c| c.rgb).unwrap_or(rgb);
        draw_iso_cube(
            &mut image,
            x as i32,
            y as i32,
            z as i32,
            tile,
            origin_x,
            origin_y,
            color,
        );
    }

    let mut bytes = Cursor::new(Vec::new());
    image.write_to(&mut bytes, ImageFormat::Png)?;
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(bytes.into_inner())
    ))
}

fn project_iso(x: i32, y: i32, z: i32, tile: i32) -> (i32, i32) {
    let sx = (x - z) * tile / 2;
    let sy = (x + z) * tile / 4 - y * tile / 2;
    (sx, sy)
}

fn cube_corners(x: i32, y: i32, z: i32) -> [(i32, i32, i32); 8] {
    [
        (x, y, z),
        (x + 1, y, z),
        (x, y + 1, z),
        (x + 1, y + 1, z),
        (x, y, z + 1),
        (x + 1, y, z + 1),
        (x, y + 1, z + 1),
        (x + 1, y + 1, z + 1),
    ]
}

fn shade_rgb(rgb: [u8; 3], factor: f32) -> [u8; 4] {
    [
        (rgb[0] as f32 * factor).clamp(0.0, 255.0) as u8,
        (rgb[1] as f32 * factor).clamp(0.0, 255.0) as u8,
        (rgb[2] as f32 * factor).clamp(0.0, 255.0) as u8,
        255,
    ]
}

fn draw_iso_cube(
    image: &mut RgbaImage,
    x: i32,
    y: i32,
    z: i32,
    tile: i32,
    origin_x: i32,
    origin_y: i32,
    rgb: [u8; 3],
) {
    let p = |cx: i32, cy: i32, cz: i32| {
        let (sx, sy) = project_iso(cx, cy, cz, tile);
        (sx + origin_x, sy + origin_y)
    };
    // Top face
    fill_quad(
        image,
        p(x, y + 1, z),
        p(x + 1, y + 1, z),
        p(x + 1, y + 1, z + 1),
        p(x, y + 1, z + 1),
        shade_rgb(rgb, 1.08),
    );
    // Left face (-X / +Z side in this projection)
    fill_quad(
        image,
        p(x, y, z + 1),
        p(x, y + 1, z + 1),
        p(x + 1, y + 1, z + 1),
        p(x + 1, y, z + 1),
        shade_rgb(rgb, 0.72),
    );
    // Right face
    fill_quad(
        image,
        p(x + 1, y, z),
        p(x + 1, y + 1, z),
        p(x + 1, y + 1, z + 1),
        p(x + 1, y, z + 1),
        shade_rgb(rgb, 0.88),
    );
}

fn fill_quad(
    image: &mut RgbaImage,
    a: (i32, i32),
    b: (i32, i32),
    c: (i32, i32),
    d: (i32, i32),
    color: [u8; 4],
) {
    fill_triangle(image, a, b, c, color);
    fill_triangle(image, a, c, d, color);
}

fn fill_triangle(
    image: &mut RgbaImage,
    a: (i32, i32),
    b: (i32, i32),
    c: (i32, i32),
    color: [u8; 4],
) {
    let min_x = a.0.min(b.0).min(c.0);
    let max_x = a.0.max(b.0).max(c.0);
    let min_y = a.1.min(b.1).min(c.1);
    let max_y = a.1.max(b.1).max(c.1);
    let area = edge(a, b, c);
    if area == 0 {
        return;
    }
    for py in min_y..=max_y {
        for px in min_x..=max_x {
            let w0 = edge((px, py), b, c);
            let w1 = edge((px, py), c, a);
            let w2 = edge((px, py), a, b);
            let inside = if area > 0 {
                w0 >= 0 && w1 >= 0 && w2 >= 0
            } else {
                w0 <= 0 && w1 <= 0 && w2 <= 0
            };
            if inside {
                put_pixel(image, px, py, color);
            }
        }
    }
}

fn edge(a: (i32, i32), b: (i32, i32), c: (i32, i32)) -> i32 {
    (c.0 - a.0) * (b.1 - a.1) - (c.1 - a.1) * (b.0 - a.0)
}

fn put_pixel(image: &mut RgbaImage, x: i32, y: i32, color: [u8; 4]) {
    if x < 0 || y < 0 {
        return;
    }
    let (x, y) = (x as u32, y as u32);
    if x < image.width() && y < image.height() {
        image.put_pixel(x, y, Rgba(color));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_obj_cube_shell_to_blocks() {
        let obj = br#"
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3
f 1 3 4
f 5 8 7
f 5 7 6
f 1 5 6
f 1 6 2
f 4 3 7
f 4 7 8
f 1 4 8
f 1 8 5
f 2 6 7
f 2 7 3
"#;
        let response = convert_model(
            obj,
            "cube.obj",
            &ModelConvertOptions {
                width: 16,
                height: 16,
                length: 16,
                hollow: true,
                support_mode: GravitySupportMode::Off,
                ..ModelConvertOptions::default()
            },
            "26.2",
        )
        .unwrap();
        assert!(response.occupied_voxels > 10);
        assert!(!response.build.structure.blocks.is_empty());
        assert!(response.preview_data_url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn accepts_cross_colour_block_override() {
        let shared = SharedMaterialOptions {
            disabled_color_ids: Vec::new(),
            block_overrides: BTreeMap::from([(60, "minecraft:white_terracotta".into())]),
            support_mode: GravitySupportMode::Off,
            support_block: "minecraft:cobblestone".into(),
            ..Default::default()
        };
        validate_shared_materials(&shared, "26.2").expect("white terracotta should override RAW_IRON");
        let bad = SharedMaterialOptions {
            block_overrides: BTreeMap::from([(60, "minecraft:definitely_fake".into())]),
            ..shared
        };
        assert!(validate_shared_materials(&bad, "26.2").is_err());
    }

    #[test]
    fn model_colour_default_is_smooth_with_no_dither() {
        let shared = SharedMaterialOptions::default();
        assert_eq!(shared.colour_matching, ColourMatching::StructureLabSmooth);
        assert_eq!(shared.dither, DitherMode::None);
        assert_eq!(shared.support_mode, GravitySupportMode::Off);
        assert_eq!(shared.block_pack, StatueBlockPack::Everything);
    }

    #[test]
    fn disabled_blocks_drop_that_cube_only() {
        let palette = load_palette_for("26.2").unwrap();
        let all = crate::palette::candidates_for_models_appearance(&palette, &[], &Default::default());
        assert!(all.iter().any(|c| c.block.canonical_name() == "minecraft:oak_planks"));
        let shared = SharedMaterialOptions {
            disabled_blocks: vec!["oak_planks".into()],
            ..SharedMaterialOptions::default()
        };
        let filtered = model_candidates_for(&palette, &shared);
        assert!(filtered.iter().all(|c| c.block.canonical_name() != "minecraft:oak_planks"));
        assert!(filtered.iter().any(|c| c.block.canonical_name() == "minecraft:birch_planks"));
    }

    #[test]
    fn colour_tune_hue_rotates_red_toward_cyan() {
        let cyan = adjust_rgb([255.0, 0.0, 0.0], 180.0, 0.0, 0.0, 0.0);
        assert!(
            cyan[0] < 40.0 && cyan[1] > 200.0 && cyan[2] > 200.0,
            "180° from red should be cyan, got {cyan:?}"
        );
        let brighter = adjust_rgb([80.0, 80.0, 80.0], 0.0, 40.0, 0.0, 0.0);
        let grey = 80.0;
        assert!(
            brighter[0] > grey + 20.0,
            "brightness +40 must lift grey, got {brighter:?}"
        );
        let greyed = adjust_rgb([200.0, 40.0, 40.0], 0.0, 0.0, 0.0, -100.0);
        let spread = (greyed[0] - greyed[1]).abs() + (greyed[1] - greyed[2]).abs();
        assert!(spread < 8.0, "saturation −100 must grey the sample, got {greyed:?}");
        let same = adjust_rgb([210.0, 165.0, 140.0], 0.0, 0.0, 0.0, 0.0);
        assert!((same[0] - 210.0).abs() < 0.5 && (same[1] - 165.0).abs() < 0.5);
    }

    #[test]
    fn smooth_matching_keeps_peach_off_white_cubes() {
        let palette = load_palette_for("26.2").unwrap();
        let candidates = crate::palette::candidates_for_models_appearance(
            &palette,
            &[],
            &Default::default(),
        );
        let idx = nearest_oklab([210.0, 165.0, 140.0], &candidates);
        let name = candidates[idx].block.canonical_name();
        eprintln!("smooth peach [210,165,140] → {name}");
        let pinkish = name.contains("pink_")
            || name.contains("magenta_")
            || name.contains("purple_")
            || name.contains("purpur")
            || name == "minecraft:white_terracotta"
            || name == "minecraft:white_wool"
            || name == "minecraft:iron_block"
            || name == "minecraft:raw_iron_block"
            || name == "minecraft:raw_gold_block"
            || name.contains("quartz")
            || name.contains("calcite")
            || name.contains("bone")
            || name.contains("snow");
        assert!(
            !pinkish,
            "lit peach skin must not snap to a white or pink cube, got {name}"
        );
    }

    #[test]
    fn smooth_plan_mixes_closer_than_a_single_cube() {
        let palette = load_palette_for("26.2").unwrap();
        let candidates = crate::palette::candidates_for_models_appearance(
            &palette,
            &[],
            &Default::default(),
        );
        let peach = [210_u8, 165, 140];
        let plan = smooth_plan(peach, &candidates);
        let used: std::collections::BTreeSet<_> = plan.into_iter().collect();
        assert!(
            used.len() >= 2,
            "smooth must dither two neighbours on peach, got {:?}",
            used.iter()
                .map(|index| candidates[*index].block.canonical_name())
                .collect::<Vec<_>>()
        );
        for index in &used {
            let name = candidates[*index].block.canonical_name();
            assert!(
                name != "minecraft:white_terracotta"
                    && name != "minecraft:raw_iron_block"
                    && !name.contains("pink_")
                    && !name.contains("magenta_")
                    && !name.contains("purpur"),
                "smooth peach must not mix with {name}"
            );
        }
        let sample_y = relative_luma(peach);
        let mix_y = plan
            .iter()
            .map(|slot| relative_luma(candidates[*slot].rgb))
            .sum::<f32>()
            / MIX_PLAN_SIZE as f32;
        assert!(
            (mix_y - sample_y).abs() < 16.0,
            "smooth peach mix luma {mix_y:.1} drifted from sample {sample_y:.1}"
        );
    }

    #[test]
    fn mix_pool_keeps_peach_off_white_terracotta() {
        let palette = load_palette_for("26.2").unwrap();
        let candidates = crate::palette::candidates_for_models_appearance(
            &palette,
            &[],
            &Default::default(),
        );
        let pool = model_mix_pool([210, 165, 140], &candidates);
        assert!(pool.len() >= 4, "peach mix pool should still have neighbours");
        for index in pool {
            let name = candidates[index].block.canonical_name();
            assert!(
                name != "minecraft:white_terracotta"
                    && name != "minecraft:raw_iron_block"
                    && name != "minecraft:raw_gold_block"
                    && !name.contains("pink_")
                    && !name.contains("magenta_")
                    && !name.contains("purpur"),
                "peach mix must not dither with {name}"
            );
        }
    }

    fn mean_luma(rgbs: &[[f32; 3]]) -> f32 {
        if rgbs.is_empty() {
            return 0.0;
        }
        rgbs.iter()
            .map(|c| 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])
            .sum::<f32>()
            / rgbs.len() as f32
    }

    fn luma_of(c: [f32; 3]) -> f32 {
        0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }

    #[test]
    fn smooth_match_does_not_lift_dark_eye_or_blacken_skin() {
        let palette = load_palette_for("26.2").unwrap();
        let candidates = crate::palette::candidates_for_models_appearance(
            &palette,
            &[],
            &Default::default(),
        );
        let eye = nearest_oklab([18.0, 12.0, 10.0], &candidates);
        let eye_rgb = candidates[eye].rgb;
        let eye_y = luma_of([eye_rgb[0] as f32, eye_rgb[1] as f32, eye_rgb[2] as f32]);
        eprintln!(
            "smooth eye [18,12,10] → {} luma {eye_y:.1}",
            candidates[eye].block.name
        );
        assert!(
            eye_y < 40.0,
            "dark eye must not snap to a lighter cube: {} luma {eye_y:.1}",
            candidates[eye].block.name
        );

        let skin = nearest_oklab([210.0, 165.0, 140.0], &candidates);
        let skin_rgb = candidates[skin].rgb;
        let skin_y = luma_of([skin_rgb[0] as f32, skin_rgb[1] as f32, skin_rgb[2] as f32]);
        eprintln!(
            "smooth skin [210,165,140] → {} luma {skin_y:.1}",
            candidates[skin].block.name
        );
        assert!(
            skin_y > 80.0,
            "peach skin must not collapse to a dark cube: {} luma {skin_y:.1}",
            candidates[skin].block.name
        );
    }

    #[test]
    fn smooth_pipeline_compare_texture_voxels_and_blocks() {
        // Peach face, dark eyes, a 1px specular. Compare original texels →
        // voxel colours → assigned blocks so lightness and details cannot drift
        // silently. Also compare against a box-filter (the old blender) and mix.
        let mut pixels = vec![0_u8; 32 * 32 * 4];
        for i in (0..pixels.len()).step_by(4) {
            pixels[i] = 210;
            pixels[i + 1] = 165;
            pixels[i + 2] = 140;
            pixels[i + 3] = 255;
        }
        let paint = |px: &mut [u8], x: usize, y: usize, rgb: [u8; 3]| {
            let i = (y * 32 + x) * 4;
            px[i] = rgb[0];
            px[i + 1] = rgb[1];
            px[i + 2] = rgb[2];
        };
        for y in 8..12 {
            for x in 8..12 {
                paint(&mut pixels, x, y, [18, 12, 10]);
            }
            for x in 20..24 {
                paint(&mut pixels, x, y, [18, 12, 10]);
            }
        }
        paint(&mut pixels, 2, 2, [255, 255, 255]);
        let texture = image::RgbaImage::from_raw(32, 32, pixels).expect("32x32");
        let tex_rgbs: Vec<[f32; 3]> = texture
            .pixels()
            .filter(|p| p.0[3] > 20)
            .map(|p| [p.0[0] as f32, p.0[1] as f32, p.0[2] as f32])
            .collect();
        let tex_dark = tex_rgbs.iter().filter(|c| luma_of(**c) < 40.0).count();

        // 2×2 box-filter to 16×16 — the mean that used to wash pupils into skin.
        let mut box_rgbs = Vec::new();
        let mut box_dark = 0usize;
        for y in 0..16 {
            for x in 0..16 {
                let mut acc = [0.0_f32; 3];
                for dy in 0..2 {
                    for dx in 0..2 {
                        let p = texture.get_pixel(x * 2 + dx, y * 2 + dy).0;
                        acc[0] += p[0] as f32;
                        acc[1] += p[1] as f32;
                        acc[2] += p[2] as f32;
                    }
                }
                let c = [acc[0] / 4.0, acc[1] / 4.0, acc[2] / 4.0];
                if luma_of(c) < 40.0 {
                    box_dark += 1;
                }
                box_rgbs.push(c);
            }
        }

        let mesh = Mesh {
            positions: vec![
                [0.0, 0.0, 0.0],
                [32.0, 0.0, 0.0],
                [32.0, 32.0, 0.0],
                [0.0, 32.0, 0.0],
            ],
            colors: vec![[210.0, 165.0, 140.0]; 4],
            uvs: vec![[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
            texture: Some(texture.clone()),
            textures: vec![texture],
            texture_index: vec![0, 0, 0, 0],
            layers: vec![0, 0, 0, 0],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };
        let grid = voxelize_mesh(&mesh, 16, 16, 4, VoxelFit::Stretch, false, false).unwrap();
        let mut voxel_rgbs = Vec::new();
        let mut dark_voxels: Vec<(u32, u32, u32, [f32; 3])> = Vec::new();
        for y in 0..grid.height {
            for z in 0..grid.length {
                for x in 0..grid.width {
                    if let Some(rgb) = grid.rgb_at(x, y, z) {
                        let c = [rgb[0] as f32, rgb[1] as f32, rgb[2] as f32];
                        voxel_rgbs.push(c);
                        if luma_of(c) < 40.0 {
                            dark_voxels.push((x, y, z, c));
                        }
                    }
                }
            }
        }
        let voxel_dark = dark_voxels.len();

        let palette = load_palette_for("26.2").unwrap();
        let candidates = crate::palette::candidates_for_models_appearance(
            &palette,
            &[],
            &Default::default(),
        );
        let mut assigned = VoxelAssignment::new();
        assign_smooth(&grid, &candidates, &mut assigned);
        let mut block_rgbs = Vec::new();
        let mut block_dark = 0usize;
        let mut lifted = 0usize;
        for y in 0..grid.height {
            for z in 0..grid.length {
                for x in 0..grid.width {
                    let Some(slot) = assigned.get(&grid.index(x, y, z)).copied() else {
                        continue;
                    };
                    let rgb = candidates[slot].rgb;
                    let c = [rgb[0] as f32, rgb[1] as f32, rgb[2] as f32];
                    let by = luma_of(c);
                    if by < 40.0 {
                        block_dark += 1;
                    }
                    if let Some(voxel) = grid.rgb_at(x, y, z) {
                        let vy = luma_of([voxel[0] as f32, voxel[1] as f32, voxel[2] as f32]);
                        if vy < 40.0 && by > vy + 18.0 {
                            lifted += 1;
                            eprintln!(
                                "lifted dark voxel ({x},{y},{z}) luma {vy:.1} → {} luma {by:.1}",
                                candidates[slot].block.name
                            );
                        }
                    }
                    block_rgbs.push(c);
                }
            }
        }

        let mut mix_assigned = VoxelAssignment::new();
        assign_mix(&grid, &candidates, &mut mix_assigned);
        let mix_dark = mix_assigned
            .values()
            .filter(|slot| {
                let rgb = candidates[**slot].rgb;
                luma_of([rgb[0] as f32, rgb[1] as f32, rgb[2] as f32]) < 40.0
            })
            .count();

        let tex_l = mean_luma(&tex_rgbs);
        let box_l = mean_luma(&box_rgbs);
        let voxel_l = mean_luma(&voxel_rgbs);
        let block_l = mean_luma(&block_rgbs);
        eprintln!(
            "smooth compare: texture luma {tex_l:.1} (dark {tex_dark}) → box-filter {box_l:.1} (dark {box_dark}) → voxels {voxel_l:.1} (dark {voxel_dark}) → blocks {block_l:.1} (dark {block_dark}, lifted {lifted}) | mix dark {mix_dark}"
        );
        assert!(
            voxel_l <= tex_l + 8.0,
            "voxeliser must not brighten the face: texture {tex_l:.1} voxels {voxel_l:.1}"
        );
        assert!(
            (voxel_l - tex_l).abs() < 14.0,
            "voxeliser must not sink the face either: texture {tex_l:.1} voxels {voxel_l:.1}"
        );
        assert!(
            block_l <= voxel_l + 16.0,
            "block match must not lift voxels: voxels {voxel_l:.1} blocks {block_l:.1}"
        );
        assert!(
            voxel_dark >= 4,
            "dark eye texels must survive voxelisation (texture dark={tex_dark}, box-filter dark={box_dark}, voxel dark={voxel_dark})"
        );
        assert!(
            voxel_dark >= box_dark,
            "two-tone footprint should keep at least as many dark cells as a mean box-filter (voxels {voxel_dark} box {box_dark})"
        );
        assert!(
            block_dark > 0,
            "dark voxels must stay dark blocks, not a brighter neighbour"
        );
        assert!(
            lifted == 0,
            "{lifted} dark voxels were assigned a much lighter cube"
        );
        assert!(
            block_dark >= mix_dark,
            "smooth should not dither eyes into skin (smooth dark {block_dark} mix dark {mix_dark})"
        );
    }
}
