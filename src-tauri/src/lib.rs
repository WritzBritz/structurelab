mod assets;
mod converter;
mod crash;
mod export;
mod model;
mod palette;
mod versions;
mod voxel;

use base64::{engine::general_purpose::STANDARD, Engine};
use converter::ConversionResponse;
use export::ExportFormat;
use model::{BuildResult, ConvertOptions};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use voxel::{
    DecodedScenePart, ModelConversionResponse, ModelConvertOptions, SceneConversionResponse,
    SceneConvertOptions, SharedMaterialOptions,
};

struct ProjectInner {
    /// Incremented at the start of each convert. Only the latest epoch may
    /// commit, so a slower older convert cannot overwrite export state.
    epoch: u64,
    build: Option<BuildResult>,
    minecraft_version: String,
}

impl ProjectInner {
    fn new() -> Self {
        Self {
            epoch: 0,
            build: None,
            minecraft_version: versions::default_version_id().to_string(),
        }
    }

    fn active_minecraft_version(&self) -> &str {
        self.minecraft_version.as_str()
    }
}

struct ProjectState(Mutex<ProjectInner>);

impl ProjectState {
    fn new() -> Self {
        Self(Mutex::new(ProjectInner::new()))
    }
}

fn begin_convert(state: &ProjectState, generation: u64) -> Result<u64, String> {
    let mut inner = state
        .0
        .lock()
        .map_err(|_| "project state is unavailable")?;
    if generation > inner.epoch {
        inner.epoch = generation;
    }
    // Drop the previous schematic before the next dense grid allocates, so
    // Convert twice cannot keep two multi-million-block builds in RAM.
    inner.build = None;
    Ok(generation)
}

/// Keep the block list in project state only. Cloning it for IPC doubles RAM
/// and can abort the process on large statues.
fn take_build_for_storage(build: &mut BuildResult) -> BuildResult {
    let structure = std::mem::replace(
        &mut build.structure,
        model::Structure {
            name: String::new(),
            size: [0, 0, 0],
            blocks: Vec::new(),
        },
    );
    let mut stored = build.clone();
    stored.structure = structure;
    stored
}

fn commit_build(state: &ProjectState, generation: u64, build: BuildResult) -> Result<(), String> {
    let mut inner = state
        .0
        .lock()
        .map_err(|_| "project state is unavailable")?;
    if generation < inner.epoch {
        return Ok(());
    }
    inner.epoch = generation;
    inner.build = Some(build);
    Ok(())
}

fn stage_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("structurelab-stage");
    fs::create_dir_all(&dir).map_err(|error| format!("could not create temp stage dir: {error}"))?;
    Ok(dir)
}

/// Ensure `path` stays under the stage temp folder (Windows + Unix).
fn ensure_path_under_stage(path: &Path) -> Result<(), String> {
    let root = stage_dir()?;
    let root = fs::canonicalize(&root).unwrap_or(root);
    let path_resolved = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    if path_resolved.starts_with(&root) {
        return Ok(());
    }

    // Fallback for mixed separators / Windows casing after canonicalize fails.
    let norm = |p: &Path| -> String {
        let mut s = p.to_string_lossy().replace('\\', "/");
        while s.ends_with('/') {
            s.pop();
        }
        if cfg!(windows) {
            s = s.to_ascii_lowercase();
        }
        s
    };
    let root_s = norm(&root);
    let path_s = norm(&path_resolved);
    if path_s == root_s || path_s.starts_with(&format!("{root_s}/")) {
        Ok(())
    } else {
        Err("staged path is outside the temp folder".into())
    }
}

fn read_part_bytes(path: Option<&String>, base64: &str, label: &str) -> Result<Vec<u8>, String> {
    if let Some(path) = path.filter(|value| !value.is_empty()) {
        return fs::read(path).map_err(|error| format!("failed to read staged '{label}': {error}"));
    }
    if base64.is_empty() {
        return Err(format!("missing payload for '{label}'"));
    }
    STANDARD
        .decode(base64)
        .map_err(|error| format!("invalid payload for '{label}': {error}"))
}

