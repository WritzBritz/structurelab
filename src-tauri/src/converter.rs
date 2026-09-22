use crate::model::{
    ArtKind, BuildMode, BuildOrientation, BuildResult, ColourMatching, ConvertOptions, MapTile,
    MaterialCount, PlacedBlock, SizeMode, StaircaseHeightAnchor, StaircaseStartEdge, Structure,
    MAP_EDGE,
};
use crate::palette::{
    candidates, ciede2000, linear_to_oklab, load_palette_for, model_color_distance,
    perceptual_distance, relative_luminance, rgb_to_lab, rgb_to_mapartcraft_lab, rgb_to_oklab,
    PaletteCandidate, StructureLabProfile,
};
use anyhow::{bail, ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{
    codecs::png::{CompressionType, FilterType as PngFilterType, PngEncoder},
    imageops::{self, FilterType},
    DynamicImage, GenericImageView, ImageEncoder, Rgba, RgbaImage,
};
#[cfg(test)]
use image::ImageFormat;
use rayon::prelude::*;
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    io::Cursor,
};

/// Sentinel in the per-pixel selection list: no block placed (transparent hole).
const EMPTY_SELECTION: usize = usize::MAX;
/// Surface-preview index reserved for empty pixels.
const EMPTY_SURFACE: u8 = 255;
/// Alpha below this is treated as empty — matches skip-transparent and trim.
const TRANSPARENT_ALPHA: u8 = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionResponse {
    pub source_width: u32,
    pub source_height: u32,
    pub preview_data_url: String,
    /// Top-surface block states for the textured 2D map preview (one per map pixel).
    pub preview_surface_palette: Vec<String>,
    /// Base64 of `width * length` bytes — index into `preview_surface_palette`.
    pub preview_surface_indices: String,
    /// Unique block states used in the 3D preview (indexed by voxel records).
    pub preview_block_palette: Vec<String>,
    /// Base64 of packed voxels: repeating `[x:u16][y:u16][z:u16][paletteIndex:u8]` little-endian.
    /// Includes support / water / staircase control blocks from the real structure.
    pub preview_voxels: String,
    /// When >1, preview kept every Nth column; cubes should be drawn N wide so they stay flush.
    pub preview_voxel_stride: u32,
    pub build: BuildResult,
}

#[cfg(test)]
fn auto_grid(width: u32, height: u32) -> [u32; 2] {
    [
        width.max(1).div_ceil(MAP_EDGE),
        height.max(1).div_ceil(MAP_EDGE),
    ]
}

fn resolve_footprint(options: &ConvertOptions) -> Result<(u32, u32)> {
    let (width, length) = match options.size_mode {
        SizeMode::Maps => {
            ensure!(
                options.maps_x > 0 && options.maps_y > 0,
                "map grid cannot be zero"
            );
            let width = options
                .maps_x
                .checked_mul(MAP_EDGE)
                .context("map footprint is too large")?;
            let length = options
                .maps_y
                .checked_mul(MAP_EDGE)
                .context("map footprint is too large")?;
            (width, length)
        }
        SizeMode::Custom => {
            ensure!(
                options.blocks_x > 0 && options.blocks_z > 0,
                "custom size cannot be zero"
            );
            (options.blocks_x, options.blocks_z)
        }
    };
    Ok((width, length))
}

/// Map art stays floor-bound with shading modes; pixel art is flat + orientable.
fn normalize_art_options(options: &mut ConvertOptions) {
    match options.art_kind {
        ArtKind::MapArt => {
            options.orientation = BuildOrientation::Floor;
        }
        ArtKind::PixelArt => {
            options.mode = BuildMode::Flat;
        }
    }
}

pub fn convert_image(
    data: &[u8],
    options: &ConvertOptions,
    minecraft_version: &str,
) -> Result<ConversionResponse> {
    let mut options = options.clone();
    normalize_art_options(&mut options);
    let source = image::load_from_memory(data).context("unsupported or damaged image")?;
    let (source_width, source_height) = source.dimensions();
    let source = if options.trim_transparent {
        trim_transparent(source)
    } else {
        source
    };
    // Native 1:1 custom size (pixel art import) should shrink with the crop so
    // transparent padding is actually removed, not stretched back in.
    let native_custom = options.size_mode == SizeMode::Custom
        && options.blocks_x == source_width
        && options.blocks_z == source_height;
    let (width, length) = if options.trim_transparent && native_custom {
        (source.width().max(1), source.height().max(1))
    } else {
        resolve_footprint(&options)?
    };
    let mut image = fit_image(&source, width, length, options.fit);
    adjust_image(
        &mut image,
        options.brightness,
        options.contrast,
        options.saturation,
        options.skip_transparent,
    );

    let palette = load_palette_for(minecraft_version)?;
    for (color_id, state) in &options.block_overrides {
        let color = palette
            .colors
            .iter()
            .find(|color| color.id == *color_id)
            .with_context(|| format!("unknown map color ID {color_id}"))?;
        ensure!(
            crate::palette::is_known_block_state(&palette, state),
            "{state} is not a valid Minecraft block (override for {})",
            color.name
        );
    }
    if options.mode == BuildMode::Staircase
        || (options.support_under_gravity && options.mode == BuildMode::Flat)
    {
        ensure!(
            crate::palette::is_known_block_state(&palette, &options.staircase_support_block),
            "{} is not a valid Minecraft support block",
            options.staircase_support_block
        );
    }
    let palette_candidates = candidates(
        &palette,
        options.mode,
        options.art_kind,
        &options.disabled_color_ids,
        &options.block_overrides,
        options.orientation,
    );
    ensure!(!palette_candidates.is_empty(), "no map colors are enabled");

    let opaque_mask = if options.skip_transparent {
        Some(opaque_mask(&image))
    } else {
        None
    };

    let (mut selected, heights) = match options.mode {
        BuildMode::Flat => {
            let selected = quantize(
                &image,
                &palette_candidates,
                options.dither,
                options.colour_matching,
                None,
            )?;
            let heights = vec![0_i32; selected.len()];
            (selected, heights)
        }
        BuildMode::Staircase => {
            // Classic first: match all 3 shades so the map colours stay exact.
            // Ground-up then re-solves *shades of those blocks* so the control
            // row sits on y=0 and the column only builds up. Off keeps the
            // classic stairs and shifts each column onto the ground (never a
            // whole-map lift). A binding height budget also re-solves shades.
            let mut selected = quantize(
                &image,
                &palette_candidates,
                options.dither,
                options.colour_matching,
                None,
            )?;
            let width_usize = width as usize;
            let length_usize = length as usize;
            let mut heights = classic_staircase_heights(
                &selected,
                &palette_candidates,
                width_usize,
                length_usize,
                options.staircase_start_edge,
                opaque_mask.as_deref(),
            )?;
            if options.staircase_start_edge == StaircaseStartEdge::Bottom {
                invert_selection_shades(&mut selected, &palette_candidates);
            }
            let limit = if options.staircase_height_auto {
                STAIRCASE_AUTO_SOFT_CAP
            } else {
                options.max_height.clamp(3, 384)
            };
            // Carpets and gravity blocks get a support block one below them, so
            // that block — not the art — is the bottom of the column.
            let support_below = support_below_flags(
                &palette,
                &palette_candidates,
                options.support_under_gravity,
            );
            let needed = max_island_height_span(
                &heights,
                &selected,
                &palette_candidates,
                &support_below,
                width_usize,
                length_usize,
                options.staircase_start_edge,
            );
            let floor_needs_replan = options.staircase_height_anchor
                == StaircaseHeightAnchor::Floor
                && any_island_below_floor(
                    &heights,
                    &selected,
                    &palette_candidates,
                    &support_below,
                    width_usize,
                    length_usize,
                    options.staircase_start_edge,
                );
            if needed > limit || floor_needs_replan {
                let color_ids = color_ids_from_selection(&selected, &palette_candidates);
                let (solved_selected, solved_heights) = solve_staircase(
                    &image,
                    &palette_candidates,
                    limit,
                    options.staircase_height_anchor,
                    options.staircase_start_edge,
                    options.colour_matching,
                    opaque_mask.as_deref(),
                    &color_ids,
                )?;
                selected = solved_selected;
                heights = solved_heights;
            }
            // Both layouts sit on the ground per column. Ground-up DP already
            // starts at y=0; Off still needs this shift after classic / centred
            // stairs so a dip in one column cannot lift the rest of the map.
            floor_align_islands(
                &mut heights,
                &selected,
                &palette_candidates,
                &support_below,
                width_usize,
                length_usize,
                options.staircase_start_edge,
            );
            (selected, heights)
        }
    };
    if let Some(mask) = &opaque_mask {
        for (index, &opaque) in mask.iter().enumerate() {
            if !opaque {
                selected[index] = EMPTY_SELECTION;
            }
        }
    }

    let build = build_structure(
        &palette,
        &palette_candidates,
        &selected,
        &heights,
        &options,
        width,
        length,
    );
    let preview_data_url = encode_preview(width, length, &selected, &palette_candidates)?;
    let (preview_surface_palette, preview_surface_indices) =
        encode_preview_surface(&selected, &palette_candidates);
    let (preview_block_palette, preview_voxels, preview_voxel_stride) =
        encode_preview_voxels(&build);
    Ok(ConversionResponse {
        source_width,
        source_height,
        preview_data_url,
        preview_surface_palette,
        preview_surface_indices,
        preview_block_palette,
        preview_voxels,
        preview_voxel_stride,
        build,
    })
}

fn fit_image(
    source: &DynamicImage,
    width: u32,
    height: u32,
    fit: crate::model::FitMode,
) -> RgbaImage {
    use crate::model::FitMode;
    // Lanczos is excellent but expensive on huge targets; CatmullRom stays sharp enough
    // for map-art and is much faster above ~1M output pixels.
    let filter = if (width as u64).saturating_mul(height as u64) > 1_000_000 {
        FilterType::CatmullRom
    } else {
        FilterType::Lanczos3
    };
    match fit {
        FitMode::Stretch => imageops::resize(source, width, height, filter),
        FitMode::Contain => {
            let scale =
                (width as f32 / source.width() as f32).min(height as f32 / source.height() as f32);
            let resized_width = (source.width() as f32 * scale).round().max(1.0) as u32;
            let resized_height = (source.height() as f32 * scale).round().max(1.0) as u32;
            let resized = imageops::resize(source, resized_width, resized_height, filter);
            let mut canvas = RgbaImage::from_pixel(width, height, Rgba([0, 0, 0, 0]));
            imageops::overlay(
                &mut canvas,
                &resized,
                ((width - resized_width) / 2) as i64,
                ((height - resized_height) / 2) as i64,
            );
            canvas
        }
        FitMode::Cover => {
            let scale =
                (width as f32 / source.width() as f32).max(height as f32 / source.height() as f32);
            let resized_width = (source.width() as f32 * scale).round().max(width as f32) as u32;
            let resized_height = (source.height() as f32 * scale).round().max(height as f32) as u32;
            let resized = imageops::resize(source, resized_width, resized_height, filter);
            imageops::crop_imm(
                &resized,
                (resized_width - width) / 2,
                (resized_height - height) / 2,
                width,
                height,
            )
            .to_image()
        }
    }
}

