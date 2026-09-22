use super::import::Mesh;
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

const CHUNK_SHIFT: u32 = 4;
const CHUNK_SIZE: u32 = 1 << CHUNK_SHIFT;
const CHUNK_MASK: u32 = CHUNK_SIZE - 1;
const CHUNK_CELLS: usize = (CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE) as usize;

fn chunk_key(x: u32, y: u32, z: u32) -> u32 {
    (y >> CHUNK_SHIFT) << 16 | (z >> CHUNK_SHIFT) << 8 | (x >> CHUNK_SHIFT)
}

fn unpack_chunk_key(key: u32) -> (u32, u32, u32) {
    (key & 0xff, (key >> 16) & 0xff, (key >> 8) & 0xff)
}

fn chunk_local(x: u32, y: u32, z: u32) -> usize {
    let lx = (x & CHUNK_MASK) as usize;
    let ly = (y & CHUNK_MASK) as usize;
    let lz = (z & CHUNK_MASK) as usize;
    (ly * CHUNK_SIZE as usize + lz) * CHUNK_SIZE as usize + lx
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VoxelFit {
    Fit,
    Stretch,
}

#[derive(Debug, Clone)]
pub struct VoxelCell {
    pub occupied: bool,
    /// Final colour used by export / preview (filled by skin path, or baked at end of mesh voxelize).
    pub color_sum: [f32; 3],
    pub samples: u32,
    /// 0 = base, 1 = overlay (informational after bake).
    pub layer: u8,
    /// First skin layer accumulators (mesh voxelize only).
    pub base_sum: [f32; 3],
    pub base_samples: u32,
    /// Second skin layer accumulators (mesh voxelize only).
    pub overlay_sum: [f32; 3],
    pub overlay_samples: u32,
}

#[derive(Debug, Clone)]
pub struct VoxelGrid {
    pub width: u32,
    pub height: u32,
    pub length: u32,
    /// 16³ chunks, allocated only where something was painted. Missing = air.
    chunks: HashMap<u32, Vec<VoxelCell>>,
    occupied_count: usize,
    bounds_min: [u32; 3],
    bounds_max: [u32; 3],
}

impl VoxelGrid {
    pub fn index(&self, x: u32, y: u32, z: u32) -> usize {
        ((y as u64 * self.length as u64 + z as u64) * self.width as u64 + x as u64) as usize
    }

    pub fn volume(&self) -> usize {
        voxel_cell_count(self.width, self.height, self.length)
    }

    pub fn occupied_count(&self) -> usize {
        self.occupied_count
    }

    pub fn empty(width: u32, height: u32, length: u32) -> Self {
        Self::try_empty(width, height, length).unwrap_or_else(|err| panic!("{err}"))
    }

    /// Logical W×H×L box with no air cells allocated.
    pub fn try_empty(width: u32, height: u32, length: u32) -> Result<Self> {
        let (width, height, length) = clamp_voxel_dims(width, height, length);
        ensure!(
            width > 0 && height > 0 && length > 0,
            "voxel box {width}×{height}×{length} is empty"
        );
        Ok(Self {
            width,
            height,
            length,
            chunks: HashMap::new(),
            occupied_count: 0,
            bounds_min: [0, 0, 0],
            bounds_max: [0, 0, 0],
        })
    }

    pub fn is_occupied(&self, x: u32, y: u32, z: u32) -> bool {
        self.cell(x, y, z).is_some_and(|cell| cell.occupied)
    }

    pub fn cell(&self, x: u32, y: u32, z: u32) -> Option<&VoxelCell> {
        if x >= self.width || y >= self.height || z >= self.length {
            return None;
        }
        let chunk = self.chunks.get(&chunk_key(x, y, z))?;
        let cell = &chunk[chunk_local(x, y, z)];
        if cell.occupied {
            Some(cell)
        } else {
            None
        }
    }

    pub fn occupied_bounds(&self) -> Option<([u32; 3], [u32; 3])> {
        if self.occupied_count == 0 {
            None
        } else {
            Some((self.bounds_min, self.bounds_max))
        }
    }

    pub fn occupied_coords(&self) -> Vec<(u32, u32, u32)> {
        let mut out = Vec::with_capacity(self.occupied_count);
        self.for_each_occupied(|x, y, z, _| out.push((x, y, z)));
        out
    }

    pub fn for_each_occupied(&self, mut visit: impl FnMut(u32, u32, u32, &VoxelCell)) {
        let width = self.width;
        let height = self.height;
        let length = self.length;
        for (&key, chunk) in &self.chunks {
            let (cx, cy, cz) = unpack_chunk_key(key);
            let ox = cx << CHUNK_SHIFT;
            let oy = cy << CHUNK_SHIFT;
            let oz = cz << CHUNK_SHIFT;
            for ly in 0..CHUNK_SIZE {
                for lz in 0..CHUNK_SIZE {
                    for lx in 0..CHUNK_SIZE {
                        let cell = &chunk[chunk_local(lx, ly, lz)];
                        if !cell.occupied {
                            continue;
                        }
                        let x = ox + lx;
                        let y = oy + ly;
                        let z = oz + lz;
                        if x < width && y < height && z < length {
                            visit(x, y, z, cell);
                        }
                    }
                }
            }
        }
    }

    pub fn with_cell_mut<R>(
        &mut self,
        x: u32,
        y: u32,
        z: u32,
        alloc: bool,
        f: impl FnOnce(&mut VoxelCell) -> R,
    ) -> Option<R> {
        if x >= self.width || y >= self.height || z >= self.length {
            return None;
        }
        let key = chunk_key(x, y, z);
        if !alloc && !self.chunks.contains_key(&key) {
            return None;
        }
        let local = chunk_local(x, y, z);
        let (result, was, now) = {
            let chunk = self
                .chunks
                .entry(key)
                .or_insert_with(|| vec![empty_cell(); CHUNK_CELLS]);
            let cell = &mut chunk[local];
            let was = cell.occupied;
            let result = f(cell);
            (result, was, cell.occupied)
        };
        if was != now {
            if now {
                if self.occupied_count == 0 {
                    self.bounds_min = [x, y, z];
                    self.bounds_max = [x, y, z];
                } else {
                    self.bounds_min[0] = self.bounds_min[0].min(x);
                    self.bounds_min[1] = self.bounds_min[1].min(y);
                    self.bounds_min[2] = self.bounds_min[2].min(z);
                    self.bounds_max[0] = self.bounds_max[0].max(x);
                    self.bounds_max[1] = self.bounds_max[1].max(y);
                    self.bounds_max[2] = self.bounds_max[2].max(z);
                }
                self.occupied_count += 1;
            } else {
                self.occupied_count = self.occupied_count.saturating_sub(1);
            }
        }
        Some(result)
    }

    pub fn put_rgb(&mut self, x: u32, y: u32, z: u32, rgb: [f32; 3]) {
        self.with_cell_mut(x, y, z, true, |cell| {
            cell.occupied = true;
            cell.color_sum = rgb;
            cell.samples = 1;
            cell.layer = 0;
            cell.base_sum = rgb;
            cell.base_samples = 1;
        });
    }

    pub fn ensure_occupied_budget(&self) -> Result<()> {
        ensure!(
            self.occupied_count as u64 <= MAX_OCCUPIED_VOXELS,
            "statue has {} solid blocks; the safety cap is {} so convert cannot exhaust RAM. Lower the size, enable Hollow, or convert fewer parts.",
            self.occupied_count,
            MAX_OCCUPIED_VOXELS
        );
        Ok(())
    }

    pub fn rgb_at(&self, x: u32, y: u32, z: u32) -> Option<[u8; 3]> {
        let cell = self.cell(x, y, z)?;
        // Minecraft dual-layer at coarse resolution: when base + overlay collapse
        // into the same cell, keep the **base** colour (face, skin, shirt).
        // Overlay-only cells (hair strands / gauntlets outside the body) keep
        // overlay colour. Preferring overlay-on-any-hit covered the face.
        let (sum, n) = if cell.base_samples > 0 {
            (cell.base_sum, cell.base_samples)
        } else if cell.overlay_samples > 0 {
            (cell.overlay_sum, cell.overlay_samples)
        } else if cell.samples > 0 {
            (cell.color_sum, cell.samples)
        } else {
            return None;
        };
        Some([
            (sum[0] / n as f32).clamp(0.0, 255.0) as u8,
            (sum[1] / n as f32).clamp(0.0, 255.0) as u8,
            (sum[2] / n as f32).clamp(0.0, 255.0) as u8,
        ])
    }
}

fn empty_cell() -> VoxelCell {
    VoxelCell {
        occupied: false,
        color_sum: [0.0; 3],
        samples: 0,
        layer: 0,
        base_sum: [0.0; 3],
        base_samples: 0,
        overlay_sum: [0.0; 3],
        overlay_samples: 0,
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum UvWrap {
    #[default]
    Clamp,
    Repeat,
}

/// Atlas UV transform applied in mesh space (before the sampler's V-flip).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct UvTransform {
    pub offset_u: f32,
    pub offset_v: f32,
    #[serde(default = "one_f32")]
    pub scale_u: f32,
    #[serde(default = "one_f32")]
    pub scale_v: f32,
    /// Degrees, clockwise around the atlas centre.
    pub rotation: f32,
    pub flip_u: bool,
    pub flip_v: bool,
    pub wrap: UvWrap,
}

fn one_f32() -> f32 {
    1.0
}

impl Default for UvTransform {
    fn default() -> Self {
        Self {
            offset_u: 0.0,
            offset_v: 0.0,
            scale_u: 1.0,
            scale_v: 1.0,
            rotation: 0.0,
            flip_u: false,
            flip_v: false,
            wrap: UvWrap::Clamp,
        }
    }
}

impl UvTransform {
    pub fn is_identity(&self) -> bool {
        self.offset_u.abs() < 1e-6
            && self.offset_v.abs() < 1e-6
            && (self.scale_u - 1.0).abs() < 1e-6
            && (self.scale_v - 1.0).abs() < 1e-6
            && self.rotation.abs() < 1e-6
            && !self.flip_u
            && !self.flip_v
            && self.wrap == UvWrap::Clamp
    }

    pub fn apply(&self, uv: [f32; 2]) -> [f32; 2] {
        if self.is_identity() {
            return uv;
        }
        let mut u = if self.flip_u { 1.0 - uv[0] } else { uv[0] };
        let mut v = if self.flip_v { 1.0 - uv[1] } else { uv[1] };
        let su = self.scale_u.max(0.05);
        let sv = self.scale_v.max(0.05);
        u = (u - 0.5) * su + 0.5;
        v = (v - 0.5) * sv + 0.5;
        if self.rotation.abs() > 1e-6 {
            let (sin, cos) = self.rotation.to_radians().sin_cos();
            let du = u - 0.5;
            let dv = v - 0.5;
            u = du * cos - dv * sin + 0.5;
            v = du * sin + dv * cos + 0.5;
        }
        u += self.offset_u;
        v += self.offset_v;
        match self.wrap {
            UvWrap::Repeat => [u.rem_euclid(1.0), v.rem_euclid(1.0)],
            UvWrap::Clamp => [u.clamp(0.0, 1.0), v.clamp(0.0, 1.0)],
        }
    }
}

/// Java / Bedrock 1.18+ build height (Y −64 … 319). Width and length are uncapped
/// in Minecraft; this only stops coordinates from overflowing the chunk map.
pub const MC_WORLD_HEIGHT: u32 = 384;

/// Real (non-air) voxels convert will keep. A solid 384³ cube still has to fit
/// in RAM; sky around a statue does not count.
pub const MAX_OCCUPIED_VOXELS: u64 = 8_000_000;

/// Chunk keys use 8 bits per axis at 16³, so the box may be at most 4096.
pub const MAX_VOXEL_AXIS: u32 = 4096;

/// Keep height inside one Minecraft world column. Width/length follow that
/// scale when height is too tall; empty air is not stored.
pub fn clamp_voxel_dims(width: u32, height: u32, length: u32) -> (u32, u32, u32) {
    let mut w = width.max(1);
    let mut h = height.max(1);
    let mut l = length.max(1);
    if h > MC_WORLD_HEIGHT {
        let scale = MC_WORLD_HEIGHT as f64 / h as f64;
        w = ((w as f64) * scale).round().max(1.0) as u32;
        h = MC_WORLD_HEIGHT;
        l = ((l as f64) * scale).round().max(1.0) as u32;
    }
    w = w.min(MAX_VOXEL_AXIS);
    h = h.min(MC_WORLD_HEIGHT);
    l = l.min(MAX_VOXEL_AXIS);
    (w, h, l)
}

fn voxel_cell_count(width: u32, height: u32, length: u32) -> usize {
    let n = (width as u64)
        .saturating_mul(height as u64)
        .saturating_mul(length as u64);
    usize::try_from(n).unwrap_or(usize::MAX)
}

/// Voxelize a textured mesh so **block occupancy matches Minecraft layering**.
///
/// Colour / occupancy compositing (dual-layer, coarse-grid safe):
/// 1. Pass 1 — dense-rasterize **base** triangles (first skin layer).
/// 2. Pass 2 — rasterize **overlay** triangles (hat / jacket / 3d planes).
///    Overlay only stamps **empty** cells. Thin Minecraft inflates (hat 0.5,
///    jacket 0.25) collapse onto the body at statue resolution; walking them
///    outward used to grow a detached 1-voxel hair / jacket sheet. Overlay
///    that already sits in empty space (gauntlets, strands) still stamps.
/// 3. With a diffuse atlas + UVs, each stamp samples the atlas at the
///    interpolated UV. Opaque samples win. **Transparent texels:** overlay
///    layers skip the stamp (skin second-layer holes). Base layers fall back
///    to vertex / Kd colour so character meshes (Maya/OBJ) don’t get crown
///    holes where the atlas is unused. Catalog entities pass `cutout` so
///    those transparent texels stay empty (shulker rims, enderman edges).
/// 4. Colour = base if present, else overlay.
/// Identity-UV wrapper around [`voxelize_mesh_with`].
#[cfg(test)]
pub fn voxelize_mesh(
    mesh: &Mesh,
    width: u32,
    height: u32,
    length: u32,
    fit: VoxelFit,
    hollow: bool,
    cutout: bool,
) -> Result<VoxelGrid> {
    voxelize_mesh_with(
        mesh,
        width,
        height,
        length,
        fit,
        hollow,
        cutout,
        &UvTransform::default(),
    )
}

pub fn voxelize_mesh_with(
    mesh: &Mesh,
    width: u32,
    height: u32,
    length: u32,
    fit: VoxelFit,
    hollow: bool,
    cutout: bool,
    uv: &UvTransform,
) -> Result<VoxelGrid> {
    ensure!(width > 0 && height > 0 && length > 0, "voxel size cannot be zero");
    let (width, height, length) = clamp_voxel_dims(width, height, length);

    // Fit bounds: full connected mesh (arms, hair, skirts, buildings). Catalog
    // cutouts use the raw AABB — wings and the tail are not outliers.
    let (bounds_min, bounds_max, _core_extent) = if cutout {
        full_mesh_bounds(&mesh.positions)
    } else {
        fit_bounds(&mesh.positions)
    };
    let size = [
        (bounds_max[0] - bounds_min[0]).max(1e-5),
        (bounds_max[1] - bounds_min[1]).max(1e-5),
        (bounds_max[2] - bounds_min[2]).max(1e-5),
    ];
    // Space diagonal of the fit box: keep every in-box triangle, even a corner-
    // to-corner face on a large statue. Mixed triangles (one vertex on the body,
    // two on a studio light) still get culled when they exceed this.
    let aabb_diag = (size[0] * size[0] + size[1] * size[1] + size[2] * size[2])
        .sqrt()
        .max(1e-5);
    let pad = [size[0] * 0.02, size[1] * 0.02, size[2] * 0.02];
    let clip_min = [
        bounds_min[0] - pad[0],
        bounds_min[1] - pad[1],
        bounds_min[2] - pad[2],
    ];
    let clip_max = [
        bounds_max[0] + pad[0],
        bounds_max[1] + pad[1],
        bounds_max[2] + pad[2],
    ];

    // Map the fit AABB into `[eps, dim - eps]` so floor() always lands in-range.
    let inset = 1e-3_f64;
    let scale = match fit {
        VoxelFit::Stretch => [
            (width as f64 - inset) / size[0] as f64,
            (height as f64 - inset) / size[1] as f64,
            (length as f64 - inset) / size[2] as f64,
        ],
        VoxelFit::Fit => {
            let uniform = ((width as f64 - inset) / size[0] as f64)
                .min((height as f64 - inset) / size[1] as f64)
                .min((length as f64 - inset) / size[2] as f64);
            [uniform, uniform, uniform]
        }
    };

    let scaled_size = [
        size[0] as f64 * scale[0],
        size[1] as f64 * scale[1],
        size[2] as f64 * scale[2],
    ];
    // Centre XZ in the grid. Keep feet on Y=0 — Fit letterboxing used to float
    // the mesh mid-air so the top clipped the convert box.
    let letterbox = [
        (width as f64 - scaled_size[0]) * 0.5,
        0.0,
        (length as f64 - scaled_size[2]) * 0.5,
    ];
    let dims = [width as f64, height as f64, length as f64];

    let mut grid = VoxelGrid::try_empty(width, height, length)?;

    let has_uvs = mesh.uvs.len() == mesh.positions.len();
    let mut nearest_dist: HashMap<usize, f32> = HashMap::new();
    let mut footprint = if cutout {
        None
    } else {
        Some(Footprint::new())
    };
    {
        let mut raster = MeshRaster {
            grid: &mut grid,
            nearest_dist: &mut nearest_dist,
            footprint: footprint.as_mut(),
            prefer_vivid: cutout,
            uv,
        };

        // Pass 1: base body. Pass 2: overlay only into empty cells.
        for pass_overlay in [false, true] {
            for triangle in &mesh.indices {
                let i0 = triangle[0] as usize;
                let i1 = triangle[1] as usize;
                let i2 = triangle[2] as usize;
                let layer = mesh.layers.get(i0).copied().unwrap_or(0);
                let is_overlay = layer > 0;
                if is_overlay != pass_overlay {
                    continue;
                }
                let pa = mesh.positions[i0];
                let pb = mesh.positions[i1];
                let pc = mesh.positions[i2];
                if !keep_triangle(pa, pb, pc, clip_min, clip_max, aabb_diag) {
                    continue;
                }
                let a = map_into_grid(pa, bounds_min, scale, letterbox, dims);
                let b = map_into_grid(pb, bounds_min, scale, letterbox, dims);
                let c = map_into_grid(pc, bounds_min, scale, letterbox, dims);
                let ca = mesh.colors[i0];
                let cb = mesh.colors[i1];
                let cc = mesh.colors[i2];
                let tex_idx = mesh.texture_index.get(i0).copied().unwrap_or(-1);
                let texture = if tex_idx >= 0 {
                    mesh.textures.get(tex_idx as usize)
                } else {
                    mesh.texture.as_ref()
                };
                let (uva, uvb, uvc) = if has_uvs && texture.is_some() {
                    (Some(mesh.uvs[i0]), Some(mesh.uvs[i1]), Some(mesh.uvs[i2]))
                } else {
                    (None, None, None)
                };
                rasterize_triangle(
                    &mut raster,
                    a,
                    b,
                    c,
                    ca,
                    cb,
                    cc,
                    uva,
                    uvb,
                    uvc,
                    texture,
                    layer,
                    cutout,
                );
            }
        }
    }

    bake_cell_colours(&mut grid, footprint.as_ref());

    // Entity cubes are hollow 6-face boxes. Solid fill closes small in-cube gaps
    // at native scale; hollow mode keeps only the outer shell (used for catalog
    // entities). fill_enclosed_interiors also skips huge cavities at statue scale.
    if !hollow {
        fill_enclosed_interiors(&mut grid);
    } else {
        hollow_out(&mut grid);
    }

    grid.ensure_occupied_budget()?;
    ensure!(
        grid.occupied_count() > 0,
        "voxelization produced an empty model; try a larger size"
    );
    Ok(grid)
}

/// Collapse base/overlay buckets into `color_sum` for exporters that only read that.
fn bake_cell_colours(grid: &mut VoxelGrid, footprint: Option<&Footprint>) {
    let width = grid.width;
    let length = grid.length;
    let keys: Vec<u32> = grid.chunks.keys().copied().collect();
    for key in keys {
        let Some(chunk) = grid.chunks.get_mut(&key) else {
            continue;
        };
        let (cx, cy, cz) = unpack_chunk_key(key);
        let ox = cx << CHUNK_SHIFT;
        let oy = cy << CHUNK_SHIFT;
        let oz = cz << CHUNK_SHIFT;
        for ly in 0..CHUNK_SIZE {
            for lz in 0..CHUNK_SIZE {
                for lx in 0..CHUNK_SIZE {
                    let cell = &mut chunk[chunk_local(lx, ly, lz)];
                    if !cell.occupied {
                        continue;
                    }
                    let x = ox + lx;
                    let y = oy + ly;
                    let z = oz + lz;
                    let index = ((y as u64 * length as u64 + z as u64) * width as u64 + x as u64)
                        as usize;
                    // Same priority as rgb_at: base wins on conflict.
                    let (sum, n, layer) = if cell.base_samples > 0 {
                        (cell.base_sum, cell.base_samples, 0_u8)
                    } else if cell.overlay_samples > 0 {
                        (cell.overlay_sum, cell.overlay_samples, 1_u8)
                    } else if cell.samples > 0 {
                        continue;
                    } else {
                        cell.occupied = false;
                        continue;
                    };
                    let mut rgb = [
                        sum[0] / n as f32,
                        sum[1] / n as f32,
                        sum[2] / n as f32,
                    ];
                    if let Some(fp) = footprint {
                        rgb = fp.pick_detail(index, rgb);
                    }
                    cell.color_sum = rgb;
                    cell.samples = 1;
                    cell.layer = layer;
                    if layer == 0 {
                        cell.base_sum = rgb;
                        cell.base_samples = 1;
                    } else {
                        cell.overlay_sum = rgb;
                        cell.overlay_samples = 1;
                    }
                }
            }
        }
    }
    let mut occupied = 0usize;
    for chunk in grid.chunks.values() {
        occupied += chunk.iter().filter(|cell| cell.occupied).count();
    }
    grid.occupied_count = occupied;
}

/// Map a mesh-space point into voxel space so the fit AABB occupies the given
/// block box. Subtract `bounds_min` in f64 first — `p * scale + offset` on large
/// world coords used to round a hair outside `[0, dim)` and `write_stamp`
/// dropped those samples (sides looked cropped, worse on big converts).
fn map_into_grid(
    point: [f32; 3],
    bounds_min: [f32; 3],
    scale: [f64; 3],
    letterbox: [f64; 3],
    dims: [f64; 3],
) -> [f32; 3] {
    const EPS: f64 = 1e-4;
    let mut out = [0.0_f32; 3];
    for i in 0..3 {
        let t = (point[i] as f64 - bounds_min[i] as f64) * scale[i] + letterbox[i];
        let max = (dims[i] - EPS).max(0.0);
        out[i] = t.clamp(0.0, max) as f32;
    }
    out
}

/// Entire mesh. Catalog entities have no studio lights; wings and tails must
/// set the scale or the body is stretched and the extremities are clipped.
fn full_mesh_bounds(positions: &[[f32; 3]]) -> ([f32; 3], [f32; 3], f32) {
    let mut full_min = [f32::INFINITY; 3];
    let mut full_max = [f32::NEG_INFINITY; 3];
    for position in positions {
        for axis in 0..3 {
            full_min[axis] = full_min[axis].min(position[axis]);
            full_max[axis] = full_max[axis].max(position[axis]);
        }
    }
    let extent = (full_max[0] - full_min[0])
        .max(full_max[1] - full_min[1])
        .max(full_max[2] - full_min[2])
        .max(1e-5);
    (full_min, full_max, extent)
}

/// Bounds used to scale the mesh into the voxel grid.
///
/// Returns `(fit_min, fit_max, core_extent)` where `core_extent` is the longest
/// axis of the 10th–90th percentile seed (for diagnostics).
///
/// Per axis: start from the dense core, then walk toward the true min/max while
/// consecutive vertices stay within `3×` the core span. Connected extremities
/// (arms, hair, skirts, roofs) have a continuous vertex cloud, so they stay in
/// the fit box. Disconnected studio lights sit many body-lengths away and stop
/// the walk — those used to be handled with a 1.55× full/core ratio, which also
/// clipped real character sides once the torso held most of the verts.
fn fit_bounds(positions: &[[f32; 3]]) -> ([f32; 3], [f32; 3], f32) {
    if positions.len() < 32 {
        return full_mesh_bounds(positions);
    }

    let mut xs: Vec<f32> = positions.iter().map(|p| p[0]).collect();
    let mut ys: Vec<f32> = positions.iter().map(|p| p[1]).collect();
    let mut zs: Vec<f32> = positions.iter().map(|p| p[2]).collect();
    xs.sort_by(|a, b| a.total_cmp(b));
    ys.sort_by(|a, b| a.total_cmp(b));
    zs.sort_by(|a, b| a.total_cmp(b));

    let (x0, x1) = expand_connected_axis(&xs);
    let (y0, y1) = expand_connected_axis(&ys);
    let (z0, z1) = expand_connected_axis(&zs);
    let bounds_min = [x0, y0, z0];
    let bounds_max = [x1, y1, z1];
    let core_extent = (x1 - x0).max(y1 - y0).max(z1 - z0).max(1e-5);
    (bounds_min, bounds_max, core_extent)
}

fn percentile_index(n: usize, t: f32) -> usize {
    let last = n.saturating_sub(1);
    ((last as f32 * t).round() as usize).min(last)
}

/// Grow from the 10th–90th percentile seed to the true extrema while the vertex
/// cloud stays connected. A gap larger than `3×` the seed span is a disconnected
/// studio light / far prop, not a limb.
fn expand_connected_axis(sorted: &[f32]) -> (f32, f32) {
    let n = sorted.len();
    if n == 0 {
        return (0.0, 1.0);
    }
    if n < 32 {
        return (sorted[0], sorted[n - 1]);
    }
    let lo_i = percentile_index(n, 0.10);
    let hi_i = percentile_index(n, 0.90).max(lo_i);
    let core_span = (sorted[hi_i] - sorted[lo_i]).max(1e-5);
    const GAP_LIMIT: f32 = 3.0;
    let max_gap = core_span * GAP_LIMIT;

    let mut left = lo_i;
    while left > 0 {
        if sorted[left] - sorted[left - 1] > max_gap {
            break;
        }
        left -= 1;
    }
    let mut right = hi_i;
    while right + 1 < n {
        if sorted[right + 1] - sorted[right] > max_gap {
            break;
        }
        right += 1;
    }
    (sorted[left], sorted[right])
}

fn point_in_aabb(point: [f32; 3], min: [f32; 3], max: [f32; 3]) -> bool {
    point[0] >= min[0]
        && point[0] <= max[0]
        && point[1] >= min[1]
        && point[1] <= max[1]
        && point[2] >= min[2]
        && point[2] <= max[2]
}

fn keep_triangle(
    a: [f32; 3],
    b: [f32; 3],
    c: [f32; 3],
    min: [f32; 3],
    max: [f32; 3],
    aabb_diag: f32,
) -> bool {
    let inside = u8::from(point_in_aabb(a, min, max))
        + u8::from(point_in_aabb(b, min, max))
        + u8::from(point_in_aabb(c, min, max));
    if inside == 0 {
        return false;
    }
    if inside == 3 {
        return true;
    }
    let longest = distance(a, b).max(distance(b, c)).max(distance(c, a));
    longest <= aabb_diag * 1.05
}

fn lerp2(a: [f32; 2], b: [f32; 2], t: f32) -> [f32; 2] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/// UV at a voxel's centre rather than wherever the parametric walk happened to
/// land. The walk steps by ~half a voxel, so a sample sitting inside voxel `x`
/// can carry the UV of texel `x±1`. Minecraft faces inset UVs by half a texel,
/// where that drift shifts the whole column one pixel — this is the same class
/// of bug as the "eyes shifted one pixel" note on the atlas sampler.
///
/// Solves the barycentric coordinates of `point` against the triangle, which
/// also projects the cell centre onto the triangle's plane.
fn barycentric_uv(
    a: [f32; 3],
    b: [f32; 3],
    c: [f32; 3],
    uva: [f32; 2],
    uvb: [f32; 2],
    uvc: [f32; 2],
    point: [f32; 3],
) -> Option<[f32; 2]> {
    let edge_b = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let edge_c = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let to_point = [point[0] - a[0], point[1] - a[1], point[2] - a[2]];
    let dot = |u: [f32; 3], v: [f32; 3]| u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    let bb = dot(edge_b, edge_b);
    let bc = dot(edge_b, edge_c);
    let cc = dot(edge_c, edge_c);
    let pb = dot(to_point, edge_b);
    let pc = dot(to_point, edge_c);
    let denom = bb * cc - bc * bc;
    if denom.abs() < 1e-12 {
        return None;
    }
    let mut beta = (cc * pb - bc * pc) / denom;
    let mut gamma = (bb * pc - bc * pb) / denom;
    // A cell centre can sit just outside a thin or edge-on triangle. Clamp back
    // onto it instead of dropping the sample and losing the voxel.
    beta = beta.clamp(0.0, 1.0);
    gamma = gamma.clamp(0.0, 1.0);
    let total = beta + gamma;
    if total > 1.0 {
        beta /= total;
        gamma /= total;
    }
    let alpha = 1.0 - beta - gamma;
    Some([
        alpha * uva[0] + beta * uvb[0] + gamma * uvc[0],
        alpha * uva[1] + beta * uvb[1] + gamma * uvc[1],
    ])
}

/// Centre of the voxel this point stamps into.
fn cell_centre(point: [f32; 3]) -> [f32; 3] {
    [
        point[0].floor() + 0.5,
        point[1].floor() + 0.5,
        point[2].floor() + 0.5,
    ]
}

fn luma(color: [f32; 3]) -> f32 {
    0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]
}

/// Two luma clusters per cell. Mean of every stamp washes pupils into skin;
/// the single darkest texel turns UV seams black. Split the footprint into a
/// dark and a light tone, then keep the dark cluster when it is a real feature.
struct Footprint {
    slots: HashMap<usize, FootprintSlot>,
}

struct FootprintSlot {
    a: [f32; 3],
    b: [f32; 3],
    a_n: u32,
    b_n: u32,
}

fn accum_cluster(slot: &mut [f32; 3], n: &mut u32, color: [f32; 3]) {
    let k = *n as f32;
    slot[0] = (slot[0] * k + color[0]) / (k + 1.0);
    slot[1] = (slot[1] * k + color[1]) / (k + 1.0);
    slot[2] = (slot[2] * k + color[2]) / (k + 1.0);
    *n += 1;
}

impl Footprint {
    fn new() -> Self {
        Self {
            slots: HashMap::new(),
        }
    }

    fn observe(&mut self, index: usize, color: [f32; 3]) {
        const SPLIT: f32 = 18.0;
        let slot = self.slots.entry(index).or_insert(FootprintSlot {
            a: [0.0; 3],
            b: [0.0; 3],
            a_n: 0,
            b_n: 0,
        });
        if slot.a_n == 0 {
            slot.a = color;
            slot.a_n = 1;
            return;
        }
        let y = luma(color);
        let ya = luma(slot.a);
        if slot.b_n == 0 {
            if (y - ya).abs() > SPLIT {
                slot.b = color;
                slot.b_n = 1;
            } else {
                accum_cluster(&mut slot.a, &mut slot.a_n, color);
            }
            return;
        }
        let yb = luma(slot.b);
        if (y - ya).abs() <= (y - yb).abs() {
            accum_cluster(&mut slot.a, &mut slot.a_n, color);
        } else {
            accum_cluster(&mut slot.b, &mut slot.b_n, color);
        }
    }

    fn pick_detail(&self, index: usize, centre: [f32; 3]) -> [f32; 3] {
        let Some(slot) = self.slots.get(&index) else {
            return centre;
        };
        let a_n = slot.a_n;
        if a_n == 0 {
            return centre;
        }
        let b_n = slot.b_n;
        if b_n == 0 {
            return centre;
        }
        let (dark, dark_n, light, light_n) = if luma(slot.a) <= luma(slot.b) {
            (slot.a, a_n, slot.b, b_n)
        } else {
            (slot.b, b_n, slot.a, a_n)
        };
        let dark_y = luma(dark);
        let light_y = luma(light);
        if light_y - dark_y < 18.0 {
            return centre;
        }
        let total = dark_n + light_n;
        // Pupils / nostrils / hair: keep the dark cluster when it owns a real
        // share, or a few very-dark stamps (a 4% pupil in a skin voxel).
        if dark_n * 10 >= total
            || dark_n >= light_n
            || (dark_y < 48.0 && dark_n * 25 >= total)
        {
            return dark;
        }
        // Sclera / teeth: only if they fill about a third of the cell. A 1-texel
        // specular is ignored so the face does not lift.
        if light_n * 3 >= total && light_y > 200.0 {
            return light;
        }
        centre
    }
}

struct MeshRaster<'a> {
    grid: &'a mut VoxelGrid,
    /// Squared distance from the sample that currently owns each cell to that
    /// cell's centre (the fallback colour when the footprint has no detail).
    nearest_dist: &'a mut HashMap<usize, f32>,
    footprint: Option<&'a mut Footprint>,
    /// Minecraft entity sheets: keep averaging + vivid-replace so a few eye
    /// texels are not washed into the head shell. Scans leave this off.
    prefer_vivid: bool,
    uv: &'a UvTransform,
}

