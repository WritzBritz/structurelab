use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Cursor;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct Mesh {
    pub positions: Vec<[f32; 3]>,
    pub colors: Vec<[f32; 3]>,
    /// Per-vertex OBJ / atlas UVs (OpenGL: V increases upward). Empty if none.
    pub uvs: Vec<[f32; 2]>,
    /// Shared diffuse atlas when the OBJ references one (typical for skins).
    /// Kept so voxelize can sample **interior** texels, not only UV-corner colours.
    pub texture: Option<image::RgbaImage>,
    /// All distinct map_Kd images referenced by the OBJ (multi-material characters).
    pub textures: Vec<image::RgbaImage>,
    /// Per-vertex index into `textures` (−1 = no atlas sample for this vertex).
    pub texture_index: Vec<i32>,
    /// Per-vertex skin layer: 0 = base (first layer), 1 = overlay (second layer).
    pub layers: Vec<u8>,
    pub indices: Vec<[u32; 3]>,
}

#[derive(Debug, Clone, Default)]
pub struct ObjSidecars {
    pub mtl: Option<Vec<u8>>,
    /// Texture basename (lowercased) → image bytes.
    pub textures: HashMap<String, Vec<u8>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshInfo {
    pub format: String,
    pub vertex_count: u32,
    pub triangle_count: u32,
    pub bounds_min: [f32; 3],
    pub bounds_max: [f32; 3],
}

impl Mesh {
    pub fn info(&self, format: &str) -> MeshInfo {
        let mut bounds_min = [f32::INFINITY; 3];
        let mut bounds_max = [f32::NEG_INFINITY; 3];
        for position in &self.positions {
            for axis in 0..3 {
                bounds_min[axis] = bounds_min[axis].min(position[axis]);
                bounds_max[axis] = bounds_max[axis].max(position[axis]);
            }
        }
        if self.positions.is_empty() {
            bounds_min = [0.0; 3];
            bounds_max = [0.0; 3];
        }
        MeshInfo {
            format: format.into(),
            vertex_count: self.positions.len() as u32,
            triangle_count: self.indices.len() as u32,
            bounds_min,
            bounds_max,
        }
    }
}

pub fn load_mesh(data: &[u8], file_name: &str) -> Result<(Mesh, MeshInfo)> {
    load_mesh_with_sidecars(data, file_name, &ObjSidecars::default())
}

pub fn load_mesh_with_sidecars(
    data: &[u8],
    file_name: &str,
    sidecars: &ObjSidecars,
) -> Result<(Mesh, MeshInfo)> {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "obj" => {
            let mesh = load_obj(data, sidecars)?;
            let info = mesh.info("obj");
            Ok((mesh, info))
        }
        "" => bail!("choose a model file with an extension such as .obj"),
        other => bail!("{other} import is not available yet; use Wavefront .obj for now"),
    }
}

