use crate::assets;
use crate::model::{BlockState, BuildMode, BuildOrientation, StatueBlockPack};
use crate::versions;
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};

fn embedded_palette_json(version: &str) -> Option<&'static str> {
    match version {
        "26.2" => Some(include_str!("../resources/minecraft/26.2/blocks.json")),
        "26.1" => Some(include_str!("../resources/minecraft/26.1/blocks.json")),
        "1.21.11" => Some(include_str!("../resources/minecraft/1.21.11/blocks.json")),
        "1.21.6" => Some(include_str!("../resources/minecraft/1.21.6/blocks.json")),
        "1.21.4" => Some(include_str!("../resources/minecraft/1.21.4/blocks.json")),
        "1.21" => Some(include_str!("../resources/minecraft/1.21/blocks.json")),
        "1.20.6" => Some(include_str!("../resources/minecraft/1.20.6/blocks.json")),
        "1.20.4" => Some(include_str!("../resources/minecraft/1.20.4/blocks.json")),
        "1.20" => Some(include_str!("../resources/minecraft/1.20/blocks.json")),
        _ => None,
    }
}
pub const SHADE_MULTIPLIERS: [u16; 4] = [180, 220, 255, 135];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteFile {
    pub minecraft_version: String,
    pub data_version: i32,
    pub source: String,
    pub colors: Vec<MapColor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapColor {
    pub id: u8,
    pub name: String,
    pub rgb: [u8; 3],
    pub block: String,
    #[serde(default)]
    pub alternatives: Vec<String>,
    #[serde(default)]
    pub transparent: bool,
    #[serde(default)]
    pub gravity: bool,
    #[serde(default)]
    pub flammable: bool,
    #[serde(default)]
    pub fluid: bool,
    #[serde(default)]
    pub needs_support: bool,
}

#[derive(Debug, Clone)]
pub struct PaletteCandidate {
    pub color_id: u8,
    pub shade: u8,
    pub rgb: [u8; 3],
    /// Standard CIE Lab (D65) — used by CIEDE2000.
    pub lab: [f32; 3],
    /// MapartCraft “better colour” Lab (redstonehelper rgb2lab).
    pub mapart_lab: [f32; 3],
    pub oklab: [f32; 3],
    /// Linear-light sRGB. Averaging here is what the eye does when blocks blend.
    pub linear: [f32; 3],
    pub block: BlockState,
}

pub fn load_palette_for(version: &str) -> Result<PaletteFile> {
    let (json, source) = match assets::read_palette_json(version) {
        Some(json) => (json, "external"),
        None => match embedded_palette_json(version) {
            Some(json) => (json.to_string(), "embedded"),
            None => anyhow::bail!(
                "no palette for Minecraft {version} — add minecraft/{version}/blocks.json beside the app"
            ),
        },
    };
    let palette: PaletteFile = serde_json::from_str(&json)
        .with_context(|| format!("invalid {source} {version} palette"))?;
    validate_palette_for(version, &palette)?;
    Ok(palette)
}

fn validate_palette_for(version: &str, palette: &PaletteFile) -> Result<()> {
    ensure!(
        palette.minecraft_version == version,
        "palette targets {}, expected {}",
        palette.minecraft_version,
        version
    );
    if let Some(expected) = versions::expected_data_version(version) {
        ensure!(
            palette.data_version == expected,
            "palette DataVersion is {}, expected {} for Minecraft {version}",
            palette.data_version,
            expected
        );
    }
    ensure!(palette.colors.len() == 62, "expected 62 map color slots");
    ensure!(
        palette
            .colors
            .iter()
            .map(|color| color.alternatives.len())
            .sum::<usize>()
            >= 20_000,
        "palette is missing the extracted block-state catalogue for Minecraft {version}"
    );
    Ok(())
}

pub fn shade_rgb(base: [u8; 3], shade: u8) -> [u8; 3] {
    let multiplier = SHADE_MULTIPLIERS[shade as usize] as u32;
    [
        (base[0] as u32 * multiplier / 255) as u8,
        (base[1] as u32 * multiplier / 255) as u8,
        (base[2] as u32 * multiplier / 255) as u8,
    ]
}

pub fn candidates(
    palette: &PaletteFile,
    mode: BuildMode,
    art_kind: crate::model::ArtKind,
    disabled: &[u8],
    overrides: &std::collections::BTreeMap<u8, String>,
    orientation: BuildOrientation,
) -> Vec<PaletteCandidate> {
    use crate::model::ArtKind;
    // Pixel art is viewed in-world, so match every full cube's texture — not the
    // 62 map-item swatches (those collapse cherry, mangrove and oak to one wood).
    // Wool / concrete / carpet presets still apply via overrides.
    if art_kind == ArtKind::PixelArt {
        return candidates_for_models_appearance_pack(
            palette,
            disabled,
            overrides,
            StatueBlockPack::Everything,
        );
    }
    // Minecraft map items multiply flat terrain by 220/255, so shade 1 matches the
    // in-game map colour. Staircase exposes all three shades via height.
    let shades: &[u8] = match mode {
        BuildMode::Flat => &[1],
        BuildMode::Staircase => &[0, 1, 2],
    };
    palette
        .colors
        .iter()
        .filter(|color| !color.transparent && !disabled.contains(&color.id))
        .flat_map(|color| {
            shades.iter().map(move |shade| {
                let rgb = shade_rgb(color.rgb, *shade);
                PaletteCandidate {
                    color_id: color.id,
                    shade: *shade,
                    rgb,
                    lab: rgb_to_lab(rgb),
                    mapart_lab: rgb_to_mapartcraft_lab(rgb),
                    oklab: rgb_to_oklab(rgb),
                    linear: srgb_to_linear(rgb),
                    block: resolve_build_block(
                        color,
                        overrides.get(&color.id).map(String::as_str),
                        sides_are_visible(art_kind, orientation),
                    ),
                }
            })
        })
        .collect()
}

/// True when sides (not just the top) of placed blocks will be seen.
/// Map items and floor pixel art look at the top face; statues and wall pixel
/// art see the sides, so top-only colours like Warped Nylium would look brown.
pub fn sides_are_visible(art_kind: crate::model::ArtKind, orientation: BuildOrientation) -> bool {
    use crate::model::ArtKind;
    match art_kind {
        ArtKind::MapArt => false,
        ArtKind::PixelArt => orientation != BuildOrientation::Floor,
    }
}

/// Candidates for 3D model colour matching: full-brightness map colours only
/// (no map-item shade darkening). Fluids are excluded — pure blues otherwise
/// latch onto water and look white / stretched in the preview.
/// True if `state` is a known block from the loaded palette
/// (any map colour). Used so block overrides can pick cross-colour replacements
/// from the UI “Any block” list.
pub fn is_known_block_state(palette: &PaletteFile, state: &str) -> bool {
    if BlockState::parse(state).is_none() {
        return false;
    }
    let id = block_id(state);
    palette.colors.iter().any(|color| {
        block_id(&color.block) == id
            || color.alternatives.iter().any(|alt| block_id(alt) == id)
    })
}

/// Candidates for 3D model colour matching. Statues are lit in the world, so
/// there is no map-item shade darkening and no fluids (pure blues otherwise
/// latch onto water and look white / stretched in the preview).
///
/// A colour only survives if some real cube carries it. Map art keeps every
/// MapColor because the map item paints the colour itself; a statue is looked
/// at from every side, so a colour with no honest cube is dropped and matching
/// falls through to the nearest colour that has one.
#[cfg(test)]
pub fn candidates_for_models(
    palette: &PaletteFile,
    disabled: &[u8],
    overrides: &std::collections::BTreeMap<u8, String>,
) -> Vec<PaletteCandidate> {
    palette
        .colors
        .iter()
        .filter(|color| !color.transparent && !color.fluid && !disabled.contains(&color.id))
        .filter_map(|color| {
            let block = match overrides.get(&color.id) {
                Some(state) => resolve_build_block(color, Some(state.as_str()), true),
                None => pick_model_block(color)?,
            };
            let rgb = color.rgb;
            Some(PaletteCandidate {
                color_id: color.id,
                shade: 2,
                rgb,
                lab: rgb_to_lab(rgb),
                mapart_lab: rgb_to_mapartcraft_lab(rgb),
                oklab: rgb_to_oklab(rgb),
                linear: srgb_to_linear(rgb),
                block,
            })
        })
        .collect()
}

const STATUE_APPEARANCE_JSON: &str = include_str!("../resources/statue_appearance.json");

/// Texture-average RGB of full-cube blocks (Scan2Craft / Voxelizer approach).
/// Map colours collapse wool, concrete and terracotta of the same dye to one RGB;
/// a statue shows the real texture, so those have to be separate match targets.
fn statue_appearance_table() -> std::collections::BTreeMap<String, [u8; 3]> {
    serde_json::from_str(STATUE_APPEARANCE_JSON).unwrap_or_default()
}

/// Models appearance palette only — never map art / pixel art.
/// Skip cubes that steal skin or are awkward to place in survival.
fn skip_appearance_block(id: &str) -> bool {
    matches!(
        id,
        "budding_amethyst"
            | "crying_obsidian"
            | "redstone_lamp"
            | "note_block"
            | "magma_block"
            | "brown_mushroom_block"
            | "red_mushroom_block"
            | "mushroom_stem"
            | "gilded_blackstone"
    ) || id.contains("coral_block")
        || skip_inconvenient_copper(id)
        || skip_emissive_statue_block(id)
        || skip_pink_statue_block(id)
        || skip_raw_ore_storage_block(id)
        || skip_uncommon_statue_block(id)
}

/// Decorative / variant cubes that steal the default Models palette.
/// Re-enable them with the Everything pack, or pick them in the block editor.
fn skip_uncommon_statue_block(id: &str) -> bool {
    id.contains("chiseled")
        || id.contains("cracked")
        || id.contains("mossy")
        || id.contains("polished")
        || id.contains("glazed")
        || id.ends_with("_bricks")
        || id == "bricks"
        || id.ends_with("_tiles")
        || id.starts_with("cut_")
        || id.contains("_ore")
        || matches!(
            id,
            "sponge" | "wet_sponge" | "honeycomb_block" | "netherite_block" | "bedrock"
        )
}

/// Whether this cube belongs in the active Models block pack.
fn skip_appearance_for_pack(id: &str, pack: StatueBlockPack) -> bool {
    match pack {
        StatueBlockPack::Everything => false,
        StatueBlockPack::Wool => !id.ends_with("_wool"),
        StatueBlockPack::Concrete => !id.ends_with("_concrete") || id.ends_with("_powder"),
        StatueBlockPack::Terracotta => {
            id.contains("glazed") || !(id.ends_with("_terracotta") || id == "terracotta")
        }
        StatueBlockPack::Stone => !is_stone_appearance_block(id),
        StatueBlockPack::Common | StatueBlockPack::Solid => skip_appearance_block(id),
    }
}

fn is_stone_appearance_block(id: &str) -> bool {
    if matches!(id, "glowstone" | "redstone_block" | "redstone_lamp") {
        return false;
    }
    const FAMILY: &[&str] = &[
        "cobble",
        "deepslate",
        "blackstone",
        "netherrack",
        "end_stone",
        "andesite",
        "diorite",
        "granite",
        "calcite",
        "prismarine",
        "basalt",
        "quartz",
        "tuff",
    ];
    if FAMILY.iter().any(|needle| id.contains(needle)) {
        return true;
    }
    if id.contains("brick") {
        return true;
    }
    id.split('_').any(|part| part == "stone")
}

/// Raw ore cubes are 9-ingot storage, not survival building blocks. Re-enable
/// them in the palette editor if you want that look. `raw_copper_block` stays:
/// it is the only default copper-tone cube besides `copper_block`.
fn skip_raw_ore_storage_block(id: &str) -> bool {
    matches!(id, "raw_iron_block" | "raw_gold_block")
}

/// Dyed pink / magenta / purple cubes steal warm skin even when Lab says they
/// are neighbours. Re-enable them in the palette editor for actual pink meshes.
/// True reds (`red_wool`, `red_terracotta`) stay in the default set.
fn skip_pink_statue_block(id: &str) -> bool {
    matches!(
        id,
        "pink_wool"
            | "pink_concrete"
            | "pink_terracotta"
            | "magenta_wool"
            | "magenta_concrete"
            | "magenta_terracotta"
            | "purple_wool"
            | "purple_concrete"
            | "purple_terracotta"
            | "purpur_block"
            | "purpur_pillar"
    )
}

/// Glow / lantern cubes read as blown-out skin and steal lit scan voxels.
fn skip_emissive_statue_block(id: &str) -> bool {
    matches!(
        id,
        "glowstone"
            | "sea_lantern"
            | "shroomlight"
            | "jack_o_lantern"
            | "beacon"
            | "ochre_froglight"
            | "verdant_froglight"
            | "pearlescent_froglight"
    ) || id.contains("froglight")
}

/// Full copper cubes (all weathering / cut / chiseled / grate / bulb).
/// Doors, chests, golem statues, lanterns, and rods stay out.
fn is_copper_full_cube(id: &str) -> bool {
    let id = id.strip_prefix("waxed_").unwrap_or(id);
    if id.contains("golem_statue")
        || id.contains("chest")
        || id.contains("lantern")
        || id.contains("door")
        || id.contains("trapdoor")
        || id.contains("slab")
        || id.contains("stairs")
        || id.contains("ore")
        || id.contains("lightning")
    {
        return false;
    }
    matches!(
        id,
        "copper_block"
            | "raw_copper_block"
            | "exposed_copper"
            | "weathered_copper"
            | "oxidized_copper"
            | "cut_copper"
            | "exposed_cut_copper"
            | "weathered_cut_copper"
            | "oxidized_cut_copper"
            | "chiseled_copper"
            | "exposed_chiseled_copper"
            | "weathered_chiseled_copper"
            | "oxidized_chiseled_copper"
            | "copper_grate"
            | "exposed_copper_grate"
            | "weathered_copper_grate"
            | "oxidized_copper_grate"
            | "copper_bulb"
            | "exposed_copper_bulb"
            | "weathered_copper_bulb"
            | "oxidized_copper_bulb"
    )
}

/// Waxed / cut / exposed / weathered copper is extra crafting for the same
/// look as `copper_block`. Common pack keeps the plain cube (and raw copper)
/// only; Everything still matches every full copper cube.
fn skip_inconvenient_copper(id: &str) -> bool {
    id.contains("copper") && !matches!(id, "copper_block" | "raw_copper_block")
}

/// Waxed cubes use the unwaxed PNG; export the unwaxed id so preview and
/// survival recipes stay on the convenient block.
fn statue_export_id(id: &str, pack: StatueBlockPack) -> Option<String> {
    let id = id.strip_prefix("waxed_").unwrap_or(id);
    if skip_appearance_for_pack(id, pack) {
        None
    } else {
        Some(id.to_string())
    }
}

fn map_color_owning<'a>(palette: &'a PaletteFile, state: &str) -> Option<&'a MapColor> {
    let id = block_id(state);
    palette.colors.iter().find(|color| {
        block_id(&color.block) == id
            || color
                .alternatives
                .iter()
                .any(|alt| block_id(alt) == id)
    })
}