fn rasterize_triangle(
    raster: &mut MeshRaster<'_>,
    a: [f32; 3],
    b: [f32; 3],
    c: [f32; 3],
    ca: [f32; 3],
    cb: [f32; 3],
    cc: [f32; 3],
    uva: Option<[f32; 2]>,
    uvb: Option<[f32; 2]>,
    uvc: Option<[f32; 2]>,
    texture: Option<&image::RgbaImage>,
    layer: u8,
    cutout: bool,
) {
    let edge_ab = distance(a, b);
    let edge_bc = distance(b, c);
    let edge_ca = distance(c, a);
    let steps = ((edge_ab.max(edge_bc).max(edge_ca) * 2.0).ceil() as i32).max(1);
    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let ab = lerp(a, b, t);
        let ac = lerp(a, c, t);
        let cab = lerp(ca, cb, t);
        let cac = lerp(ca, cc, t);
        let uv_ab = match (uva, uvb) {
            (Some(ua), Some(ub)) => Some(lerp2(ua, ub, t)),
            _ => None,
        };
        let uv_ac = match (uva, uvc) {
            (Some(ua), Some(uc)) => Some(lerp2(ua, uc, t)),
            _ => None,
        };
        let row_steps = ((distance(ab, ac) * 2.0).ceil() as i32).max(1);
        for j in 0..=row_steps {
            let u = j as f32 / row_steps as f32;
            let pos = lerp(ab, ac, u);
            let fallback = lerp(cab, cac, u);
            let walked = match (uv_ab, uv_ac) {
                (Some(left), Some(right)) => Some(lerp2(left, right, u)),
                _ => None,
            };
            let uv = if raster.prefer_vivid {
                stamp_uv(a, b, c, uva, uvb, uvc, pos, walked)
            } else {
                walked.or_else(|| stamp_uv(a, b, c, uva, uvb, uvc, pos, None))
            };
            let uv = uv.map(|uv| raster.uv.apply(uv));
            let color = match resolve_stamp_colour(
                fallback,
                uv,
                texture,
                layer,
                cutout,
                !raster.prefer_vivid,
            ) {
                Some(rgb) => rgb,
                None => continue,
            };
            stamp(raster, pos, color, layer);
        }
    }
    for (edge_pos, edge_col, edge_uv) in [
        ([a, b], [ca, cb], [uva, uvb]),
        ([b, c], [cb, cc], [uvb, uvc]),
        ([c, a], [cc, ca], [uvc, uva]),
    ] {
        let edge_steps = ((distance(edge_pos[0], edge_pos[1]) * 3.0).ceil() as i32).max(1);
        for i in 0..=edge_steps {
            let t = i as f32 / edge_steps as f32;
            let pos = lerp(edge_pos[0], edge_pos[1], t);
            let fallback = lerp(edge_col[0], edge_col[1], t);
            let walked = match (edge_uv[0], edge_uv[1]) {
                (Some(ua), Some(ub)) => Some(lerp2(ua, ub, t)),
                _ => None,
            };
            let uv = if raster.prefer_vivid {
                stamp_uv(a, b, c, uva, uvb, uvc, pos, walked)
            } else {
                walked.or_else(|| stamp_uv(a, b, c, uva, uvb, uvc, pos, None))
            };
            let uv = uv.map(|uv| raster.uv.apply(uv));
            let color = match resolve_stamp_colour(
                fallback,
                uv,
                texture,
                layer,
                cutout,
                !raster.prefer_vivid,
            ) {
                Some(rgb) => rgb,
                None => continue,
            };
            stamp(raster, pos, color, layer);
        }
    }
}