/// Download an official cape PNG from textures.minecraft.net (hash-only, avoids CORS).
#[tauri::command]
async fn fetch_cape_texture(hash: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_cape_texture_sync(hash))
        .await
        .map_err(|error| format!("cape download failed: {error}"))?
}

fn fetch_cape_texture_sync(hash: String) -> Result<String, String> {
    let hash = hash.trim().to_ascii_lowercase();
    if hash.len() != 64 || !hash.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err("invalid cape texture id".into());
    }
    let url = format!("https://textures.minecraft.net/texture/{hash}");
    let response = ureq::get(&url)
        .set("User-Agent", "StructureLab")
        .timeout(std::time::Duration::from_secs(20))
        .call()
        .map_err(|error| format!("could not download cape: {error}"))?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(32 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("could not read cape: {error}"))?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("cape PNG is too large to load".into());
    }
    if bytes.len() < 64 || bytes[0] != 0x89 || bytes[1] != b'P' || bytes[2] != b'N' || bytes[3] != b'G' {
        return Err("cape download was not a PNG".into());
    }
    Ok(STANDARD.encode(bytes))
}

/// Create an empty staged file and return its absolute path.
#[tauri::command]
fn stage_bytes_begin(file_name: String) -> Result<String, String> {
    let dir = stage_dir()?;
    let safe = file_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let path = dir.join(format!(
        "{}_{safe}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    fs::write(&path, []).map_err(|error| format!("could not create staged file: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Append a base64 chunk to a staged file (keeps IPC payloads small).
#[tauri::command]
fn stage_bytes_append(path: String, chunk_base64: String) -> Result<(), String> {
    let staged = PathBuf::from(&path);
    ensure_path_under_stage(&staged)?;
    let bytes = STANDARD
        .decode(chunk_base64)
        .map_err(|error| format!("invalid staged chunk: {error}"))?;
    let mut file = OpenOptions::new()
        .append(true)
        .open(&staged)
        .map_err(|error| format!("could not open staged file: {error}"))?;
    file.write_all(&bytes)
        .map_err(|error| format!("could not append staged chunk: {error}"))?;
    Ok(())
}

/// Copy a local file into the stage folder without shipping bytes through JS.
#[tauri::command]
fn stage_copy_from_path(source: String, file_name: String) -> Result<String, String> {
    let src = PathBuf::from(&source);
    ensure_readable_local_file(&src)?;
    let dest = {
        let dir = stage_dir()?;
        let safe = file_name
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
                    ch
                } else {
                    '_'
                }
            })
            .collect::<String>();
        dir.join(format!(
            "{}_{safe}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ))
    };
    fs::copy(&src, &dest).map_err(|error| format!("could not stage copy: {error}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn stage_bytes_cleanup(paths: Vec<String>) -> Result<(), String> {
    for path in paths {
        let staged = PathBuf::from(&path);
        if ensure_path_under_stage(&staged).is_ok() {
            let _ = fs::remove_file(staged);
        }
    }
    Ok(())
}

#[tauri::command]
fn list_minecraft_versions() -> Vec<versions::MinecraftVersionInfo> {
    versions::list_versions()
}

#[tauri::command]
fn get_minecraft_version(state: tauri::State<'_, ProjectState>) -> Result<String, String> {
    let inner = state
        .0
        .lock()
        .map_err(|_| "project state is unavailable")?;
    Ok(inner.minecraft_version.clone())
}

#[tauri::command]
fn set_minecraft_version(
    version: String,
    state: tauri::State<'_, ProjectState>,
) -> Result<(), String> {
    let id = versions::normalize_version_id(&version)?;
    let info = versions::list_versions()
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| format!("unknown Minecraft version '{id}'"))?;
    if !info.available {
        return Err(format!(
            "Minecraft {id} assets are not installed — add minecraft/{id}/ beside the app"
        ));
    }
    let mut inner = state
        .0
        .lock()
        .map_err(|_| "project state is unavailable")?;
    // Drop any convert from the previous era so exports cannot keep the wrong DataVersion.
    if inner.minecraft_version != id {
        inner.build = None;
        inner.epoch = inner.epoch.saturating_add(1);
    }
    inner.minecraft_version = id;
    Ok(())
}

#[tauri::command]
fn get_palette(state: tauri::State<'_, ProjectState>) -> Result<palette::PaletteFile, String> {
    let inner = state
        .0
        .lock()
        .map_err(|_| "project state is unavailable")?;
    palette::load_palette_for(inner.active_minecraft_version()).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_model_cubes(
    pack: model::StatueBlockPack,
    state: tauri::State<'_, ProjectState>,
) -> Result<Vec<palette::ModelAppearanceCube>, String> {
    let inner = state
        .0
        .lock()
        .map_err(|_| "project state is unavailable")?;
    let palette = palette::load_palette_for(inner.active_minecraft_version())
        .map_err(|error| error.to_string())?;
    Ok(palette::list_model_appearance_cubes(&palette, pack))
}

/// Absolute path to `minecraft/{version}` when present (portable folder or dev checkout).
#[tauri::command]
fn get_minecraft_assets_dir(state: tauri::State<'_, ProjectState>) -> Option<String> {
    let inner = state.0.lock().ok()?;
    assets::resolve_minecraft_assets_dir(inner.active_minecraft_version())
        .map(|path| assets::frontend_path(&path))
}

#[tauri::command]
fn get_minecraft_assets(
    state: tauri::State<'_, ProjectState>,
) -> Option<assets::MinecraftAssetsInfo> {
    let inner = state.0.lock().ok()?;
    assets::minecraft_assets_info(inner.active_minecraft_version())
}

#[tauri::command]
async fn install_vanilla_textures(
    state: tauri::State<'_, ProjectState>,
) -> Result<assets::VanillaTextureInstall, String> {
    let version = {
        let inner = state
            .0
            .lock()
            .map_err(|_| "project state is unavailable")?;
        inner.active_minecraft_version().to_string()
    };
    tauri::async_runtime::spawn_blocking(move || assets::install_vanilla_textures(&version))
        .await
        .map_err(|error| format!("{error}"))?
}

#[tauri::command]
async fn download_vanilla_texture_objects(
    keys: Vec<String>,
    state: tauri::State<'_, ProjectState>,
) -> Result<assets::VanillaTextureInstall, String> {
    let version = {
        let inner = state
            .0
            .lock()
            .map_err(|_| "project state is unavailable")?;
        inner.active_minecraft_version().to_string()
    };
    tauri::async_runtime::spawn_blocking(move || {
        assets::download_vanilla_texture_objects(&version, Some(&keys))
    })
    .await
    .map_err(|error| format!("{error}"))?
}

#[tauri::command]
async fn convert_image(
    image_base64: String,
    options: ConvertOptions,
    generation: u64,
    state: tauri::State<'_, ProjectState>,
) -> Result<ConversionResponse, String> {
    let epoch = begin_convert(&state, generation)?;
    let minecraft_version = {
        let inner = state
            .0
            .lock()
            .map_err(|_| "project state is unavailable")?;
        inner.minecraft_version.clone()
    };
    let mut response = tauri::async_runtime::spawn_blocking(move || {
        crash::catch_convert(|| {
            let data = STANDARD
                .decode(image_base64)
                .map_err(|error| format!("invalid image payload: {error}"))?;
            converter::convert_image(&data, &options, &minecraft_version)
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| {
        crash::append_log(&format!("convert_image worker failed: {error}"));
        format!("convert task failed: {error}")
    })??;

    let stored = take_build_for_storage(&mut response.build);
    commit_build(&state, epoch, stored)?;
    Ok(response)
}

/// Legacy single-mesh import — the Models UI uses `convert_scene` instead.
#[tauri::command]
fn import_model(model_base64: String, file_name: String) -> Result<voxel::MeshInfo, String> {
    let data = STANDARD
        .decode(model_base64)
        .map_err(|error| format!("invalid model payload: {error}"))?;
    let (_mesh, info) =
        voxel::load_mesh(&data, &file_name).map_err(|error| error.to_string())?;
    Ok(info)
}

/// Legacy single-mesh convert — the Models UI uses `convert_scene` instead.
#[tauri::command]
fn convert_model(
    model_base64: String,
    file_name: String,
    options: ModelConvertOptions,
    generation: u64,
    state: tauri::State<'_, ProjectState>,
) -> Result<ModelConversionResponse, String> {
    let data = STANDARD
        .decode(model_base64)
        .map_err(|error| format!("invalid model payload: {error}"))?;
    let epoch = begin_convert(&state, generation)?;
    let minecraft_version = {
        let inner = state
            .0
            .lock()
            .map_err(|_| "project state is unavailable")?;
        inner.minecraft_version.clone()
    };
    let mut response = voxel::convert_model(&data, &file_name, &options, &minecraft_version)
        .map_err(|error| error.to_string())?;
    let stored = take_build_for_storage(&mut response.build);
    commit_build(&state, epoch, stored)?;
    Ok(response)
}

#[tauri::command]
async fn convert_scene(
    options: SceneConvertOptions,
    generation: u64,
    state: tauri::State<'_, ProjectState>,
) -> Result<SceneConversionResponse, String> {
    let epoch = begin_convert(&state, generation)?;
    let minecraft_version = {
        let inner = state
            .0
            .lock()
            .map_err(|_| "project state is unavailable")?;
        inner.minecraft_version.clone()
    };
    let mut response = tauri::async_runtime::spawn_blocking(move || {
        crash::catch_convert(|| {
            let mut decoded = Vec::with_capacity(options.parts.len());
            for part in options.parts {
                let data = read_part_bytes(part.data_path.as_ref(), &part.data_base64, &part.name)?;
                let mtl = if part.mtl_path.is_some() || part.mtl_base64.as_ref().is_some_and(|v| !v.is_empty())
                {
                    Some(read_part_bytes(
                        part.mtl_path.as_ref(),
                        part.mtl_base64.as_deref().unwrap_or(""),
                        &format!("{} mtl", part.name),
                    )?)
                } else {
                    None
                };
                let mut textures = std::collections::HashMap::new();
                for (name, path) in &part.textures_paths {
                    let bytes = fs::read(path).map_err(|error| {
                        format!("invalid texture '{name}' for '{}': {error}", part.name)
                    })?;
                    textures.insert(name.to_ascii_lowercase(), bytes);
                }
                for (name, encoded) in &part.textures_base64 {
                    if textures.contains_key(&name.to_ascii_lowercase()) {
                        continue;
                    }
                    let bytes = STANDARD.decode(encoded).map_err(|error| {
                        format!("invalid texture '{name}' for '{}': {error}", part.name)
                    })?;
                    textures.insert(name.to_ascii_lowercase(), bytes);
                }
                let cape = if part.cape_base64.as_ref().is_some_and(|v| !v.is_empty()) {
                    Some(
                        STANDARD
                            .decode(part.cape_base64.as_deref().unwrap_or(""))
                            .map_err(|error| format!("invalid cape for '{}': {error}", part.name))?,
                    )
                } else {
                    None
                };
                decoded.push(DecodedScenePart {
                    options: part,
                    data,
                    sidecars: voxel::ObjSidecars { mtl, textures },
                    cape,
                });
            }
            let shared = SharedMaterialOptions {
                disabled_color_ids: options.disabled_color_ids,
                block_overrides: options.block_overrides,
                block_pack: options.block_pack,
                disabled_blocks: options.disabled_blocks,
                block_substitutions: options.block_substitutions,
                support_mode: options.support_mode,
                support_block: options.support_block,
                colour_matching: options.colour_matching,
                dither: options.dither,
                hue: options.hue,
                brightness: options.brightness,
                contrast: options.contrast,
                saturation: options.saturation,
            };
            // Leave staged files on disk — the UI may still need `sourcePath` for mesh
            // preview after convert. Frontend cleans convert-only temps itself.
            voxel::convert_scene(&decoded, &shared, &minecraft_version).map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| {
        crash::append_log(&format!("convert_scene worker failed: {error}"));
        format!("convert worker failed: {error}")
    })??;

    let stored = take_build_for_storage(&mut response.build);
    commit_build(&state, epoch, stored)?;
    Ok(response)
}

#[tauri::command]
fn read_local_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    let len = ensure_readable_local_file(&path)?;
    // Prefer chunked reads from the frontend for large files; keep this for small ones.
    if len > 32 * 1024 * 1024 {
        return Err(format!(
            "{} is large ({:.0} MB) — use chunked read",
            path.display(),
            len as f64 / (1024.0 * 1024.0)
        ));
    }
    let bytes =
        fs::read(&path).map_err(|error| format!("could not read {}: {error}", path.display()))?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
fn local_file_size(path: String) -> Result<u64, String> {
    ensure_readable_local_file(&PathBuf::from(path))
}

/// Read a slice of a local file as base64 (keeps IPC messages small for huge OBJs).
#[tauri::command]
fn read_local_file_chunk(path: String, offset: u64, length: u32) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let path = PathBuf::from(path);
    let len = ensure_readable_local_file(&path)?;
    if offset > len {
        return Err(format!("chunk offset past end of {}", path.display()));
    }
    let want = (length as u64)
        .min(8 * 1024 * 1024)
        .min(len.saturating_sub(offset)) as usize;
    let mut file = fs::File::open(&path)
        .map_err(|error| format!("could not open {}: {error}", path.display()))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("could not seek {}: {error}", path.display()))?;
    let mut buf = vec![0_u8; want];
    let mut read_total = 0;
    while read_total < want {
        match file.read(&mut buf[read_total..]) {
            Ok(0) => break,
            Ok(n) => read_total += n,
            Err(error) => {
                return Err(format!("could not read {}: {error}", path.display()));
            }
        }
    }
    buf.truncate(read_total);
    Ok(STANDARD.encode(buf))
}

/// Frontend debug line — always appended to the StructureLab log file.
#[tauri::command]
fn debug_log(message: String) {
    println!("{message}");
    crash::append_log(&message);
}

/// List file names in a folder (not recursive). Used to auto-find miobject companions.
#[tauri::command]
fn list_local_directory(path: String) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&path);
    let meta = fs::metadata(&path).map_err(|error| format!("could not open {}: {error}", path.display()))?;
    if !meta.is_dir() {
        return Err(format!("{} is not a folder", path.display()));
    }
    let mut names = Vec::new();
    let entries = fs::read_dir(&path).map_err(|error| format!("could not list {}: {error}", path.display()))?;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_string());
        }
    }
    names.sort();
    Ok(names)
}

const WALK_SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    "__pycache__",
    "library",
    "temp",
    "obj",
];

/// Recursively list files under a folder (or return a single file). Used to
/// attach Blender `.fbm`, Unity `Material/…/Tex`, Maya `sourceimages`, and
/// dropped texture folders without knowing one model's layout.
#[tauri::command]
fn walk_local_files(
    path: String,
    extensions: Option<Vec<String>>,
    max_files: Option<u32>,
    max_depth: Option<u32>,
) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&path);
    let meta = fs::metadata(&root).map_err(|error| format!("could not open {}: {error}", root.display()))?;
    if meta.is_file() {
        return Ok(vec![root.to_string_lossy().into_owned()]);
    }
    if !meta.is_dir() {
        return Err(format!("{} is not a file or folder", root.display()));
    }
    let max_files = max_files.unwrap_or(400).clamp(1, 2000) as usize;
    let max_depth = max_depth.unwrap_or(8).clamp(1, 16) as u32;
    let allowed: Option<Vec<String>> = extensions.map(|list| {
        list.into_iter()
            .map(|ext| ext.trim_start_matches('.').to_ascii_lowercase())
            .filter(|ext| !ext.is_empty())
            .collect()
    });
    let mut out = Vec::new();
    walk_local_files_rec(&root, &allowed, 0, max_depth, max_files, &mut out)?;
    Ok(out)
}