/// One candidate per distinct cube texture. Used by perceptual mix and the
/// smooth Oklab matcher so a face can pick dirt, white terracotta, and red concrete
/// as different colours instead of 62 map-item swatches.
#[cfg(test)]
pub fn candidates_for_models_appearance(
    palette: &PaletteFile,
    disabled: &[u8],
    overrides: &std::collections::BTreeMap<u8, String>,
) -> Vec<PaletteCandidate> {
    candidates_for_models_appearance_pack(
        palette,
        disabled,
        overrides,
        StatueBlockPack::Common,
    )
}

/// Same as [`candidates_for_models_appearance`], with an explicit Models block pack.
pub fn candidates_for_models_appearance_pack(
    palette: &PaletteFile,
    disabled: &[u8],
    overrides: &std::collections::BTreeMap<u8, String>,
    pack: StatueBlockPack,
) -> Vec<PaletteCandidate> {
    let table = statue_appearance_table();
    let mut out = Vec::new();
    let mut seen_ids = std::collections::BTreeSet::new();
    let mut emitted_override = std::collections::BTreeSet::new();
    for cube in palette_unique_cubes(palette) {
        let Some(place) = statue_export_id(&cube.id, pack) else {
            continue;
        };
        let state = if block_id(&cube.state) == place.as_str() {
            cube.state.clone()
        } else {
            format!("minecraft:{place}")
        };
        if !is_known_block_state(palette, &state) {
            continue;
        }
        if is_non_full_cube(&state) || is_falling_block(&state) || is_statue_prop_block(&state) {
            continue;
        }
        if pack != StatueBlockPack::Everything && is_poor_model_block(&state) {
            continue;
        }
        let Some(color) = map_color_owning(palette, &state) else {
            continue;
        };
        if disabled.contains(&color.id) {
            continue;
        }
        if let Some(forced) = overrides.get(&color.id).filter(|state| !is_statue_prop_block(state))
        {
            if block_id(forced) != place.as_str() {
                continue;
            }
            emitted_override.insert(color.id);
        }
        if !seen_ids.insert(place.clone()) {
            continue;
        }
        let rgb = cube_match_rgb(&place, color.rgb, &table);
        out.push(make_candidate(color.id, rgb, parse_or_simple(&state)));
    }
    for (color_id, forced) in overrides {
        if disabled.contains(color_id)
            || emitted_override.contains(color_id)
            || is_statue_prop_block(forced)
        {
            continue;
        }
        let Some(color) = palette.colors.iter().find(|entry| entry.id == *color_id) else {
            continue;
        };
        let rgb = cube_match_rgb(block_id(forced), color.rgb, &table);
        out.push(make_candidate(*color_id, rgb, parse_or_simple(forced)));
    }
    out
}

struct PaletteCube {
    id: String,
    state: String,
}

fn palette_unique_cubes(palette: &PaletteFile) -> Vec<PaletteCube> {
    let mut best: std::collections::BTreeMap<String, (String, u8)> =
        std::collections::BTreeMap::new();
    for color in &palette.colors {
        if color.transparent {
            continue;
        }
        for state in std::iter::once(color.block.as_str())
            .chain(color.alternatives.iter().map(String::as_str))
        {
            let id = block_id(state);
            if matches!(id, "air" | "cave_air" | "void_air") {
                continue;
            }
            let score = if state.contains('[') { 1 } else { 0 };
            match best.get(id) {
                Some((_, old_score)) if *old_score <= score => {}
                _ => {
                    best.insert(id.to_string(), (state.to_string(), score));
                }
            }
        }
    }
    best.into_iter()
        .map(|(id, (state, _))| PaletteCube { id, state })
        .collect()
}

fn cube_match_rgb(
    id: &str,
    map_rgb: [u8; 3],
    table: &std::collections::BTreeMap<String, [u8; 3]>,
) -> [u8; 3] {
    if let Some(rgb) = table.get(id) {
        return *rgb;
    }
    crate::assets::cube_texture_rgb(id).unwrap_or(map_rgb)
}

/// Doors, slabs, plants, and other non-cubes. Logs / grass stay — they are full
/// blocks, just anisotropic. Everything-pack matching uses them; Common still
/// drops logs via [`is_poor_model_block`].
fn is_non_full_cube(state: &str) -> bool {
    if is_copper_full_cube(block_id(state)) {
        return false;
    }
    if is_anisotropic_map_block(state) && !is_statue_prop_block(state) {
        return false;
    }
    is_omni_unsuitable(state) || is_statue_prop_block(state)
}

/// Full cubes whose names look plant-like (`flowering_azalea_leaves`, moss).
fn is_statue_foliage_cube(id: &str) -> bool {
    id.ends_with("_leaves")
        || id.ends_with("_planks")
        || id.ends_with("_log")
        || id.ends_with("_wood")
        || id.ends_with("_hyphae")
        || id.ends_with("_coral_block")
        || id.ends_with("_wart_block")
        || matches!(
            id,
            "moss_block"
                | "pale_moss_block"
                | "bamboo_block"
                | "stripped_bamboo_block"
                | "bamboo_mosaic"
                | "dried_kelp_block"
                | "mushroom_stem"
                | "brown_mushroom_block"
                | "red_mushroom_block"
                | "grass_block"
                | "crimson_stem"
                | "warped_stem"
                | "stripped_crimson_stem"
                | "stripped_warped_stem"
                | "mangrove_roots"
                | "muddy_mangrove_roots"
                | "rooted_dirt"
                | "mossy_cobblestone"
                | "mossy_stone_bricks"
                | "dripstone_block"
                | "nether_wart_block"
                | "warped_wart_block"
                | "snow_block"
                | "ice"
                | "packed_ice"
                | "blue_ice"
        )
}