fn trim_transparent(source: DynamicImage) -> DynamicImage {
    let rgba = source.to_rgba8();
    let mut min_x = rgba.width();
    let mut min_y = rgba.height();
    let mut max_x = 0u32;
    let mut max_y = 0u32;
    let mut found = false;
    for (x, y, pixel) in rgba.enumerate_pixels() {
        if pixel[3] >= TRANSPARENT_ALPHA {
            found = true;
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }
    if !found {
        return DynamicImage::ImageRgba8(rgba);
    }
    DynamicImage::ImageRgba8(
        imageops::crop_imm(&rgba, min_x, min_y, max_x - min_x + 1, max_y - min_y + 1)
            .to_image(),
    )
}

fn adjust_image(
    image: &mut RgbaImage,
    brightness: f32,
    contrast: f32,
    saturation: f32,
    skip_transparent: bool,
) {
    let brightness = brightness.clamp(-100.0, 100.0) * 2.55;
    let contrast = (contrast.clamp(-100.0, 100.0) + 100.0) / 100.0;
    let saturation = (saturation.clamp(-100.0, 100.0) + 100.0) / 100.0;
    for pixel in image.pixels_mut() {
        if pixel[3] < TRANSPARENT_ALPHA {
            if skip_transparent {
                *pixel = Rgba([0, 0, 0, 0]);
            } else {
                *pixel = Rgba([255, 255, 255, 255]);
            }
            continue;
        }
        let mut rgb = [pixel[0] as f32, pixel[1] as f32, pixel[2] as f32];
        for channel in &mut rgb {
            *channel = ((*channel - 127.5) * contrast + 127.5 + brightness).clamp(0.0, 255.0);
        }
        let luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        for channel in &mut rgb {
            *channel = (luminance + (*channel - luminance) * saturation).clamp(0.0, 255.0);
        }
        *pixel = Rgba([rgb[0] as u8, rgb[1] as u8, rgb[2] as u8, 255]);
    }
}

fn opaque_mask(image: &RgbaImage) -> Vec<bool> {
    image.pixels().map(|pixel| pixel[3] >= TRANSPARENT_ALPHA).collect()
}

#[derive(Clone, Copy)]
struct MatchingCtx {
    matching: ColourMatching,
    structure_lab: Option<StructureLabProfile>,
}

#[derive(Clone, Copy)]
struct PreparedSample {
    rgb: [u8; 3],
    lab: [f32; 3],
    oklab: [f32; 3],
}

fn matching_ctx(matching: ColourMatching, candidates: &[PaletteCandidate]) -> MatchingCtx {
    MatchingCtx {
        matching,
        structure_lab: match matching {
            ColourMatching::OklabHueGuard => Some(StructureLabProfile::from_candidates(candidates)),
            _ => None,
        },
    }
}

fn prepare_sample(rgb: [u8; 3], ctx: MatchingCtx) -> PreparedSample {
    match ctx.matching {
        ColourMatching::OklabHueGuard => PreparedSample {
            rgb,
            lab: [0.0; 3],
            oklab: ctx
                .structure_lab
                .expect("Oklab hue-guard profile")
                .premap(rgb_to_oklab(rgb)),
        },
        ColourMatching::RebaneMapartClassic => PreparedSample {
            rgb,
            lab: rgb_to_mapartcraft_lab(rgb),
            oklab: [0.0; 3],
        },
        ColourMatching::HueAwareLab => PreparedSample {
            rgb,
            lab: [0.0; 3],
            oklab: [0.0; 3],
        },
        _ => PreparedSample {
            rgb,
            lab: rgb_to_lab(rgb),
            oklab: [0.0; 3],
        },
    }
}

fn colour_distance(
    ctx: MatchingCtx,
    sample: PreparedSample,
    candidate: &PaletteCandidate,
) -> f32 {
    match ctx.matching {
        ColourMatching::HueAwareLab => model_color_distance(sample.rgb, candidate.rgb),
        ColourMatching::RebaneMapartClassic => {
            perceptual_distance(sample.lab, candidate.mapart_lab)
        }
        ColourMatching::Ciede2000 => ciede2000(sample.lab, candidate.lab),
        ColourMatching::OklabHueGuard => ctx
            .structure_lab
            .expect("Oklab hue-guard profile")
            .distance(sample.oklab, candidate),
        // Mix modes never rank single candidates — they solve a whole plan.
        ColourMatching::StructureLabMix | ColourMatching::StructureLabSmooth => {
            perceptual_distance(sample.lab, candidate.lab)
        }
    }
}

/// Colours per mixing plan. The Bayer cell picks one slot, so the plan's
/// linear-light average is what the eye integrates across a block of pixels.
pub(crate) const MIX_PLAN_SIZE: usize = 16;
/// Nearest candidates considered when building a plan. Keeps the search bounded
/// without starving mixes of the complementary colours they need.
const MIX_POOL_SIZE: usize = 16;

pub(crate) const BAYER_8: [[u8; 8]; 8] = [
    [0, 48, 12, 60, 3, 51, 15, 63],
    [32, 16, 44, 28, 35, 19, 47, 31],
    [8, 56, 4, 52, 11, 59, 7, 55],
    [40, 24, 36, 20, 43, 27, 39, 23],
    [2, 50, 14, 62, 1, 49, 13, 61],
    [34, 18, 46, 30, 33, 17, 45, 29],
    [10, 58, 6, 54, 9, 57, 5, 53],
    [42, 26, 38, 22, 41, 25, 37, 21],
];

/// Candidates nearest `target_oklab`, cheapest-first, honouring a shade lock.
fn mix_pool(
    target_oklab: [f32; 3],
    candidates: &[PaletteCandidate],
    shade_lock: Option<u8>,
) -> Vec<usize> {
    let mut best: Vec<(f32, usize)> = Vec::with_capacity(MIX_POOL_SIZE + 1);
    for (index, candidate) in candidates.iter().enumerate() {
        if shade_lock.is_some_and(|shade| candidate.shade != shade) {
            continue;
        }
        let score = perceptual_distance(target_oklab, candidate.oklab);
        let slot = best.partition_point(|(existing, _)| *existing <= score);
        if slot >= MIX_POOL_SIZE {
            continue;
        }
        best.insert(slot, (score, index));
        best.truncate(MIX_POOL_SIZE);
    }
    best.into_iter().map(|(_, index)| index).collect()
}

/// Greedy mixing plan: repeatedly add whichever palette colour (in whatever
/// doubling amount) moves the plan's linear-light average closest to the target.
/// Yliluoma's arbitrary-palette positional dithering, scored in Oklab.
pub(crate) fn mixing_plan(
    target_rgb: [u8; 3],
    candidates: &[PaletteCandidate],
    shade_lock: Option<u8>,
) -> [usize; MIX_PLAN_SIZE] {
    let target_oklab = rgb_to_oklab(target_rgb);
    let pool = mix_pool(target_oklab, candidates, shade_lock);
    mixing_plan_from_pool(target_rgb, candidates, &pool)
}

pub(crate) fn mixing_plan_from_pool(
    target_rgb: [u8; 3],
    candidates: &[PaletteCandidate],
    pool: &[usize],
) -> [usize; MIX_PLAN_SIZE] {
    let target_oklab = rgb_to_oklab(target_rgb);
    let fallback = pool.first().copied().unwrap_or(0);
    let mut plan = [fallback; MIX_PLAN_SIZE];
    if pool.is_empty() {
        return plan;
    }

    let mut filled = 0usize;
    let mut sum = [0.0_f32; 3];
    while filled < MIX_PLAN_SIZE {
        let remaining = MIX_PLAN_SIZE - filled;
        // Cap growth so early picks cannot claim the whole plan outright.
        let max_amount = if filled == 0 { 1 } else { filled.min(remaining) };
        let mut best_penalty = f32::INFINITY;
        let mut best_index = pool[0];
        let mut best_amount = 1usize;
        for &index in pool {
            let linear = candidates[index].linear;
            let mut amount = 1usize;
            while amount <= max_amount {
                let scale = amount as f32;
                let total = (filled + amount) as f32;
                let average = [
                    (sum[0] + linear[0] * scale) / total,
                    (sum[1] + linear[1] * scale) / total,
                    (sum[2] + linear[2] * scale) / total,
                ];
                let penalty = perceptual_distance(linear_to_oklab(average), target_oklab);
                if penalty < best_penalty {
                    best_penalty = penalty;
                    best_index = index;
                    best_amount = amount;
                }
                amount *= 2;
            }
        }
        let linear = candidates[best_index].linear;
        let scale = best_amount as f32;
        for channel in 0..3 {
            sum[channel] += linear[channel] * scale;
        }
        for slot in plan.iter_mut().skip(filled).take(best_amount) {
            *slot = best_index;
        }
        filled += best_amount;
    }

    // Luminance order turns the Bayer ramp into a smooth light→dark sweep.
    plan.sort_by(|left, right| {
        relative_luminance(candidates[*left].linear)
            .total_cmp(&relative_luminance(candidates[*right].linear))
    });
    plan
}

/// Plans are cached on a 32-level-per-channel grid. Error is still diffused from
/// the exact working colour, so this only coarsens plan lookup, never accounting.
const MIX_KEY_BITS: u8 = 3;

/// How much of the leftover error carries into neighbours. The plan already
/// handles colours it can average to; this covers the detail it cannot, and at
/// half strength it never lost to plain Floyd–Steinberg in testing.
pub(crate) const MIX_DIFFUSION: f32 = 0.5;

fn mix_key(rgb: [f32; 3], shade_lock: Option<u8>) -> ([u8; 3], Option<u8>) {
    let quantized = [
        (rgb[0].round().clamp(0.0, 255.0) as u8) >> MIX_KEY_BITS,
        (rgb[1].round().clamp(0.0, 255.0) as u8) >> MIX_KEY_BITS,
        (rgb[2].round().clamp(0.0, 255.0) as u8) >> MIX_KEY_BITS,
    ];
    (quantized, shade_lock)
}

/// Colour at the centre of a quantized key's cell.
fn mix_key_rgb(key: [u8; 3]) -> [u8; 3] {
    let half = 1_u8 << (MIX_KEY_BITS - 1);
    key.map(|channel| (channel << MIX_KEY_BITS).saturating_add(half))
}

/// StructureLab perceptual mix. A mixing plan gives each pixel a set of palette
/// colours whose blend matches the target, placed by Bayer cell; the residual the
/// plan cannot express is diffused so fine detail still tracks locally. Supplies
/// its own dithering, so `dither` is intentionally unused here.
fn quantize_mix(
    image: &RgbaImage,
    candidates: &[PaletteCandidate],
    shade_lock: Option<&[u8]>,
) -> Vec<usize> {
    let width = image.width() as usize;
    let height = image.height() as usize;
    let lock_at = |index: usize| {
        shade_lock.and_then(|locks| {
            let shade = locks[index];
            (shade <= 2).then_some(shade)
        })
    };

    let mut work = image
        .pixels()
        .map(|p| [p[0] as f32, p[1] as f32, p[2] as f32])
        .collect::<Vec<_>>();
    let mut plans: HashMap<([u8; 3], Option<u8>), [usize; MIX_PLAN_SIZE]> = HashMap::new();
    let mut output = vec![EMPTY_SELECTION; work.len()];

    for y in 0..height {
        for x in 0..width {
            let index = y * width + x;
            if image.get_pixel(x as u32, y as u32)[3] < TRANSPARENT_ALPHA {
                continue;
            }
            let sample = work[index];
            let key = mix_key(sample, lock_at(index));
            let plan = plans
                .entry(key)
                .or_insert_with(|| mixing_plan(mix_key_rgb(key.0), candidates, key.1));
            let chosen = plan[BAYER_8[y % 8][x % 8] as usize * MIX_PLAN_SIZE / 64];
            output[index] = chosen;

            let picked = candidates[chosen].rgb;
            let error = [
                (sample[0] - picked[0] as f32) * MIX_DIFFUSION,
                (sample[1] - picked[1] as f32) * MIX_DIFFUSION,
                (sample[2] - picked[2] as f32) * MIX_DIFFUSION,
            ];
            const TAPS: [(isize, isize, f32); 4] = [
                (1, 0, 7.0 / 16.0),
                (-1, 1, 3.0 / 16.0),
                (0, 1, 5.0 / 16.0),
                (1, 1, 1.0 / 16.0),
            ];
            for (dx, dy, weight) in TAPS {
                let nx = x as isize + dx;
                let ny = y as isize + dy;
                if nx < 0 || ny < 0 || nx >= width as isize || ny >= height as isize {
                    continue;
                }
                if image.get_pixel(nx as u32, ny as u32)[3] < TRANSPARENT_ALPHA {
                    continue;
                }
                let next = ny as usize * width + nx as usize;
                for channel in 0..3 {
                    work[next][channel] =
                        (work[next][channel] + error[channel] * weight).clamp(0.0, 255.0);
                }
            }
        }
    }

    output
}

fn nearest(
    rgb: [f32; 3],
    candidates: &[PaletteCandidate],
    ctx: MatchingCtx,
    shade_lock: Option<u8>,
) -> usize {
    let sample_rgb = [
        rgb[0].round().clamp(0.0, 255.0) as u8,
        rgb[1].round().clamp(0.0, 255.0) as u8,
        rgb[2].round().clamp(0.0, 255.0) as u8,
    ];
    let sample = prepare_sample(sample_rgb, ctx);
    candidates
        .iter()
        .enumerate()
        .filter(|(_, candidate)| shade_lock.map_or(true, |shade| candidate.shade == shade))
        .min_by(|(_, left), (_, right)| {
            colour_distance(ctx, sample, left).total_cmp(&colour_distance(ctx, sample, right))
        })
        .map(|(index, _)| index)
        .unwrap_or(0)
}

/// Pick a palette index for one RGB sample. Mix mode falls back to CIE Lab
/// nearest — callers that want a mixing plan should use `mixing_plan`.
pub(crate) fn nearest_colour(
    rgb: [f32; 3],
    candidates: &[PaletteCandidate],
    matching: ColourMatching,
) -> usize {
    let ctx = matching_ctx(matching, candidates);
    nearest(rgb, candidates, ctx, None)
}

/// Ordered Bayer amplitude — classic mapart strength for gradients on 128×128.
const ORDERED_DITHER_AMOUNT: f32 = 28.0;

fn quantize(
    image: &RgbaImage,
    candidates: &[PaletteCandidate],
    dither: crate::model::DitherMode,
    matching: ColourMatching,
    shade_lock: Option<&[u8]>,
) -> Result<Vec<usize>> {
    use crate::model::DitherMode;
    if matching == ColourMatching::StructureLabMix {
        return Ok(quantize_mix(image, candidates, shade_lock));
    }
    let ctx = matching_ctx(matching, candidates);
    let width = image.width() as usize;
    let height = image.height() as usize;
    let lock_at = |index: usize| {
        shade_lock.and_then(|locks| {
            let shade = locks[index];
            (shade <= 2).then_some(shade)
        })
    };

    // None / Ordered have no error diffusion — safe to parallelize per pixel.
    if matches!(dither, DitherMode::None | DitherMode::Ordered) {
        const BAYER: [[f32; 4]; 4] = [
            [0.0, 8.0, 2.0, 10.0],
            [12.0, 4.0, 14.0, 6.0],
            [3.0, 11.0, 1.0, 9.0],
            [15.0, 7.0, 13.0, 5.0],
        ];
        let ordered = dither == DitherMode::Ordered;
        let output = (0..height * width)
            .into_par_iter()
            .map(|index| {
                let x = index % width;
                let y = index / width;
                let pixel = image.get_pixel(x as u32, y as u32);
                if pixel[3] < TRANSPARENT_ALPHA {
                    return EMPTY_SELECTION;
                }
                let mut sample = [pixel[0] as f32, pixel[1] as f32, pixel[2] as f32];
                if ordered {
                    let offset = (BAYER[y % 4][x % 4] / 16.0 - 0.5) * ORDERED_DITHER_AMOUNT;
                    for channel in &mut sample {
                        *channel = (*channel + offset).clamp(0.0, 255.0);
                    }
                }
                nearest(sample, candidates, ctx, lock_at(index))
            })
            .collect();
        return Ok(output);
    }

    let mut work = image
        .pixels()
        .map(|p| [p[0] as f32, p[1] as f32, p[2] as f32])
        .collect::<Vec<_>>();
    let mut output = vec![0; work.len()];
    for y in 0..height {
        for x in 0..width {
            let index = y * width + x;
            let pixel = image.get_pixel(x as u32, y as u32);
            if pixel[3] < TRANSPARENT_ALPHA {
                output[index] = EMPTY_SELECTION;
                continue;
            }
            let sample = work[index];
            let chosen = nearest(sample, candidates, ctx, lock_at(index));
            output[index] = chosen;
            let target = candidates[chosen].rgb;
            let error = [
                sample[0] - target[0] as f32,
                sample[1] - target[1] as f32,
                sample[2] - target[2] as f32,
            ];
            // MapartCraft scans left→right (no serpentine).
            let taps: &[(isize, isize, f32)] = if dither == DitherMode::FloydSteinberg {
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
            for &(dx, dy, weight) in taps {
                let nx = x as isize + dx;
                let ny = y as isize + dy;
                if nx >= 0 && ny >= 0 && nx < width as isize && ny < height as isize {
                    let next = ny as usize * width + nx as usize;
                    if image.get_pixel(nx as u32, ny as u32)[3] < TRANSPARENT_ALPHA {
                        continue;
                    }
                    for channel in 0..3 {
                        work[next][channel] =
                            (work[next][channel] + error[channel] * weight).clamp(0.0, 255.0);
                    }
                }
            }
        }
    }
    Ok(output)
}

fn color_ids_from_selection(selected: &[usize], candidates: &[PaletteCandidate]) -> Vec<u8> {
    selected
        .iter()
        .map(|&choice| {
            if choice == EMPTY_SELECTION {
                255
            } else {
                candidates[choice].color_id
            }
        })
        .collect()
}

/// MapartCraft Classic height: prefix-sum of north-based steps.
///
/// Walk starts at the virtual northern control (y=0). Y may go negative when
/// dark shades stack. Ground-up re-plans those columns so they start on the
/// floor and never dig; Off keeps these relative stairs and then shifts each
/// column onto y=0 (a global lift would raise every other column too).
fn heights_from_shades(
    selected: &[usize],
    candidates: &[PaletteCandidate],
    width: usize,
    length: usize,
    opaque: Option<&[bool]>,
) -> Result<Vec<i32>> {
    ensure!(selected.len() == width * length, "selection size mismatch");

    let mut heights = vec![0_i32; width * length];
    for x in 0..width {
        let mut z = 0usize;
        while z < length {
            let opaque_here = opaque
                .map(|mask| mask[z * width + x])
                .unwrap_or(true);
            if !opaque_here || selected[z * width + x] == EMPTY_SELECTION {
                z += 1;
                continue;
            }
            let start_z = z;
            z += 1;
            while z < length {
                let next_opaque = opaque
                    .map(|mask| mask[z * width + x])
                    .unwrap_or(true);
                if !next_opaque || selected[z * width + x] == EMPTY_SELECTION {
                    break;
                }
                z += 1;
            }
            let mut y = 0_i32;
            for row in start_z..z {
                let index = row * width + x;
                let choice = selected[index];
                if choice == EMPTY_SELECTION {
                    continue;
                }
                y += shade_height_delta(candidates[choice].shade);
                heights[index] = y;
            }
        }
    }
    Ok(heights)
}

/// MapartCraft Classic heights for Auto — respects which image edge the control row uses.
fn classic_staircase_heights(
    selected: &[usize],
    candidates: &[PaletteCandidate],
    width: usize,
    length: usize,
    start_edge: StaircaseStartEdge,
    opaque: Option<&[bool]>,
) -> Result<Vec<i32>> {
    match start_edge {
        StaircaseStartEdge::Top => {
            heights_from_shades(selected, candidates, width, length, opaque)
        }
        StaircaseStartEdge::Bottom => {
            let opaque_working = opaque.map(|mask| flip_mask_vertical(mask, width, length));
            let mut working = selected.to_vec();
            flip_selection_vertical(&mut working, width, length);
            let mut heights = heights_from_shades(
                &working,
                candidates,
                width,
                length,
                opaque_working.as_deref(),
            )?;
            flip_heights_vertical(&mut heights, width, length);
            Ok(heights)
        }
    }
}

/// Which candidates get a support block placed one below them (gravity blocks and
/// carpets). That support is the real bottom of the column, so both the height
/// layout and the height cap have to count it — otherwise a column reported as
/// sitting on y=0 actually reaches y=-1.
fn support_below_flags(
    palette: &crate::palette::PaletteFile,
    candidates: &[PaletteCandidate],
    support_under_gravity: bool,
) -> Vec<bool> {
    if !support_under_gravity {
        return vec![false; candidates.len()];
    }
    candidates
        .iter()
        .map(|candidate| {
            let color = palette
                .colors
                .iter()
                .find(|entry| entry.id == candidate.color_id);
            block_needs_under_support(color, &candidate.block)
        })
        .collect()
}

/// Lowest y this pixel occupies, support block included.
fn pixel_bottom(heights: &[i32], selected: &[usize], support_below: &[bool], index: usize) -> i32 {
    heights[index] - i32::from(support_below[selected[index]])
}

fn island_y_bounds(
    heights: &[i32],
    selected: &[usize],
    candidates: &[PaletteCandidate],
    support_below: &[bool],
    width: usize,
    length: usize,
    x: usize,
    start_z: usize,
    end_z: usize,
    start_edge: StaircaseStartEdge,
) -> Option<(i32, i32)> {
    let mut min_y = i32::MAX;
    let mut max_y = i32::MIN;
    for z in start_z..end_z {
        let index = z * width + x;
        if selected[index] == EMPTY_SELECTION {
            continue;
        }
        min_y = min_y.min(pixel_bottom(heights, selected, support_below, index));
        max_y = max_y.max(heights[index]);
    }
    if min_y == i32::MAX {
        return None;
    }
    let abuts_control = match start_edge {
        StaircaseStartEdge::Top => start_z == 0,
        StaircaseStartEdge::Bottom => end_z == length,
    };
    if abuts_control {
        let edge_z = match start_edge {
            StaircaseStartEdge::Top => start_z,
            StaircaseStartEdge::Bottom => end_z.saturating_sub(1),
        };
        let edge_index = edge_z * width + x;
        if selected.get(edge_index).copied().unwrap_or(EMPTY_SELECTION) != EMPTY_SELECTION {
            let control = heights[edge_index]
                - shade_height_delta(candidates[selected[edge_index]].shade);
            min_y = min_y.min(control);
            max_y = max_y.max(control);
        }
    }
    Some((min_y, max_y))
}

fn max_island_height_span(
    heights: &[i32],
    selected: &[usize],
    candidates: &[PaletteCandidate],
    support_below: &[bool],
    width: usize,
    length: usize,
    start_edge: StaircaseStartEdge,
) -> u32 {
    let mut best = 1_u32;
    for x in 0..width {
        let mut z = 0usize;
        while z < length {
            if selected[z * width + x] == EMPTY_SELECTION {
                z += 1;
                continue;
            }
            let start_z = z;
            z += 1;
            while z < length && selected[z * width + x] != EMPTY_SELECTION {
                z += 1;
            }
            if let Some((min_y, max_y)) = island_y_bounds(
                heights,
                selected,
                candidates,
                support_below,
                width,
                length,
                x,
                start_z,
                z,
                start_edge,
            ) {
                best = best.max((max_y - min_y + 1) as u32);
            }
        }
    }
    best
}

/// True when any opaque island dips below y=0 (art, supports, or control).
/// Ground-up re-solves those columns so they start on the floor and only build up.
fn any_island_below_floor(
    heights: &[i32],
    selected: &[usize],
    candidates: &[PaletteCandidate],
    support_below: &[bool],
    width: usize,
    length: usize,
    start_edge: StaircaseStartEdge,
) -> bool {
    for x in 0..width {
        let mut z = 0usize;
        while z < length {
            if selected[z * width + x] == EMPTY_SELECTION {
                z += 1;
                continue;
            }
            let start_z = z;
            z += 1;
            while z < length && selected[z * width + x] != EMPTY_SELECTION {
                z += 1;
            }
            if let Some((min_y, _)) = island_y_bounds(
                heights,
                selected,
                candidates,
                support_below,
                width,
                length,
                x,
                start_z,
                z,
                start_edge,
            ) {
                if min_y < 0 {
                    return true;
                }
            }
        }
    }
    false
}

fn solve_staircase(
    image: &RgbaImage,
    candidates: &[PaletteCandidate],
    max_height: u32,
    anchor: StaircaseHeightAnchor,
    start_edge: StaircaseStartEdge,
    matching: ColourMatching,
    opaque: Option<&[bool]>,
    preferred_ids: &[u8],
) -> Result<(Vec<usize>, Vec<i32>)> {
    let width = image.width() as usize;
    let length = image.height() as usize;
    let levels = max_height as usize;
    ensure!(levels >= 3, "staircase max height must be at least 3");
    let by_shade = [0_u8, 1, 2].map(|shade| {
        candidates
            .iter()
            .enumerate()
            .filter(|(_, candidate)| candidate.shade == shade)
            .map(|(index, _)| index)
            .collect::<Vec<_>>()
    });
    if by_shade.iter().any(Vec::is_empty) {
        bail!("staircase palette needs low, normal, and high shades");
    }
    let ctx = matching_ctx(matching, candidates);

    // Bottom edge: flip north↔south, solve with a northern control row, then flip
    // back and invert shades (0↔2) so Minecraft's north-based map shading stays valid.
    let working = match start_edge {
        StaircaseStartEdge::Top => image.clone(),
        StaircaseStartEdge::Bottom => flip_image_vertical(image),
    };
    let opaque_working: Option<Vec<bool>> = opaque.map(|mask| match start_edge {
        StaircaseStartEdge::Top => mask.to_vec(),
        StaircaseStartEdge::Bottom => flip_mask_vertical(mask, width, length),
    });
    let mut working_ids = preferred_ids.to_vec();
    if start_edge == StaircaseStartEdge::Bottom {
        flip_u8_vertical(&mut working_ids, width, length);
    }

    let mut selected = vec![EMPTY_SELECTION; width * length];
    let mut heights = vec![0_i32; width * length];
    let columns: Vec<(Vec<usize>, Vec<i32>)> = (0..width)
        .into_par_iter()
        .map(|x| {
            let mut col_selected = vec![EMPTY_SELECTION; length];
            let mut col_heights = vec![0_i32; length];
            let mut z = 0usize;
            while z < length {
                let opaque_here = opaque_working
                    .as_ref()
                    .map(|mask| mask[z * width + x])
                    .unwrap_or(true);
                if !opaque_here {
                    z += 1;
                    continue;
                }
                let start_z = z;
                z += 1;
                while z < length {
                    let next_opaque = opaque_working
                        .as_ref()
                        .map(|mask| mask[z * width + x])
                        .unwrap_or(true);
                    if !next_opaque {
                        break;
                    }
                    z += 1;
                }
                let end_z = z;
                // Solve this opaque island on its own so gaps don't carry height over.
                let (seg_selected, seg_heights) = solve_staircase_segment(
                    &working,
                    candidates,
                    &by_shade,
                    levels,
                    anchor,
                    ctx,
                    &working_ids,
                    x,
                    start_z,
                    end_z,
                );
                for (offset, (choice, height)) in seg_selected
                    .into_iter()
                    .zip(seg_heights.into_iter())
                    .enumerate()
                {
                    col_selected[start_z + offset] = choice;
                    col_heights[start_z + offset] = height;
                }
            }
            (col_selected, col_heights)
        })
        .collect();

    for (x, (col_selected, col_heights)) in columns.into_iter().enumerate() {
        for z in 0..length {
            selected[z * width + x] = col_selected[z];
            heights[z * width + x] = col_heights[z];
        }
    }

    if start_edge == StaircaseStartEdge::Bottom {
        flip_selection_vertical(&mut selected, width, length);
        flip_heights_vertical(&mut heights, width, length);
        invert_selection_shades(&mut selected, candidates);
    }

    Ok((selected, heights))
}

fn solve_staircase_segment(
    working: &RgbaImage,
    candidates: &[PaletteCandidate],
    by_shade: &[Vec<usize>; 3],
    levels: usize,
    anchor: StaircaseHeightAnchor,
    ctx: MatchingCtx,
    preferred_ids: &[u8],
    x: usize,
    start_z: usize,
    end_z: usize,
) -> (Vec<usize>, Vec<i32>) {
    let width = working.width() as usize;
    let length = end_z - start_z;
    let mut costs = vec![f32::INFINITY; levels];
    match anchor {
        // Control locked to y=0 — first map row can only sit level or one up.
        // Shade may change (same block family) so the column never starts mid-air.
        StaircaseHeightAnchor::Floor => costs[0] = 0.0,
        // Height-capped Off: centred band, then floor-align so it still sits down.
        StaircaseHeightAnchor::Floating => costs[levels / 2] = 0.0,
    }
    let mut parents = vec![vec![(0_usize, 1_u8, 0_usize); levels]; length];
    for local_z in 0..length {
        let z = start_z + local_z;
        let pixel = working.get_pixel(x as u32, z as u32);
        let sample_rgb = [pixel[0] as f32, pixel[1] as f32, pixel[2] as f32];
        let sample = prepare_sample([pixel[0], pixel[1], pixel[2]], ctx);
        // Keep the already-matched map colour (block family) and only vary shade.
        // Re-picking nearest-in-shade jumps to a random other hue.
        let stored_id = preferred_ids.get(z * width + x).copied().unwrap_or(255);
        let preferred_id = if stored_id == 255 {
            candidates[nearest(sample_rgb, candidates, ctx, None)].color_id
        } else {
            stored_id
        };
        let best_for_shade = [0_u8, 1, 2].map(|shade| {
            by_shade[shade as usize]
                .iter()
                .copied()
                .find(|&index| candidates[index].color_id == preferred_id)
                .unwrap_or_else(|| {
                    by_shade[shade as usize]
                        .iter()
                        .copied()
                        .min_by(|left, right| {
                            colour_distance(ctx, sample, &candidates[*left])
                                .total_cmp(&colour_distance(ctx, sample, &candidates[*right]))
                        })
                        .unwrap()
                })
        });
        let mut next = vec![f32::INFINITY; levels];
        for previous_y in 0..levels {
            if !costs[previous_y].is_finite() {
                continue;
            }
            for &(shade, delta) in &[(0_u8, -1_i32), (1, 0), (2, 1)] {
                let current_y = previous_y as i32 + delta;
                if current_y < 0 || current_y >= levels as i32 {
                    continue;
                }
                let candidate = best_for_shade[shade as usize];
                let color_cost = colour_distance(ctx, sample, &candidates[candidate]);
                let at_top = current_y == levels as i32 - 1;
                let at_bottom = current_y == 0;
                let edge_penalty = match anchor {
                    StaircaseHeightAnchor::Floor => {
                        if at_top {
                            4.0
                        } else {
                            0.0
                        }
                    }
                    StaircaseHeightAnchor::Floating => {
                        if at_bottom || at_top {
                            4.0
                        } else {
                            0.0
                        }
                    }
                };
                let total = costs[previous_y] + color_cost + edge_penalty;
                if total < next[current_y as usize] {
                    next[current_y as usize] = total;
                    parents[local_z][current_y as usize] = (previous_y, shade, candidate);
                }
            }
        }
        costs = next;
    }
    let fallback = match anchor {
        StaircaseHeightAnchor::Floor => 0,
        StaircaseHeightAnchor::Floating => levels / 2,
    };
    let mut y = fallback;
    let mut best = f32::INFINITY;
    for (index, &cost) in costs.iter().enumerate() {
        if !cost.is_finite() {
            continue;
        }
        let better = match anchor {
            StaircaseHeightAnchor::Floor => cost < best || (cost == best && index < y),
            StaircaseHeightAnchor::Floating => cost < best,
        };
        if better {
            best = cost;
            y = index;
        }
    }
    let mut seg_selected = vec![0; length];
    let mut seg_heights = vec![0_i32; length];
    for local_z in (0..length).rev() {
        let (previous_y, _shade, candidate) = parents[local_z][y];
        seg_selected[local_z] = candidate;
        seg_heights[local_z] = y as i32;
        y = previous_y;
    }
    (seg_selected, seg_heights)
}

fn flip_mask_vertical(mask: &[bool], width: usize, length: usize) -> Vec<bool> {
    let mut out = vec![false; width * length];
    for z in 0..length {
        for x in 0..width {
            out[z * width + x] = mask[(length - 1 - z) * width + x];
        }
    }
    out
}

fn flip_u8_vertical(values: &mut [u8], width: usize, length: usize) {
    for z in 0..(length / 2) {
        let a = z * width;
        let b = (length - 1 - z) * width;
        for x in 0..width {
            values.swap(a + x, b + x);
        }
    }
}

fn shade_height_delta(shade: u8) -> i32 {
    match shade {
        0 => -1,
        2 => 1,
        _ => 0,
    }
}

/// Soft ceiling for Auto Classic. Modern overworld build height is ~320 usable;
/// beyond this Auto re-plans with DP instead of emitting sky-high stairs.
const STAIRCASE_AUTO_SOFT_CAP: u32 = 320;

fn floor_align_islands(
    heights: &mut [i32],
    selected: &[usize],
    candidates: &[PaletteCandidate],
    support_below: &[bool],
    width: usize,
    length: usize,
    start_edge: StaircaseStartEdge,
) {
    // Re-anchor every opaque island — a whole-column shift leaves later
    // islands floating after a transparent gap.
    for x in 0..width {
        let mut z = 0usize;
        while z < length {
            if selected[z * width + x] == EMPTY_SELECTION {
                z += 1;
                continue;
            }
            let start_z = z;
            z += 1;
            while z < length && selected[z * width + x] != EMPTY_SELECTION {
                z += 1;
            }
            align_staircase_segment(
                heights,
                selected,
                candidates,
                support_below,
                width,
                length,
                x,
                start_z,
                z,
                start_edge,
            );
        }
    }
}

/// Pin one opaque island within a column so its lowest block (control / support
/// included) sits at y=0. Off uses this so a dip cannot lift neighbouring
/// columns; Ground-up uses it after carpet/gravity supports deepen a cell.
fn align_staircase_segment(
    heights: &mut [i32],
    selected: &[usize],
    candidates: &[PaletteCandidate],
    support_below: &[bool],
    width: usize,
    length: usize,
    x: usize,
    start_z: usize,
    end_z: usize,
    start_edge: StaircaseStartEdge,
) {
    let mut min_y = i32::MAX;
    let mut any = false;
    for z in start_z..end_z {
        let index = z * width + x;
        if selected[index] == EMPTY_SELECTION {
            continue;
        }
        any = true;
        min_y = min_y.min(pixel_bottom(heights, selected, support_below, index));
    }
    // Virtual control height only for the island that abuts the real control row.
    // Mid-map islands after a transparent gap have no placed control — pin art only.
    let abuts_control = match start_edge {
        StaircaseStartEdge::Top => start_z == 0,
        StaircaseStartEdge::Bottom => end_z == length,
    };
    if abuts_control {
        let edge_z = match start_edge {
            StaircaseStartEdge::Top => start_z,
            StaircaseStartEdge::Bottom => end_z.saturating_sub(1),
        };
        let edge_index = edge_z * width + x;
        if selected.get(edge_index).copied().unwrap_or(EMPTY_SELECTION) != EMPTY_SELECTION {
            let y = heights[edge_index];
            let control = y - shade_height_delta(candidates[selected[edge_index]].shade);
            min_y = min_y.min(control);
            any = true;
        }
    }
    if !any || min_y == i32::MAX || min_y == 0 {
        return;
    }
    for z in start_z..end_z {
        let index = z * width + x;
        if selected[index] == EMPTY_SELECTION {
            continue;
        }
        heights[index] -= min_y;
    }
}

fn flip_image_vertical(image: &RgbaImage) -> RgbaImage {
    let width = image.width();
    let height = image.height();
    let mut out = RgbaImage::new(width, height);
    for y in 0..height {
        for x in 0..width {
            out.put_pixel(x, y, *image.get_pixel(x, height - 1 - y));
        }
    }
    out
}

fn flip_selection_vertical(selected: &mut [usize], width: usize, length: usize) {
    for z in 0..(length / 2) {
        let a = z * width;
        let b = (length - 1 - z) * width;
        for x in 0..width {
            selected.swap(a + x, b + x);
        }
    }
}

fn flip_heights_vertical(heights: &mut [i32], width: usize, length: usize) {
    for z in 0..(length / 2) {
        let a = z * width;
        let b = (length - 1 - z) * width;
        for x in 0..width {
            heights.swap(a + x, b + x);
        }
    }
}

fn invert_selection_shades(selected: &mut [usize], candidates: &[PaletteCandidate]) {
    let mut by_key: HashMap<(u8, u8), usize> = HashMap::new();
    for (index, candidate) in candidates.iter().enumerate() {
        by_key.insert((candidate.color_id, candidate.shade), index);
    }
    for choice in selected.iter_mut() {
        if *choice == EMPTY_SELECTION {
            continue;
        }
        let candidate = &candidates[*choice];
        let inverted = match candidate.shade {
            0 => 2,
            2 => 0,
            other => other,
        };
        if let Some(&index) = by_key.get(&(candidate.color_id, inverted)) {
            *choice = index;
        }
    }
}

fn build_structure(
    palette: &crate::palette::PaletteFile,
    candidates: &[PaletteCandidate],
    selected: &[usize],
    heights: &[i32],
    options: &ConvertOptions,
    width: u32,
    length: u32,
) -> BuildResult {
    let mut blocks = Vec::new();
    let mut warnings = Vec::new();
    let staircase_support = crate::model::BlockState::parse(&options.staircase_support_block)
        .unwrap_or_else(|| crate::model::BlockState::simple("minecraft:cobblestone"));
    let orientation = options.orientation;
    let img_w = width as i32;
    let img_l = length as i32;
    let start_edge = options.staircase_start_edge;
    let z_offset: u32 = if options.mode == BuildMode::Staircase
        && orientation == BuildOrientation::Floor
        && start_edge == StaircaseStartEdge::Top
    {
        1
    } else {
        0
    };

    let push = |blocks: &mut Vec<PlacedBlock>,
                ix: i32,
                iz: i32,
                fy: i32,
                state: crate::model::BlockState| {
        let (x, y, z) = orient_block(orientation, ix, iz, fy, img_w, img_l);
        blocks.push(PlacedBlock { x, y, z, state });
    };

    if options.mode == BuildMode::Staircase && orientation == BuildOrientation::Floor {
        for x in 0..width {
            let edge_index = match start_edge {
                StaircaseStartEdge::Top => x as usize,
                StaircaseStartEdge::Bottom => ((length - 1) * width + x) as usize,
            };
            if selected[edge_index] == EMPTY_SELECTION {
                continue;
            }
            let edge_height = heights[edge_index];
            let shade = candidates[selected[edge_index]].shade;
            let control_height = edge_height - shade_height_delta(shade);
            let control_z = match start_edge {
                // Northern control row; map pixels start at z=1.
                StaircaseStartEdge::Top => 0,
                // Southern control row; map pixels occupy z=0..length-1.
                StaircaseStartEdge::Bottom => length as i32,
            };
            push(
                &mut blocks,
                x as i32,
                control_z,
                control_height,
                staircase_support.clone(),
            );
        }
    }

    for z in 0..length {
        for x in 0..width {
            let index = (z * width + x) as usize;
            if selected[index] == EMPTY_SELECTION {
                continue;
            }
            let candidate = &candidates[selected[index]];
            let color = palette
                .colors
                .iter()
                .find(|entry| entry.id == candidate.color_id);
            let needs_support = options.support_under_gravity
                && block_needs_under_support(color, &candidate.block);
            let ix = x as i32;
            let iz = z as i32;
            match options.mode {
                BuildMode::Flat => {
                    if needs_support {
                        push(&mut blocks, ix, iz, 0, staircase_support.clone());
                        push(&mut blocks, ix, iz, 1, candidate.block.clone());
                    } else {
                        push(&mut blocks, ix, iz, 0, candidate.block.clone());
                    }
                }
                BuildMode::Staircase => {
                    let y = heights[index];
                    let fz = iz + z_offset as i32;
                    if needs_support {
                        push(&mut blocks, ix, fz, y - 1, staircase_support.clone());
                    }
                    push(&mut blocks, ix, fz, y, candidate.block.clone());
                }
            }
        }
    }
    if options.mode == BuildMode::Staircase {
        // Short build notes only — long tutorials live in the Maps UI hints.
        match start_edge {
            StaircaseStartEdge::Top => warnings.push(
                "Includes a northern control row required for map shading.".into(),
            ),
            StaircaseStartEdge::Bottom => warnings.push(
                "Includes a southern control row required for map shading.".into(),
            ),
        }
        if options.staircase_height_anchor == StaircaseHeightAnchor::Floating {
            warnings.push(
                "Exact stairs: columns that step down keep their north edge above the floor."
                    .into(),
            );
        }
    }
    if orientation != BuildOrientation::Floor {
        warnings.push(format!(
            "Pixel art is oriented as {}.",
            orientation_label(orientation)
        ));
    }

    let used_color_ids = selected
        .iter()
        .filter(|&&index| index != EMPTY_SELECTION)
        .map(|index| candidates[*index].color_id)
        .collect::<BTreeSet<_>>();
    let mut placed_under_supports = false;
    for index in selected {
        if *index == EMPTY_SELECTION {
            continue;
        }
        let candidate = &candidates[*index];
        let color = palette
            .colors
            .iter()
            .find(|entry| entry.id == candidate.color_id);
        if options.support_under_gravity && block_needs_under_support(color, &candidate.block) {
            placed_under_supports = true;
            break;
        }
    }
    if placed_under_supports {
        warnings.push(
            if orientation == BuildOrientation::Floor {
                "Support blocks are placed under gravity-affected blocks and carpets.".into()
            } else {
                "Support blocks are placed behind gravity-affected blocks and carpets.".into()
            },
        );
    }
    for color in palette
        .colors
        .iter()
        .filter(|color| used_color_ids.contains(&color.id))
    {
        if !options.support_under_gravity && color.gravity {
            warnings.push(format!(
                "{} is gravity-affected; enable support placement or add supports manually.",
                color.block
            ));
        }
        if color.needs_support {
            warnings.push(format!("{} needs special attachment support.", color.block));
        }
    }
    warnings.sort();
    warnings.dedup();

    let (min_x, min_y, min_z, max_x, max_y, max_z) = block_bounds(&blocks);
    for block in &mut blocks {
        block.x -= min_x;
        block.y -= min_y;
        block.z -= min_z;
    }
    let out_width = (max_x - min_x + 1).max(1) as u32;
    let out_height = (max_y - min_y + 1).max(1) as u32;
    let out_length = (max_z - min_z + 1).max(1) as u32;
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
    let maps_x = width.div_ceil(MAP_EDGE).max(1);
    let maps_y = length.div_ceil(MAP_EDGE).max(1);
    let tiles = (0..maps_y)
        .flat_map(|row| {
            (0..maps_x).map(move |column| MapTile {
                column,
                row,
                start_x: column * MAP_EDGE,
                start_z: row * MAP_EDGE + z_offset,
            })
        })
        .collect();
    BuildResult {
        structure: Structure {
            name: "StructureLab".into(),
            size: [out_width, out_height, out_length],
            blocks,
        },
        width: out_width,
        length: out_length,
        height: out_height,
        min_y: min_y,
        maps_x,
        maps_y,
        tiles,
        materials,
        warnings,
        minecraft_version: palette.minecraft_version.clone(),
        data_version: palette.data_version,
    }
}

fn orientation_label(orientation: BuildOrientation) -> &'static str {
    match orientation {
        BuildOrientation::Floor => "floor (horizontal)",
        BuildOrientation::WallSouth => "a south-facing wall",
        BuildOrientation::WallNorth => "a north-facing wall",
        BuildOrientation::WallEast => "an east-facing wall",
        BuildOrientation::WallWest => "a west-facing wall",
    }
}

/// Map image pixel `(ix, iz)` plus floor-space height/depth `fy` into world XYZ.
/// For walls, image rows become vertical and `fy` is depth (0 = face, 1 = in front / on top for floor).
fn orient_block(
    orientation: BuildOrientation,
    ix: i32,
    iz: i32,
    fy: i32,
    img_w: i32,
    img_l: i32,
) -> (i32, i32, i32) {
    let row_y = img_l - 1 - iz;
    match orientation {
        BuildOrientation::Floor => (ix, fy, iz),
        BuildOrientation::WallSouth => (ix, row_y, fy),
        BuildOrientation::WallNorth => (img_w - 1 - ix, row_y, -fy),
        BuildOrientation::WallEast => (fy, row_y, ix),
        BuildOrientation::WallWest => (-fy, row_y, img_w - 1 - ix),
    }
}

fn block_bounds(blocks: &[PlacedBlock]) -> (i32, i32, i32, i32, i32, i32) {
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut min_z = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    let mut max_z = i32::MIN;
    if blocks.is_empty() {
        return (0, 0, 0, 0, 0, 0);
    }
    for block in blocks {
        min_x = min_x.min(block.x);
        min_y = min_y.min(block.y);
        min_z = min_z.min(block.z);
        max_x = max_x.max(block.x);
        max_y = max_y.max(block.y);
        max_z = max_z.max(block.z);
    }
    (min_x, min_y, min_z, max_x, max_y, max_z)
}

pub fn block_needs_under_support(
    _color: Option<&crate::palette::MapColor>,
    block: &crate::model::BlockState,
) -> bool {
    let name = block.name.as_str();
    let id = name.strip_prefix("minecraft:").unwrap_or(name);
    id.ends_with("_carpet")
        || id == "moss_carpet"
        || id.ends_with("_concrete_powder")
        || matches!(
            id,
            "sand"
                | "red_sand"
                | "gravel"
                | "anvil"
                | "chipped_anvil"
                | "damaged_anvil"
                | "dragon_egg"
                | "suspicious_sand"
                | "suspicious_gravel"
        )
}

fn encode_preview(
    width: u32,
    height: u32,
    selected: &[usize],
    candidates: &[PaletteCandidate],
) -> Result<String> {
    let preview = image_from_selection(width, height, selected, candidates);
    let mut bytes = Cursor::new(Vec::new());
    // Fast/no-filter PNG: preview encode was a major cost on multi-megapixel maps.
    PngEncoder::new_with_quality(&mut bytes, CompressionType::Fast, PngFilterType::NoFilter)
        .write_image(
            preview.as_raw(),
            width,
            height,
            image::ExtendedColorType::Rgba8,
        )?;
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(bytes.into_inner())
    ))
}