fn load_obj(data: &[u8], sidecars: &ObjSidecars) -> Result<Mesh> {
    let text = std::str::from_utf8(data).context("OBJ files must be UTF-8 text")?;
    let mtl_owned = sidecars.mtl.clone();
    let (models, materials_result) = tobj::load_obj_buf(
        &mut Cursor::new(text.as_bytes()),
        &tobj::LoadOptions {
            triangulate: true,
            single_index: true,
            ..Default::default()
        },
        |_mat_path| {
            if let Some(mtl) = &mtl_owned {
                tobj::load_mtl_buf(&mut Cursor::new(mtl.as_slice()))
            } else {
                Ok(Default::default())
            }
        },
    )
    .context("failed to parse OBJ mesh")?;

    let materials = match materials_result {
        Ok(mats) if !mats.is_empty() => mats,
        Ok(_) | Err(_) => {
            // Some exporters leave the embedded MTL result empty; load the sidecar directly.
            if let Some(mtl) = &sidecars.mtl {
                tobj::load_mtl_buf(&mut Cursor::new(mtl.as_slice()))
                    .map(|(mats, _)| mats)
                    .unwrap_or_default()
            } else {
                Vec::new()
            }
        }
    };
    let fallback_by_name = parse_mtl_diffuse_map(sidecars.mtl.as_deref());
    let map_kd_by_name = parse_mtl_diffuse_textures(sidecars.mtl.as_deref());
    let texture_cache = load_texture_images(sidecars);

    let mut positions = Vec::new();
    let mut colors = Vec::new();
    let mut uvs = Vec::new();
    let mut layers = Vec::new();
    let mut indices = Vec::new();
    let mut texture_index = Vec::new();
    let mut textures: Vec<image::RgbaImage> = Vec::new();
    let mut texture_key_to_index: HashMap<String, i32> = HashMap::new();
    let mut vertex_offset = 0_u32;

    for model in models {
        let mesh = model.mesh;
        if mesh.positions.len() % 3 != 0 {
            bail!("OBJ vertex positions are malformed");
        }
        let vertex_count = mesh.positions.len() / 3;
        let material = mesh
            .material_id
            .and_then(|id| materials.get(id));
        let material_name = material.map(|mat| mat.name.as_str());
        let material_overlay = material_name
            .map(|name| {
                let lower = name.to_ascii_lowercase();
                lower.contains("overlay") || lower.contains("outer")
            })
            .unwrap_or(false);
        let object_overlay = {
            let lower = model.name.to_ascii_lowercase();
            lower.contains("overlay") || lower.ends_with("_outer")
        };
        let layer: u8 = if material_overlay || object_overlay { 1 } else { 0 };
        let diffuse = material
            .and_then(|mat| mat.diffuse)
            .or_else(|| {
                material_name.and_then(|name| fallback_by_name.get(name).copied())
            })
            .or_else(|| fallback_by_name.get(model.name.as_str()).copied())
            .map(|rgb| byte_rgb(rgb[0], rgb[1], rgb[2]))
            .unwrap_or([184.0, 189.0, 199.0]);
        let texture_name = material
            .and_then(|mat| mat.diffuse_texture.as_ref())
            .map(|path| texture_key(path))
            .or_else(|| {
                material_name
                    .and_then(|name| map_kd_by_name.get(name).cloned())
            })
            .or_else(|| map_kd_by_name.get(model.name.as_str()).cloned());
        let tex_idx: i32 = resolve_mesh_texture(
            texture_name.as_deref(),
            &texture_cache,
            &mut textures,
            &mut texture_key_to_index,
        );
        let texture = if tex_idx >= 0 {
            textures.get(tex_idx as usize)
        } else {
            None
        };

        for index in 0..vertex_count {
            let base = index * 3;
            positions.push([
                mesh.positions[base],
                mesh.positions[base + 1],
                mesh.positions[base + 2],
            ]);
            layers.push(layer);
            texture_index.push(tex_idx);

            if mesh.texcoords.len() >= (index + 1) * 2 {
                let t = index * 2;
                uvs.push([mesh.texcoords[t], mesh.texcoords[t + 1]]);
            } else {
                uvs.push([0.0, 0.0]);
            }

            // Prefer real texture samples over Kd / vertex colour — white Kd was
            // wiping posed skins when map_Kd failed to bind.
            // Only sample the atlas when this mesh actually has UVs; otherwise a
            // single sidecar PNG would paint every face from atlas-centre (0.5,0.5).
            // Note: corner UV samples alone miss face interiors (eyes / skin);
            // voxelize also keeps per-submesh textures and samples per stamp.
            let vertex_rgb = {
                let base = index * 3;
                (mesh.vertex_color.len() >= base + 3).then(|| {
                    byte_rgb(
                        mesh.vertex_color[base],
                        mesh.vertex_color[base + 1],
                        mesh.vertex_color[base + 2],
                    )
                })
            };
            let uv = {
                let t = index * 2;
                (mesh.texcoords.len() >= t + 2).then(|| (mesh.texcoords[t], mesh.texcoords[t + 1]))
            };
            let sampled = match (texture, uv) {
                (Some(image), Some((u, v))) => sample_texture_exact(image, u, v)
                    // Transparent texel (common on Minecraft skins): a baked vertex
                    // colour is real data, so it beats guessing from a neighbour.
                    .or(vertex_rgb)
                    // Nothing baked — bleed into nearby atlas padding rather than
                    // dropping to a flat grey Kd, which turned skins into white wool.
                    .or_else(|| sample_texture(image, u, v)),
                _ => vertex_rgb,
            };
            colors.push(sampled.unwrap_or(diffuse));
        }

        if mesh.indices.len() % 3 != 0 {
            bail!("OBJ faces must be triangulated");
        }
        for triangle in mesh.indices.chunks_exact(3) {
            indices.push([
                triangle[0] + vertex_offset,
                triangle[1] + vertex_offset,
                triangle[2] + vertex_offset,
            ]);
        }
        vertex_offset += vertex_count as u32;
    }

    if positions.is_empty() || indices.is_empty() {
        bail!("OBJ mesh has no triangles");
    }

    let mesh_texture = if textures.len() == 1 {
        textures.first().cloned()
    } else {
        None
    };

    Ok(Mesh {
        positions,
        colors,
        uvs,
        texture: mesh_texture,
        textures,
        texture_index,
        layers,
        indices,
    })
}