/// Not a 1×1×1 building cube: fire, campfires, copper golem statues, flowers,
/// bushes, furniture, and similar props. Never auto-placed on statues or pixel art.
pub(crate) fn is_statue_prop_block(state: &str) -> bool {
    let id = block_id(state);
    if is_statue_foliage_cube(id) || is_copper_full_cube(id) {
        return false;
    }
    if is_statue_furniture_block(id) {
        return true;
    }
    if id == "fire"
        || id == "soul_fire"
        || id.contains("golem_statue")
        || id.contains("campfire")
        || id.contains("flower")
        || id.contains("bush")
        || id.contains("sapling")
        || id.contains("petals")
        || id.contains("blossom")
        || id.contains("seagrass")
        || id.contains("dripleaf")
        || id.contains("dandelion")
        || id.contains("potted")
        || id.ends_with("_fungus")
        || id.ends_with("_tulip")
        || id.ends_with("_crop")
        || id.ends_with("_coral")
        || id.contains("azalea")
    {
        return true;
    }
    matches!(
        id,
        "dispenser"
            | "dropper"
            | "observer"
            | "frosted_ice"
            | "poppy"
            | "allium"
            | "azure_bluet"
            | "oxeye_daisy"
            | "lily_of_the_valley"
            | "wither_rose"
            | "lilac"
            | "peony"
            | "blue_orchid"
            | "cornflower"
            | "sunflower"
            | "torchflower"
            | "pitcher_plant"
            | "wildflowers"
            | "fern"
            | "large_fern"
            | "short_grass"
            | "tall_grass"
            | "short_dry_grass"
            | "tall_dry_grass"
            | "bamboo"
            | "cactus"
            | "sugar_cane"
            | "kelp"
            | "kelp_plant"
            | "sea_pickle"
            | "brown_mushroom"
            | "red_mushroom"
            | "crimson_roots"
            | "warped_roots"
            | "nether_sprouts"
            | "hanging_roots"
            | "mangrove_propagule"
            | "leaf_litter"
            | "lily_pad"
            | "wheat"
            | "carrots"
            | "potatoes"
            | "beetroots"
            | "cocoa"
            | "nether_wart"
            | "melon_stem"
            | "pumpkin_stem"
            | "attached_melon_stem"
            | "attached_pumpkin_stem"
            | "chorus_plant"
            | "cobweb"
            | "powder_snow"
            | "snow"
            | "daylight_detector"
        )
}

/// Machines, rods, pots, and other non-cube furniture — including copper
/// weathering variants (`exposed_lightning_rod`, `waxed_oxidized_lightning_rod`).
fn is_statue_furniture_block(id: &str) -> bool {
    id.contains("lightning_rod")
        || id.contains("end_rod")
        || id.contains("brewing_stand")
        || id.contains("enchanting_table")
        || id.contains("flower_pot")
        || id.contains("decorated_pot")
        || id.contains("grindstone")
        || id.contains("stonecutter")
        || id.contains("lectern")
        || id.contains("hopper")
        || id.contains("composter")
        || id.contains("daylight_detector")
        || id.contains("sculk_sensor")
        || id.contains("sculk_shrieker")
        || id.contains("pointed_dripstone")
        || id.contains("amethyst_cluster")
        || id.contains("amethyst_bud")
        || id.contains("tripwire")
        || id.contains("item_frame")
        || id.contains("dried_ghast")
        || id.contains("heavy_core")
        || id.contains("chiseled_bookshelf")
        || id.contains("scaffolding")
        || id.contains("crafter")
        || id.contains("vault")
        || id.contains("spawner")
        || id.ends_with("_chain")
        || id.ends_with("_egg")
        || matches!(
            id,
            "chain"
                | "iron_bars"
                | "lever"
                | "ladder"
                | "comparator"
                | "repeater"
                | "redstone_wire"
                | "painting"
                | "bell"
                | "conduit"
                | "frogspawn"
                | "bubble_column"
                | "cake"
        )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelAppearanceCube {
    pub block: String,
    pub rgb: [u8; 3],
}

/// Cubes the Models materials UI can toggle — one row per real texture, not a map colour.
pub fn list_model_appearance_cubes(
    palette: &PaletteFile,
    pack: StatueBlockPack,
) -> Vec<ModelAppearanceCube> {
    candidates_for_models_appearance_pack(palette, &[], &Default::default(), pack)
        .into_iter()
        .map(|candidate| ModelAppearanceCube {
            block: candidate.block.canonical_name(),
            rgb: candidate.rgb,
        })
        .collect()
}

pub fn block_id(state: &str) -> &str {
    state
        .split_once('[')
        .map(|(name, _)| name)
        .unwrap_or(state)
        .strip_prefix("minecraft:")
        .unwrap_or(state)
}

fn make_candidate(color_id: u8, rgb: [u8; 3], block: BlockState) -> PaletteCandidate {
    PaletteCandidate {
        color_id,
        shade: 2,
        rgb,
        lab: rgb_to_lab(rgb),
        mapart_lab: rgb_to_mapartcraft_lab(rgb),
        oklab: rgb_to_oklab(rgb),
        linear: srgb_to_linear(rgb),
        block,
    }
}

/// Multiface / vine / hanging blocks share a MapColor but only exist on a host.
/// Never use them as the freestanding colour pixel for map art or statues.
fn is_host_attached_block(state: &str) -> bool {
    let id = block_id(state);
    matches!(
        id,
        "glow_lichen"
            | "sculk_vein"
            | "resin_clump"
            | "vine"
            | "cave_vines"
            | "cave_vines_plant"
            | "weeping_vines"
            | "weeping_vines_plant"
            | "twisting_vines"
            | "twisting_vines_plant"
            | "pale_hanging_moss"
            | "hanging_roots"
            | "spore_blossom"
    ) || id.ends_with("_coral_fan")
        || id.ends_with("_coral_wall_fan")
        || id.ends_with("_wall_torch")
        || id.ends_with("_button")
}

fn parse_or_simple(state: &str) -> BlockState {
    BlockState::parse(state).unwrap_or_else(|| BlockState::simple(state.to_string()))
}

/// Minecraft map colour is sampled as if looking down. These blocks' map
/// colour (or default texture in our 3D preview) comes from a unique top /
/// end face, while the sides are a different hue — Warped Nylium is cyan on
/// top and netherrack-brown on the sides. Fine for maps; wrong for statues
/// and wall pixel art.
fn is_anisotropic_map_block(state: &str) -> bool {
    let id = block_id(state);
    matches!(
        id,
        "grass_block"
            | "podzol"
            | "mycelium"
            | "dirt_path"
            | "farmland"
            | "crimson_nylium"
            | "warped_nylium"
            | "hay_block"
            | "bone_block"
            | "quartz_pillar"
            | "purpur_pillar"
            | "pearlescent_froglight"
            | "verdant_froglight"
            | "ochre_froglight"
    ) || id.ends_with("_nylium")
        || ((id.ends_with("_stem") || id.ends_with("_log") || id.ends_with("_hyphae"))
            && !id.contains("mushroom")
            && !id.contains("chorus")
            && !id.contains("attached")
            && !id.contains("pumpkin"))
}

/// Nether wood / axis blocks and other cubes that are a bad default statue voxel.
/// Map art still uses them as unique MapColors; models drop those colours so
/// matching falls through to wool / terracotta / stone.
fn is_poor_model_block(state: &str) -> bool {
    if is_omni_unsuitable(state) || is_infested_block(state) {
        return true;
    }
    let id = block_id(state);
    id.contains("hyphae")
        || ((id.ends_with("_log") || id.ends_with("_wood") || id.ends_with("_stem"))
            && !id.contains("mushroom")
            && !id.contains("chorus")
            && !id.contains("attached")
            && !id.contains("pumpkin"))
}

/// Sand, gravel and concrete powder fall the moment they are placed with
/// nothing underneath. Map art lays a flat floor, but a statue voxel is mid-air,
/// so keep the MapColor and place a cube of the same colour that stays put.
fn is_falling_block(state: &str) -> bool {
    let id = block_id(state);
    id.ends_with("_concrete_powder")
        || matches!(
            id,
            "sand"
                | "red_sand"
                | "gravel"
                | "suspicious_sand"
                | "suspicious_gravel"
                | "anvil"
                | "chipped_anvil"
                | "damaged_anvil"
                | "dragon_egg"
        )
}

/// The cube a statue places for this colour, or `None` when the colour has no
/// honest one. Unlike map art, models may not fall back to a lookalike from a
/// different MapColor: a map item paints the colour, but a statue shows the
/// block's real texture from every side, so the block must carry this colour.
#[cfg(test)]
fn pick_model_block(color: &MapColor) -> Option<BlockState> {
    let mut best: Option<(&str, u8)> = None;
    for state in std::iter::once(color.block.as_str())
        .chain(color.alternatives.iter().map(String::as_str))
    {
        if is_poor_model_block(state) || is_falling_block(state) || is_statue_prop_block(state) {
            continue;
        }
        let rank = omni_rank(state);
        if best.map(|(_, current)| rank < current).unwrap_or(true) {
            best = Some((state, rank));
        }
    }
    best.map(|(state, _)| parse_or_simple(state))
}

fn is_omni_unsuitable(state: &str) -> bool {
    if is_statue_prop_block(state)
        || is_host_attached_block(state)
        || is_anisotropic_map_block(state)
    {
        return true;
    }
    let id = block_id(state);
    id.ends_with("_slab")
        || id.ends_with("_stairs")
        || id.ends_with("_wall")
        || id.ends_with("_fence")
        || id.ends_with("_fence_gate")
        || id.ends_with("_door")
        || id.ends_with("_trapdoor")
        || id.ends_with("_pane")
        || id.ends_with("_carpet")
        || id.ends_with("_sign")
        || id.ends_with("_hanging_sign")
        || id.ends_with("_banner")
        || id.ends_with("_bed")
        || id.ends_with("_button")
        || id.ends_with("_pressure_plate")
        || id.contains("chest")
        || id.contains("shulker")
        || id.contains("anvil")
        || id.contains("piston")
        || id.contains("hopper")
        || id.contains("lectern")
        || id.contains("furnace")
        || id.contains("smoker")
        || id.contains("barrel")
        || id.contains("composter")
        || id.contains("grindstone")
        || id.contains("stonecutter")
        || id.contains("beacon")
        || id.contains("cake")
        || id.contains("cauldron")
        || id.contains("candle")
        || id.contains("sapling")
        || id.contains("potted")
        || id.contains("rail")
        || id.ends_with("_head")
        || id.ends_with("_skull")
        || id.ends_with("_shelf")
        || id.contains("torch")
        || (id.contains("lantern") && id != "sea_lantern" && id != "jack_o_lantern")
        || id.starts_with("infested_")
        || id.contains("campfire")
        || id.contains("lightning_rod")
        || id.contains("end_rod")
        || id.contains("brewing_stand")
        || id.contains("enchanting_table")
        || id.contains("flower_pot")
        || id.contains("decorated_pot")
        || id.contains("vault")
        || id.contains("spawner")
        || id.ends_with("_chain")
        || matches!(
            id,
            "heavy_core"
                | "bell"
                | "conduit"
                | "decorated_pot"
                | "dried_ghast"
                | "barrier"
                | "light"
                | "structure_void"
                | "structure_block"
                | "jigsaw"
                | "command_block"
                | "chain_command_block"
                | "repeating_command_block"
                | "test_block"
                | "test_instance_block"
                | "bedrock"
                | "spawner"
                | "trial_spawner"
                | "vault"
                | "end_portal"
                | "end_portal_frame"
                | "end_gateway"
                | "nether_portal"
                | "crafter"
                | "chiseled_bookshelf"
                | "dragon_egg"
                | "budding_amethyst"
                | "sculk_sensor"
                | "calibrated_sculk_sensor"
                | "sculk_shrieker"
                | "sniffer_egg"
                | "turtle_egg"
                | "frogspawn"
                | "pointed_dripstone"
                | "amethyst_cluster"
                | "small_amethyst_bud"
                | "medium_amethyst_bud"
                | "large_amethyst_bud"
                | "creaking_heart"
                | "scaffolding"
                | "daylight_detector"
        )
}

/// Lower is better for statues / wall art: uniform coloured cubes first.
fn omni_rank(state: &str) -> u8 {
    let id = block_id(state);
    if id.ends_with("_wool") {
        0
    } else if id.ends_with("_concrete") && !id.contains("powder") {
        1
    } else if id.ends_with("_terracotta") && !id.contains("glazed") {
        2
    } else if id.ends_with("_planks") {
        3
    } else if id.contains("copper") && !id.contains("ore") && !id.contains("door") {
        4
    } else if !state.contains('[') {
        6
    } else {
        12
    }
}

fn anisotropic_fallback(id: &str) -> Option<&'static str> {
    Some(match id {
        "warped_nylium" => "minecraft:oxidized_copper",
        "crimson_nylium" => "minecraft:nether_wart_block",
        "grass_block" => "minecraft:lime_concrete",
        "mycelium" => "minecraft:light_gray_concrete",
        "podzol" => "minecraft:brown_concrete",
        "dirt_path" => "minecraft:packed_mud",
        "farmland" => "minecraft:dirt",
        "crimson_stem" | "stripped_crimson_stem" => "minecraft:crimson_planks",
        "warped_stem" | "stripped_warped_stem" => "minecraft:warped_planks",
        "hay_block" => "minecraft:yellow_wool",
        "bone_block" => "minecraft:bone_block",
        "quartz_pillar" => "minecraft:quartz_block",
        "purpur_pillar" => "minecraft:purpur_block",
        "verdant_froglight" => "minecraft:verdant_froglight",
        "ochre_froglight" => "minecraft:ochre_froglight",
        "pearlescent_froglight" => "minecraft:pearlescent_froglight",
        _ => return None,
    })
}