/// Pack the top-surface block used for each map pixel (textured 2D preview).
fn encode_preview_surface(
    selected: &[usize],
    candidates: &[PaletteCandidate],
) -> (Vec<String>, String) {
    let mut palette: Vec<String> = Vec::new();
    let mut index_of: HashMap<String, u8> = HashMap::new();
    let mut indices = Vec::with_capacity(selected.len());

    for &choice in selected {
        if choice == EMPTY_SELECTION {
            indices.push(EMPTY_SURFACE);
            continue;
        }
        let name = candidates[choice].block.canonical_name();
        let idx = if let Some(&existing) = index_of.get(&name) {
            existing
        } else if palette.len() >= 255 {
            // 255 is reserved for empty holes.
            0
        } else {
            let next = palette.len() as u8;
            palette.push(name.clone());
            index_of.insert(name, next);
            next
        };
        indices.push(idx);
    }

    (palette, STANDARD.encode(indices))
}

/// Pack the real structure (supports included) for the textured 3D preview.
fn encode_preview_voxels(build: &BuildResult) -> (Vec<String>, String, u32) {
    // Always pack every block at stride 1. Thinning + footprint expand made large
    // builds (e.g. trim-transparent map art) look like flat slabs with stair gaps.
    // InstancedMesh handles typical multi-map staircase counts; huge builds may be
    // slower to upload once, but geometry stays correct.
    let stride = 1_u32;
    let blocks = &build.structure.blocks;

    let mut palette: Vec<String> = Vec::new();
    let mut index_of: HashMap<String, u8> = HashMap::new();
    let mut packed: Vec<u8> = Vec::with_capacity(blocks.len().saturating_mul(7));

    for block in blocks {
        if block.x < 0 || block.y < 0 || block.z < 0 {
            continue;
        }
        if block.x > u16::MAX as i32 || block.y > u16::MAX as i32 || block.z > u16::MAX as i32 {
            continue;
        }
        let name = block.state.canonical_name();
        let idx = if let Some(&existing) = index_of.get(&name) {
            existing
        } else if palette.len() >= 255 {
            0
        } else {
            let next = palette.len() as u8;
            palette.push(name.clone());
            index_of.insert(name, next);
            next
        };
        packed.extend_from_slice(&(block.x as u16).to_le_bytes());
        packed.extend_from_slice(&(block.y as u16).to_le_bytes());
        packed.extend_from_slice(&(block.z as u16).to_le_bytes());
        packed.push(idx);
    }

    (palette, STANDARD.encode(packed), stride)
}

