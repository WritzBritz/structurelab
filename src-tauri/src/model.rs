use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const MINECRAFT_VERSION: &str = "26.2";
pub const DATA_VERSION: i32 = 4903;
pub const MAP_EDGE: u32 = 128;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct BlockState {
    pub name: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub properties: BTreeMap<String, String>,
}

impl BlockState {
    pub fn simple(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            properties: BTreeMap::new(),
        }
    }

    pub fn canonical_name(&self) -> String {
        if self.properties.is_empty() {
            return self.name.clone();
        }
        let properties = self
            .properties
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join(",");
        format!("{}[{}]", self.name, properties)
    }

    pub fn parse(value: &str) -> Option<Self> {
        let (name, properties) = match value.split_once('[') {
            Some((name, properties)) => (name, Some(properties.strip_suffix(']')?)),
            None => (value, None),
        };
        if !name.contains(':')
            || !name.chars().all(|character| {
                character.is_ascii_lowercase()
                    || character.is_ascii_digit()
                    || "_:/.-".contains(character)
            })
        {
            return None;
        }
        let mut parsed = BTreeMap::new();
        if let Some(properties) = properties {
            for entry in properties.split(',').filter(|entry| !entry.is_empty()) {
                let (key, property_value) = entry.split_once('=')?;
                if key.is_empty() || property_value.is_empty() {
                    return None;
                }
                parsed.insert(key.to_string(), property_value.to_string());
            }
        }
        Some(Self {
            name: name.to_string(),
            properties: parsed,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlacedBlock {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub state: BlockState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Structure {
    pub name: String,
    pub size: [u32; 3],
    pub blocks: Vec<PlacedBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialCount {
    pub block: String,
    pub count: u64,
    pub stacks: u64,
    pub remainder: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapTile {
    pub column: u32,
    pub row: u32,
    pub start_x: u32,
    pub start_z: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    #[serde(skip_serializing)]
    pub structure: Structure,
    pub width: u32,
    pub length: u32,
    pub height: u32,
    pub min_y: i32,
    pub maps_x: u32,
    pub maps_y: u32,
    pub tiles: Vec<MapTile>,
    pub materials: Vec<MaterialCount>,
    pub warnings: Vec<String>,
    #[serde(default = "default_minecraft_version")]
    pub minecraft_version: String,
    #[serde(default = "default_data_version")]
    pub data_version: i32,
}

fn default_minecraft_version() -> String {
    MINECRAFT_VERSION.to_string()
}

fn default_data_version() -> i32 {
    DATA_VERSION
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BuildMode {
    Flat,
    Staircase,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DitherMode {
    None,
    FloydSteinberg,
    Atkinson,
    Ordered,
}

/// How map-art pixels are matched to palette shades.
/// Dithering stays a separate option — this only chooses the distance metric.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ColourMatching {
    /// Models default. CIE Lab plus HSV hue/saturation so saturated mesh
    /// colours (especially blues) do not snap to water, magenta, or clay.
    #[serde(alias = "modelHueLab")]
    HueAwareLab,
    /// rebane2001 MapartCraft “better colour”: redstonehelper Lab² (not CIE D65).
    #[serde(alias = "mapartClassic")]
    RebaneMapartClassic,
    /// CIE 2001 colour-difference (ΔE₀₀) in Lab — not the MapartCraft default.
    Ciede2000,
    /// Oklab HyAB + hue guard; weights scale with how many map colours are enabled.
    #[serde(alias = "structureLab")]
    OklabHueGuard,
    /// StructureLab perceptual mix (map art default). Works on any palette: it
    /// matches the *local average* a viewer sees rather than each pixel alone, so
    /// the build can show colours the palette has no single block for. The gain is
    /// largest when the palette is sparse (carpet) or the art is small. Supplies
    /// its own dithering, so the separate dither setting is ignored while this is
    /// selected.
    #[default]
    StructureLabMix,
    /// Models only. Oklab HyAB nearest colour, then a two-cube mix along the
    /// Oklab segment when that average is closer than either cube alone.
    /// 3D ordered dither, no error diffusion (which brightens and bleeds).
    /// Lightness outliers (eyes) stay a single nearest cube.
    #[serde(alias = "structureLabRealistic")]
    StructureLabSmooth,
}

/// Models-only cube pool. Map art never reads this.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum StatueBlockPack {
    /// Survival-friendly cubes: skip chiseled, bricks, glazed, pink dyes, raw iron/gold, etc.
    Common,
    /// Every placeable full cube in this Minecraft version (still no falling blocks or props).
    #[default]
    Everything,
    Wool,
    Concrete,
    Terracotta,
    Stone,
    Solid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FitMode {
    Stretch,
    Contain,
    Cover,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SizeMode {
    Maps,
    Custom,
}

impl Default for SizeMode {
    fn default() -> Self {
        Self::Maps
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ArtKind {
    MapArt,
    PixelArt,
}

impl Default for ArtKind {
    fn default() -> Self {
        Self::MapArt
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BuildOrientation {
    /// Horizontal on the ground (XZ). Required for map art.
    Floor,
    /// Vertical wall; front faces south (look north to view).
    WallSouth,
    /// Vertical wall; front faces north.
    WallNorth,
    /// Vertical wall; front faces east.
    WallEast,
    /// Vertical wall; front faces west.
    WallWest,
}

impl Default for BuildOrientation {
    fn default() -> Self {
        Self::Floor
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum StaircaseHeightAnchor {
    /// Exact shade stairs; each column is shifted onto y=0 (no whole-map lift).
    Floating,
    /// Control at y=0 and only build upward. Shade may change; map-colour blocks stay.
    #[default]
    Floor,
}

/// Which end of the image the staircase solution starts from (image top = north).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum StaircaseStartEdge {
    /// Image top / north — control row on the north side (classic).
    #[default]
    Top,
    /// Image bottom / south — staircase grows from the bottom edge instead.
    Bottom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertOptions {
    pub maps_x: u32,
    pub maps_y: u32,
    /// `maps` = maps_x/y × 128; `custom` = exact blocks_x × blocks_z footprint.
    #[serde(default)]
    pub size_mode: SizeMode,
    /// East-west size in blocks when `size_mode` is Custom.
    #[serde(default = "default_block_span")]
    pub blocks_x: u32,
    /// North-south size in blocks when `size_mode` is Custom.
    #[serde(default = "default_block_span")]
    pub blocks_z: u32,
    /// Map art (map shading) vs in-world pixel art.
    #[serde(default)]
    pub art_kind: ArtKind,
    /// How the finished build is oriented in the world.
    #[serde(default)]
    pub orientation: BuildOrientation,
    pub mode: BuildMode,
    pub dither: DitherMode,
    /// Palette distance metric. Independent of dithering.
    #[serde(default)]
    pub colour_matching: ColourMatching,
    pub fit: FitMode,
    pub brightness: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub max_height: u32,
    /// True: unlimited height for best MapartCraft quality.
    /// False (default): `max_height` is a hard budget (128 recommended).
    #[serde(default)]
    pub staircase_height_auto: bool,
    /// Floor: control at y=0, only build up. Floating: exact stairs, each column on the ground.
    #[serde(default)]
    pub staircase_height_anchor: StaircaseHeightAnchor,
    /// Control row on image top (north) vs bottom (south). Binding caps re-solve from that edge.
    #[serde(default)]
    pub staircase_start_edge: StaircaseStartEdge,
    #[serde(default = "default_staircase_support_block")]
    pub staircase_support_block: String,
    #[serde(default = "default_true")]
    pub support_under_gravity: bool,
    #[serde(default)]
    pub trim_transparent: bool,
    /// When true, fully transparent source pixels place no blocks (instead of white).
    #[serde(default)]
    pub skip_transparent: bool,
    #[serde(default)]
    pub disabled_color_ids: Vec<u8>,
    #[serde(default)]
    pub block_overrides: BTreeMap<u8, String>,
}

fn default_staircase_support_block() -> String {
    "minecraft:cobblestone".into()
}

fn default_true() -> bool {
    true
}

fn default_block_span() -> u32 {
    MAP_EDGE
}

impl Default for ConvertOptions {
    fn default() -> Self {
        Self {
            maps_x: 1,
            maps_y: 1,
            size_mode: SizeMode::Maps,
            blocks_x: MAP_EDGE,
            blocks_z: MAP_EDGE,
            art_kind: ArtKind::MapArt,
            orientation: BuildOrientation::Floor,
            mode: BuildMode::Flat,
            dither: DitherMode::FloydSteinberg,
            colour_matching: ColourMatching::StructureLabMix,
            fit: FitMode::Stretch,
            brightness: 0.0,
            contrast: 0.0,
            saturation: 0.0,
            max_height: 128,
            staircase_height_auto: false,
            staircase_height_anchor: StaircaseHeightAnchor::Floor,
            staircase_start_edge: StaircaseStartEdge::Top,
            staircase_support_block: default_staircase_support_block(),
            support_under_gravity: true,
            trim_transparent: false,
            skip_transparent: false,
            disabled_color_ids: Vec::new(),
            block_overrides: BTreeMap::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_block_states_round_trip() {
        let state = BlockState::parse("minecraft:oak_stairs[facing=north,half=bottom]").unwrap();
        assert_eq!(state.name, "minecraft:oak_stairs");
        assert_eq!(
            state.canonical_name(),
            "minecraft:oak_stairs[facing=north,half=bottom]"
        );
        assert!(BlockState::parse("not namespaced").is_none());
    }
}