fn pick_omni_block(color: &MapColor) -> BlockState {
    let default = color.block.as_str();
    if !is_omni_unsuitable(default) {
        return parse_or_simple(default);
    }
    let mut best: Option<(&str, u8)> = None;
    for state in color
        .alternatives
        .iter()
        .map(String::as_str)
        .chain(std::iter::once(default))
    {
        if is_omni_unsuitable(state) {
            continue;
        }
        let rank = omni_rank(state);
        if best.map(|(_, current)| rank < current).unwrap_or(true) {
            best = Some((state, rank));
        }
    }
    if let Some((state, _)) = best {
        return parse_or_simple(state);
    }
    if let Some(fallback) = anisotropic_fallback(block_id(default)) {
        return parse_or_simple(fallback);
    }
    parse_or_simple(&without_infested(default))
}

pub(crate) fn is_infested_block(state: &str) -> bool {
    block_id(state).starts_with("infested_")
}

fn infested_host_state(state: &str) -> Option<String> {
    let host = block_id(state).strip_prefix("infested_")?;
    if host.is_empty() {
        return None;
    }
    Some(format!("minecraft:{host}"))
}

fn without_infested(state: &str) -> String {
    infested_host_state(state).unwrap_or_else(|| state.to_string())
}

fn resolve_build_block(
    color: &MapColor,
    override_state: Option<&str>,
    omni: bool,
) -> BlockState {
    if let Some(requested) = override_state {
        let requested = without_infested(requested);
        if !is_host_attached_block(&requested) && !is_infested_block(&requested) {
            return parse_or_simple(&requested);
        }
        if !is_host_attached_block(&color.block) && !is_infested_block(&color.block) {
            return parse_or_simple(&color.block);
        }
        if let Some(alt) = color.alternatives.iter().find(|state| {
            !is_host_attached_block(state) && !is_infested_block(state)
        }) {
            return parse_or_simple(alt);
        }
        return parse_or_simple(&requested);
    }
    if omni {
        return pick_omni_block(color);
    }
    if !is_host_attached_block(&color.block) && !is_infested_block(&color.block) {
        return parse_or_simple(&color.block);
    }
    if let Some(alt) = color.alternatives.iter().find(|state| {
        !is_host_attached_block(state) && !is_infested_block(state)
    }) {
        return parse_or_simple(alt);
    }
    if let Some(host) = infested_host_state(&color.block) {
        return parse_or_simple(&host);
    }
    parse_or_simple(&color.block)
}

/// HSV-aware distance for synthetic MTL / vertex colours.
/// Lab alone maps pure blues to water and red-yellow browns onto pink wool
/// because those sit next to each other in Lab — hue and saturation keep the
/// nearest *colour*, with no preference for particular blocks.
pub fn model_color_distance(sample: [u8; 3], candidate: [u8; 3]) -> f32 {
    let sample_lab = rgb_to_lab(sample);
    let candidate_lab = rgb_to_lab(candidate);
    let lab = perceptual_distance(sample_lab, candidate_lab);
    let (hs, ss, vs) = rgb_to_hsv(sample);
    let (hc, sc, vc) = rgb_to_hsv(candidate);
    // Near-black / near-grey: hue is meaningless — use Lab only.
    if ss < 0.12 || vs < 0.12 {
        return lab;
    }
    let mut dh = (hs - hc).abs();
    dh = dh.min(1.0 - dh);
    let hue_pen = (dh * 2.0).powi(2) * ss.powf(1.35) * 28_000.0;
    let mut sat_pen = (ss - sc).abs().powi(2) * 3_500.0 * ss;
    if ss >= 0.22 && sc < 0.14 {
        sat_pen += (ss - sc).powi(2) * 18_000.0;
    }
    // A more saturated candidate than the sample (pink wool vs dusty brown).
    if sc > ss + 0.10 {
        sat_pen += (sc - ss).powi(2) * 12_000.0;
    }
    let mut dist = lab * 0.35 + hue_pen + sat_pen + (vs - vc).powi(2) * 900.0;
    // Red–yellow samples are not magenta; Lab still treats them as neighbours.
    if is_warm_earth(sample) && is_magenta_family(candidate) {
        dist += 12_000.0 + hue_pen;
    }
    dist
}

/// Models / statues only. Hue-aware Lab plus the pink-drift tax so peach skin
/// does not land on white terracotta. Map art must not call this — it uses
/// `model_color_distance` / MapartCraft Lab instead.
pub fn statue_color_distance(sample: [u8; 3], candidate: [u8; 3]) -> f32 {
    let mut dist = model_color_distance(sample, candidate);
    if is_warm_earth(sample) && !is_rose_cube(sample) && is_rose_cube(candidate) {
        dist += 12_000.0;
    }
    dist + warm_pink_drift(sample, candidate) * 280.0
}

/// Red–yellow–brown. Green is at least as strong as blue, so this is not magenta.
fn is_warm_earth(rgb: [u8; 3]) -> bool {
    let r = rgb[0] as i16;
    let g = rgb[1] as i16;
    let b = rgb[2] as i16;
    r >= g - 8 && g >= b - 12 && r > b + 8
}

/// Pink / magenta / purple — blue stronger than green.
fn is_magenta_family(rgb: [u8; 3]) -> bool {
    let r = rgb[0] as i16;
    let g = rgb[1] as i16;
    let b = rgb[2] as i16;
    b > g + 6 && r > g + 6
}

/// Dusty rose (pink terracotta) is not magenta — blue ≈ green — but still reads pink.
fn is_rose_cube(rgb: [u8; 3]) -> bool {
    let r = rgb[0] as i16;
    let g = rgb[1] as i16;
    let b = rgb[2] as i16;
    if r <= 70 || r <= g + 18 {
        return false;
    }
    b + 6 >= g && (g > 60 || b > 80) && (r - g) + (b - g) > 40
}

/// Extra CIEDE2000-scale cost when a warm (red–yellow) sample would land on a
/// cooler / pinker cube. Lab treats peach and white terracotta as neighbours;
/// the grout in that texture then reads as pink skin.
pub fn warm_pink_drift(sample: [u8; 3], candidate: [u8; 3]) -> f32 {
    if is_magenta_family(sample) || is_rose_cube(sample) {
        return 0.0;
    }
    if !is_warm_earth(sample) {
        return 0.0;
    }
    let mut extra = 0.0;
    if is_magenta_family(candidate) || is_rose_cube(candidate) {
        extra += 12.0;
    }
    let s = rgb_to_lab(sample);
    let c = rgb_to_lab(candidate);
    let yellow_loss = s[2] - c[2];
    // Only paler cubes: white terracotta is lighter than peach and loses yellow.
    // Darker orange/brown neighbours must not be taxed or true orange snaps off.
    if yellow_loss > 2.0 && c[1] > 4.0 && s[2] > 8.0 && c[0] >= s[0] - 1.0 {
        extra += (yellow_loss - 2.0) * 1.6;
        let sample_chroma = (s[1] * s[1] + s[2] * s[2]).sqrt();
        let cand_chroma = (c[1] * c[1] + c[2] * c[2]).sqrt();
        // Washed beige (white terracotta): Lab-near peach, but grout reads pink.
        // Needs enough extra cost to lose to birch planks once raw iron is gone.
        if cand_chroma < sample_chroma * 0.85 {
            extra += 8.0;
        }
    }
    extra
}

fn rgb_to_hsv(rgb: [u8; 3]) -> (f32, f32, f32) {
    let r = rgb[0] as f32 / 255.0;
    let g = rgb[1] as f32 / 255.0;
    let b = rgb[2] as f32 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    let v = max;
    let s = if max <= 1e-6 { 0.0 } else { delta / max };
    let h = if delta <= 1e-6 {
        0.0
    } else if max == r {
        ((g - b) / delta).rem_euclid(6.0) / 6.0
    } else if max == g {
        (((b - r) / delta) + 2.0) / 6.0
    } else {
        (((r - g) / delta) + 4.0) / 6.0
    };
    (h, s, v)
}

