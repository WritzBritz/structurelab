use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinecraftAssetsInfo {
    /// Absolute path with `/` separators and no Windows `\\?\` prefix
    /// (`convertFileSrc` treats that prefix as a relative path).
    pub dir: String,
    pub version: String,
    pub icons: Vec<String>,
    pub textures: Vec<String>,
    /// Relative paths under `entity-textures/` for the convert version (unused for import).
    pub entity_textures: Vec<String>,
    /// Latest catalog pack (`minecraft/26.2`) — entity PNGs stay available when
    /// the selected export version is older and does not ship those mobs.
    pub entity_catalog_dir: Option<String>,
    /// Downloaded block PNGs when they live next to the exe instead of `dir`.
    pub block_texture_overlay_dir: Option<String>,
    pub overlay_textures: Vec<String>,
}

/// Set once from Tauri `app.path().resource_dir()` during setup so packaged
/// macOS/Linux builds resolve `minecraft/{version}/` under the real bundle
/// resource root (e.g. `Contents/Resources`, AppImage lib dir).
static TAURI_RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init_tauri_resource_dir(dir: PathBuf) {
    let _ = TAURI_RESOURCE_DIR.set(dir);
}

fn dir_if_palette(dir: PathBuf) -> Option<PathBuf> {
    if dir.join("blocks.json").is_file() {
        Some(dir)
    } else {
        None
    }
}

/// Path the WebView asset protocol can load. Windows `canonicalize` adds `\\?\`.
pub fn frontend_path(path: &Path) -> String {
    let raw = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let displayed = raw.to_string_lossy();
    let stripped = displayed
        .strip_prefix(r"\\?\")
        .unwrap_or(displayed.as_ref());
    stripped.replace('\\', "/")
}

fn png_rel_paths(dir: &Path, prefix: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            names.extend(png_rel_paths(&path, prefix));
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.to_ascii_lowercase().ends_with(".png") {
            continue;
        }
        if let Ok(rel) = path.strip_prefix(prefix) {
            names.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    names.sort();
    names
}

fn png_stems(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.strip_suffix(".png").map(str::to_string)
        })
        .collect();
    names.sort();
    names
}

/// Folder next to the executable (portable zip layout).
pub fn exe_minecraft_dir(version: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    dir_if_palette(exe.parent()?.join("minecraft").join(version))
}

/// Repo / dev checkout: `minecraft/{version}` at the project root.
#[cfg(debug_assertions)]
pub fn dev_minecraft_dir(version: &str) -> Option<PathBuf> {
    dir_if_palette(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("minecraft")
            .join(version),
    )
}

#[cfg(not(debug_assertions))]
pub fn dev_minecraft_dir(_version: &str) -> Option<PathBuf> {
    None
}

/// Bundled crate resources (fallback when no external folder exists).
pub fn bundled_minecraft_dir(version: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("minecraft")
        .join(version)
}

/// `minecraft/{version}` under Tauri's resolved `$RESOURCE` directory.
fn tauri_resource_minecraft_dir(version: &str) -> Option<PathBuf> {
    let root = TAURI_RESOURCE_DIR.get()?;
    dir_if_palette(root.join("minecraft").join(version))
}

/// Heuristics when PathResolver isn't available (or before setup runs):
/// macOS `.app` Resources, and `{exe}/resources/minecraft` (some Windows layouts).
fn platform_resource_minecraft_dir(version: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    // StructureLab.app/Contents/MacOS/<exe> → ../Resources/minecraft/{version}
    if let Some(dir) =
        dir_if_palette(exe_dir.join("../Resources").join("minecraft").join(version))
    {
        return Some(dir);
    }
    // Windows installer-style: {exe}/resources/minecraft/{version}
    dir_if_palette(
        exe_dir
            .join("resources")
            .join("minecraft")
            .join(version),
    )
}

/// Best directory for Minecraft palette + preview PNGs for a version.
pub fn resolve_minecraft_assets_dir(version: &str) -> Option<PathBuf> {
    [
        dev_minecraft_dir(version),
        exe_minecraft_dir(version),
        tauri_resource_minecraft_dir(version),
        platform_resource_minecraft_dir(version),
        dir_if_palette(bundled_minecraft_dir(version)),
    ]
    .into_iter()
    .flatten()
    .next()
}