/// Re-solve a walk sample's UV at the centre of the voxel it lands in, falling
/// back to the walk's own interpolated UV when the triangle is degenerate.
#[allow(clippy::too_many_arguments)]
fn stamp_uv(
    a: [f32; 3],
    b: [f32; 3],
    c: [f32; 3],
    uva: Option<[f32; 2]>,
    uvb: Option<[f32; 2]>,
    uvc: Option<[f32; 2]>,
    pos: [f32; 3],
    walked: Option<[f32; 2]>,
) -> Option<[f32; 2]> {
    match (uva, uvb, uvc) {
        (Some(ua), Some(ub), Some(uc)) => {
            barycentric_uv(a, b, c, ua, ub, uc, cell_centre(pos)).or(walked)
        }
        _ => walked,
    }
}

/// Atlas sample when UVs exist. Transparent overlay texels (bee wings, hat
/// holes) stay empty. Base-layer misses fall back to baked vertex / Kd colour
/// so entity cube faces still stamp when UVs hit unused atlas padding.
fn resolve_stamp_colour(
    fallback: [f32; 3],
    uv: Option<[f32; 2]>,
    texture: Option<&image::RgbaImage>,
    layer: u8,
    cutout: bool,
    exact: bool,
) -> Option<[f32; 3]> {
    if let (Some(image), Some(uv)) = (texture, uv) {
        // Overlay holes and catalog cutouts must sample the texel itself.
        // The padded sampler fills a 3px ring around every opaque island,
        // which paints shulker rims and enderman mouth edges solid.
        // Scan meshes use the exact texel too — bleed is a blend, and it
        // was lifting dark details toward neighbouring skin.
        let sampled = if layer > 0 || cutout || exact {
            super::import::sample_texture_exact(image, uv[0], uv[1])
        } else {
            super::import::sample_texture(image, uv[0], uv[1])
        };
        if let Some(rgb) = sampled {
            return Some(rgb);
        }
        if layer > 0 || cutout {
            return None;
        }
        return Some(fallback);
    }
    Some(fallback)
}