fn texture_key(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_ascii_lowercase()
}

/// Convert OBJ / MTL colour components to 0..255 storage used by voxel matching.
fn byte_rgb(r: f32, g: f32, b: f32) -> [f32; 3] {
    let max = r.max(g).max(b);
    if max > 1.0 + 1e-3 {
        [r.clamp(0.0, 255.0), g.clamp(0.0, 255.0), b.clamp(0.0, 255.0)]
    } else {
        [
            r.clamp(0.0, 1.0) * 255.0,
            g.clamp(0.0, 1.0) * 255.0,
            b.clamp(0.0, 1.0) * 255.0,
        ]
    }
}

fn parse_mtl_diffuse_map(mtl: Option<&[u8]>) -> HashMap<String, [f32; 3]> {
    let Some(bytes) = mtl else {
        return HashMap::new();
    };
    let Ok(text) = std::str::from_utf8(bytes) else {
        return HashMap::new();
    };
    let mut map = HashMap::new();
    let mut current: Option<String> = None;
    for raw in text.lines() {
        let line = raw.trim();
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("newmtl ") {
            current = Some(line[7..].trim().to_string());
            if let Some(name) = &current {
                map.entry(name.clone()).or_insert([0.72, 0.74, 0.78]);
            }
        } else if lower.starts_with("kd ") {
            if let Some(name) = &current {
                let parts: Vec<_> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    let r = parts[1].parse().unwrap_or(0.72);
                    let g = parts[2].parse().unwrap_or(0.74);
                    let b = parts[3].parse().unwrap_or(0.78);
                    map.insert(name.clone(), [r, g, b]);
                }
            }
        }
    }
    map
}

fn parse_mtl_diffuse_textures(mtl: Option<&[u8]>) -> HashMap<String, String> {
    let Some(bytes) = mtl else {
        return HashMap::new();
    };
    let Ok(text) = std::str::from_utf8(bytes) else {
        return HashMap::new();
    };
    let mut map = HashMap::new();
    let mut current: Option<String> = None;
    for raw in text.lines() {
        let line = raw.trim();
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("newmtl ") {
            current = Some(line[7..].trim().to_string());
        } else if lower.starts_with("map_kd ") {
            if let Some(name) = &current {
                let path = line[7..].trim();
                if !path.is_empty() {
                    map.insert(name.clone(), texture_key(path));
                }
            }
        }
    }
    map
}

fn load_texture_images(sidecars: &ObjSidecars) -> HashMap<String, image::RgbaImage> {
    let mut loaded = HashMap::new();
    for (name, bytes) in &sidecars.textures {
        if let Ok(img) = image::load_from_memory(bytes) {
            loaded.insert(
                name.to_ascii_lowercase(),
                flatten_unused_alpha(img.to_rgba8()),
            );
        }
    }
    loaded
}

/// Pick a sidecar atlas for this submesh. Catalog mobs sometimes register the
/// same PNG under map_Kd + model-id aliases; if the exact key misses, fall back
/// to the sole atlas (or sole unique size) so eyes/markings still sample.
fn resolve_mesh_texture(
    texture_name: Option<&str>,
    texture_cache: &HashMap<String, image::RgbaImage>,
    textures: &mut Vec<image::RgbaImage>,
    texture_key_to_index: &mut HashMap<String, i32>,
) -> i32 {
    let intern = |key: &str,
                  image: &image::RgbaImage,
                  textures: &mut Vec<image::RgbaImage>,
                  texture_key_to_index: &mut HashMap<String, i32>|
     -> i32 {
        if let Some(&existing) = texture_key_to_index.get(key) {
            return existing;
        }
        let idx = textures.len() as i32;
        textures.push(image.clone());
        texture_key_to_index.insert(key.to_string(), idx);
        idx
    };

    if let Some(key) = texture_name {
        if let Some(image) = texture_cache.get(key) {
            return intern(key, image, textures, texture_key_to_index);
        }
        // Basename / partial match (path vs filename).
        if let Some((k, image)) = texture_cache.iter().find(|(k, _)| {
            k == &key || k.ends_with(key) || key.ends_with(k.as_str())
        }) {
            return intern(k, image, textures, texture_key_to_index);
        }
    }

    if texture_cache.len() == 1 {
        let (k, image) = texture_cache.iter().next().unwrap();
        return intern(k, image, textures, texture_key_to_index);
    }

    // Several names pointing at the same atlas bytes (angry Enderman aliases).
    if texture_cache_identical_atlases(texture_cache) {
        if let Some((k, image)) = texture_cache.iter().next() {
            return intern(k, image, textures, texture_key_to_index);
        }
    }

    -1
}