fn entity_textures_dir_nonempty(dir: &Path) -> bool {
    let entity = dir.join("entity-textures");
    if !entity.is_dir() {
        return false;
    }
    // Any PNG (nested) means downloads or a full pack landed here.
    !png_rel_paths(&entity, &entity).is_empty()
}

/// Existing writable pack roots without creating folders (unlike
/// [`writable_minecraft_dir`], which `create_dir_all`s next to the exe).
fn peek_writable_minecraft_dir(version: &str) -> Option<PathBuf> {
    if let Some(dir) = dev_minecraft_dir(version) {
        return Some(dir);
    }
    if let Some(dir) = exe_minecraft_dir(version) {
        return Some(dir);
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.join("minecraft").join(version);
    dir.is_dir().then_some(dir)
}

/// Catalog entity sheets: prefer the writable download target when it already
/// has PNGs. `resolve_minecraft_assets_dir` can stay on a read-only bundled pack
/// (has `blocks.json`) while `download_vanilla_texture_objects` writes entity
/// files next to the exe — without this, the frontend never sees those downloads.
pub fn resolve_entity_catalog_dir(version: &str) -> Option<PathBuf> {
    if let Some(writable) = peek_writable_minecraft_dir(version) {
        if entity_textures_dir_nonempty(&writable) {
            return Some(writable);
        }
    }
    resolve_minecraft_assets_dir(version)
}

pub fn palette_json_path(version: &str) -> Option<PathBuf> {
    resolve_minecraft_assets_dir(version).map(|dir| dir.join("blocks.json"))
}

pub fn read_palette_json(version: &str) -> Option<String> {
    let path = palette_json_path(version)?;
    std::fs::read_to_string(path).ok()
}

pub fn minecraft_assets_info(version: &str) -> Option<MinecraftAssetsInfo> {
    let dir = resolve_minecraft_assets_dir(version)?;
    let entity_dir = dir.join("entity-textures");
    let catalog_id = crate::versions::default_version_id();
    let entity_catalog_dir = resolve_entity_catalog_dir(catalog_id).map(|path| frontend_path(&path));
    let overlay = peek_writable_minecraft_dir(version).filter(|writable| {
        frontend_path(writable) != frontend_path(&dir)
    });
    let overlay_textures = overlay
        .as_ref()
        .map(|path| png_stems(&path.join("block-textures")))
        .unwrap_or_default();
    let block_texture_overlay_dir = overlay.and_then(|path| {
        if overlay_textures.is_empty() {
            None
        } else {
            Some(frontend_path(&path))
        }
    });
    Some(MinecraftAssetsInfo {
        icons: png_stems(&dir.join("block-icons")),
        textures: png_stems(&dir.join("block-textures")),
        entity_textures: png_rel_paths(&entity_dir, &entity_dir),
        dir: frontend_path(&dir),
        version: version.to_string(),
        entity_catalog_dir,
        block_texture_overlay_dir,
        overlay_textures,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VanillaTextureInstall {
    pub dir: String,
    pub entity_count: u32,
    pub block_count: u32,
}

fn writable_minecraft_dir(version: &str) -> Result<PathBuf, String> {
    if let Some(dir) = dev_minecraft_dir(version) {
        return Ok(dir);
    }
    if let Some(dir) = exe_minecraft_dir(version) {
        return Ok(dir);
    }
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let dir = exe
        .parent()
        .ok_or("could not resolve app folder")?
        .join("minecraft")
        .join(version);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn http_get(url: &str) -> Result<ureq::Response, String> {
    ureq::get(url)
        .set("User-Agent", "StructureLab/1.0")
        .call()
        .map_err(|error| error.to_string())
}

fn fetch_json(url: &str) -> Result<Value, String> {
    http_get(url)?
        .into_json()
        .map_err(|error| error.to_string())
}

fn load_asset_index(version: &str) -> Result<Value, String> {
    let manifest = fetch_json("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .map_err(|error| format!("version list: {error}"))?;
    let versions = manifest
        .get("versions")
        .and_then(|value| value.as_array())
        .ok_or("malformed version manifest")?;
    let latest_snapshot = manifest
        .pointer("/latest/snapshot")
        .and_then(|value| value.as_str());
    let latest_release = manifest
        .pointer("/latest/release")
        .and_then(|value| value.as_str());
    let find = |id: &str| {
        versions.iter().find(|item| item.get("id").and_then(|value| value.as_str()) == Some(id))
    };
    let entry = find(version)
        .or_else(|| latest_snapshot.and_then(find))
        .or_else(|| latest_release.and_then(find))
        .ok_or_else(|| format!("Mojang has no asset index for {version}"))?;
    let meta_url = entry
        .get("url")
        .and_then(|url| url.as_str())
        .ok_or("malformed version meta URL")?;
    let meta = fetch_json(meta_url).map_err(|error| format!("version meta: {error}"))?;
    let index_url = meta
        .pointer("/assetIndex/url")
        .and_then(|value| value.as_str())
        .ok_or("version has no asset index")?;
    fetch_json(index_url).map_err(|error| format!("asset index: {error}"))
}

fn object_url(hash: &str) -> String {
    format!(
        "https://resources.download.minecraft.net/{}/{}",
        &hash[..2.min(hash.len())],
        hash
    )
}

fn dest_for_asset(dest: &Path, key: &str) -> Option<(PathBuf, bool)> {
    let key = key.strip_prefix("minecraft/")?;
    if let Some(rel) = key.strip_prefix("textures/entity/") {
        if rel.to_ascii_lowercase().ends_with(".png") {
            return Some((dest.join("entity-textures").join(rel), true));
        }
    }
    if let Some(rel) = key.strip_prefix("textures/block/") {
        if rel.to_ascii_lowercase().ends_with(".png") {
            let name = Path::new(rel).file_name()?;
            return Some((dest.join("block-textures").join(name), false));
        }
    }
    None
}

fn extra_block_texture_stems(stem: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut add = |name: &str| {
        if name != stem && !out.iter().any(|existing| existing == name) {
            out.push(name.to_string());
        }
    };
    if let Some(unwaxed) = stem.strip_prefix("waxed_") {
        add(unwaxed);
        for extra in extra_block_texture_stems(unwaxed) {
            add(&extra);
        }
        return out;
    }
    match stem {
        "smooth_quartz" => add("quartz_block_bottom"),
        "smooth_sandstone" => add("sandstone_top"),
        "smooth_red_sandstone" => add("red_sandstone_top"),
        "magma_block" => add("magma"),
        "snow_block" => add("snow"),
        _ => {}
    }
    out
}

fn texture_key_candidates(key: &str) -> Vec<String> {
    let mut keys = vec![key.to_string()];
    let Some(stem) = key
        .strip_prefix("minecraft/textures/block/")
        .and_then(|rest| rest.strip_suffix(".png"))
    else {
        return keys;
    };
    for extra in extra_block_texture_stems(stem) {
        keys.push(format!("minecraft/textures/block/{extra}.png"));
    }
    keys
}

/// Average RGB of a block’s face PNG (opaque pixels). Used so Models / pixel art
/// can match every cube in the version, not only the frozen appearance JSON.
pub fn cube_texture_rgb(stem: &str) -> Option<[u8; 3]> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<[u8; 3]>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    {
        let guard = cache.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(hit) = guard.get(stem) {
            return *hit;
        }
    }
    let rgb = cube_texture_rgb_uncached(stem);
    let mut guard = cache.lock().unwrap_or_else(|error| error.into_inner());
    guard.insert(stem.to_string(), rgb);
    rgb
}

fn cube_texture_rgb_uncached(stem: &str) -> Option<[u8; 3]> {
    let dirs = block_texture_search_dirs();
    for name in block_texture_stem_candidates(stem) {
        for dir in &dirs {
            let path = dir.join(format!("{name}.png"));
            if let Some(rgb) = average_opaque_png(&path) {
                return Some(rgb);
            }
        }
    }
    None
}

fn block_texture_stem_candidates(stem: &str) -> Vec<String> {
    let mut names = vec![
        stem.to_string(),
        format!("{stem}_top"),
        format!("{stem}_side"),
    ];
    for extra in extra_block_texture_stems(stem) {
        if !names.iter().any(|existing| existing == &extra) {
            names.push(extra);
        }
    }
    names
}

fn block_texture_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let push = |dirs: &mut Vec<PathBuf>, path: PathBuf| {
        if path.is_dir() && !dirs.iter().any(|existing| existing == &path) {
            dirs.push(path);
        }
    };
    push(
        &mut dirs,
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public/block-textures"),
    );
    if let Some(root) = resolve_minecraft_assets_dir(crate::versions::default_version_id()) {
        push(&mut dirs, root.join("block-textures"));
    }
    dirs
}

fn average_opaque_png(path: &Path) -> Option<[u8; 3]> {
    let img = image::open(path).ok()?.to_rgba8();
    let mut r = 0u64;
    let mut g = 0u64;
    let mut b = 0u64;
    let mut n = 0u64;
    for pixel in img.pixels() {
        if pixel.0[3] < 16 {
            continue;
        }
        r += u64::from(pixel.0[0]);
        g += u64::from(pixel.0[1]);
        b += u64::from(pixel.0[2]);
        n += 1;
    }
    if n == 0 {
        return None;
    }
    Some([(r / n) as u8, (g / n) as u8, (b / n) as u8])
}

fn expand_wanted_keys(
    keys: &[String],
    objects: &serde_json::Map<String, Value>,
) -> std::collections::HashSet<String> {
    let mut wanted = std::collections::HashSet::new();
    for key in keys {
        for candidate in texture_key_candidates(key) {
            if objects.contains_key(&candidate) {
                wanted.insert(candidate);
            }
        }
    }
    wanted
}

fn download_hash(hash: &str, out: &Path) -> Result<(), String> {
    if out.is_file() && out.metadata().map(|meta| meta.len() > 0).unwrap_or(false) {
        return Ok(());
    }
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let response = http_get(&object_url(hash)).map_err(|error| format!("{hash}: {error}"))?;
    let mut file = std::fs::File::create(out).map_err(|error| error.to_string())?;
    std::io::copy(&mut response.into_reader(), &mut file).map_err(|error| error.to_string())?;
    Ok(())
}

fn is_entity_asset_key(key: &str) -> bool {
    key.contains("textures/entity/")
}

/// Pull PNGs from Mojang's asset index (resources.download.minecraft.net), not a client jar.
/// Entity sheets always come from the newest registered version so mob import
/// is not limited by the export/palette version. Block textures stay on `version`.
pub fn download_vanilla_texture_objects(
    version: &str,
    keys: Option<&[String]>,
) -> Result<VanillaTextureInstall, String> {
    if let Some(list) = keys {
        let catalog = crate::versions::default_version_id();
        let entity_keys: Vec<String> = list
            .iter()
            .filter(|key| is_entity_asset_key(key))
            .cloned()
            .collect();
        let other_keys: Vec<String> = list
            .iter()
            .filter(|key| !is_entity_asset_key(key))
            .cloned()
            .collect();
        if !entity_keys.is_empty() && version != catalog {
            let mut installed = download_indexed(catalog, Some(&entity_keys), TextureKind::Entity)?;
            if !other_keys.is_empty() {
                let blocks = download_indexed(version, Some(&other_keys), TextureKind::All)?;
                installed.block_count += blocks.block_count;
                installed.entity_count += blocks.entity_count;
            }
            return Ok(installed);
        }
        if !entity_keys.is_empty() {
            let mut installed = download_indexed(version, Some(&entity_keys), TextureKind::Entity)?;
            if !other_keys.is_empty() {
                let blocks = download_indexed(version, Some(&other_keys), TextureKind::All)?;
                installed.block_count += blocks.block_count;
                installed.entity_count += blocks.entity_count;
            }
            return Ok(installed);
        }
        return download_indexed(version, Some(&other_keys), TextureKind::All);
    }
    download_indexed(version, None, TextureKind::All)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TextureKind {
    All,
    Entity,
}

fn keep_texture(is_entity: bool, kind: TextureKind) -> bool {
    match kind {
        TextureKind::All => true,
        TextureKind::Entity => is_entity,
    }
}

fn download_indexed(
    version: &str,
    keys: Option<&[String]>,
    kind: TextureKind,
) -> Result<VanillaTextureInstall, String> {
    let dest = writable_minecraft_dir(version)?;
    let index = load_asset_index(version)?;
    let objects = index
        .get("objects")
        .and_then(|value| value.as_object())
        .ok_or("malformed asset index")?;
    let wanted = keys.map(|list| expand_wanted_keys(list, objects));
    if let (Some(list), Some(set)) = (keys, wanted.as_ref()) {
        if !list.is_empty() && set.is_empty() {
            let sample = list.iter().take(4).cloned().collect::<Vec<_>>().join(", ");
            return Err(format!(
                "none of the requested textures exist in Minecraft {version}'s asset index ({sample})"
            ));
        }
    }
    let mut entity_count = 0u32;
    let mut block_count = 0u32;
    for (key, object) in objects {
        if let Some(set) = &wanted {
            if !set.contains(key.as_str()) {
                continue;
            }
        }
        let Some((out, is_entity)) = dest_for_asset(&dest, key) else {
            continue;
        };
        if !keep_texture(is_entity, kind) {
            continue;
        }
        let Some(hash) = object.get("hash").and_then(|value| value.as_str()) else {
            continue;
        };
        download_hash(hash, &out)?;
        if is_entity {
            entity_count += 1;
        } else {
            block_count += 1;
        }
    }
    Ok(VanillaTextureInstall {
        dir: frontend_path(&dest),
        entity_count,
        block_count,
    })
}

pub fn install_vanilla_textures(version: &str) -> Result<VanillaTextureInstall, String> {
    let mut installed = download_indexed(version, None, TextureKind::All)?;
    let catalog = crate::versions::default_version_id();
    // Mob catalog is not tied to the export version — always fill the latest
    // pack's entity sheets so older palettes can still import new models.
    if version != catalog {
        let extra = download_indexed(catalog, None, TextureKind::Entity)?;
        installed.entity_count = installed.entity_count.saturating_add(extra.entity_count);
    }
    Ok(installed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_palette_path_exists_in_repo() {
        let dir = bundled_minecraft_dir("26.2");
        assert!(dir.join("blocks.json").is_file(), "missing bundled blocks.json");
    }

    #[test]
    fn frontend_path_strips_verbatim_prefix() {
        let stripped = frontend_path(&bundled_minecraft_dir("26.2"));
        assert!(!stripped.starts_with(r"\\?\"), "{stripped}");
        assert!(!stripped.contains('\\'), "{stripped}");
        assert!(stripped.contains("minecraft"), "{stripped}");
    }

    #[test]
    fn waxed_and_smooth_texture_keys_map_to_vanilla_pngs() {
        let waxed = texture_key_candidates("minecraft/textures/block/waxed_copper_block.png");
        assert!(waxed.contains(&"minecraft/textures/block/copper_block.png".into()));
        let quartz = texture_key_candidates("minecraft/textures/block/smooth_quartz.png");
        assert!(quartz.contains(&"minecraft/textures/block/quartz_block_bottom.png".into()));
        let sandstone = texture_key_candidates("minecraft/textures/block/smooth_sandstone.png");
        assert!(sandstone.contains(&"minecraft/textures/block/sandstone_top.png".into()));
    }

    #[test]
    fn entity_texture_kind_skips_block_pngs() {
        assert!(keep_texture(true, TextureKind::All));
        assert!(keep_texture(false, TextureKind::All));
        assert!(keep_texture(true, TextureKind::Entity));
        assert!(!keep_texture(false, TextureKind::Entity));
    }

    #[test]
    fn cube_texture_rgb_distinguishes_oak_from_cherry() {
        let oak = cube_texture_rgb("oak_planks").expect("oak_planks.png");
        let cherry = cube_texture_rgb("cherry_planks").expect("cherry_planks.png");
        assert_ne!(oak, cherry, "wood types must not share a baked average");
    }
}