fn walk_local_files_rec(
    dir: &Path,
    allowed: &Option<Vec<String>>,
    depth: u32,
    max_depth: u32,
    max_files: usize,
    out: &mut Vec<String>,
) -> Result<(), String> {
    if out.len() >= max_files || depth > max_depth {
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(|error| format!("could not list {}: {error}", dir.display()))?;
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if file_type.is_dir() {
            if WALK_SKIP_DIRS.iter().any(|skip| name.eq_ignore_ascii_case(skip)) {
                continue;
            }
            dirs.push(entry.path());
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        if let Some(allowed) = allowed {
            let ext = entry
                .path()
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !allowed.iter().any(|want| want == &ext) {
                continue;
            }
        }
        files.push(entry.path());
    }
    files.sort();
    dirs.sort();
    for path in files {
        if out.len() >= max_files {
            break;
        }
        out.push(path.to_string_lossy().into_owned());
    }
    if depth == max_depth {
        return Ok(());
    }
    for child in dirs {
        if out.len() >= max_files {
            break;
        }
        walk_local_files_rec(&child, allowed, depth + 1, max_depth, max_files, out)?;
    }
    Ok(())
}

fn ensure_readable_local_file(path: &Path) -> Result<u64, String> {
    let meta =
        fs::metadata(path).map_err(|error| format!("could not open {}: {error}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    Ok(meta.len())
}

#[tauri::command]
fn export_current(
    format: ExportFormat,
    path: PathBuf,
    state: tauri::State<'_, ProjectState>,
) -> Result<(), String> {
    let inner = state
        .0
        .lock()
        .map_err(|_| "project state is unavailable")?;
    let build = inner
        .build
        .as_ref()
        .ok_or_else(|| "convert something before exporting".to_string())?;
    if build.minecraft_version != inner.minecraft_version {
        return Err(format!(
            "build is for Minecraft {}, but the app is on {} — convert again before exporting",
            build.minecraft_version, inner.minecraft_version
        ));
    }
    if build.data_version <= 0 {
        return Err("build is missing a Minecraft DataVersion — convert again before exporting".into());
    }
    export::export(build, format, &path).map_err(|error| {
        let text = error.to_string();
        crash::append_log(&format!("[export] {text}"));
        text
    })
}

fn run_main_app() {
    crash::append_log("[app] starting");

    let app = match tauri::Builder::default()
        .manage(ProjectState::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            list_minecraft_versions,
            get_minecraft_version,
            set_minecraft_version,
            get_palette,
            get_model_cubes,
            get_minecraft_assets_dir,
            get_minecraft_assets,
            install_vanilla_textures,
            download_vanilla_texture_objects,
            convert_image,
            import_model,
            convert_model,
            convert_scene,
            export_current,
            fetch_cape_texture,
            stage_bytes_begin,
            stage_bytes_append,
            stage_copy_from_path,
            stage_bytes_cleanup,
            read_local_file,
            local_file_size,
            read_local_file_chunk,
            list_local_directory,
            walk_local_files,
            debug_log,
            crash::crash_log_info,
            crash::open_log_folder,
        ])
        .setup(|app| {
            use tauri::Manager;
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                            path: crash::log_dir(),
                            file_name: Some("structurelab-runtime".into()),
                        }),
                    ])
                    .build(),
            )?;
            match app.path().resource_dir() {
                Ok(dir) => {
                    log::info!("Tauri resource dir: {}", dir.display());
                    assets::init_tauri_resource_dir(dir);
                }
                Err(error) => {
                    log::warn!("Could not resolve Tauri resource dir: {error}");
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(error) => {
            let text = format!("StructureLab failed to start: {error}");
            crash::write_crash_report("startup", "StructureLab failed to start", &text, &text);
            crash::show_native_alert("StructureLab failed to start", &text);
            return;
        }
    };

    app.run(|_handle, _event| {});
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    crash::install_panic_hook();
    run_main_app();
}

#[cfg(test)]
mod stage_path_tests {
    use super::*;

    #[test]
    fn accepts_paths_under_stage_dir() {
        let dir = stage_dir().expect("stage dir");
        let file = dir.join("unit_test_staged.bin");
        fs::write(&file, b"ok").expect("write staged file");
        ensure_path_under_stage(&file).expect("under stage");
        let _ = fs::remove_file(&file);
    }

    #[test]
    fn rejects_paths_outside_stage_dir() {
        let outside = std::env::temp_dir().join("structurelab-outside-stage.bin");
        fs::write(&outside, b"no").expect("write outside file");
        let err = ensure_path_under_stage(&outside).expect_err("must reject");
        assert!(err.contains("outside"));
        let _ = fs::remove_file(&outside);
    }
}