pub fn rgb_to_lab(rgb: [u8; 3]) -> [f32; 3] {
    let mut c = [
        rgb[0] as f32 / 255.0,
        rgb[1] as f32 / 255.0,
        rgb[2] as f32 / 255.0,
    ];
    for value in &mut c {
        *value = if *value > 0.04045 {
            ((*value + 0.055) / 1.055).powf(2.4)
        } else {
            *value / 12.92
        };
    }
    let x = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047;
    let y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    let z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883;
    let f = |value: f32| {
        if value > 0.008856 {
            value.cbrt()
        } else {
            7.787 * value + 16.0 / 116.0
        }
    };
    let (fx, fy, fz) = (f(x), f(y), f(z));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

/// MapartCraft “better colour” Lab — port of `rgb2lab` in
/// `mapCanvas.jsworker` (credited there to redstonehelper). Not CIE D65 Lab:
/// different XYZ matrix, `/12.0` linear branch, and L scaled by 2.55.
pub fn rgb_to_mapartcraft_lab(rgb: [u8; 3]) -> [f32; 3] {
    let linearize = |channel: f32| {
        if 0.04045 >= channel {
            channel / 12.0
        } else {
            ((channel + 0.055) / 1.055).powf(2.4)
        }
    };
    let r1 = linearize(rgb[0] as f32 / 255.0);
    let g1 = linearize(rgb[1] as f32 / 255.0);
    let b1 = linearize(rgb[2] as f32 / 255.0);

    let f = (0.43605202 * r1 + 0.3850816 * g1 + 0.14308742 * b1) / 0.964221;
    let h = 0.22249159 * r1 + 0.71688604 * g1 + 0.060621485 * b1;
    let k = (0.013929122 * r1 + 0.097097 * g1 + 0.7141855 * b1) / 0.825211;

    let lab_f = |value: f32| {
        if 0.008856452 < value {
            value.cbrt()
        } else {
            (903.2963 * value + 16.0) / 116.0
        }
    };
    let l = lab_f(h);
    let m = 500.0 * (lab_f(f) - l);
    let n = 200.0 * (l - lab_f(k));
    // MapartCraft stores L≈0..255 (+0.5) so ΔL is weighted like 8-bit channels.
    [
        2.55 * (116.0 * l - 16.0) + 0.5,
        m + 0.5,
        n + 0.5,
    ]
}

/// sRGB → linear light. Mixing/averaging colours is only physical here.
pub fn srgb_to_linear(rgb: [u8; 3]) -> [f32; 3] {
    let mut c = [
        rgb[0] as f32 / 255.0,
        rgb[1] as f32 / 255.0,
        rgb[2] as f32 / 255.0,
    ];
    for value in &mut c {
        *value = if *value > 0.04045 {
            ((*value + 0.055) / 1.055).powf(2.4)
        } else {
            *value / 12.92
        };
    }
    c
}

/// Bottosson Oklab (2020) from linear-light sRGB.
pub fn linear_to_oklab(c: [f32; 3]) -> [f32; 3] {
    let l = (0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]).cbrt();
    let m = (0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]).cbrt();
    let s = (0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]).cbrt();
    [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ]
}

/// Bottosson Oklab (2020). L ≈ 0..1; a/b are opponent axes.
pub fn rgb_to_oklab(rgb: [u8; 3]) -> [f32; 3] {
    linear_to_oklab(srgb_to_linear(rgb))
}