fn stamp(
    raster: &mut MeshRaster<'_>,
    point: [f32; 3],
    color: [f32; 3],
    layer: u8,
) {
    let x0 = point[0].floor() as i32;
    let y0 = point[1].floor() as i32;
    let z0 = point[2].floor() as i32;
    if layer == 0 {
        write_stamp(raster, x0, y0, z0, color, 0, point);
        return;
    }

    // Overlay only if this cell is still empty. Inflated hat/jacket boxes are
    // hollow 0.25–0.5px shells; walking them outward grew detached cyan / hair
    // sheets around Steve. Catalog convert also strips those objects so the
    // inner cubes alone become blocks.
    let _ = write_stamp(raster, x0, y0, z0, color, 1, point);
}

/// Returns true if the stamp was applied. Overlay refuses cells that already
/// hold base samples (second layer must not cover the first).
fn write_stamp(
    raster: &mut MeshRaster<'_>,
    x: i32,
    y: i32,
    z: i32,
    color: [f32; 3],
    layer: u8,
    point: [f32; 3],
) -> bool {
    // A hair outside the box (f32 / raster overshoot) still belongs on the wall.
    let Some(x) = clamp_near_grid(x, raster.grid.width) else {
        return false;
    };
    let Some(y) = clamp_near_grid(y, raster.grid.height) else {
        return false;
    };
    let Some(z) = clamp_near_grid(z, raster.grid.length) else {
        return false;
    };
    write_stamp_at(raster, x, y, z, color, layer, point)
}

fn clamp_near_grid(v: i32, dim: u32) -> Option<u32> {
    if dim == 0 {
        return None;
    }
    let max = dim as i32 - 1;
    if v < -1 || v > max + 1 {
        return None;
    }
    Some(v.clamp(0, max) as u32)
}