fn texture_cache_identical_atlases(texture_cache: &HashMap<String, image::RgbaImage>) -> bool {
    if texture_cache.len() < 2 {
        return false;
    }
    let mut iter = texture_cache.values();
    let first = match iter.next() {
        Some(img) => img,
        None => return false,
    };
    for image in iter {
        if image.dimensions() != first.dimensions() {
            return false;
        }
        if image.as_raw() != first.as_raw() {
            return false;
        }
    }
    true
}

/// Maya/TGA exports often store painted RGB with an empty alpha channel. Minecraft
/// skins use alpha as a real cutout. If almost no texels are opaque, treat alpha as
/// unused and force it opaque so sampling / preview keep the RGB.
fn flatten_unused_alpha(mut image: image::RgbaImage) -> image::RgbaImage {
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return image;
    }
    let step_x = ((width / 64).max(1)) as u32;
    let step_y = ((height / 64).max(1)) as u32;
    let mut opaque = 0u64;
    let mut samples = 0u64;
    let mut y = 0u32;
    while y < height {
        let mut x = 0u32;
        while x < width {
            samples += 1;
            if image.get_pixel(x, y).0[3] >= 20 {
                opaque += 1;
            }
            x = x.saturating_add(step_x);
            if x == 0 {
                break;
            }
        }
        y = y.saturating_add(step_y);
        if y == 0 {
            break;
        }
    }
    if samples > 0 && (opaque as f64 / samples as f64) >= 0.02 {
        return image;
    }
    for pixel in image.pixels_mut() {
        pixel.0[3] = 255;
    }
    image
}

pub(crate) fn sample_texture(image: &image::RgbaImage, u: f32, v: f32) -> Option<[f32; 3]> {
    sample_atlas(image, u, v, true)
}

/// Exact texel only. Catalog cutouts (shulker rims, enderman mouth edges) must
/// not inherit a neighbour's colour — that paints 1–3px holes solid.
pub(crate) fn sample_texture_exact(image: &image::RgbaImage, u: f32, v: f32) -> Option<[f32; 3]> {
    sample_atlas(image, u, v, false)
}