fn image_from_selection(
    width: u32,
    height: u32,
    selected: &[usize],
    candidates: &[PaletteCandidate],
) -> RgbaImage {
    let mut image = RgbaImage::new(width, height);
    for (index, pixel) in image.pixels_mut().enumerate() {
        if selected[index] == EMPTY_SELECTION {
            *pixel = Rgba([0, 0, 0, 0]);
            continue;
        }
        let color = candidates[selected[index]].rgb;
        *pixel = Rgba([color[0], color[1], color[2], 255]);
    }
    image
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nearest_pick(rgb: [u8; 3], candidates: &[PaletteCandidate], matching: ColourMatching) -> usize {
        let ctx = matching_ctx(matching, candidates);
        nearest(
            [rgb[0] as f32, rgb[1] as f32, rgb[2] as f32],
            candidates,
            ctx,
            None,
        )
    }

    /// Rebane (CIE76) and CIEDE2000 often agree; Oklab+hue should diverge on skin/grey probes.
    #[test]
    fn colour_matching_modes_are_distinct_algorithms() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let full = candidates(
            &palette,
            BuildMode::Flat,
            ArtKind::MapArt,
            &[],
            &Default::default(),
            BuildOrientation::Floor,
        );
        // 16 dye carpets: white (8) + orange..black (15–29).
        let carpet_ids: std::collections::BTreeSet<u8> =
            std::iter::once(8u8).chain(15..=29).collect();
        let carpet: Vec<PaletteCandidate> = full
            .iter()
            .filter(|candidate| carpet_ids.contains(&candidate.color_id))
            .cloned()
            .collect();
        assert_eq!(carpet.len(), 16, "expected 16 flat carpet dye candidates");
        let probes: &[[u8; 3]] = &[
            [210, 165, 140], // skin
            [120, 170, 210], // sky
            [70, 120, 55],   // grass
            [160, 160, 160], // neutral grey
            [51, 76, 178],   // blue
            [242, 127, 165], // pink
        ];
        let modes = [
            ColourMatching::RebaneMapartClassic,
            ColourMatching::Ciede2000,
            ColourMatching::OklabHueGuard,
        ];

        for (label, candidates) in [("full", &full), ("carpet-dyes", &carpet)] {
            let mut rebane_vs_ciede = 0usize;
            let mut rebane_vs_oklab = 0usize;
            let mut ciede_vs_oklab = 0usize;
            for rgb in probes {
                let picks = modes.map(|mode| nearest_pick(*rgb, candidates, mode));
                if picks[0] != picks[1] {
                    rebane_vs_ciede += 1;
                }
                if picks[0] != picks[2] {
                    rebane_vs_oklab += 1;
                }
                if picks[1] != picks[2] {
                    ciede_vs_oklab += 1;
                }
            }
            eprintln!(
                "{label}: rebane≠ciede {}/{}, rebane≠oklab {}/{}, ciede≠oklab {}/{}",
                rebane_vs_ciede,
                probes.len(),
                rebane_vs_oklab,
                probes.len(),
                ciede_vs_oklab,
                probes.len(),
            );
            assert!(
                rebane_vs_oklab > 0 || ciede_vs_oklab > 0,
                "{label}: Oklab+hue must disagree with Lab metrics on at least one probe"
            );
        }

        // CIE76 vs CIEDE2000 are different functions — must differ somewhere on
        // the full palette. Include the probes (already known to diverge) plus a
        // coarse RGB lattice. Sum in u16: u8 addition overflowed this loop.
        let mut lab_pair_diff = 0usize;
        for rgb in probes {
            let rebane = nearest_pick(*rgb, &full, ColourMatching::RebaneMapartClassic);
            let ciede = nearest_pick(*rgb, &full, ColourMatching::Ciede2000);
            if rebane != ciede {
                lab_pair_diff += 1;
            }
        }
        for r in 0..=255u8 {
            for g in 0..=255u8 {
                for b in 0..=255u8 {
                    if (u16::from(r) + u16::from(g) + u16::from(b)) % 51 != 0 {
                        continue;
                    }
                    let rebane = nearest_pick([r, g, b], &full, ColourMatching::RebaneMapartClassic);
                    let ciede = nearest_pick([r, g, b], &full, ColourMatching::Ciede2000);
                    if rebane != ciede {
                        lab_pair_diff += 1;
                    }
                }
            }
        }
        eprintln!("full palette coarse grid: rebane≠ciede on {lab_pair_diff} samples");
        assert!(
            lab_pair_diff > 0,
            "CIE76 and CIEDE2000 must not be identical on every probe"
        );
    }

    /// Mean Oklab error after a 3×3 box blur — approximates what a viewer sees
    /// once neighbouring blocks blend together at map scale.
    fn blurred_error(source: &RgbaImage, selected: &[usize], candidates: &[PaletteCandidate]) -> f32 {
        let width = source.width() as usize;
        let height = source.height() as usize;
        let mut total = 0.0_f32;
        let mut count = 0usize;
        for y in 1..height - 1 {
            for x in 1..width - 1 {
                let mut want = [0.0_f32; 3];
                let mut got = [0.0_f32; 3];
                for dy in 0..3 {
                    for dx in 0..3 {
                        let index = (y + dy - 1) * width + (x + dx - 1);
                        let pixel = source.get_pixel((x + dx - 1) as u32, (y + dy - 1) as u32);
                        let source_linear =
                            crate::palette::srgb_to_linear([pixel[0], pixel[1], pixel[2]]);
                        let chosen = candidates[selected[index]].linear;
                        for channel in 0..3 {
                            want[channel] += source_linear[channel] / 9.0;
                            got[channel] += chosen[channel] / 9.0;
                        }
                    }
                }
                total += perceptual_distance(linear_to_oklab(want), linear_to_oklab(got)).sqrt();
                count += 1;
            }
        }
        total / count as f32
    }

    /// The whole point of the mix mode: on a 16-dye carpet pack it should beat
    /// Floyd–Steinberg on blurred error, which is what the eye integrates.
    #[test]
    fn perceptual_mix_beats_dither_on_carpet_skin_tones() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let carpet_ids: std::collections::BTreeSet<u8> =
            std::iter::once(8u8).chain(15..=29).collect();
        let disabled: Vec<u8> = palette
            .colors
            .iter()
            .filter(|color| !color.transparent && !carpet_ids.contains(&color.id))
            .map(|color| color.id)
            .collect();
        let carpet = candidates(
            &palette,
            BuildMode::Staircase,
            ArtKind::MapArt,
            &disabled,
            &Default::default(),
            BuildOrientation::Floor,
        );
        assert_eq!(carpet.len(), 48, "16 dyes × 3 staircase shades");

        // Skin-tone gradient — the case plain Lab matching flattens to grey.
        let mut image = RgbaImage::new(64, 64);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            let u = x as f32 / 63.0;
            let v = y as f32 / 63.0;
            *pixel = Rgba([
                (205.0 + 30.0 * u - 25.0 * v) as u8,
                (160.0 + 20.0 * u - 30.0 * v) as u8,
                (140.0 + 15.0 * u - 35.0 * v) as u8,
                255,
            ]);
        }

        let dithered = quantize(
            &image,
            &carpet,
            crate::model::DitherMode::FloydSteinberg,
            ColourMatching::RebaneMapartClassic,
            None,
        )
        .unwrap();
        let mixed = quantize(
            &image,
            &carpet,
            crate::model::DitherMode::None,
            ColourMatching::StructureLabMix,
            None,
        )
        .unwrap();

        let dithered_error = blurred_error(&image, &dithered, &carpet);
        let mixed_error = blurred_error(&image, &mixed, &carpet);
        eprintln!("blurred error — FS dither {dithered_error:.4}, perceptual mix {mixed_error:.4}");
        assert!(
            mixed_error < dithered_error,
            "perceptual mix should lower blurred error (mix {mixed_error:.4} vs dither {dithered_error:.4})"
        );
    }

    #[test]
    fn perceptual_mix_respects_shade_locks() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let candidates = candidates(
            &palette,
            BuildMode::Staircase,
            ArtKind::MapArt,
            &[],
            &Default::default(),
            BuildOrientation::Floor,
        );
        let image = RgbaImage::from_pixel(8, 8, Rgba([180, 140, 120, 255]));
        let locks = vec![2_u8; 64];
        let selected = quantize(
            &image,
            &candidates,
            crate::model::DitherMode::None,
            ColourMatching::StructureLabMix,
            Some(&locks),
        )
        .unwrap();
        for choice in selected {
            assert_eq!(candidates[choice].shade, 2, "mix plan must honour shade locks");
        }
    }

    /// Supports sit one block under carpets and gravity blocks. If the layout
    /// ignores them the global shift at the end of `build_structure` lifts every
    /// other column off the floor, which looks like "ground up" being ignored.
    #[test]
    fn floor_anchor_counts_support_blocks_under_every_column() {
        // Carpet only: every map colour needs a support block, so the support row
        // is the floor and no column may float above it.
        let carpet_ids: std::collections::BTreeSet<u8> =
            std::iter::once(8u8).chain(15..=29).collect();
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let disabled: Vec<u8> = palette
            .colors
            .iter()
            .filter(|color| !color.transparent && !carpet_ids.contains(&color.id))
            .map(|color| color.id)
            .collect();

        let mut image = RgbaImage::new(12, 10);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            *pixel = Rgba([
                (30 + x * 18) as u8,
                (40 + y * 20) as u8,
                (200 - x * 12) as u8,
                255,
            ]);
        }
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, ImageFormat::Png).unwrap();

        let options = ConvertOptions {
            size_mode: SizeMode::Custom,
            blocks_x: 12,
            blocks_z: 10,
            mode: BuildMode::Staircase,
            staircase_height_anchor: StaircaseHeightAnchor::Floor,
            staircase_height_auto: true,
            support_under_gravity: true,
            disabled_color_ids: disabled,
            dither: crate::model::DitherMode::None,
            ..ConvertOptions::default()
        };
        let response = convert_image(&bytes.into_inner(), &options, "26.2").unwrap();
        let mins = column_min_y(&response);
        assert!(
            mins.iter().all(|&y| y == 0),
            "every column should reach the floor with supports counted, got {mins:?}"
        );
    }

    fn column_min_y(response: &ConversionResponse) -> Vec<i32> {
        let width = response.build.width as i32;
        (0..width)
            .map(|x| {
                response
                    .build
                    .structure
                    .blocks
                    .iter()
                    .filter(|block| block.x == x)
                    .map(|block| block.y)
                    .min()
                    .unwrap_or(0)
            })
            .collect()
    }

    #[test]
    fn pixel_art_wall_orients_blocks_vertically() {
        let image = RgbaImage::from_pixel(4, 3, Rgba([200, 40, 40, 255]));
        let mut encoded = Cursor::new(Vec::new());
        image.write_to(&mut encoded, ImageFormat::Png).unwrap();
        let options = ConvertOptions {
            art_kind: ArtKind::PixelArt,
            orientation: BuildOrientation::WallSouth,
            size_mode: SizeMode::Custom,
            blocks_x: 4,
            blocks_z: 3,
            mode: BuildMode::Staircase, // forced flat by normalize
            ..ConvertOptions::default()
        };
        let response = convert_image(&encoded.into_inner(), &options, "26.2").unwrap();
        assert_eq!(response.build.width, 4);
        assert_eq!(response.build.height, 3);
        assert_eq!(response.build.length, 1);
        assert_eq!(response.build.structure.blocks.len(), 12);
    }

    #[test]
    fn custom_size_uses_exact_block_footprint() {
        let image = RgbaImage::from_pixel(40, 20, Rgba([200, 40, 40, 255]));
        let mut encoded = Cursor::new(Vec::new());
        image.write_to(&mut encoded, ImageFormat::Png).unwrap();
        let options = ConvertOptions {
            size_mode: SizeMode::Custom,
            blocks_x: 40,
            blocks_z: 20,
            ..ConvertOptions::default()
        };
        let response = convert_image(&encoded.into_inner(), &options, "26.2").unwrap();
        assert_eq!(response.build.width, 40);
        assert_eq!(response.build.length, 20);
        assert_eq!(response.build.maps_x, 1);
        assert_eq!(response.build.maps_y, 1);
        assert_eq!(
            STANDARD
                .decode(&response.preview_surface_indices)
                .unwrap()
                .len(),
            40 * 20
        );
    }

    #[test]
    fn auto_size_uses_near_native_resolution() {
        assert_eq!(auto_grid(1920, 1080), [15, 9]);
        assert_eq!(auto_grid(128, 128), [1, 1]);
        assert_eq!(auto_grid(129, 1), [2, 1]);
    }

    #[test]
    fn flat_conversion_builds_one_block_per_pixel() {
        let image = RgbaImage::from_pixel(2, 2, Rgba([200, 40, 40, 255]));
        let mut encoded = Cursor::new(Vec::new());
        image.write_to(&mut encoded, ImageFormat::Png).unwrap();
        let response = convert_image(&encoded.into_inner(), &ConvertOptions::default(), "26.2").unwrap();
        assert_eq!(response.build.structure.size, [128, 1, 128]);
        assert_eq!(response.build.structure.blocks.len(), 16_384);
        assert!(response
            .preview_data_url
            .starts_with("data:image/png;base64,"));
        assert!(!response.preview_surface_palette.is_empty());
        assert_eq!(
            STANDARD
                .decode(&response.preview_surface_indices)
                .unwrap()
                .len(),
            128 * 128
        );
    }

    #[test]
    fn staircase_floor_anchor_puts_each_column_on_the_floor() {
        let image = RgbaImage::from_fn(4, 8, |x, y| {
            let t = ((x + y) % 5) as u8;
            let v = 40u8.saturating_add(t.saturating_mul(40));
            Rgba([v, v, 255u8.saturating_sub(v / 2), 255])
        });
        let mut encoded = Cursor::new(Vec::new());
        image.write_to(&mut encoded, ImageFormat::Png).unwrap();
        let bytes = encoded.into_inner();
        let options = ConvertOptions {
            mode: BuildMode::Staircase,
            max_height: 16,
            staircase_height_anchor: StaircaseHeightAnchor::Floor,
            dither: crate::model::DitherMode::None,
            size_mode: SizeMode::Custom,
            blocks_x: 4,
            blocks_z: 8,
            maps_x: 1,
            maps_y: 1,
            support_under_gravity: false,
            ..ConvertOptions::default()
        };
        let response = convert_image(&bytes, &options, "26.2").unwrap();
        let min_y = response
            .build
            .structure
            .blocks
            .iter()
            .map(|block| block.y)
            .min()
            .unwrap_or(0);
        assert_eq!(min_y, 0, "floor-anchored staircase should sit on y=0");
        // Every occupied X column should touch the floor (not only the global minimum).
        let width = response.build.width as i32;
        for x in 0..width {
            let col_min = response
                .build
                .structure
                .blocks
                .iter()
                .filter(|block| block.x == x)
                .map(|block| block.y)
                .min();
            if let Some(col_min) = col_min {
                assert_eq!(col_min, 0, "column x={x} should be floor-anchored");
            }
        }
        assert!(response
            .build
            .warnings
            .iter()
            .any(|warning| warning.contains("control row")));
    }

    #[test]
    fn staircase_bottom_start_places_southern_control_row() {
        let image = RgbaImage::from_fn(3, 6, |x, y| {
            let v = 80u8.saturating_add(((x * 3 + y * 5) % 7) as u8 * 20);
            Rgba([v, 180, 220, 255])
        });
        let mut encoded = Cursor::new(Vec::new());
        image.write_to(&mut encoded, ImageFormat::Png).unwrap();
        let bytes = encoded.into_inner();
        let options = ConvertOptions {
            mode: BuildMode::Staircase,
            max_height: 12,
            staircase_height_anchor: StaircaseHeightAnchor::Floor,
            staircase_start_edge: StaircaseStartEdge::Bottom,
            dither: crate::model::DitherMode::None,
            size_mode: SizeMode::Custom,
            blocks_x: 3,
            blocks_z: 6,
            maps_x: 1,
            maps_y: 1,
            support_under_gravity: false,
            ..ConvertOptions::default()
        };
        let response = convert_image(&bytes, &options, "26.2").unwrap();
        assert!(response
            .build
            .warnings
            .iter()
            .any(|warning| warning.contains("southern control row")));
        let max_z = response
            .build
            .structure
            .blocks
            .iter()
            .map(|block| block.z)
            .max()
            .unwrap_or(0);
        // Art is 6 rows at z=0..5; southern control sits at z=6.
        assert_eq!(max_z, 6);
        let min_y = response
            .build
            .structure
            .blocks
            .iter()
            .map(|block| block.y)
            .min()
            .unwrap_or(0);
        assert_eq!(min_y, 0);
    }

    #[test]
    fn staircase_floor_anchor_resets_after_transparent_gap() {
        // Two opaque bands separated by a transparent gap — with skip-transparent,
        // the second band must re-anchor to y=0 instead of continuing the climb.
        let mut image = RgbaImage::from_pixel(2, 8, Rgba([0, 0, 0, 0]));
        for z in 0..3 {
            for x in 0..2 {
                image.put_pixel(x, z, Rgba([240, 244, 248, 255]));
            }
        }
        for z in 5..8 {
            for x in 0..2 {
                image.put_pixel(x, z, Rgba([240, 244, 248, 255]));
            }
        }
        let mut encoded = Cursor::new(Vec::new());
        image.write_to(&mut encoded, ImageFormat::Png).unwrap();
        let bytes = encoded.into_inner();
        let options = ConvertOptions {
            mode: BuildMode::Staircase,
            max_height: 32,
            staircase_height_anchor: StaircaseHeightAnchor::Floor,
            staircase_start_edge: StaircaseStartEdge::Top,
            dither: crate::model::DitherMode::None,
            skip_transparent: true,
            size_mode: SizeMode::Custom,
            blocks_x: 2,
            blocks_z: 8,
            maps_x: 1,
            maps_y: 1,
            support_under_gravity: false,
            ..ConvertOptions::default()
        };
        let response = convert_image(&bytes, &options, "26.2").unwrap();
        let width = response.build.width as i32;
        for x in 0..width {
            // Include control row at z=0 so high-shade art at y=1 still reports floor contact.
            let first_band = response
                .build
                .structure
                .blocks
                .iter()
                .filter(|block| block.x == x && block.z >= 0 && block.z <= 3)
                .map(|block| block.y)
                .min();
            let second_band = response
                .build
                .structure
                .blocks
                .iter()
                .filter(|block| block.x == x && block.z >= 6 && block.z <= 8)
                .map(|block| block.y)
                .min();
            assert_eq!(first_band, Some(0), "first band x={x} should sit on the floor");
            assert_eq!(
                second_band,
                Some(0),
                "second band after gap x={x} should sit on the floor"
            );
        }
    }

    #[test]
    fn staircase_uses_and_validates_selected_support_block() {
        let image = RgbaImage::from_pixel(1, 1, Rgba([200, 40, 40, 255]));
        let mut encoded = Cursor::new(Vec::new());
        image.write_to(&mut encoded, ImageFormat::Png).unwrap();
        let bytes = encoded.into_inner();
        let mut options = ConvertOptions {
            mode: BuildMode::Staircase,
            max_height: 3,
            staircase_support_block: "minecraft:oak_planks".into(),
            ..ConvertOptions::default()
        };
        let response = convert_image(&bytes, &options, "26.2").unwrap();
        assert!(response
            .build
            .materials
            .iter()
            .any(|material| material.block == "minecraft:oak_planks"));

        options.staircase_support_block = "minecraft:not_a_block".into();
        assert!(convert_image(&bytes, &options, "26.2")
            .unwrap_err()
            .to_string()
            .contains("not a valid Minecraft support block"));
    }

    #[test]
    fn staircase_binding_cap_replans_instead_of_flattening() {
        // Uniform near-white wants a bright (step-up) stair all the way south.
        // A luminance ramp is the wrong fixture: Rebane can walk black→grey→white
        // by changing map colour and stay under 8 layers with no height cap.
        // preview_surface_indices are block names (shade-agnostic), so the 2D
        // block map can stay equal while north-neighbour shades change.
        let image = RgbaImage::from_pixel(4, 40, Rgba([250, 250, 250, 255]));
        let bytes = png_bytes(image);
        let auto = ConvertOptions {
            mode: BuildMode::Staircase,
            staircase_height_auto: true,
            staircase_height_anchor: StaircaseHeightAnchor::Floor,
            dither: crate::model::DitherMode::None,
            colour_matching: ColourMatching::RebaneMapartClassic,
            size_mode: SizeMode::Custom,
            blocks_x: 4,
            blocks_z: 40,
            maps_x: 1,
            maps_y: 1,
            support_under_gravity: false,
            ..ConvertOptions::default()
        };
        let auto_response = convert_image(&bytes, &auto, "26.2").unwrap();
        assert!(
            auto_response.build.height > 8,
            "unconstrained bright stairs should need more than 8 layers, got {}",
            auto_response.build.height
        );

        let capped = ConvertOptions {
            staircase_height_auto: false,
            max_height: 8,
            ..auto.clone()
        };
        let capped_response = convert_image(&bytes, &capped, "26.2").unwrap();
        assert!(
            capped_response.build.height <= 9,
            "binding cap should keep the build near max height, got {}",
            capped_response.build.height
        );
        let auto_shades = implied_map_shades(&auto_response);
        let capped_shades = implied_map_shades(&capped_response);
        assert_ne!(
            auto_shades, capped_shades,
            "a binding height cap should re-plan shades, not flatten the same map"
        );
        assert_ne!(
            auto_response.preview_data_url, capped_response.preview_data_url,
            "re-planned shades should change the 2D preview colours"
        );

        let roomy = ConvertOptions {
            staircase_height_auto: false,
            max_height: 128,
            ..auto.clone()
        };
        let roomy_response = convert_image(&bytes, &roomy, "26.2").unwrap();
        assert_eq!(
            implied_map_shades(&auto_response),
            implied_map_shades(&roomy_response),
            "a cap that still fits should keep the auto shade plan"
        );
    }

    #[test]
    fn staircase_auto_soft_caps_near_world_height() {
        // Long bright column: Classic Auto would climb hundreds of blocks. Soft-cap
        // must re-plan so the build stays near modern world height (~320).
        let rows = 400_u32;
        let image = RgbaImage::from_fn(2, rows, |_, _| Rgba([250, 250, 250, 255]));
        let bytes = png_bytes(image);
        let auto = ConvertOptions {
            mode: BuildMode::Staircase,
            staircase_height_auto: true,
            staircase_height_anchor: StaircaseHeightAnchor::Floor,
            staircase_start_edge: StaircaseStartEdge::Top,
            dither: crate::model::DitherMode::None,
            size_mode: SizeMode::Custom,
            blocks_x: 2,
            blocks_z: rows,
            maps_x: 1,
            maps_y: 1,
            support_under_gravity: false,
            ..ConvertOptions::default()
        };
        let auto_response = convert_image(&bytes, &auto, "26.2").unwrap();
        assert!(
            auto_response.build.height as u32 <= STAIRCASE_AUTO_SOFT_CAP + 2,
            "Auto soft-cap should keep height near {STAIRCASE_AUTO_SOFT_CAP}, got {}",
            auto_response.build.height
        );

        let manual = ConvertOptions {
            staircase_height_auto: false,
            max_height: 128,
            ..auto.clone()
        };
        let manual_response = convert_image(&bytes, &manual, "26.2").unwrap();
        assert!(
            manual_response.build.height <= 130,
            "manual 128 should stay near that budget, got {}",
            manual_response.build.height
        );
        assert!(
            manual_response.build.height < auto_response.build.height
                || manual_response.preview_surface_indices != auto_response.preview_surface_indices,
            "manual 128 should bind tighter than Auto soft-cap"
        );
    }

    #[test]
    fn staircase_height_layout_floor_vs_floating() {
        // Dark column steps down, light column steps up. Ground-up re-shades so
        // the north control sits on y=0 and stairs only climb. Off keeps exact
        // stairs and pins each column onto the ground — a global lift would
        // raise the bright column too.
        let image = RgbaImage::from_fn(2, 12, |x, _y| {
            if x == 0 {
                Rgba([8, 8, 8, 255])
            } else {
                Rgba([248, 248, 248, 255])
            }
        });
        let bytes = png_bytes(image);
        let base = ConvertOptions {
            mode: BuildMode::Staircase,
            staircase_height_auto: true,
            staircase_start_edge: StaircaseStartEdge::Top,
            dither: crate::model::DitherMode::None,
            size_mode: SizeMode::Custom,
            blocks_x: 2,
            blocks_z: 12,
            maps_x: 1,
            maps_y: 1,
            support_under_gravity: false,
            ..ConvertOptions::default()
        };

        let floor = convert_image(
            &bytes,
            &ConvertOptions {
                staircase_height_anchor: StaircaseHeightAnchor::Floor,
                ..base.clone()
            },
            "26.2",
        )
        .unwrap();
        let floor_mins = column_min_y(&floor);
        assert!(
            floor_mins.iter().all(|&y| y == 0),
            "floor layout should pin every column to y=0, got {floor_mins:?}"
        );
        // Northern control row must sit on the ground — not mid-air above a dip.
        let floor_controls: Vec<i32> = (0..floor.build.width as i32)
            .map(|x| {
                floor
                    .build
                    .structure
                    .blocks
                    .iter()
                    .filter(|block| block.x == x && block.z == 0)
                    .map(|block| block.y)
                    .min()
                    .expect("control row block")
            })
            .collect();
        assert!(
            floor_controls.iter().all(|&y| y == 0),
            "ground-up control row should be on y=0, got {floor_controls:?}"
        );

        let floating = convert_image(
            &bytes,
            &ConvertOptions {
                staircase_height_anchor: StaircaseHeightAnchor::Floating,
                ..base.clone()
            },
            "26.2",
        )
        .unwrap();
        let floating_mins = column_min_y(&floating);
        assert!(
            floating_mins.iter().all(|&y| y == 0),
            "off layout should still sit on the ground per column, got {floating_mins:?}"
        );
        let floating_controls: Vec<i32> = (0..floating.build.width as i32)
            .map(|x| {
                floating
                    .build
                    .structure
                    .blocks
                    .iter()
                    .filter(|block| block.x == x && block.z == 0)
                    .map(|block| block.y)
                    .min()
                    .expect("control row block")
            })
            .collect();
        assert!(
            floating_controls.iter().any(|&y| y > 0),
            "off layout should keep dark columns' exact stairs (control above the floor), got {floating_controls:?}"
        );
        assert_eq!(
            floating_controls[1], 0,
            "off must not lift the bright column that never dipped, got {floating_controls:?}"
        );

        let capped_floor = convert_image(
            &bytes,
            &ConvertOptions {
                staircase_height_auto: false,
                max_height: 8,
                staircase_height_anchor: StaircaseHeightAnchor::Floor,
                ..base.clone()
            },
            "26.2",
        )
        .unwrap();
        let capped_floor_mins = column_min_y(&capped_floor);
        assert!(
            capped_floor_mins.iter().all(|&y| y == 0),
            "binding floor cap should still pin columns to y=0, got {capped_floor_mins:?}"
        );

        let capped_floating = convert_image(
            &bytes,
            &ConvertOptions {
                staircase_height_auto: false,
                max_height: 8,
                staircase_height_anchor: StaircaseHeightAnchor::Floating,
                ..base
            },
            "26.2",
        )
        .unwrap();
        let capped_floating_mins = column_min_y(&capped_floating);
        assert!(
            capped_floating_mins.iter().all(|&y| y == 0),
            "binding off cap should still sit on the ground, got {capped_floating_mins:?}"
        );
        assert_ne!(
            capped_floating.preview_data_url, capped_floor.preview_data_url,
            "ground-up vs off should still differ when a cap forces a re-plan"
        );
    }

    #[test]
    fn staircase_auto_bottom_start_still_places_southern_control() {
        let image = RgbaImage::from_fn(3, 6, |x, y| {
            let v = 80u8.saturating_add(((x * 3 + y * 5) % 7) as u8 * 20);
            Rgba([v, 180, 220, 255])
        });
        let bytes = png_bytes(image);
        let options = ConvertOptions {
            mode: BuildMode::Staircase,
            staircase_height_auto: true,
            staircase_height_anchor: StaircaseHeightAnchor::Floor,
            staircase_start_edge: StaircaseStartEdge::Bottom,
            dither: crate::model::DitherMode::None,
            size_mode: SizeMode::Custom,
            blocks_x: 3,
            blocks_z: 6,
            maps_x: 1,
            maps_y: 1,
            support_under_gravity: false,
            ..ConvertOptions::default()
        };
        let response = convert_image(&bytes, &options, "26.2").unwrap();
        let max_z = response
            .build
            .structure
            .blocks
            .iter()
            .map(|block| block.z)
            .max()
            .unwrap_or(0);
        assert_eq!(max_z, 6, "Auto + bottom start should still grow a southern control row");
        let mins = column_min_y(&response);
        assert!(
            mins.iter().all(|&y| y == 0),
            "Auto + bottom + floor should still pin columns, got {mins:?}"
        );
    }

    #[test]
    fn staircase_floor_keeps_map_colour_family() {
        // Ground-up may change shade so the north edge sits on y=0, but it must
        // keep the same map-colour blocks as unconstrained matching.
        let image = RgbaImage::from_fn(2, 12, |x, _y| {
            if x == 0 {
                Rgba([8, 8, 8, 255])
            } else {
                Rgba([248, 248, 248, 255])
            }
        });
        let bytes = png_bytes(image);
        let base = ConvertOptions {
            mode: BuildMode::Staircase,
            staircase_height_auto: true,
            staircase_start_edge: StaircaseStartEdge::Top,
            dither: crate::model::DitherMode::None,
            colour_matching: ColourMatching::RebaneMapartClassic,
            size_mode: SizeMode::Custom,
            blocks_x: 2,
            blocks_z: 12,
            maps_x: 1,
            maps_y: 1,
            support_under_gravity: false,
            ..ConvertOptions::default()
        };
        let floor = convert_image(
            &bytes,
            &ConvertOptions {
                staircase_height_anchor: StaircaseHeightAnchor::Floor,
                ..base.clone()
            },
            "26.2",
        )
        .unwrap();
        let off = convert_image(
            &bytes,
            &ConvertOptions {
                staircase_height_anchor: StaircaseHeightAnchor::Floating,
                ..base
            },
            "26.2",
        )
        .unwrap();
        let floor_blocks = floor.preview_surface_palette.iter().collect::<BTreeSet<_>>();
        let off_blocks = off.preview_surface_palette.iter().collect::<BTreeSet<_>>();
        assert_eq!(
            floor_blocks, off_blocks,
            "ground-up should keep the same blocks as exact stairs, only shade may change"
        );
        let floor_controls: Vec<i32> = (0..floor.build.width as i32)
            .map(|x| {
                floor
                    .build
                    .structure
                    .blocks
                    .iter()
                    .filter(|block| block.x == x && block.z == 0)
                    .map(|block| block.y)
                    .min()
                    .expect("control")
            })
            .collect();
        assert!(
            floor_controls.iter().all(|&y| y == 0),
            "ground-up should start on the floor, got {floor_controls:?}"
        );
    }

    #[test]
    fn staircase_rebane_uses_dark_shade_for_black() {
        let image = RgbaImage::from_pixel(3, 8, Rgba([4, 4, 4, 255]));
        let bytes = png_bytes(image);
        let response = convert_image(
            &bytes,
            &ConvertOptions {
                mode: BuildMode::Staircase,
                staircase_height_auto: true,
                staircase_height_anchor: StaircaseHeightAnchor::Floating,
                staircase_start_edge: StaircaseStartEdge::Top,
                dither: crate::model::DitherMode::None,
                colour_matching: ColourMatching::RebaneMapartClassic,
                size_mode: SizeMode::Custom,
                blocks_x: 3,
                blocks_z: 8,
                maps_x: 1,
                maps_y: 1,
                support_under_gravity: false,
                ..ConvertOptions::default()
            },
            "26.2",
        )
        .unwrap();
        let shades = implied_map_shades(&response);
        let dark = shades.iter().filter(|&&shade| shade == 0).count();
        assert!(
            dark * 2 >= shades.len(),
            "black map art should mostly use the dark staircase shade, got {shades:?}"
        );
        assert!(
            shades.iter().all(|&shade| shade == 0),
            "uniform black should be dark-on-dark stairs (shade 0), got {shades:?}"
        );
    }

    #[test]
    fn staircase_capped_dp_stays_on_the_same_map_colour() {
        // A long near-black ramp that cannot fit in 8 layers must re-plan shades,
        // but it should dim the *same* map colour — not jump to a random other block.
        let image = RgbaImage::from_pixel(2, 40, Rgba([12, 12, 12, 255]));
        let bytes = png_bytes(image);
        let response = convert_image(
            &bytes,
            &ConvertOptions {
                mode: BuildMode::Staircase,
                staircase_height_auto: false,
                max_height: 8,
                staircase_height_anchor: StaircaseHeightAnchor::Floor,
                staircase_start_edge: StaircaseStartEdge::Top,
                dither: crate::model::DitherMode::None,
                colour_matching: ColourMatching::RebaneMapartClassic,
                size_mode: SizeMode::Custom,
                blocks_x: 2,
                blocks_z: 40,
                maps_x: 1,
                maps_y: 1,
                support_under_gravity: false,
                ..ConvertOptions::default()
            },
            "26.2",
        )
        .unwrap();
        let unique_art_blocks = response
            .preview_surface_palette
            .iter()
            .filter(|name| *name != "minecraft:air")
            .collect::<BTreeSet<_>>();
        assert_eq!(
            unique_art_blocks.len(),
            1,
            "height-capped black art should stay on one map colour, got {unique_art_blocks:?}"
        );
    }

    #[test]
    fn supports_are_placed_under_carpets_when_enabled() {
        let image = RgbaImage::from_pixel(1, 1, Rgba([255, 255, 255, 255]));
        let mut encoded = Cursor::new(Vec::new());
        image.write_to(&mut encoded, ImageFormat::Png).unwrap();
        let bytes = encoded.into_inner();
        let mut options = ConvertOptions {
            mode: BuildMode::Flat,
            maps_x: 1,
            maps_y: 1,
            dither: crate::model::DitherMode::None,
            staircase_support_block: "minecraft:stone".into(),
            support_under_gravity: true,
            block_overrides: BTreeMap::from([(8, "minecraft:white_carpet".into())]),
            ..ConvertOptions::default()
        };
        // Color 8 is SNOW which includes white_carpet alternatives in 26.2 palette;
        // if white isn't id 8, find a color that has white_carpet.
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let carpet_color = palette
            .colors
            .iter()
            .find(|color| {
                color.block == "minecraft:white_carpet"
                    || color.alternatives.iter().any(|state| state == "minecraft:white_carpet")
            })
            .expect("white carpet should exist in palette");
        options.block_overrides = BTreeMap::from([(carpet_color.id, "minecraft:white_carpet".into())]);
        options.disabled_color_ids = palette
            .colors
            .iter()
            .filter(|color| !color.transparent && color.id != carpet_color.id)
            .map(|color| color.id)
            .collect();

        let with_supports = convert_image(&bytes, &options, "26.2").unwrap();
        assert!(with_supports
            .build
            .materials
            .iter()
            .any(|material| material.block == "minecraft:stone"));
        assert!(with_supports
            .build
            .materials
            .iter()
            .any(|material| material.block == "minecraft:white_carpet"));
        assert_eq!(with_supports.build.height, 2);

        options.support_under_gravity = false;
        let without_supports = convert_image(&bytes, &options, "26.2").unwrap();
        assert!(!without_supports
            .build
            .materials
            .iter()
            .any(|material| material.block == "minecraft:stone"));
        assert_eq!(without_supports.build.height, 1);
    }

    fn png_bytes(image: RgbaImage) -> Vec<u8> {
        let mut encoded = Cursor::new(Vec::new());
        image.write_to(&mut encoded, ImageFormat::Png).unwrap();
        encoded.into_inner()
    }

    fn empty_preview_count(response: &ConversionResponse) -> usize {
        STANDARD
            .decode(&response.preview_surface_indices)
            .unwrap()
            .into_iter()
            .filter(|&index| index == EMPTY_SURFACE)
            .count()
    }

    /// Minecraft map shade implied by north-neighbour height (control row at z=0).
    fn implied_map_shades(response: &ConversionResponse) -> Vec<u8> {
        let width = response.build.width as i32;
        let max_z = response
            .build
            .structure
            .blocks
            .iter()
            .map(|block| block.z)
            .max()
            .unwrap_or(0);
        let mut y_at = vec![None; ((max_z + 1) * width) as usize];
        for block in &response.build.structure.blocks {
            if block.x < 0 || block.x >= width || block.z < 0 || block.z > max_z {
                continue;
            }
            let index = (block.z * width + block.x) as usize;
            y_at[index] = Some(y_at[index].map_or(block.y, |previous: i32| previous.max(block.y)));
        }
        let mut shades = Vec::with_capacity((width * max_z) as usize);
        for z in 1..=max_z {
            for x in 0..width {
                let here = y_at[(z * width + x) as usize].unwrap_or(0);
                let north = y_at[((z - 1) * width + x) as usize].unwrap_or(here);
                shades.push(if here > north {
                    2
                } else if here < north {
                    0
                } else {
                    1
                });
            }
        }
        shades
    }

    /// 16×16 canvas with a 4×4 opaque patch and a faint alpha fringe on every pixel.
    fn padded_sprite(fringe_alpha: u8) -> RgbaImage {
        let mut image = RgbaImage::from_pixel(16, 16, Rgba([0, 0, 0, fringe_alpha]));
        for y in 6..10 {
            for x in 6..10 {
                image.put_pixel(x, y, Rgba([200, 40, 40, 255]));
            }
        }
        image
    }

    #[test]
    fn trim_transparent_crops_padding_then_fills_the_map() {
        let bytes = png_bytes(padded_sprite(0));
        let mut options = ConvertOptions {
            dither: crate::model::DitherMode::None,
            skip_transparent: true,
            maps_x: 1,
            maps_y: 1,
            ..ConvertOptions::default()
        };
        let untrimmed = convert_image(&bytes, &options, "26.2").unwrap();
        options.trim_transparent = true;
        let trimmed = convert_image(&bytes, &options, "26.2").unwrap();
        assert!(
            empty_preview_count(&untrimmed) > empty_preview_count(&trimmed),
            "trim should remove transparent margin so fewer map pixels stay empty"
        );
        assert_eq!(empty_preview_count(&trimmed), 0);
    }

    #[test]
    fn trim_transparent_ignores_near_invisible_fringe() {
        let bytes = png_bytes(padded_sprite(4));
        let options = ConvertOptions {
            dither: crate::model::DitherMode::None,
            skip_transparent: true,
            trim_transparent: true,
            maps_x: 1,
            maps_y: 1,
            ..ConvertOptions::default()
        };
        let trimmed = convert_image(&bytes, &options, "26.2").unwrap();
        assert_eq!(
            empty_preview_count(&trimmed),
            0,
            "alpha 4 fringe must count as padding, same as skip-transparent"
        );
    }

    #[test]
    fn trim_transparent_shrinks_native_custom_pixel_art() {
        let bytes = png_bytes(padded_sprite(0));
        let options = ConvertOptions {
            art_kind: ArtKind::PixelArt,
            size_mode: SizeMode::Custom,
            blocks_x: 16,
            blocks_z: 16,
            dither: crate::model::DitherMode::None,
            skip_transparent: true,
            trim_transparent: true,
            ..ConvertOptions::default()
        };
        let trimmed = convert_image(&bytes, &options, "26.2").unwrap();
        assert_eq!(trimmed.build.width, 4);
        assert_eq!(trimmed.build.length, 4);
        assert_eq!(trimmed.build.structure.blocks.len(), 16);
    }
}