fn write_stamp_at(
    raster: &mut MeshRaster<'_>,
    x: u32,
    y: u32,
    z: u32,
    color: [f32; 3],
    layer: u8,
    point: [f32; 3],
) -> bool {
    if x >= raster.grid.width || y >= raster.grid.height || z >= raster.grid.length {
        return false;
    }
    let index = raster.grid.index(x, y, z);
    let dx = point[0] - (x as f32 + 0.5);
    let dy = point[1] - (y as f32 + 0.5);
    let dz = point[2] - (z as f32 + 0.5);
    let dist = dx * dx + dy * dy + dz * dz;
    let prev_dist = *raster.nearest_dist.get(&index).unwrap_or(&f32::MAX);
    let closer = dist < prev_dist;
    let prefer_vivid = raster.prefer_vivid;
    let mut update_dist = false;
    let wrote = raster.grid.with_cell_mut(x, y, z, true, |cell| {
        if layer > 0 && cell.base_samples > 0 {
            return false;
        }
        cell.occupied = true;
        if prefer_vivid {
            if layer > 0 {
                cell.overlay_sum[0] += color[0];
                cell.overlay_sum[1] += color[1];
                cell.overlay_sum[2] += color[2];
                cell.overlay_samples += 1;
            } else {
                // Eyes / markings are few bright texels on dark shells (Enderman).
                let vivid = color[0].max(color[1]).max(color[2]);
                let existing_vivid = if cell.base_samples > 0 {
                    cell.base_sum[0]
                        .max(cell.base_sum[1])
                        .max(cell.base_sum[2])
                        / cell.base_samples as f32
                } else {
                    0.0
                };
                if cell.base_samples > 0 && vivid > existing_vivid + 40.0 {
                    cell.base_sum = [color[0], color[1], color[2]];
                    cell.base_samples = 1;
                } else {
                    cell.base_sum[0] += color[0];
                    cell.base_sum[1] += color[1];
                    cell.base_sum[2] += color[2];
                    cell.base_samples += 1;
                }
            }
            return true;
        }

        if layer > 0 {
            if cell.overlay_samples == 0 || closer {
                cell.overlay_sum = color;
                cell.overlay_samples = 1;
                update_dist = true;
            }
        } else if cell.base_samples == 0 || closer {
            cell.base_sum = color;
            cell.base_samples = 1;
            update_dist = true;
        }
        true
    });
    if wrote != Some(true) {
        return false;
    }
    if update_dist {
        raster.nearest_dist.insert(index, dist);
    }
    if let Some(fp) = raster.footprint.as_mut() {
        fp.observe(index, color);
    }
    true
}

/// Flood empty cells that are not reachable from the occupied bounding box
/// border, using the nearest occupied neighbour's colour. Closes hollow
/// Minecraft cube shells. The 15% skip still uses the **logical** box volume
/// so statue-scale entity cubes do not solid-fill.
fn fill_enclosed_interiors(grid: &mut VoxelGrid) {
    let w = grid.width;
    let h = grid.height;
    let l = grid.length;
    if w == 0 || h == 0 || l == 0 {
        return;
    }
    let Some((min, max)) = grid.occupied_bounds() else {
        return;
    };
    let volume = grid.volume() as f64;
    let bw = (max[0] - min[0] + 1) as usize;
    let bh = (max[1] - min[1] + 1) as usize;
    let bl = (max[2] - min[2] + 1) as usize;
    let count = bw * bh * bl;
    let mut outside = vec![false; count];
    let mut queue: VecDeque<(u32, u32, u32)> = VecDeque::new();
    let idx = |x: u32, y: u32, z: u32| {
        let lx = (x - min[0]) as usize;
        let ly = (y - min[1]) as usize;
        let lz = (z - min[2]) as usize;
        (ly * bl + lz) * bw + lx
    };

    let seed = |x: u32,
                y: u32,
                z: u32,
                grid: &VoxelGrid,
                outside: &mut [bool],
                queue: &mut VecDeque<(u32, u32, u32)>| {
        let i = idx(x, y, z);
        if grid.is_occupied(x, y, z) || outside[i] {
            return;
        }
        outside[i] = true;
        queue.push_back((x, y, z));
    };

    for y in min[1]..=max[1] {
        for z in min[2]..=max[2] {
            seed(min[0], y, z, grid, &mut outside, &mut queue);
            if max[0] > min[0] {
                seed(max[0], y, z, grid, &mut outside, &mut queue);
            }
        }
    }
    for y in min[1]..=max[1] {
        for x in min[0]..=max[0] {
            seed(x, y, min[2], grid, &mut outside, &mut queue);
            if max[2] > min[2] {
                seed(x, y, max[2], grid, &mut outside, &mut queue);
            }
        }
    }
    for z in min[2]..=max[2] {
        for x in min[0]..=max[0] {
            seed(x, min[1], z, grid, &mut outside, &mut queue);
            if max[1] > min[1] {
                seed(x, max[1], z, grid, &mut outside, &mut queue);
            }
        }
    }

    let neighbors = |x: u32, y: u32, z: u32| {
        [
            (x.wrapping_sub(1), y, z),
            (x + 1, y, z),
            (x, y.wrapping_sub(1), z),
            (x, y + 1, z),
            (x, y, z.wrapping_sub(1)),
            (x, y, z + 1),
        ]
    };

    while let Some((x, y, z)) = queue.pop_front() {
        for (nx, ny, nz) in neighbors(x, y, z) {
            if nx < min[0] || ny < min[1] || nz < min[2] || nx > max[0] || ny > max[1] || nz > max[2]
            {
                continue;
            }
            let i = idx(nx, ny, nz);
            if grid.is_occupied(nx, ny, nz) || outside[i] {
                continue;
            }
            outside[i] = true;
            queue.push_back((nx, ny, nz));
        }
    }

    let mut interior: Vec<(u32, u32, u32)> = Vec::new();
    for y in min[1]..=max[1] {
        for z in min[2]..=max[2] {
            for x in min[0]..=max[0] {
                let i = idx(x, y, z);
                if !grid.is_occupied(x, y, z) && !outside[i] {
                    interior.push((x, y, z));
                }
            }
        }
    }
    if interior.is_empty() {
        return;
    }

    // Hollow shell meshes scaled to fill a large grid (Minecraft entity cubes at
    // statue size) seal off most of the volume. Filling that cavity would
    // solid-paint the entire bounding box with the nearest limb colour.
    const MAX_INTERIOR_FRACTION: f64 = 0.15;
    if interior.len() as f64 > volume * MAX_INTERIOR_FRACTION {
        return;
    }

    loop {
        let mut painted = 0usize;
        for &(x, y, z) in &interior {
            if grid.is_occupied(x, y, z) {
                continue;
            }
            if grid.occupied_count() as u64 >= MAX_OCCUPIED_VOXELS {
                break;
            }
            let mut source: Option<VoxelCell> = None;
            for (nx, ny, nz) in neighbors(x, y, z) {
                if nx >= w || ny >= h || nz >= l {
                    continue;
                }
                if let Some(ncell) = grid.cell(nx, ny, nz) {
                    source = Some(ncell.clone());
                    break;
                }
            }
            if let Some(cell) = source {
                grid.with_cell_mut(x, y, z, true, |dst| {
                    *dst = cell;
                    dst.occupied = true;
                });
                painted += 1;
            }
        }
        if painted == 0 {
            break;
        }
        interior.retain(|&(x, y, z)| !grid.is_occupied(x, y, z));
        if interior.is_empty() {
            break;
        }
    }
}

/// Keep only surface voxels (6-neighbor exposed). Used after mesh or skin voxelization.
pub(crate) fn hollow_out(grid: &mut VoxelGrid) {
    let coords = grid.occupied_coords();
    let mut drop_list = Vec::new();
    for (x, y, z) in coords {
        let neighbors = [
            (x.wrapping_sub(1), y, z),
            (x + 1, y, z),
            (x, y.wrapping_sub(1), z),
            (x, y + 1, z),
            (x, y, z.wrapping_sub(1)),
            (x, y, z + 1),
        ];
        let exposed = neighbors.iter().any(|&(nx, ny, nz)| {
            nx >= grid.width
                || ny >= grid.height
                || nz >= grid.length
                || !grid.is_occupied(nx, ny, nz)
        });
        if !exposed {
            drop_list.push((x, y, z));
        }
    }
    for (x, y, z) in drop_list {
        grid.with_cell_mut(x, y, z, false, |cell| {
            *cell = empty_cell();
        });
    }
}