fn sample_atlas(image: &image::RgbaImage, u: f32, v: f32, bleed: bool) -> Option<[f32; 3]> {
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return None;
    }
    // Minecraft / GL nearest: floor(uv * size), clamp-to-edge.
    // round(u * (size-1)) pulled the right/bottom of an 8px Steve face
    // into the next atlas column (eyes shifted one pixel).
    let u = u.clamp(0.0, 1.0);
    let v = 1.0 - v.clamp(0.0, 1.0);
    let max_x = width.saturating_sub(1);
    let max_y = height.saturating_sub(1);
    let x0 = ((u * width as f32).floor() as i32).clamp(0, max_x as i32);
    let y0 = ((v * height as f32).floor() as i32).clamp(0, max_y as i32);
    let try_at = |x: i32, y: i32| -> Option<[f32; 3]> {
        if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
            return None;
        }
        let pixel = image[(x as u32, y as u32)].0;
        // Minecraft skins leave RGB garbage under transparent texels (often black).
        if pixel[3] < 20 {
            return None;
        }
        Some([pixel[0] as f32, pixel[1] as f32, pixel[2] as f32])
    };
    if let Some(rgb) = try_at(x0, y0) {
        return Some(rgb);
    }
    if !bleed {
        return None;
    }
    // Soft miss into unused atlas padding: pull a nearby opaque texel so
    // character meshes don't fall back to grey Kd → white wool. Catalog
    // converts must not use this — it fills intentional 1px cutouts.
    for radius in 1i32..=3 {
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                if dx.abs().max(dy.abs()) != radius {
                    continue;
                }
                if let Some(rgb) = try_at(x0 + dx, y0 + dy) {
                    return Some(rgb);
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_a_simple_triangle_obj() {
        let obj = b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
        let (mesh, info) = load_mesh(obj, "triangle.obj").unwrap();
        assert_eq!(mesh.positions.len(), 3);
        assert_eq!(mesh.indices.len(), 1);
        assert_eq!(info.format, "obj");
        assert_eq!(info.triangle_count, 1);
    }

    #[test]
    fn applies_mtl_diffuse_colors() {
        let obj = b"mtllib x.mtl\nusemtl paint\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
        let mtl = b"newmtl paint\nKd 1.0 0.0 0.0\n";
        let sidecars = ObjSidecars {
            mtl: Some(mtl.to_vec()),
            textures: HashMap::new(),
        };
        let (mesh, _) = load_mesh_with_sidecars(obj, "car.obj", &sidecars).unwrap();
        assert!((mesh.colors[0][0] - 255.0).abs() < 1e-5);
        assert!(mesh.colors[0][1].abs() < 1e-5);
    }

    #[test]
    fn kd_wins_when_texture_has_no_uvs() {
        use image::ImageEncoder;
        // 1x1 red PNG
        let png = {
            let mut bytes = Vec::new();
            image::codecs::png::PngEncoder::new(&mut bytes)
                .write_image(&[255, 0, 0, 255], 1, 1, image::ExtendedColorType::Rgba8)
                .unwrap();
            bytes
        };
        let obj = b"mtllib x.mtl\nusemtl paint\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
        let mtl = b"newmtl paint\nKd 0.0 1.0 0.0\nmap_Kd skin.png\n";
        let mut textures = HashMap::new();
        textures.insert("skin.png".into(), png);
        let sidecars = ObjSidecars {
            mtl: Some(mtl.to_vec()),
            textures,
        };
        let (mesh, _) = load_mesh_with_sidecars(obj, "car.obj", &sidecars).unwrap();
        // Must keep Kd green — not sample atlas centre.
        assert!(mesh.colors[0][1] > 200.0, "expected Kd green, got {:?}", mesh.colors[0]);
        assert!(mesh.colors[0][0] < 50.0);
    }

    #[test]
    fn vertex_colours_are_scaled_to_bytes() {
        let obj = b"v 0 0 0 1 0 0\nv 1 0 0 0 1 0\nv 0 1 0 0 0 1\nf 1 2 3\n";
        let (mesh, _) = load_mesh(obj, "coloured.obj").unwrap();
        assert!((mesh.colors[0][0] - 255.0).abs() < 1e-3);
        assert!((mesh.colors[1][1] - 255.0).abs() < 1e-3);
        assert!((mesh.colors[2][2] - 255.0).abs() < 1e-3);
    }

    #[test]
    fn transparent_texture_falls_back_to_vertex_colour() {
        use image::ImageEncoder;
        // 2x2: opaque red + transparent black (Minecraft skin style garbage RGB).
        let png = {
            let mut bytes = Vec::new();
            let pixels = [
                255, 0, 0, 255, // (0,0) red
                0, 0, 0, 0, // (1,0) transparent black
                0, 0, 0, 0, // (0,1)
                0, 0, 0, 0, // (1,1)
            ];
            image::codecs::png::PngEncoder::new(&mut bytes)
                .write_image(&pixels, 2, 2, image::ExtendedColorType::Rgba8)
                .unwrap();
            bytes
        };
        // UV at centre of transparent texel (1,0); vertex colour is green.
        // OpenGL V: image y0 → vt.v=1, image y0.75 → near top... 
        // sample uses v_img = 1 - vt.v. For pixel (1,0): u=0.75, image v=0 → vt.v = 1 - 0 = 1.
        let obj = b"mtllib x.mtl\nusemtl skin\nv 0 0 0 0 1 0\nv 1 0 0 0 1 0\nv 0 1 0 0 1 0\nvt 0.75 1.0\nvt 0.75 1.0\nvt 0.75 1.0\nusemtl skin\nf 1/1 2/2 3/3\n";
        let mtl = b"newmtl skin\nKd 0.72 0.74 0.78\nmap_Kd skin.png\n";
        let mut textures = HashMap::new();
        textures.insert("skin.png".into(), png);
        let sidecars = ObjSidecars {
            mtl: Some(mtl.to_vec()),
            textures,
        };
        let (mesh, _) = load_mesh_with_sidecars(obj, "t.obj", &sidecars).unwrap();
        // Must NOT keep transparent black — fall back to vertex green.
        assert!(
            mesh.colors[0][1] > 200.0,
            "expected vertex green fallback, got {:?}",
            mesh.colors[0]
        );
        assert!(mesh.colors[0][0] < 40.0 && mesh.colors[0][2] < 40.0);
    }

    #[test]
    fn vertex_colours_used_when_map_kd_missing() {
        let obj = b"mtllib x.mtl
o body
usemtl entity
v 0 0 0 0.1 0.2 0.3
v 1 0 0 0.1 0.2 0.3
v 0 1 0 0.1 0.2 0.3
vt 0 0
vt 1 0
vt 0 1
f 1/1 2/2 3/3
";
        let mtl = b"newmtl entity\nKd 0.72 0.74 0.78\nmap_Kd missing.png\n";
        let sidecars = ObjSidecars {
            mtl: Some(mtl.to_vec()),
            textures: HashMap::new(),
        };
        let (mesh, _) = load_mesh_with_sidecars(obj, "mob.obj", &sidecars).unwrap();
        assert_eq!(mesh.colors.len(), 3);
        for rgb in &mesh.colors {
            assert!(
                (rgb[0] - 25.5).abs() < 1.0
                    && (rgb[1] - 51.0).abs() < 1.0
                    && (rgb[2] - 76.5).abs() < 1.0,
                "expected baked vertex colour, got {rgb:?}"
            );
        }
    }

    #[test]
    fn overlay_object_name_sets_second_skin_layer() {
        let obj = b"mtllib x.mtl
o head_overlay
usemtl entity
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
";
        let mtl = b"newmtl entity\nKd 1 1 1\nmap_Kd skin.png\n";
        let sidecars = ObjSidecars {
            mtl: Some(mtl.to_vec()),
            textures: HashMap::new(),
        };
        let (mesh, _) = load_mesh_with_sidecars(obj, "mob.obj", &sidecars).unwrap();
        assert!(
            mesh.layers.iter().all(|&layer| layer == 1),
            "head_overlay object should be layer 1, got {:?}",
            mesh.layers
        );
    }

    #[test]
    fn overlay_material_sets_second_skin_layer() {
        let obj = b"mtllib x.mtl
o head
usemtl entity
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
o hat
usemtl entity_overlay
v 0 0 1
v 1 0 1
v 0 1 1
f 4 5 6
";
        let mtl = b"newmtl entity\nKd 1 1 1\nmap_Kd skin.png\nnewmtl entity_overlay\nKd 1 1 1\nmap_Kd skin.png\n";
        let sidecars = ObjSidecars {
            mtl: Some(mtl.to_vec()),
            textures: HashMap::new(),
        };
        let (mesh, _) = load_mesh_with_sidecars(obj, "mob.obj", &sidecars).unwrap();
        assert_eq!(mesh.layers.len(), 6);
        assert!(
            mesh.layers.iter().take(3).all(|&layer| layer == 0),
            "inner faces should be base, got {:?}",
            &mesh.layers[..3]
        );
        assert!(
            mesh.layers.iter().skip(3).all(|&layer| layer == 1),
            "overlay faces should be layer 1, got {:?}",
            &mesh.layers[3..]
        );
    }

    #[test]
    fn single_sidecar_paints_objects_without_usemtl() {
        use image::ImageEncoder;
        let png = {
            let mut bytes = Vec::new();
            image::codecs::png::PngEncoder::new(&mut bytes)
                .write_image(&[0, 0, 255, 255], 1, 1, image::ExtendedColorType::Rgba8)
                .unwrap();
            bytes
        };
        // First group has usemtl; later `o` groups often drop it (tobj).
        let obj = b"mtllib x.mtl
o head
usemtl entity
v 0 0 0
v 1 0 0
v 0 1 0
vt 0.5 0.5
f 1/1 2/1 3/1
o body
v 0 0 1
v 1 0 1
v 0 1 1
vt 0.5 0.5
f 4/1 5/1 6/1
";
        let mtl = b"newmtl entity\nKd 0.72 0.74 0.78\nmap_Kd skin.png\n";
        let mut textures = HashMap::new();
        textures.insert("skin.png".into(), png);
        let sidecars = ObjSidecars {
            mtl: Some(mtl.to_vec()),
            textures,
        };
        let (mesh, _) = load_mesh_with_sidecars(obj, "mob.obj", &sidecars).unwrap();
        assert_eq!(mesh.colors.len(), 6);
        for color in &mesh.colors {
            assert!(
                color[2] > 200.0,
                "expected atlas blue on every object, got {color:?}"
            );
        }
    }

    #[test]
    fn rejects_unknown_formats_for_now() {
        let error = load_mesh(b"solid", "cube.stl").unwrap_err().to_string();
        assert!(error.contains("not available yet"));
    }
}