/// Rec. 709 relative luminance — orders a mixing plan so dithering ramps smoothly.
pub fn relative_luminance(linear: [f32; 3]) -> f32 {
    0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

const HUE_SECTORS: usize = 16;
/// Oklab chroma below this is treated as hue-less grey.
const OKLAB_GREY_CHROMA: f32 = 0.02;

/// Oklab HyAB + hue guard; weights from how many map colours are enabled.
#[derive(Debug, Clone, Copy)]
pub struct StructureLabProfile {
    pub w_l: f32,
    pub w_h: f32,
    pub w_c: f32,
    hue_chroma_cap: [f32; HUE_SECTORS],
}

impl StructureLabProfile {
    pub fn from_candidates(candidates: &[PaletteCandidate]) -> Self {
        let unique = candidates
            .iter()
            .map(|candidate| candidate.color_id)
            .collect::<std::collections::BTreeSet<_>>()
            .len();
        // 16 dye packs (carpet/wool) → hue-heavy; ~50+ map colours → milder.
        let t = ((unique as f32 - 16.0) / 38.0).clamp(0.0, 1.0);
        let mut hue_chroma_cap = [0.0_f32; HUE_SECTORS];
        for candidate in candidates {
            let chroma = oklab_chroma(candidate.oklab);
            if chroma < OKLAB_GREY_CHROMA {
                continue;
            }
            let sector = hue_sector(oklab_hue(candidate.oklab));
            hue_chroma_cap[sector] = hue_chroma_cap[sector].max(chroma);
        }
        Self {
            w_l: 0.70 + 0.45 * t,
            w_h: 1.25 - 0.90 * t,
            w_c: 0.85 - 0.60 * t,
            hue_chroma_cap,
        }
    }

    /// Reduce sample chroma toward the palette’s hue-sector cap (keep L + hue).
    pub fn premap(&self, oklab: [f32; 3]) -> [f32; 3] {
        let chroma = oklab_chroma(oklab);
        if chroma < OKLAB_GREY_CHROMA {
            return oklab;
        }
        let sector = hue_sector(oklab_hue(oklab));
        let prev = (sector + HUE_SECTORS - 1) % HUE_SECTORS;
        let next = (sector + 1) % HUE_SECTORS;
        let cap = self.hue_chroma_cap[prev]
            .max(self.hue_chroma_cap[sector])
            .max(self.hue_chroma_cap[next]);
        if cap < OKLAB_GREY_CHROMA || chroma <= cap {
            return oklab;
        }
        let scale = cap / chroma;
        [oklab[0], oklab[1] * scale, oklab[2] * scale]
    }

    pub fn distance(&self, sample_oklab: [f32; 3], candidate: &PaletteCandidate) -> f32 {
        // Scale Oklab toward Lab-like units so staircase edge penalties stay small.
        let s = [
            sample_oklab[0] * 100.0,
            sample_oklab[1] * 100.0,
            sample_oklab[2] * 100.0,
        ];
        let c = [
            candidate.oklab[0] * 100.0,
            candidate.oklab[1] * 100.0,
            candidate.oklab[2] * 100.0,
        ];
        let dl = (s[0] - c[0]).abs();
        let dc = (s[1] - c[1]).hypot(s[2] - c[2]);
        let c1 = s[1].hypot(s[2]);
        let c2 = c[1].hypot(c[2]);
        let hue_term = if c1 >= 2.0 {
            if c2 < 2.0 {
                // Grey has no hue — don't let lightness-only greys beat skin/earth.
                c1
            } else {
                let h1 = s[2].atan2(s[1]);
                let h2 = c[2].atan2(c[1]);
                2.0 * (c1 * c2).sqrt() * (0.5 * wrapped_angle(h2 - h1)).abs().sin()
            }
        } else {
            0.0
        };
        let chroma_loss = (c1 - c2).max(0.0);
        self.w_l * dl + dc + self.w_h * hue_term + self.w_c * chroma_loss
    }
}

fn oklab_chroma(oklab: [f32; 3]) -> f32 {
    oklab[1].hypot(oklab[2])
}

fn oklab_hue(oklab: [f32; 3]) -> f32 {
    oklab[2].atan2(oklab[1])
}

fn hue_sector(hue: f32) -> usize {
    let tau = std::f32::consts::TAU;
    let u = (hue / tau).rem_euclid(1.0);
    ((u * HUE_SECTORS as f32).floor() as usize).min(HUE_SECTORS - 1)
}

fn wrapped_angle(delta: f32) -> f32 {
    delta.sin().atan2(delta.cos())
}

/// Models-only Oklab distance. HyAB (|ΔL| + chroma) plus a hue term so peach
/// skin does not land on rose neighbours the way CIE Lab / CIEDE2000 did.
/// This is not the map-art `StructureLabProfile` (those weights follow map-colour count).
pub fn statue_oklab_distance(sample: [f32; 3], candidate: [f32; 3]) -> f32 {
    let dl = (sample[0] - candidate[0]).abs();
    let dc = (sample[1] - candidate[1]).hypot(sample[2] - candidate[2]);
    let mut dist = dl + dc;
    let c1 = sample[1].hypot(sample[2]);
    let c2 = candidate[1].hypot(candidate[2]);
    dist += (c1 - c2).max(0.0) * 1.15;
    if candidate[0] > sample[0] {
        dist += (candidate[0] - sample[0]) * 0.75;
    }
    if c1 >= 0.04 {
        if c2 < 0.025 {
            dist += c1 * 0.65;
        } else {
            let hue_gap = wrapped_angle(candidate[2].atan2(candidate[1]) - sample[2].atan2(sample[1]))
                .abs();
            dist += hue_gap * c1.min(c2) * 0.85;
        }
    }
    if statue_is_washed(sample, candidate) {
        dist += 0.12;
    }
    dist
}

/// Paler, less-chromatic cube at the same Oklab hue (white terracotta vs peach).
/// The *average* RGB is close; the grout in the texture still reads pink.
pub fn statue_is_washed(sample: [f32; 3], candidate: [f32; 3]) -> bool {
    let c1 = sample[1].hypot(sample[2]);
    let c2 = candidate[1].hypot(candidate[2]);
    if c1 < 0.04 {
        return false;
    }
    if candidate[0] <= sample[0] + 0.008 || c2 >= c1 * 0.88 {
        return false;
    }
    let hue_gap = wrapped_angle(candidate[2].atan2(candidate[1]) - sample[2].atan2(sample[1])).abs();
    hue_gap < 0.35
}

pub fn perceptual_distance(left: [f32; 3], right: [f32; 3]) -> f32 {
    let dl = left[0] - right[0];
    let da = left[1] - right[1];
    let db = left[2] - right[2];
    dl * dl + da * da + db * db
}

/// CIEDE2000 (ΔE₀₀) in CIELAB, parametric factors kL = kC = kH = 1.
/// Sharma, Wu & Dalal (2005) implementation notes.
pub fn ciede2000(left: [f32; 3], right: [f32; 3]) -> f32 {
    ciede2000_kl(left, right, 1.0)
}

/// CIEDE2000 with a custom lightness weight. `k_l > 1` lets hue win over a
/// lightness miss; `k_l < 1` (scan matching) keeps dark voxels on dark cubes.
pub fn ciede2000_kl(left: [f32; 3], right: [f32; 3], k_l: f64) -> f32 {
    let (l1, a1, b1) = (left[0] as f64, left[1] as f64, left[2] as f64);
    let (l2, a2, b2) = (right[0] as f64, right[1] as f64, right[2] as f64);

    let c1 = (a1 * a1 + b1 * b1).sqrt();
    let c2 = (a2 * a2 + b2 * b2).sqrt();
    let c_bar = (c1 + c2) * 0.5;
    let c_bar7 = c_bar.powi(7);
    let g = 0.5 * (1.0 - (c_bar7 / (c_bar7 + 25.0_f64.powi(7))).sqrt());

    let a1p = (1.0 + g) * a1;
    let a2p = (1.0 + g) * a2;
    let c1p = (a1p * a1p + b1 * b1).sqrt();
    let c2p = (a2p * a2p + b2 * b2).sqrt();

    let h1p = hue_angle_deg(b1, a1p);
    let h2p = hue_angle_deg(b2, a2p);

    let delta_lp = l2 - l1;
    let delta_cp = c2p - c1p;
    let delta_hp_deg = if c1p.min(c2p) < 1e-14 {
        0.0
    } else if (h2p - h1p).abs() <= 180.0 {
        h2p - h1p
    } else if h2p - h1p > 180.0 {
        h2p - h1p - 360.0
    } else {
        h2p - h1p + 360.0
    };
    let delta_hp = 2.0 * (c1p * c2p).sqrt() * (delta_hp_deg.to_radians() * 0.5).sin();

    let l_bar = (l1 + l2) * 0.5;
    let c_bar_p = (c1p + c2p) * 0.5;
    let h_bar_p = if c1p.min(c2p) < 1e-14 {
        h1p + h2p
    } else if (h1p - h2p).abs() <= 180.0 {
        (h1p + h2p) * 0.5
    } else if h1p + h2p < 360.0 {
        (h1p + h2p + 360.0) * 0.5
    } else {
        (h1p + h2p - 360.0) * 0.5
    };

    let t = 1.0 - 0.17 * (h_bar_p - 30.0).to_radians().cos()
        + 0.24 * (2.0 * h_bar_p).to_radians().cos()
        + 0.32 * (3.0 * h_bar_p + 6.0).to_radians().cos()
        - 0.20 * (4.0 * h_bar_p - 63.0).to_radians().cos();
    let delta_theta = 30.0 * (-((h_bar_p - 275.0) / 25.0).powi(2)).exp();
    let c_bar_p7 = c_bar_p.powi(7);
    let r_c = 2.0 * (c_bar_p7 / (c_bar_p7 + 25.0_f64.powi(7))).sqrt();
    let r_t = -r_c * (2.0 * delta_theta.to_radians()).sin();

    let sl = 1.0 + (0.015 * (l_bar - 50.0).powi(2)) / (20.0 + (l_bar - 50.0).powi(2)).sqrt();
    let sc = 1.0 + 0.045 * c_bar_p;
    let sh = 1.0 + 0.015 * c_bar_p * t;

    let l_term = delta_lp / (k_l.max(1e-6) * sl);
    let c_term = delta_cp / sc;
    let h_term = delta_hp / sh;
    (l_term * l_term + c_term * c_term + h_term * h_term + r_t * c_term * h_term).sqrt() as f32
}

fn hue_angle_deg(b: f64, a_prime: f64) -> f64 {
    if a_prime.abs() < 1e-14 && b.abs() < 1e-14 {
        0.0
    } else {
        let mut h = b.atan2(a_prime).to_degrees();
        if h < 0.0 {
            h += 360.0;
        }
        h
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ciede2000_matches_sharma_sample_pairs() {
        // Sharma, Wu & Dalal, Color Res Appl 30(1), 2005 — Table I.
        let pairs = [
            ([50.0000, 2.6772, -79.7751], [50.0000, 0.0000, -82.7485], 2.0425),
            ([50.0000, 3.1571, -77.2803], [50.0000, 0.0000, -82.7485], 2.8615),
            ([50.0000, 2.8361, -74.0200], [50.0000, 0.0000, -82.7485], 3.4412),
            ([50.0000, 2.5000, 0.0000], [50.0000, 0.0000, -2.5000], 4.3065),
            ([50.0000, 0.0000, 0.0000], [50.0000, -1.0000, 2.0000], 2.3669),
        ];
        for (left, right, expected) in pairs {
            let delta = ciede2000(left, right);
            assert!(
                (delta - expected).abs() < 5e-4,
                "CIEDE2000({left:?}, {right:?}) = {delta}, expected {expected}"
            );
        }
        assert!(ciede2000([50.0, 0.0, 0.0], [50.0, 0.0, 0.0]).abs() < 1e-6);
    }

    fn test_candidate(color_id: u8, rgb: [u8; 3]) -> PaletteCandidate {
        PaletteCandidate {
            color_id,
            shade: 1,
            rgb,
            lab: rgb_to_lab(rgb),
            mapart_lab: rgb_to_mapartcraft_lab(rgb),
            oklab: rgb_to_oklab(rgb),
            linear: srgb_to_linear(rgb),
            block: crate::model::BlockState::simple("minecraft:stone"),
        }
    }

    #[test]
    fn mapartcraft_lab_matches_rebane_rgb2lab() {
        // Reference values from MapartCraft mapCanvas.jsworker rgb2lab.
        let cases: [([u8; 3], [f32; 3]); 6] = [
            ([0, 0, 0], [0.5, 0.5, 0.5]),
            ([255, 255, 255], [255.49991, 0.5001544, 0.49989075]),
            ([210, 165, 140], [182.79654, 15.053575, 20.17115]),
            ([128, 64, 32], [90.09251, 26.877644, 32.47221]),
            ([10, 20, 30], [15.539072, -0.78786623, -7.679173]),
            ([180, 40, 40], [104.80467, 56.160526, 37.472546]),
        ];
        for (rgb, expected) in cases {
            let got = rgb_to_mapartcraft_lab(rgb);
            for i in 0..3 {
                assert!(
                    (got[i] - expected[i]).abs() < 1e-4,
                    "rgb {rgb:?} channel {i}: got {} expected {}",
                    got[i],
                    expected[i]
                );
            }
        }
    }

    #[test]
    fn oklab_white_is_unit_lightness() {
        let white = rgb_to_oklab([255, 255, 255]);
        let black = rgb_to_oklab([0, 0, 0]);
        assert!((white[0] - 1.0).abs() < 0.02, "white L {}", white[0]);
        assert!(black[0].abs() < 0.02, "black L {}", black[0]);
        assert!(white[1].abs() < 0.02 && white[2].abs() < 0.02);
    }

    #[test]
    fn warm_pink_drift_taxes_peach_on_white_terracotta_not_actual_rose() {
        let peach = [210_u8, 165, 140];
        let white_terracotta = [210_u8, 178, 161];
        let pink_terracotta = [162_u8, 78, 79];
        let rose = [180_u8, 90, 100];
        assert!(
            warm_pink_drift(peach, white_terracotta) >= 12.0,
            "peach on white terracotta drift {}",
            warm_pink_drift(peach, white_terracotta)
        );
        assert!(
            warm_pink_drift(peach, [192, 175, 121]) < 2.0,
            "birch planks must stay a cheap peach neighbour"
        );
        assert!(
            warm_pink_drift(peach, pink_terracotta) >= 12.0,
            "peach on pink terracotta drift {}",
            warm_pink_drift(peach, pink_terracotta)
        );
        assert_eq!(
            warm_pink_drift(rose, pink_terracotta),
            0.0,
            "an actual rose sample must still be allowed to match pink terracotta"
        );
    }

    #[test]
    fn structure_lab_prefers_pink_over_grey_for_skin() {
        let grey = test_candidate(8, [153, 153, 153]);
        let pink = test_candidate(6, [242, 127, 165]);
        let orange = test_candidate(1, [216, 127, 51]);
        let palette = [grey, pink, orange];
        let profile = StructureLabProfile::from_candidates(&palette);
        assert!(
            profile.w_h > profile.w_l,
            "16-colour pack should be hue-heavy ({:.2} vs L {:.2})",
            profile.w_h,
            profile.w_l
        );
        let sample = profile.premap(rgb_to_oklab([210, 165, 140]));
        let mut ranked = palette.iter().collect::<Vec<_>>();
        ranked.sort_by(|left, right| {
            profile
                .distance(sample, left)
                .total_cmp(&profile.distance(sample, right))
        });
        assert_ne!(
            ranked[0].color_id, 8,
            "skin should not snap to light grey (picked color {})",
            ranked[0].color_id
        );
        assert_eq!(
            ranked[0].color_id, 1,
            "skin should pick orange over pink/grey on this 3-colour stand-in"
        );
    }

    #[test]
    fn exact_minecraft_shades_use_integer_truncation() {
        assert_eq!(shade_rgb([127, 178, 56], 0), [89, 125, 39]);
        assert_eq!(shade_rgb([127, 178, 56], 1), [109, 153, 48]);
        assert_eq!(shade_rgb([127, 178, 56], 2), [127, 178, 56]);
        assert_eq!(shade_rgb([127, 178, 56], 3), [67, 94, 29]);
    }

    #[test]
    fn bundled_palette_is_pinned() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        assert_eq!(palette.data_version, 4903);
        assert_eq!(palette.colors[61].name, "GLOW_LICHEN");
    }

    #[test]
    fn every_registered_palette_matches_registry_data_version() {
        for def in crate::versions::registered_versions() {
            let palette = load_palette_for(def.id)
                .unwrap_or_else(|err| panic!("load palette {}: {err}", def.id));
            assert_eq!(
                palette.minecraft_version, def.id,
                "palette minecraftVersion for {}",
                def.id
            );
            assert_eq!(
                palette.data_version, def.data_version,
                "palette DataVersion for {}",
                def.id
            );
        }
    }

    #[test]
    fn saturated_blues_prefer_blue_wool_not_white() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let candidates = candidates_for_models(&palette, &[], &Default::default());
        let pick = |rgb: [u8; 3]| {
            candidates
                .iter()
                .min_by(|a, b| {
                    model_color_distance(rgb, a.rgb).total_cmp(&model_color_distance(rgb, b.rgb))
                })
                .unwrap()
        };
        assert_eq!(pick([0, 0, 204]).color_id, 25, "pure MTL blue");
        assert_eq!(pick([7, 39, 163]).color_id, 25, "rim blue");
        assert_eq!(pick([100, 120, 180]).color_id, 17, "washed blue");
        assert_ne!(pick([0, 0, 204]).block.canonical_name(), "minecraft:white_wool");
        assert_ne!(pick([0, 0, 204]).block.canonical_name(), "minecraft:water");
    }

    #[test]
    fn model_matching_keeps_closest_hue_not_pink_dyes() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let candidates = candidates_for_models(&palette, &[], &Default::default());
        let pick = |rgb: [u8; 3]| {
            candidates
                .iter()
                .min_by(|a, b| {
                    model_color_distance(rgb, a.rgb).total_cmp(&model_color_distance(rgb, b.rgb))
                })
                .unwrap()
        };
        let pink = palette.colors.iter().find(|color| color.name == "PINK").unwrap();
        let magenta = palette.colors.iter().find(|color| color.name == "MAGENTA").unwrap();
        let purple = palette.colors.iter().find(|color| color.name == "PURPLE").unwrap();
        let dirt = palette.colors.iter().find(|color| color.name == "DIRT").unwrap();
        let red = palette.colors.iter().find(|color| color.name == "RED").unwrap();
        let orange = palette.colors.iter().find(|color| color.name == "ORANGE").unwrap();
        let wrong_hue = [pink.id, magenta.id, purple.id];

        assert_eq!(
            pick(dirt.rgb).color_id,
            dirt.id,
            "a colour that is already a palette entry should keep that entry"
        );
        assert_eq!(
            pick(pink.rgb).color_id,
            pink.id,
            "actual pink should still match pink"
        );
        assert_eq!(
            pick(red.rgb).color_id,
            red.id,
            "actual red should still match red"
        );

        let tan = pick([186, 132, 85]);
        assert!(
            !wrong_hue.contains(&tan.color_id),
            "brown tan is not magenta; got {}",
            tan.block.canonical_name()
        );
        let skin = pick([210, 165, 140]);
        assert!(
            !wrong_hue.contains(&skin.color_id),
            "peach is not hot pink; got {}",
            skin.block.canonical_name()
        );
        let crewmate = pick([196, 40, 40]);
        assert!(
            !wrong_hue.contains(&crewmate.color_id),
            "saturated red is not pink/purple; got {}",
            crewmate.block.canonical_name()
        );
        assert_eq!(
            pick([249, 128, 29]).color_id,
            orange.id,
            "saturated orange must stay orange"
        );
    }

    #[test]
    fn appearance_peach_is_not_white_terracotta() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let candidates = candidates_for_models_appearance(&palette, &[], &Default::default());
        let peach = [210_u8, 165, 140];
        let pick = candidates
            .iter()
            .min_by(|a, b| {
                statue_color_distance(peach, a.rgb).total_cmp(&statue_color_distance(peach, b.rgb))
            })
            .unwrap();
        let name = pick.block.canonical_name();
        assert_ne!(
            name, "minecraft:white_terracotta",
            "hue-aware peach must not land on white terracotta"
        );
        assert_ne!(
            name, "minecraft:raw_iron_block",
            "peach should use a survival building cube, not raw iron"
        );
        assert!(
            !name.contains("pink_") && !name.contains("magenta_") && !name.contains("purpur"),
            "hue-aware peach must not land on {name}"
        );
    }

    #[test]
    fn every_model_colour_places_a_block_that_really_is_that_colour() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let models = candidates_for_models(&palette, &[], &Default::default());
        assert!(models.len() >= 40, "models kept only {} colours", models.len());
        for candidate in &models {
            let color = palette
                .colors
                .iter()
                .find(|entry| entry.id == candidate.color_id)
                .unwrap();
            let placed = candidate.block.canonical_name();
            assert!(
                color.block == placed || color.alternatives.iter().any(|state| *state == placed),
                "{} places {placed}, which does not carry that MapColor",
                color.name
            );
            assert!(
                !is_falling_block(&placed),
                "{} places {placed}, which falls with nothing under it",
                color.name
            );
        }
        let sand = palette.colors.iter().find(|color| color.name == "SAND").unwrap();
        let sand_block = models
            .iter()
            .find(|candidate| candidate.color_id == sand.id)
            .expect("SAND has non-falling cubes")
            .block
            .canonical_name();
        assert_ne!(sand_block, "minecraft:sand");
    }

    #[test]
    fn models_match_distinct_cube_textures_not_one_swatch_per_map_colour() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let map = candidates_for_models(&palette, &[], &Default::default());
        let appearance = candidates_for_models_appearance(&palette, &[], &Default::default());
        let unique_rgb = appearance
            .iter()
            .map(|candidate| candidate.rgb)
            .collect::<std::collections::BTreeSet<_>>();
        assert!(
            unique_rgb.len() >= 80,
            "models should match real cube averages, got {} unique RGBs",
            unique_rgb.len()
        );
        assert!(
            appearance.len() > map.len(),
            "texture averages should add cubes the map palette collapses, map={} appearance={}",
            map.len(),
            appearance.len()
        );
        let names: std::collections::BTreeSet<_> = appearance
            .iter()
            .map(|candidate| candidate.block.canonical_name())
            .collect();
        for need in [
            "minecraft:dirt",
            "minecraft:white_terracotta",
            "minecraft:red_concrete",
            "minecraft:red_wool",
            "minecraft:oak_planks",
        ] {
            assert!(names.contains(need), "appearance palette missing {need}");
        }
        for skip in [
            "minecraft:pink_wool",
            "minecraft:pink_concrete",
            "minecraft:pink_terracotta",
            "minecraft:magenta_wool",
            "minecraft:magenta_concrete",
            "minecraft:purple_wool",
            "minecraft:purple_terracotta",
            "minecraft:purpur_block",
            "minecraft:raw_iron_block",
            "minecraft:raw_gold_block",
            "minecraft:chiseled_stone_bricks",
            "minecraft:stone_bricks",
            "minecraft:bricks",
            "minecraft:cracked_stone_bricks",
            "minecraft:polished_andesite",
        ] {
            assert!(
                !names.contains(skip),
                "common Models cubes skip {skip} — use Everything or the block editor"
            );
        }
        let red_wool = appearance
            .iter()
            .find(|candidate| candidate.block.canonical_name() == "minecraft:red_wool")
            .unwrap();
        let red_concrete = appearance
            .iter()
            .find(|candidate| candidate.block.canonical_name() == "minecraft:red_concrete")
            .unwrap();
        assert_ne!(
            red_wool.rgb, red_concrete.rgb,
            "wool and concrete of the same dye must stay different match targets"
        );
        assert!(
            names.iter().all(|name| !name.contains("waxed_")),
            "waxed copper must not be auto-placed"
        );
        assert!(
            names.iter().all(|name| {
                let id = name.strip_prefix("minecraft:").unwrap_or(name);
                !id.contains("copper") || matches!(id, "copper_block" | "raw_copper_block")
            }),
            "cut/exposed/weathered copper must not be auto-placed"
        );
        assert!(
            names.contains("minecraft:copper_block"),
            "plain copper_block should remain available"
        );
        assert!(
            !names.contains("minecraft:sand") && !names.contains("minecraft:red_sand"),
            "falling sand must not be auto-placed"
        );
    }

    #[test]
    fn infested_blocks_are_never_auto_placed() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let models = candidates_for_models(&palette, &[], &Default::default());
        assert!(
            models
                .iter()
                .all(|candidate| !is_infested_block(&candidate.block.canonical_name())),
            "models default palette must not pick infested stone"
        );
        let clay = palette.colors.iter().find(|color| color.name == "CLAY").unwrap();
        assert!(
            clay.alternatives
                .iter()
                .any(|state| state.contains("infested_")),
            "fixture: clay still lists infested alternatives in the registry"
        );
        let clay_block = models
            .iter()
            .find(|candidate| candidate.color_id == clay.id)
            .unwrap();
        assert_eq!(clay_block.block.canonical_name(), "minecraft:clay");
        let forced = std::collections::BTreeMap::from([(
            clay.id,
            "minecraft:infested_chiseled_stone_bricks".to_string(),
        )]);
        let remapped = candidates_for_models(&palette, &[], &forced);
        let after = remapped
            .iter()
            .find(|candidate| candidate.color_id == clay.id)
            .unwrap();
        assert_eq!(
            after.block.canonical_name(),
            "minecraft:chiseled_stone_bricks",
            "an infested override must fall back to the host block"
        );
    }

    #[test]
    fn cross_colour_override_is_a_known_block() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        assert!(is_known_block_state(&palette, "minecraft:white_terracotta"));
        assert!(is_known_block_state(&palette, "minecraft:raw_iron_block"));
        assert!(!is_known_block_state(&palette, "minecraft:not_a_real_block"));
        let raw_iron = palette.colors.iter().find(|c| c.name == "RAW_IRON").unwrap();
        assert!(!raw_iron.alternatives.iter().any(|s| s == "minecraft:white_terracotta"));
        let overrides = std::collections::BTreeMap::from([(
            raw_iron.id,
            "minecraft:white_terracotta".to_string(),
        )]);
        let candidates = candidates_for_models(&palette, &[], &overrides);
        let matched = candidates.iter().find(|c| c.color_id == raw_iron.id).unwrap();
        assert_eq!(matched.block.canonical_name(), "minecraft:white_terracotta");
    }

    #[test]
    fn glow_lichen_colour_uses_verdant_froglight() {
        use crate::model::ArtKind;
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let color = palette
            .colors
            .iter()
            .find(|entry| entry.id == 61)
            .expect("GLOW_LICHEN colour");
        assert_eq!(color.block, "minecraft:verdant_froglight");
        assert!(!color.needs_support);
        let flat = candidates(
            &palette,
            BuildMode::Flat,
            ArtKind::MapArt,
            &[],
            &Default::default(),
            BuildOrientation::Floor,
        );
        let matched = flat.iter().find(|c| c.color_id == 61).unwrap();
        assert_eq!(
            matched.block.canonical_name(),
            "minecraft:verdant_froglight"
        );
        let forced = std::collections::BTreeMap::from([(
            61u8,
            "minecraft:glow_lichen".to_string(),
        )]);
        let remapped = candidates(
            &palette,
            BuildMode::Flat,
            ArtKind::MapArt,
            &[],
            &forced,
            BuildOrientation::Floor,
        );
        let safe = remapped.iter().find(|c| c.color_id == 61).unwrap();
        assert_eq!(safe.block.canonical_name(), "minecraft:verdant_froglight");
    }

    #[test]
    fn flat_map_art_uses_mid_shade_pixel_art_matches_real_cubes() {
        use crate::model::ArtKind;
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let map_flat = candidates(
            &palette,
            BuildMode::Flat,
            ArtKind::MapArt,
            &[],
            &Default::default(),
            BuildOrientation::Floor,
        );
        assert!(map_flat.iter().all(|c| c.shade == 1));
        assert!(map_flat
            .iter()
            .any(|c| c.color_id == 8 && c.rgb == [220, 220, 220]));
        assert!(
            map_flat.len() <= 62,
            "map art must stay on map-item colours, got {}",
            map_flat.len()
        );
        let pixel_flat = candidates(
            &palette,
            BuildMode::Flat,
            ArtKind::PixelArt,
            &[],
            &Default::default(),
            BuildOrientation::Floor,
        );
        assert!(pixel_flat.iter().all(|c| c.shade == 2));
        let names: std::collections::BTreeSet<_> = pixel_flat
            .iter()
            .map(|c| c.block.canonical_name())
            .collect();
        assert!(
            pixel_flat.len() > 200,
            "pixel art should match version cubes, got {}",
            pixel_flat.len()
        );
        assert!(names.contains("minecraft:oak_planks"));
        assert!(names.contains("minecraft:cherry_planks"));
        assert!(names.contains("minecraft:white_wool"));
        let stair = candidates(
            &palette,
            BuildMode::Staircase,
            ArtKind::MapArt,
            &[],
            &Default::default(),
            BuildOrientation::Floor,
        );
        assert!(stair.iter().any(|c| c.shade == 1));
        assert!(stair.iter().any(|c| c.shade == 2));
    }

    fn colour_block(candidates: &[PaletteCandidate], name: &str) -> String {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let id = palette
            .colors
            .iter()
            .find(|color| color.name == name)
            .unwrap()
            .id;
        candidates
            .iter()
            .find(|candidate| candidate.color_id == id)
            .unwrap_or_else(|| panic!("{name} (id {id}) missing from candidate list"))
            .block
            .canonical_name()
    }

    #[test]
    fn map_art_keeps_top_face_blocks_statues_do_not() {
        use crate::model::ArtKind;
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let map = candidates(
            &palette,
            BuildMode::Flat,
            ArtKind::MapArt,
            &[],
            &Default::default(),
            BuildOrientation::Floor,
        );
        assert_eq!(colour_block(&map, "WARPED_NYLIUM"), "minecraft:warped_nylium");
        assert_eq!(colour_block(&map, "GRASS"), "minecraft:grass_block");

        let models = candidates_for_models(&palette, &[], &Default::default());
        assert_ne!(
            colour_block(&models, "WARPED_NYLIUM"),
            "minecraft:warped_nylium",
            "statues must not use Warped Nylium — sides are netherrack, not cyan"
        );
        assert_ne!(
            colour_block(&models, "GRASS"),
            "minecraft:grass_block",
            "statues must not use Grass Block — sides are dirt, not green"
        );
        let crimson = palette
            .colors
            .iter()
            .find(|color| color.name == "CRIMSON_NYLIUM")
            .unwrap()
            .id;
        assert!(
            models.iter().all(|candidate| candidate.color_id != crimson),
            "crimson nylium has no honest cube — drop the colour rather than place a top-only block"
        );
        assert!(
            models.iter().all(|candidate| {
                !candidate.block.canonical_name().contains("hyphae")
            }),
            "statues must not place warped/crimson hyphae"
        );
        for name in ["WARPED_HYPHAE", "CRIMSON_HYPHAE"] {
            let id = palette.colors.iter().find(|color| color.name == name).unwrap().id;
            assert!(
                models.iter().all(|candidate| candidate.color_id != id),
                "{name} is a map-item colour with no statue cube — skip it so matching uses terracotta"
            );
        }
    }

    #[test]
    fn map_art_keeps_pink_and_raw_iron_that_statues_skip() {
        use crate::model::ArtKind;
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let map = candidates(
            &palette,
            BuildMode::Flat,
            ArtKind::MapArt,
            &[],
            &Default::default(),
            BuildOrientation::Floor,
        );
        for name in ["PINK", "MAGENTA", "PURPLE", "RAW_IRON"] {
            let id = palette
                .colors
                .iter()
                .find(|color| color.name == name)
                .unwrap()
                .id;
            assert!(
                map.iter().any(|candidate| candidate.color_id == id),
                "map art must still offer {name} — statue skips must not apply"
            );
        }
        let appearance = candidates_for_models_appearance(&palette, &[], &Default::default());
        let names: std::collections::BTreeSet<_> = appearance
            .iter()
            .map(|candidate| candidate.block.canonical_name())
            .collect();
        assert!(
            !names.contains("minecraft:pink_wool") && !names.contains("minecraft:raw_iron_block"),
            "statue appearance skips those cubes; map art does not"
        );
    }

    #[test]
    fn everything_pack_unlocks_uncommon_and_pink_cubes() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let everything = candidates_for_models_appearance_pack(
            &palette,
            &[],
            &Default::default(),
            StatueBlockPack::Everything,
        );
        let names: std::collections::BTreeSet<_> = everything
            .iter()
            .map(|candidate| candidate.block.canonical_name())
            .collect();
        let ids: std::collections::BTreeSet<_> = names
            .iter()
            .map(|name| block_id(name).to_string())
            .collect();
        for need in [
            "chiseled_stone_bricks",
            "stone_bricks",
            "bricks",
            "pink_wool",
            "raw_iron_block",
            "glowstone",
            "cherry_planks",
            "mangrove_planks",
            "bamboo_planks",
            "pale_oak_planks",
            "copper_block",
            "exposed_copper",
            "weathered_copper",
            "oxidized_copper",
            "cut_copper",
            "exposed_cut_copper",
            "weathered_cut_copper",
            "oxidized_cut_copper",
            "chiseled_copper",
            "exposed_chiseled_copper",
            "weathered_chiseled_copper",
            "oxidized_chiseled_copper",
            "copper_grate",
            "exposed_copper_grate",
            "weathered_copper_grate",
            "oxidized_copper_grate",
            "copper_bulb",
            "exposed_copper_bulb",
            "weathered_copper_bulb",
            "oxidized_copper_bulb",
        ] {
            assert!(
                ids.contains(need),
                "Everything pack should include {need}"
            );
        }
        assert!(
            everything.len()
                > candidates_for_models_appearance(&palette, &[], &Default::default()).len(),
            "Everything must be a larger cube pool than Common"
        );
    }

    #[test]
    fn statue_pool_skips_fire_golem_statues_flowers_and_bushes() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let names: std::collections::BTreeSet<_> =
            list_model_appearance_cubes(&palette, StatueBlockPack::Everything)
                .into_iter()
                .map(|cube| cube.block)
                .collect();
        let ids: std::collections::BTreeSet<_> = names
            .iter()
            .map(|name| block_id(name).to_string())
            .collect();
        for banned in [
            "fire",
            "soul_fire",
            "campfire",
            "soul_campfire",
            "copper_golem_statue",
            "exposed_copper_golem_statue",
            "weathered_copper_golem_statue",
            "oxidized_copper_golem_statue",
            "dandelion",
            "poppy",
            "rose_bush",
            "sweet_berry_bush",
            "lilac",
            "peony",
            "short_grass",
            "dispenser",
            "dropper",
            "observer",
            "frosted_ice",
            "blue_orchid",
            "cornflower",
            "sunflower",
            "torchflower",
            "wildflowers",
            "cactus_flower",
            "golden_dandelion",
            "azalea",
            "flowering_azalea",
            "bamboo",
            "cactus",
            "cobweb",
            "lightning_rod",
            "exposed_lightning_rod",
            "weathered_lightning_rod",
            "oxidized_lightning_rod",
            "brewing_stand",
            "enchanting_table",
            "decorated_pot",
            "hopper",
            "grindstone",
            "stonecutter",
            "lectern",
            "crafter",
            "vault",
            "bell",
            "conduit",
        ] {
            assert!(
                !ids.contains(banned),
                "statue pool must not auto-place {banned}"
            );
        }
        assert!(
            ids.contains("flowering_azalea_leaves")
                || ids.contains("azalea_leaves")
                || ids.contains("oak_leaves"),
            "leaf cubes should still be statue voxels"
        );
        assert!(
            names.iter().all(|name| {
                let id = block_id(name);
                !is_statue_prop_block(name)
                    && !id.contains("lightning_rod")
                    && !id.contains("brewing_stand")
                    && !id.contains("golem_statue")
            }),
            "statue pool leaked a fire, flower, bush, campfire, golem statue, or furniture prop"
        );
    }

    #[test]
    fn wool_pack_only_matches_wool_cubes() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let wool = candidates_for_models_appearance_pack(
            &palette,
            &[],
            &Default::default(),
            StatueBlockPack::Wool,
        );
        assert!(wool.len() >= 12, "wool pack kept only {} cubes", wool.len());
        for candidate in &wool {
            assert!(
                candidate.block.canonical_name().ends_with("_wool"),
                "wool pack leaked {}",
                candidate.block.canonical_name()
            );
        }
        let names: std::collections::BTreeSet<_> = wool
            .iter()
            .map(|candidate| candidate.block.canonical_name())
            .collect();
        assert!(
            names.contains("minecraft:pink_wool"),
            "wool pack should include pink wool"
        );
    }

    #[test]
    fn stone_pack_keeps_bricks_and_skips_wool() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let stone = candidates_for_models_appearance_pack(
            &palette,
            &[],
            &Default::default(),
            StatueBlockPack::Stone,
        );
        let names: std::collections::BTreeSet<_> = stone
            .iter()
            .map(|candidate| candidate.block.canonical_name())
            .collect();
        assert!(names.contains("minecraft:stone"));
        assert!(names.contains("minecraft:stone_bricks"));
        assert!(names.contains("minecraft:chiseled_stone_bricks"));
        assert!(!names.contains("minecraft:red_wool"));
        assert!(!names.contains("minecraft:oak_planks"));
    }

    #[test]
    fn model_cube_list_is_one_row_per_texture() {
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let cubes = list_model_appearance_cubes(&palette, StatueBlockPack::Common);
        let names: std::collections::BTreeSet<_> =
            cubes.iter().map(|cube| cube.block.as_str()).collect();
        assert_eq!(names.len(), cubes.len(), "cube list must not collapse by map colour");
        assert!(cubes.len() > 62, "got {} cubes", cubes.len());
        assert!(names.contains("minecraft:oak_planks"));
        assert!(names.contains("minecraft:birch_planks"));
        assert!(names.contains("minecraft:white_terracotta"));
        assert!(names.contains("minecraft:red_wool"));
    }

    #[test]
    fn pixel_art_matches_every_full_cube_in_the_version() {
        use crate::model::ArtKind;
        let palette = load_palette_for(crate::versions::default_version_id()).unwrap();
        let pixel = candidates(
            &palette,
            BuildMode::Flat,
            ArtKind::PixelArt,
            &[],
            &Default::default(),
            BuildOrientation::Floor,
        );
        let names: std::collections::BTreeSet<_> = pixel
            .iter()
            .map(|candidate| candidate.block.canonical_name())
            .collect();
        for need in [
            "minecraft:oak_planks",
            "minecraft:cherry_planks",
            "minecraft:mangrove_planks",
            "minecraft:bamboo_planks",
            "minecraft:pale_oak_planks",
            "minecraft:white_concrete",
            "minecraft:dirt",
        ] {
            assert!(names.contains(need), "pixel art pool missing {need}");
        }
        assert!(
            !names.iter().any(|name| name.contains("_stairs") || name.ends_with("_door")),
            "pixel art auto-match should stay on full cubes"
        );
    }

    #[test]
    fn appearance_cubes_only_use_blocks_from_that_palette() {
        for def in crate::versions::registered_versions() {
            let palette = load_palette_for(def.id)
                .unwrap_or_else(|err| panic!("load palette {}: {err}", def.id));
            for pack in [
                StatueBlockPack::Common,
                StatueBlockPack::Everything,
                StatueBlockPack::Solid,
            ] {
                for cube in list_model_appearance_cubes(&palette, pack) {
                    assert!(
                        is_known_block_state(&palette, &cube.block),
                        "{} pack {:?} listed {} which is missing from the palette",
                        def.id,
                        pack,
                        cube.block
                    );
                }
            }
        }
    }

    #[test]
    fn older_palettes_omit_blocks_added_in_later_releases() {
        let v20 = load_palette_for("1.20").unwrap();
        assert!(
            !is_known_block_state(&v20, "minecraft:pale_oak_planks"),
            "pale oak is 1.21.2+"
        );
        assert!(!is_known_block_state(&v20, "minecraft:resin_bricks"));
        assert!(
            is_known_block_state(&v20, "minecraft:cherry_planks"),
            "cherry wood shipped in 1.20"
        );
        let v20_names: Vec<String> = list_model_appearance_cubes(&v20, StatueBlockPack::Everything)
            .into_iter()
            .map(|cube| cube.block)
            .collect();
        assert!(
            v20_names.iter().any(|name| name.contains("cherry_planks")),
            "1.20 Everything pack should include cherry"
        );
        assert!(
            v20_names.iter().all(|name| !name.contains("pale_oak")),
            "1.20 Models cubes must not include pale oak"
        );

        let v214 = load_palette_for("1.21.4").unwrap();
        assert!(is_known_block_state(
            &v214,
            "minecraft:pale_oak_planks"
        ));
        assert!(is_known_block_state(&v214, "minecraft:resin_bricks"));
        let v214_names: Vec<String> =
            list_model_appearance_cubes(&v214, StatueBlockPack::Everything)
                .into_iter()
                .map(|cube| cube.block)
                .collect();
        assert!(
            v214_names.iter().any(|name| name.contains("pale_oak")),
            "1.21.4 Everything pack should include pale oak"
        );
    }
}