fn lerp(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

fn distance(a: [f32; 3], b: [f32; 3]) -> f32 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    let dz = a[2] - b[2];
    (dx * dx + dy * dy + dz * dz).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::import::Mesh;

    #[test]
    fn clamp_voxel_dims_fits_minecraft_height() {
        assert_eq!(clamp_voxel_dims(64, 64, 64), (64, 64, 64));
        assert_eq!(clamp_voxel_dims(160, 160, 160), (160, 160, 160));
        assert_eq!(clamp_voxel_dims(512, 10, 10), (512, 10, 10));
        let (w, h, l) = clamp_voxel_dims(200, 500, 200);
        assert_eq!(h, MC_WORLD_HEIGHT);
        assert!(w < 200 && l < 200);
        let (w, h, l) = clamp_voxel_dims(384, 384, 384);
        assert_eq!((w, h, l), (384, 384, 384));
        let (w, h, l) = clamp_voxel_dims(256, 256, 256);
        assert_eq!((w, h, l), (256, 256, 256));
    }

    #[test]
    fn world_cube_grid_does_not_store_air() {
        let grid = VoxelGrid::try_empty(384, 384, 384).unwrap();
        assert_eq!((grid.width, grid.height, grid.length), (384, 384, 384));
        assert_eq!(grid.occupied_count(), 0);
        assert!(grid.chunks.is_empty());
    }

    #[test]
    fn voxelizes_a_unit_triangle() {
        let mesh = Mesh {
            positions: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            colors: vec![[255.0, 0.0, 0.0], [255.0, 0.0, 0.0], [255.0, 0.0, 0.0]],
            uvs: vec![],
            texture: None,
            textures: vec![],
            texture_index: vec![],
            layers: vec![0, 0, 0],
            indices: vec![[0, 1, 2]],
        };
        let grid = voxelize_mesh(&mesh, 8, 8, 8, VoxelFit::Fit, false, false).unwrap();
        assert!(grid.occupied_count() > 3);
        let rgb = grid
            .occupied_coords()
            .into_iter()
            .find_map(|(x, y, z)| grid.rgb_at(x, y, z))
            .unwrap();
        assert!(rgb[0] > 200, "expected red, got {rgb:?}");
        assert!(rgb[1] < 30 && rgb[2] < 30, "expected pure red, got {rgb:?}");
    }

    #[test]
    fn studio_light_outliers_do_not_crush_model() {
        // Dense red cube near origin + one giant far white triangle (studio light).
        let mut positions = Vec::new();
        let mut colors = Vec::new();
        let mut layers = Vec::new();
        let mut indices = Vec::new();
        let mut push_tri = |pts: [[f32; 3]; 3], rgb: [f32; 3]| {
            let base = positions.len() as u32;
            for p in pts {
                positions.push(p);
                colors.push(rgb);
                layers.push(0);
            }
            indices.push([base, base + 1, base + 2]);
        };
        for x in 0..4 {
            for y in 0..4 {
                for z in 0..4 {
                    let o = [x as f32, y as f32, z as f32];
                    push_tri(
                        [
                            [o[0], o[1], o[2]],
                            [o[0] + 0.9, o[1], o[2]],
                            [o[0], o[1] + 0.9, o[2]],
                        ],
                        [220.0, 40.0, 40.0],
                    );
                }
            }
        }
        push_tri(
            [[-200.0, 0.0, -200.0], [200.0, 0.0, -200.0], [0.0, 200.0, 200.0]],
            [250.0, 250.0, 250.0],
        );
        let mesh = Mesh {
            positions,
            colors,
            uvs: vec![],
            texture: None,
            textures: vec![],
            texture_index: vec![],
            layers,
            indices,
        };
        let grid = voxelize_mesh(&mesh, 32, 32, 32, VoxelFit::Fit, false, false).unwrap();
        let occupied = grid.occupied_count();
        assert!(occupied > 20, "model should fill many cells, got {occupied}");
        let mut red = 0;
        let mut white = 0;
        for y in 0..grid.height {
            for z in 0..grid.length {
                for x in 0..grid.width {
                    let Some(rgb) = grid.rgb_at(x, y, z) else {
                        continue;
                    };
                    if rgb[0] > 150 && rgb[1] < 100 {
                        red += 1;
                    }
                    if rgb[0] > 200 && rgb[1] > 200 && rgb[2] > 200 {
                        white += 1;
                    }
                }
            }
        }
        assert!(
            red > white,
            "studio light must not dominate: red={red} white={white}"
        );
    }

    fn push_box_mesh(
        positions: &mut Vec<[f32; 3]>,
        colors: &mut Vec<[f32; 3]>,
        layers: &mut Vec<u8>,
        indices: &mut Vec<[u32; 3]>,
        min: [f32; 3],
        max: [f32; 3],
        rgb: [f32; 3],
    ) {
        let [x0, y0, z0] = min;
        let [x1, y1, z1] = max;
        let corners = [
            [x0, y0, z0],
            [x1, y0, z0],
            [x1, y1, z0],
            [x0, y1, z0],
            [x0, y0, z1],
            [x1, y0, z1],
            [x1, y1, z1],
            [x0, y1, z1],
        ];
        let faces: [[usize; 4]; 6] = [
            [0, 1, 2, 3],
            [4, 7, 6, 5],
            [0, 4, 5, 1],
            [3, 2, 6, 7],
            [0, 3, 7, 4],
            [1, 5, 6, 2],
        ];
        for face in faces {
            let base = positions.len() as u32;
            for i in face {
                positions.push(corners[i]);
                colors.push(rgb);
                layers.push(0);
            }
            indices.push([base, base + 1, base + 2]);
            indices.push([base, base + 2, base + 3]);
        }
    }

    fn mesh_from_parts(
        positions: Vec<[f32; 3]>,
        colors: Vec<[f32; 3]>,
        layers: Vec<u8>,
        indices: Vec<[u32; 3]>,
    ) -> Mesh {
        Mesh {
            positions,
            colors,
            uvs: vec![],
            texture: None,
            textures: vec![],
            texture_index: vec![],
            layers,
            indices,
        }
    }

    #[test]
    fn fit_bounds_keeps_connected_arm_past_torso_ratio() {
        // Dense torso (0–1) plus a connected arm out to x=2.5. The old 1.55×
        // full/core cutoff treated the arm as a studio light and cropped it.
        let mut positions = Vec::new();
        let mut colors = Vec::new();
        let mut layers = Vec::new();
        let mut indices = Vec::new();
        for _ in 0..80 {
            push_box_mesh(
                &mut positions,
                &mut colors,
                &mut layers,
                &mut indices,
                [0.0, 0.0, 0.0],
                [1.0, 1.0, 1.0],
                [220.0, 40.0, 40.0],
            );
        }
        push_box_mesh(
            &mut positions,
            &mut colors,
            &mut layers,
            &mut indices,
            [1.0, 0.4, 0.4],
            [2.5, 0.6, 0.6],
            [40.0, 40.0, 220.0],
        );
        let (min, max, _) = fit_bounds(&positions);
        assert!(
            max[0] > 2.4,
            "connected arm must stay in the fit box, max.x={:?}",
            max[0]
        );
        assert!(min[0] <= 0.01, "torso min must stay, min.x={:?}", min[0]);
    }

    #[test]
    fn connected_extremities_are_not_cropped_from_grid() {
        let mut positions = Vec::new();
        let mut colors = Vec::new();
        let mut layers = Vec::new();
        let mut indices = Vec::new();
        for _ in 0..80 {
            push_box_mesh(
                &mut positions,
                &mut colors,
                &mut layers,
                &mut indices,
                [0.0, 0.0, 0.0],
                [1.0, 1.0, 1.0],
                [220.0, 40.0, 40.0],
            );
        }
        push_box_mesh(
            &mut positions,
            &mut colors,
            &mut layers,
            &mut indices,
            [1.0, 0.4, 0.4],
            [2.5, 0.6, 0.6],
            [40.0, 40.0, 220.0],
        );
        let mesh = mesh_from_parts(positions, colors, layers, indices);
        let grid = voxelize_mesh(&mesh, 32, 32, 32, VoxelFit::Fit, false, false).unwrap();
        let mut blue_high_x = 0;
        let mut max_x = 0u32;
        for y in 0..grid.height {
            for z in 0..grid.length {
                for x in 0..grid.width {
                    let Some(rgb) = grid.rgb_at(x, y, z) else {
                        continue;
                    };
                    max_x = max_x.max(x);
                    if x >= 18 && rgb[2] > 150 && rgb[0] < 100 {
                        blue_high_x += 1;
                    }
                }
            }
        }
        assert!(
            max_x >= 30,
            "fitted mesh must reach the given width, max_x={max_x}"
        );
        assert!(
            blue_high_x > 0,
            "arm voxels must land on the high-X side, not be dropped"
        );
    }

    #[test]
    fn large_world_coords_still_fill_the_given_box() {
        let origin = 1_000_000.0;
        let mut positions = Vec::new();
        let mut colors = Vec::new();
        let mut layers = Vec::new();
        let mut indices = Vec::new();
        push_box_mesh(
            &mut positions,
            &mut colors,
            &mut layers,
            &mut indices,
            [origin, origin, origin],
            [origin + 10.0, origin + 10.0, origin + 10.0],
            [200.0, 40.0, 40.0],
        );
        let mesh = mesh_from_parts(positions, colors, layers, indices);
        let grid = voxelize_mesh(&mesh, 16, 16, 16, VoxelFit::Stretch, false, false).unwrap();
        let mut min_x = u32::MAX;
        let mut max_x = 0u32;
        let mut min_z = u32::MAX;
        let mut max_z = 0u32;
        let mut occupied = 0;
        for y in 0..grid.height {
            for z in 0..grid.length {
                for x in 0..grid.width {
                    if grid.rgb_at(x, y, z).is_none() {
                        continue;
                    }
                    occupied += 1;
                    min_x = min_x.min(x);
                    max_x = max_x.max(x);
                    min_z = min_z.min(z);
                    max_z = max_z.max(z);
                }
            }
        }
        assert!(occupied > 20, "large-origin cube should rasterize, occupied={occupied}");
        assert_eq!(min_x, 0, "left wall must not be dropped, min_x={min_x}");
        assert_eq!(max_x, 15, "right wall must not be dropped, max_x={max_x}");
        assert_eq!(min_z, 0, "front wall must not be dropped, min_z={min_z}");
        assert_eq!(max_z, 15, "back wall must not be dropped, max_z={max_z}");
    }

    #[test]
    fn space_diagonal_triangle_is_kept() {
        // Longest edge is the AABB space diagonal (√3). The old face-diagonal
        // cap (extent × √2 × 1.05) culled it, leaving a hole on large faces.
        let mesh = Mesh {
            positions: vec![[0.0, 0.0, 0.0], [1.0, 1.0, 1.0], [1.0, 0.0, 0.0]],
            colors: vec![[220.0, 40.0, 40.0]; 3],
            uvs: vec![],
            texture: None,
            textures: vec![],
            texture_index: vec![],
            layers: vec![0, 0, 0],
            indices: vec![[0, 1, 2]],
        };
        let grid = voxelize_mesh(&mesh, 12, 12, 12, VoxelFit::Fit, false, false).unwrap();
        let occupied = grid.occupied_count();
        assert!(occupied > 3, "space-diagonal triangle must voxelize, occupied={occupied}");
    }

    #[test]
    fn face_keeps_base_colour_when_hair_overlay_shares_the_cell() {
        // Head face (peach) and hair shell (dark) land on the same coarse cells.
        // Face must remain visible — Minecraft shows base through transparent /
        // collapsed overlay, not a solid hair mask.
        // Identical positions force every cell to be shared (Stretch would
        // otherwise pull a tiny Z offset onto different slices).
        let mesh = Mesh {
            positions: vec![
                // Base face quad
                [0.0, 0.0, 0.0],
                [2.0, 0.0, 0.0],
                [2.0, 2.0, 0.0],
                [0.0, 2.0, 0.0],
                // Overlay hair on the same plane (coarse-grid collapse case)
                [0.0, 0.0, 0.0],
                [2.0, 0.0, 0.0],
                [2.0, 2.0, 0.0],
                [0.0, 2.0, 0.0],
            ],
            colors: vec![
                [240.0, 200.0, 170.0],
                [240.0, 200.0, 170.0],
                [240.0, 200.0, 170.0],
                [240.0, 200.0, 170.0],
                [40.0, 35.0, 30.0],
                [40.0, 35.0, 30.0],
                [40.0, 35.0, 30.0],
                [40.0, 35.0, 30.0],
            ],
            uvs: vec![],
            texture: None,
            textures: vec![],
            texture_index: vec![],
            layers: vec![0, 0, 0, 0, 1, 1, 1, 1],
            indices: vec![[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7]],
        };
        let grid = voxelize_mesh(&mesh, 8, 8, 4, VoxelFit::Stretch, false, false).unwrap();
        let mut peach = 0;
        let mut dark = 0;
        let mut overlay_on_base = 0;
        for y in 0..grid.height {
            for z in 0..grid.length {
                for x in 0..grid.width {
                    if let Some(cell) = grid.cell(x, y, z) {
                        if cell.base_samples > 0 && cell.overlay_samples > 0 {
                            overlay_on_base += 1;
                        }
                    }
                    let Some(rgb) = grid.rgb_at(x, y, z) else { continue };
                    if rgb[0] > 180 && rgb[1] > 140 {
                        peach += 1;
                    }
                    if rgb[0] < 80 && rgb[1] < 80 {
                        dark += 1;
                    }
                }
            }
        }
        assert!(peach > 0, "expected face (peach) voxels");
        assert_eq!(
            overlay_on_base, 0,
            "overlay must not write into cells already claimed by base"
        );
        assert_eq!(
            dark, 0,
            "collapsed hat/jacket overlay must not grow a shell, dark={dark}"
        );
    }

    #[test]
    fn protruding_overlay_only_cells_keep_overlay_colour() {
        // Gauntlet / hair strand sitting outside the body: overlay-only cells.
        let mesh = Mesh {
            positions: vec![
                // Base body far left
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                // Overlay detail far right (no overlap)
                [3.0, 0.0, 0.0],
                [4.0, 0.0, 0.0],
                [3.0, 1.0, 0.0],
            ],
            colors: vec![
                [240.0, 200.0, 170.0],
                [240.0, 200.0, 170.0],
                [240.0, 200.0, 170.0],
                [220.0, 220.0, 220.0],
                [220.0, 220.0, 220.0],
                [220.0, 220.0, 220.0],
            ],
            uvs: vec![],
            texture: None,
            textures: vec![],
            texture_index: vec![],
            layers: vec![0, 0, 0, 1, 1, 1],
            indices: vec![[0, 1, 2], [3, 4, 5]],
        };
        let grid = voxelize_mesh(&mesh, 16, 8, 4, VoxelFit::Stretch, false, false).unwrap();
        let mut body = 0;
        let mut detail = 0;
        for y in 0..grid.height {
            for z in 0..grid.length {
                for x in 0..grid.width {
                    let Some(rgb) = grid.rgb_at(x, y, z) else { continue };
                    if rgb[0] > 200 && rgb[1] > 150 && rgb[1] < 210 {
                        body += 1;
                    }
                    if rgb[0] > 200 && rgb[1] > 200 && (rgb[0] as i16 - rgb[1] as i16).abs() < 20 {
                        detail += 1;
                    }
                }
            }
        }
        assert!(body >= 1, "base body present");
        assert!(detail >= 1, "protruding overlay detail must remain");
    }

    #[test]
    fn overlay_colour_does_not_dominate_shared_surface() {
        // Large green base + small red overlay on the same patch.
        let mesh = Mesh {
            positions: vec![
                [0.0, 0.0, 0.0],
                [4.0, 0.0, 0.0],
                [0.0, 4.0, 0.0],
                [1.0, 1.0, 0.0],
                [1.5, 1.0, 0.0],
                [1.0, 1.5, 0.0],
            ],
            colors: vec![
                [0.0, 255.0, 0.0],
                [0.0, 255.0, 0.0],
                [0.0, 255.0, 0.0],
                [255.0, 0.0, 0.0],
                [255.0, 0.0, 0.0],
                [255.0, 0.0, 0.0],
            ],
            uvs: vec![],
            texture: None,
            textures: vec![],
            texture_index: vec![],
            layers: vec![0, 0, 0, 1, 1, 1],
            indices: vec![[0, 1, 2], [3, 4, 5]],
        };
        let grid = voxelize_mesh(&mesh, 16, 16, 4, VoxelFit::Stretch, false, false).unwrap();
        let mut green = 0;
        let mut red = 0;
        for y in 0..grid.height {
            for z in 0..grid.length {
                for x in 0..grid.width {
                    let Some(rgb) = grid.rgb_at(x, y, z) else { continue };
                    if rgb[1] > 200 && rgb[0] < 50 {
                        green += 1;
                    }
                    if rgb[0] > 200 && rgb[1] < 50 {
                        red += 1;
                    }
                }
            }
        }
        assert!(green > red, "base green={green} should dominate shared overlay red={red}");
    }

    #[test]
    fn face_interior_uv_samples_beat_dark_corner_vertex_colours() {
        // Minecraft head front: UV corners sit on a dark outline; peach / eyes are
        // in the interior. Vertex colours alone would paint the whole face dark.
        let mut pixels = vec![0_u8; 8 * 8 * 4];
        for y in 0..8 {
            for x in 0..8 {
                let i = (y * 8 + x) * 4;
                let edge = x == 0 || y == 0 || x == 7 || y == 7;
                if edge {
                    pixels[i] = 40;
                    pixels[i + 1] = 35;
                    pixels[i + 2] = 30;
                } else {
                    pixels[i] = 255;
                    pixels[i + 1] = 194;
                    pixels[i + 2] = 143;
                }
                pixels[i + 3] = 255;
            }
        }
        // White "eye" texels
        for &(x, y) in &[(2_usize, 3), (5, 3)] {
            let i = (y * 8 + x) * 4;
            pixels[i] = 255;
            pixels[i + 1] = 255;
            pixels[i + 2] = 255;
        }
        let texture = image::RgbaImage::from_raw(8, 8, pixels).expect("8x8 rgba");
        // OBJ V-up: image row 0 → v=1, row 7 → v≈0.
        let mesh = Mesh {
            positions: vec![
                [0.0, 0.0, 0.0],
                [8.0, 0.0, 0.0],
                [8.0, 8.0, 0.0],
                [0.0, 8.0, 0.0],
            ],
            // Deliberately wrong / dark corner colours — atlas must win.
            colors: vec![
                [40.0, 35.0, 30.0],
                [40.0, 35.0, 30.0],
                [40.0, 35.0, 30.0],
                [40.0, 35.0, 30.0],
            ],
            uvs: vec![
                [0.0, 1.0],
                [1.0, 1.0],
                [1.0, 0.0],
                [0.0, 0.0],
            ],
            texture: Some(texture.clone()),
            textures: vec![texture],
            texture_index: vec![0, 0, 0, 0],
            layers: vec![0, 0, 0, 0],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };
        let grid = voxelize_mesh(&mesh, 16, 16, 4, VoxelFit::Stretch, false, false).unwrap();
        let mut peach = 0;
        let mut white = 0;
        let mut dark = 0;
        for y in 0..grid.height {
            for z in 0..grid.length {
                for x in 0..grid.width {
                    let Some(rgb) = grid.rgb_at(x, y, z) else { continue };
                    if rgb[0] > 200 && rgb[1] > 150 && rgb[2] > 100 && rgb[1] < 230 {
                        peach += 1;
                    }
                    if rgb[0] > 230 && rgb[1] > 230 && rgb[2] > 230 {
                        white += 1;
                    }
                    if rgb[0] < 80 && rgb[1] < 80 {
                        dark += 1;
                    }
                }
            }
        }
        assert!(peach > 0, "expected peach interior from UV sampling");
        assert!(white > 0, "expected white eye texels from UV sampling");
        assert!(peach > dark, "interior face should beat dark outline: peach={peach} dark={dark}");
    }

    #[test]
    fn transparent_overlay_uv_does_not_create_voxels() {
        // 2×2 atlas: left opaque red, right fully transparent.
        let pixels = vec![
            255, 0, 0, 255, // 0,0
            0, 0, 0, 0, // 1,0 transparent
            255, 0, 0, 255, // 0,1
            0, 0, 0, 0, // 1,1 transparent
        ];
        let texture = image::RgbaImage::from_raw(2, 2, pixels).expect("2x2");
        let mesh = Mesh {
            positions: vec![
                [0.0, 0.0, 0.0],
                [2.0, 0.0, 0.0],
                [2.0, 2.0, 0.0],
                [0.0, 2.0, 0.0],
            ],
            colors: vec![
                [255.0, 0.0, 0.0],
                [255.0, 0.0, 0.0],
                [255.0, 0.0, 0.0],
                [255.0, 0.0, 0.0],
            ],
            // Full quad maps across both texels (V-up).
            uvs: vec![[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
            texture: Some(texture.clone()),
            textures: vec![texture],
            texture_index: vec![0, 0, 0, 0],
            layers: vec![1, 1, 1, 1],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };
        let grid = voxelize_mesh(&mesh, 16, 16, 4, VoxelFit::Stretch, false, false).unwrap();
        let occupied = grid.occupied_count();
        // Right half of the quad is transparent — must not fill the full rectangle.
        // Exactly half (128 of 16×16) is the expected opaque left side.
        assert!(
            occupied <= 16 * 16 / 2,
            "transparent overlay half must stay empty, occupied={occupied}"
        );
        assert!(occupied > 0, "opaque overlay half must still stamp");
    }

    #[test]
    fn cutout_base_skips_transparent_texels() {
        // Catalog entity sheets use alpha as a cutout (shulker rims, enderman
        // edges). Those texels must stay empty, not fill with vertex colour.
        let mut pixels = vec![0u8; 2 * 2 * 4];
        pixels[0..4].copy_from_slice(&[200, 40, 40, 255]);
        let texture = image::RgbaImage::from_raw(2, 2, pixels).expect("2x2");
        let mesh = Mesh {
            positions: vec![
                [0.0, 0.0, 0.0],
                [16.0, 0.0, 0.0],
                [16.0, 16.0, 0.0],
                [0.0, 16.0, 0.0],
            ],
            colors: vec![[80.0, 80.0, 80.0]; 4],
            uvs: vec![[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
            texture: Some(texture.clone()),
            textures: vec![texture],
            texture_index: vec![0, 0, 0, 0],
            layers: vec![0, 0, 0, 0],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };
        let grid = voxelize_mesh(&mesh, 16, 16, 4, VoxelFit::Stretch, false, true).unwrap();
        let occupied = grid.occupied_count();
        assert!(
            occupied <= 16 * 16 / 2,
            "cutout transparent half must stay empty, occupied={occupied}"
        );
        assert!(occupied > 0, "opaque cutout half must still stamp");
    }

    #[test]
    fn transparent_base_uv_falls_back_to_vertex_colour() {
        // Character / Maya meshes: atlas often has unused transparent padding.
        // Base layer must still stamp using vertex colour so the crown isn’t hollow.
        let pixels = vec![
            0, 0, 0, 0, // fully transparent atlas
            0, 0, 0, 0,
            0, 0, 0, 0,
            0, 0, 0, 0,
        ];
        let texture = image::RgbaImage::from_raw(2, 2, pixels).expect("2x2");
        let mesh = Mesh {
            positions: vec![
                [0.0, 0.0, 0.0],
                [2.0, 0.0, 0.0],
                [2.0, 2.0, 0.0],
                [0.0, 2.0, 0.0],
            ],
            colors: vec![
                [40.0, 180.0, 80.0],
                [40.0, 180.0, 80.0],
                [40.0, 180.0, 80.0],
                [40.0, 180.0, 80.0],
            ],
            uvs: vec![[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
            texture: Some(texture.clone()),
            textures: vec![texture],
            texture_index: vec![0, 0, 0, 0],
            layers: vec![0, 0, 0, 0],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };
        let grid = voxelize_mesh(&mesh, 12, 12, 4, VoxelFit::Stretch, false, false).unwrap();
        let occupied = grid.occupied_count();
        assert!(
            occupied > 20,
            "base mesh with transparent atlas must still fill via vertex colour, occupied={occupied}"
        );
        let mut green = 0;
        for y in 0..grid.height {
            for z in 0..grid.length {
                for x in 0..grid.width {
                    let Some(rgb) = grid.rgb_at(x, y, z) else { continue };
                    if rgb[1] > 140 && rgb[0] < 80 {
                        green += 1;
                    }
                }
            }
        }
        assert!(green > 10, "expected vertex green stamps, green={green}");
    }

    #[test]
    fn atlas_face_maps_one_texel_per_voxel_without_shift() {
        // 8 columns, unique red = 8*x+4 so a 1px shift would miss the match.
        let mut pixels = vec![0_u8; 8 * 8 * 4];
        for y in 0..8 {
            for x in 0..8 {
                let i = (y * 8 + x) * 4;
                pixels[i] = (x as u8) * 32 + 8;
                pixels[i + 1] = 20;
                pixels[i + 2] = 20;
                pixels[i + 3] = 255;
            }
        }
        let texture = image::RgbaImage::from_raw(8, 8, pixels).expect("8x8");
        let inset = 0.5 / 8.0;
        let mesh = Mesh {
            positions: vec![
                [0.0, 0.0, 0.0],
                [8.0, 0.0, 0.0],
                [8.0, 8.0, 0.0],
                [0.0, 8.0, 0.0],
            ],
            colors: vec![[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]],
            uvs: vec![
                [inset, 1.0 - inset],
                [1.0 - inset, 1.0 - inset],
                [1.0 - inset, inset],
                [inset, inset],
            ],
            texture: Some(texture.clone()),
            textures: vec![texture],
            texture_index: vec![0, 0, 0, 0],
            layers: vec![0, 0, 0, 0],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };
        let grid = voxelize_mesh(&mesh, 8, 8, 2, VoxelFit::Stretch, false, false).unwrap();
        let mut matches = 0;
        let mut occupied = 0;
        for y in 0..grid.height {
            for z in 0..grid.length {
                for x in 0..grid.width {
                    let Some(rgb) = grid.rgb_at(x, y, z) else { continue };
                    occupied += 1;
                    let expected = (x as u8).saturating_mul(32).saturating_add(8);
                    if rgb[0].abs_diff(expected) <= 2 {
                        matches += 1;
                    }
                }
            }
        }
        assert!(occupied >= 8, "expected a filled face, occupied={occupied}");
        assert!(
            matches * 2 >= occupied,
            "face columns should align to texels, matches={matches} occupied={occupied}"
        );
    }

    #[test]
    fn uv_flip_u_mirrors_atlas_columns() {
        let mut pixels = vec![0_u8; 8 * 8 * 4];
        for y in 0..8 {
            for x in 0..8 {
                let i = (y * 8 + x) * 4;
                pixels[i] = (x as u8) * 32 + 8;
                pixels[i + 1] = 20;
                pixels[i + 2] = 20;
                pixels[i + 3] = 255;
            }
        }
        let texture = image::RgbaImage::from_raw(8, 8, pixels).expect("8x8");
        let inset = 0.5 / 8.0;
        let mesh = Mesh {
            positions: vec![
                [0.0, 0.0, 0.0],
                [8.0, 0.0, 0.0],
                [8.0, 8.0, 0.0],
                [0.0, 8.0, 0.0],
            ],
            colors: vec![[0.0, 0.0, 0.0]; 4],
            uvs: vec![
                [inset, 1.0 - inset],
                [1.0 - inset, 1.0 - inset],
                [1.0 - inset, inset],
                [inset, inset],
            ],
            texture: Some(texture.clone()),
            textures: vec![texture],
            texture_index: vec![0, 0, 0, 0],
            layers: vec![0, 0, 0, 0],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };
        let uv = UvTransform {
            flip_u: true,
            ..UvTransform::default()
        };
        let grid =
            voxelize_mesh_with(&mesh, 8, 8, 2, VoxelFit::Stretch, false, false, &uv).unwrap();
        let mut matches = 0;
        let mut occupied = 0;
        for y in 0..grid.height {
            for z in 0..grid.length {
                for x in 0..grid.width {
                    let Some(rgb) = grid.rgb_at(x, y, z) else { continue };
                    occupied += 1;
                    let expected = (7u8.saturating_sub(x as u8)).saturating_mul(32).saturating_add(8);
                    if rgb[0].abs_diff(expected) <= 2 {
                        matches += 1;
                    }
                }
            }
        }
        assert!(occupied >= 8, "expected a filled face, occupied={occupied}");
        assert!(
            matches * 2 >= occupied,
            "flip U should mirror columns, matches={matches} occupied={occupied}"
        );
    }

    #[test]
    fn cell_centre_sample_ignores_corner_highlight() {
        // 8×8 peach face with one white texel in the corner. Averaging / vivid
        // replace used to paint most of the face white; Scan2Craft keeps the
        // texel under the voxel centre, so interior cells stay peach.
        let mut pixels = vec![0_u8; 8 * 8 * 4];
        for y in 0..8 {
            for x in 0..8 {
                let i = (y * 8 + x) * 4;
                pixels[i] = 160;
                pixels[i + 1] = 100;
                pixels[i + 2] = 70;
                pixels[i + 3] = 255;
            }
        }
        pixels[0] = 255;
        pixels[1] = 255;
        pixels[2] = 255;
        let texture = image::RgbaImage::from_raw(8, 8, pixels).expect("8x8");
        let mesh = Mesh {
            positions: vec![
                [0.0, 0.0, 0.0],
                [8.0, 0.0, 0.0],
                [8.0, 8.0, 0.0],
                [0.0, 8.0, 0.0],
            ],
            colors: vec![[160.0, 100.0, 70.0]; 4],
            uvs: vec![[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
            texture: Some(texture.clone()),
            textures: vec![texture],
            texture_index: vec![0, 0, 0, 0],
            layers: vec![0, 0, 0, 0],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };
        let grid = voxelize_mesh(&mesh, 8, 8, 2, VoxelFit::Stretch, false, false).unwrap();
        let mut peach = 0;
        let mut white = 0;
        for y in 0..grid.height {
            for z in 0..grid.length {
                for x in 0..grid.width {
                    let Some(rgb) = grid.rgb_at(x, y, z) else { continue };
                    if rgb[0] > 230 && rgb[1] > 230 && rgb[2] > 230 {
                        white += 1;
                    } else if rgb[0] > 120 && rgb[1] < 160 && rgb[2] < 120 {
                        peach += 1;
                    }
                }
            }
        }
        assert!(peach > white * 3, "highlight must not wash the face: peach={peach} white={white}");
    }

    #[test]
    fn footprint_keeps_dark_feature_ignores_specular() {
        let mut fp = Footprint::new();
        let peach = [210.0, 165.0, 140.0];
        let eye = [18.0, 12.0, 10.0];
        let spec = [255.0, 255.0, 255.0];
        for _ in 0..9 {
            fp.observe(0, peach);
        }
        for _ in 0..3 {
            fp.observe(0, eye);
        }
        let picked_eye = fp.pick_detail(0, peach);
        assert!(
            luma(picked_eye) < 40.0,
            "25% pupil must win over skin mean, got {picked_eye:?}"
        );

        for _ in 0..9 {
            fp.observe(1, peach);
        }
        fp.observe(1, spec);
        let picked_spec = fp.pick_detail(1, peach);
        assert!(
            luma(picked_spec) > 120.0,
            "10% specular must not lift the cell, got {picked_spec:?}"
        );
    }

    fn hollow_box_shell_mesh(size: f32) -> Mesh {
        let s = size;
        let white = [240.0, 240.0, 240.0];
        let mut positions = Vec::new();
        let mut colors = Vec::new();
        let mut uvs = Vec::new();
        let mut indices = Vec::new();
        let mut push_quad = |a: [f32; 3], b: [f32; 3], c: [f32; 3], d: [f32; 3]| {
            let base = positions.len() as u32;
            positions.extend([a, b, c, d]);
            colors.extend([white; 4]);
            uvs.extend([[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]);
            indices.push([base, base + 1, base + 2]);
            indices.push([base, base + 2, base + 3]);
        };
        // Bottom (y=0)
        push_quad([0.0, 0.0, 0.0], [s, 0.0, 0.0], [s, 0.0, s], [0.0, 0.0, s]);
        // Top (y=s)
        push_quad([0.0, s, s], [s, s, s], [s, s, 0.0], [0.0, s, 0.0]);
        // North (z=0)
        push_quad([s, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, s, 0.0], [s, s, 0.0]);
        // South (z=s)
        push_quad([0.0, 0.0, s], [s, 0.0, s], [s, s, s], [0.0, s, s]);
        // West (x=0)
        push_quad([0.0, 0.0, s], [0.0, s, s], [0.0, s, 0.0], [0.0, 0.0, 0.0]);
        // East (x=s)
        push_quad([s, 0.0, 0.0], [s, 0.0, s], [s, s, s], [s, s, 0.0]);
        let vertex_count = positions.len();
        Mesh {
            positions,
            colors,
            uvs,
            texture: None,
            textures: vec![],
            texture_index: vec![0; vertex_count],
            layers: vec![0; vertex_count],
            indices,
        }
    }

    #[test]
    fn large_hollow_shell_does_not_solid_fill_grid() {
        let mesh = hollow_box_shell_mesh(10.0);
        let grid = voxelize_mesh(&mesh, 64, 64, 64, VoxelFit::Stretch, false, false).unwrap();
        let occupied = grid.occupied_count();
        let total = grid.volume();
        assert!(
            occupied * 4 < total,
            "hollow shell at statue scale must stay a thin surface, occupied={occupied} total={total}"
        );
    }

    #[test]
    fn hollow_flag_keeps_entity_shell_surface_only() {
        let mesh = hollow_box_shell_mesh(10.0);
        let grid = voxelize_mesh(&mesh, 64, 64, 64, VoxelFit::Stretch, true, false).unwrap();
        let occupied = grid.occupied_count();
        let total = grid.volume();
        assert!(
            occupied * 4 < total,
            "hollow mesh path must not fill interior, occupied={occupied} total={total}"
        );
    }
}
