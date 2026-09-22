use super::voxelize::VoxelGrid;
use anyhow::{ensure, Context, Result};
use image::RgbaImage;

/// Extra voxels around the base model so hat pixels can protrude in 3D.
/// Modelbench steve/alex templates: hat inflate 0.5 → 1 voxel; body/limb
/// overlays use a unit-scaled shell (flush at 1×, ~2 voxels at 2× statues).
const OUTER_MARGIN: i32 = 1;

/// Vanilla player-skin UV layout width. HD skins are integer multiples of this.
const SKIN_LAYOUT_W: u32 = 64;
/// Decode / GPU safety rail — 8192² RGBA is 256 MB. Not a Minecraft format rule.
const SKIN_MAX_EDGE: u32 = 8192;

const SKIN_LAYOUT_HINT: &str =
    "player skins must be 64×64 or 64×32, or an HD integer scale of that layout";

/// Texels per vanilla UV unit, and whether this is a pre-1.8 2:1 sheet.
pub fn skin_atlas(width: u32, height: u32) -> Result<(u32, bool)> {
    ensure!(
        width >= SKIN_LAYOUT_W && width % SKIN_LAYOUT_W == 0,
        "{SKIN_LAYOUT_HINT}"
    );
    let scale = width / SKIN_LAYOUT_W;
    ensure!(scale >= 1, "{SKIN_LAYOUT_HINT}");
    let legacy = height * 2 == width;
    let modern = height == width;
    ensure!(modern || legacy, "{SKIN_LAYOUT_HINT}");
    ensure!(
        width <= SKIN_MAX_EDGE && height <= SKIN_MAX_EDGE,
        "{width}×{height} skin is too large to load (max {SKIN_MAX_EDGE}×{SKIN_MAX_EDGE})"
    );
    Ok((scale, legacy))
}

/// Rest-pose statue size at 1 voxel per vanilla skin pixel (including overlay margin).
pub fn native_skin_grid_size(slim_arms: bool, skeleton_limbs: bool) -> (u32, u32, u32) {
    let arm_w = if skeleton_limbs {
        2_u32
    } else if slim_arms {
        3
    } else {
        4
    };
    let m = OUTER_MARGIN as u32;
    (arm_w + 8 + arm_w + m * 2, 32 + m * 2, 8 + m * 2)
}

const CAPE_LAYOUT_W: u32 = 64;
const CAPE_LAYOUT_H: u32 = 32;
const CAPE_LAYOUT_HINT: &str =
    "capes must be 64×32, or an HD integer scale of that layout (square PNGs are ok)";

/// Texels per vanilla cape UV unit. Square sheets are padded 64×32 layouts.
pub fn cape_atlas(width: u32, height: u32) -> Result<u32> {
    ensure!(
        width >= CAPE_LAYOUT_W && width % CAPE_LAYOUT_W == 0,
        "{CAPE_LAYOUT_HINT}"
    );
    let scale = width / CAPE_LAYOUT_W;
    ensure!(scale >= 1, "{CAPE_LAYOUT_HINT}");
    let classic = height == CAPE_LAYOUT_H * scale;
    let square = height == width;
    ensure!(classic || square, "{CAPE_LAYOUT_HINT}");
    ensure!(
        width <= SKIN_MAX_EDGE && height <= SKIN_MAX_EDGE,
        "{width}×{height} cape is too large to load (max {SKIN_MAX_EDGE})"
    );
    Ok(scale)
}

/// Modelbench default player hat inflate (steve/alex.mbtemplate).
const HAT_INFLATE: f32 = 0.5;

/// Native Minecraft player statue proportions in skin pixels (1 pixel = 1 voxel),
/// including margin for the extruded hat shell.
///
/// When `outer_3d` is true, opaque overlay texels (hat / jacket / sleeves /
/// pants) are extruded outward like the 3D Skin Layers mod — extra voxels
/// on the surface, not a hollow inflated cube around each limb.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SkinOuterMode {
    None,
    Hat,
    Full,
}

impl SkinOuterMode {
    pub fn from_options(outer_3d: bool, overlay: Option<&str>) -> Self {
        match overlay {
            Some("none") => Self::None,
            Some("hat") => Self::Hat,
            Some("full") => {
                if outer_3d {
                    Self::Full
                } else {
                    Self::None
                }
            }
            _ => {
                if outer_3d {
                    Self::Full
                } else {
                    Self::None
                }
            }
        }
    }
}

#[cfg(test)]
pub fn skin_to_voxels(data: &[u8], slim_arms: bool, outer_3d: bool) -> Result<VoxelGrid> {
    skin_to_voxels_ex(data, slim_arms, outer_3d, false)
}

#[cfg(test)]
pub fn skin_to_voxels_ex(
    data: &[u8],
    slim_arms: bool,
    outer_3d: bool,
    skeleton_limbs: bool,
) -> Result<VoxelGrid> {
    skin_to_voxels_at_unit(data, slim_arms, outer_3d, skeleton_limbs, 1)
}

pub fn skin_to_voxels_at_unit(
    data: &[u8],
    slim_arms: bool,
    outer_3d: bool,
    skeleton_limbs: bool,
    voxel_unit: u32,
) -> Result<VoxelGrid> {
    let image = image::load_from_memory(data)
        .context("failed to decode skin PNG")?
        .into_rgba8();
    let (scale, legacy) = skin_atlas(image.width(), image.height())?;
    let unit = voxel_unit.max(1) as i32;
    let limb_w = if skeleton_limbs {
        2_i32
    } else if slim_arms {
        3_i32
    } else {
        4_i32
    };
    let arm_w = limb_w * unit;
    let arm_d = (if skeleton_limbs { 2_i32 } else { 4_i32 }) * unit;
    let leg_w = (if skeleton_limbs { 2_i32 } else { 4_i32 }) * unit;
    let leg_d = (if skeleton_limbs { 2_i32 } else { 4_i32 }) * unit;
    let m = OUTER_MARGIN * unit;
    // Base player bounds + margin on every side for extruded overlays.
    let grid_w = (arm_w + 8 * unit + arm_w + m * 2) as u32;
    let grid_h = (32 * unit + m * 2) as u32;
    let grid_d = (8 * unit + m * 2) as u32;
    let mut grid = empty_grid(grid_w, grid_h, grid_d);

    // Origins are the minimum corner of each base box (already shifted by margin).
    // Minecraft / Mine-imator: character's right = −X, left = +X (facing −Z).
    let body_x = arm_w + m;
    let head_x = arm_w + m;
    let right_arm_x = m;
    let left_arm_x = arm_w + 8 * unit + m;
    let right_leg_x = arm_w + m;
    let left_leg_x = arm_w + leg_w + m;
    let body_y = 12 * unit + m;
    let head_y = 24 * unit + m;
    let limb_z = 2 * unit + m;
    let head_z = m;

    let head = Cuboid {
        x: head_x,
        y: head_y,
        z: head_z,
        w: 8 * unit,
        h: 8 * unit,
        d: 8 * unit,
    };
    paint_box(
        &mut grid,
        &image,
        scale,
        head,
        FaceUvs {
            right: uv(0, 8, 8, 8),
            front: uv(8, 8, 8, 8),
            left: uv(16, 8, 8, 8),
            back: uv(24, 8, 8, 8),
            top: uv(8, 0, 8, 8),
            bottom: uv(16, 0, 8, 8),
        },
    );

    let body = Cuboid {
        x: body_x,
        y: body_y,
        z: limb_z,
        w: 8 * unit,
        h: 12 * unit,
        d: 4 * unit,
    };
    paint_box(
        &mut grid,
        &image,
        scale,
        body,
        FaceUvs {
            right: uv(16, 20, 4, 12),
            front: uv(20, 20, 8, 12),
            left: uv(28, 20, 4, 12),
            back: uv(32, 20, 8, 12),
            top: uv(20, 16, 8, 4),
            bottom: uv(28, 16, 8, 4),
        },
    );

    let limb_z = if skeleton_limbs { 3 * unit + m } else { 2 * unit + m };
    let right_arm_uv = if skeleton_limbs {
        FaceUvs {
            right: uv(40, 18, 2, 12),
            front: uv(42, 18, 2, 12),
            left: uv(44, 18, 2, 12),
            back: uv(46, 18, 2, 12),
            top: uv(42, 16, 2, 2),
            bottom: uv(44, 16, 2, 2),
        }
    } else if slim_arms {
        FaceUvs {
            right: uv(40, 20, 4, 12),
            front: uv(44, 20, 3, 12),
            left: uv(47, 20, 4, 12),
            back: uv(51, 20, 3, 12),
            top: uv(44, 16, 3, 4),
            bottom: uv(47, 16, 3, 4),
        }
    } else {
        FaceUvs {
            right: uv(40, 20, 4, 12),
            front: uv(44, 20, 4, 12),
            left: uv(48, 20, 4, 12),
            back: uv(52, 20, 4, 12),
            top: uv(44, 16, 4, 4),
            bottom: uv(48, 16, 4, 4),
        }
    };
    let right_arm = Cuboid {
        x: right_arm_x,
        y: body_y,
        z: limb_z,
        w: arm_w,
        h: 12 * unit,
        d: arm_d,
    };
    paint_box(&mut grid, &image, scale, right_arm, right_arm_uv);

    let left_arm_uv = if legacy || skeleton_limbs {
        mirror_arm_uvs(right_arm_uv, slim_arms)
    } else if slim_arms {
        FaceUvs {
            right: uv(32, 52, 4, 12),
            front: uv(36, 52, 3, 12),
            left: uv(39, 52, 4, 12),
            back: uv(43, 52, 3, 12),
            top: uv(36, 48, 3, 4),
            bottom: uv(39, 48, 3, 4),
        }
    } else {
        FaceUvs {
            right: uv(32, 52, 4, 12),
            front: uv(36, 52, 4, 12),
            left: uv(40, 52, 4, 12),
            back: uv(44, 52, 4, 12),
            top: uv(36, 48, 4, 4),
            bottom: uv(40, 48, 4, 4),
        }
    };
    let left_arm = Cuboid {
        x: left_arm_x,
        y: body_y,
        z: limb_z,
        w: arm_w,
        h: 12 * unit,
        d: arm_d,
    };
    paint_box(&mut grid, &image, scale, left_arm, left_arm_uv);

    let right_leg_uv = if skeleton_limbs {
        FaceUvs {
            right: uv(0, 18, 2, 12),
            front: uv(2, 18, 2, 12),
            left: uv(4, 18, 2, 12),
            back: uv(6, 18, 2, 12),
            top: uv(2, 16, 2, 2),
            bottom: uv(4, 16, 2, 2),
        }
    } else {
        FaceUvs {
            right: uv(0, 20, 4, 12),
            front: uv(4, 20, 4, 12),
            left: uv(8, 20, 4, 12),
            back: uv(12, 20, 4, 12),
            top: uv(4, 16, 4, 4),
            bottom: uv(8, 16, 4, 4),
        }
    };
    let right_leg = Cuboid {
        x: right_leg_x,
        y: m,
        z: limb_z,
        w: leg_w,
        h: 12 * unit,
        d: leg_d,
    };
    paint_box(&mut grid, &image, scale, right_leg, right_leg_uv);

    let left_leg_uv = if legacy || skeleton_limbs {
        mirror_leg_uvs(right_leg_uv)
    } else {
        FaceUvs {
            right: uv(16, 52, 4, 12),
            front: uv(20, 52, 4, 12),
            left: uv(24, 52, 4, 12),
            back: uv(28, 52, 4, 12),
            top: uv(20, 48, 4, 4),
            bottom: uv(24, 48, 4, 4),
        }
    };
    let left_leg = Cuboid {
        x: left_leg_x,
        y: m,
        z: limb_z,
        w: leg_w,
        h: 12 * unit,
        d: leg_d,
    };
    paint_box(&mut grid, &image, scale, left_leg, left_leg_uv);

    // 3D Skin Layers: extrude opaque overlay pixels, don't wrap a hollow shell.
    if outer_3d {
        paint_skin_outer_layers_ex(
            &mut grid,
            &image,
            slim_arms,
            voxel_unit.max(1),
            SkinOuterMode::Full,
            skeleton_limbs,
        );
    }

    ensure!(
        grid.occupied_count() > 0,
        "skin produced an empty statue; check that the PNG is a valid player skin"
    );
    Ok(grid)
}

/// Vanilla cape: 10×16×1 box at texOffs(0,0), hanging from the neck behind the body.
pub fn paint_cape_on_grid(
    grid: &mut VoxelGrid,
    image: &RgbaImage,
    slim_arms: bool,
    voxel_unit: u32,
    skeleton_limbs: bool,
    behind_overlay: bool,
) -> Result<()> {
    let scale = cape_atlas(image.width(), image.height())?;
    let unit = voxel_unit.max(1) as i32;
    let arm_w = if skeleton_limbs {
        2_i32
    } else if slim_arms {
        3_i32
    } else {
        4_i32
    } * unit;
    let m = OUTER_MARGIN * unit;
    let body_x = arm_w + m;
    let limb_z = 2 * unit + m;
    let outer = if behind_overlay {
        limb_overlay_expand(voxel_unit.max(1))
    } else {
        0
    };
    let cape_d = unit;
    let cape_w = 10 * unit;
    let cape_h = 16 * unit;
    let cape_x = body_x - unit;
    let cape_y = 8 * unit + m;
    let mut cape_z = limb_z - outer - cape_d;
    if cape_z < 0 {
        cape_z = 0;
    }
    let box_ = Cuboid {
        x: cape_x,
        y: cape_y,
        z: cape_z,
        w: cape_w,
        h: cape_h,
        d: cape_d,
    };
    // +Z faces the body (inside, UV 12,1); −Z is the design people see (UV 1,1).
    let uvs = FaceUvs {
        right: uv(11, 1, 1, 16),
        front: uv(12, 1, 10, 16),
        left: uv(0, 1, 1, 16),
        back: uv(1, 1, 10, 16),
        top: uv(1, 0, 10, 1),
        bottom: uv(11, 0, 10, 1),
    };
    paint_faces(grid, image, scale, box_, uvs);
    // 1-voxel-thick capes share front/back cells — keep the outside design.
    if box_.d <= 1 {
        for dy in 0..box_.h {
            for dx in 0..box_.w {
                if let Some(rgb) = sample(
                    image,
                    scale,
                    uvs.back,
                    dx as u32,
                    dy as u32,
                    box_.w as u32,
                    box_.h as u32,
                    true,
                ) {
                    set_cell(
                        grid,
                        box_.x + dx,
                        box_.y + (box_.h - 1 - dy),
                        box_.z,
                        rgb,
                    );
                }
            }
        }
    }
    Ok(())
}

/// Extrude the second skin layer on a grid already scaled to `voxel_unit`
/// voxels per skin pixel. Opaque overlay texels become extra voxels just
/// outside the matching inner face (3D Skin Layers), not a hollow box.
pub fn paint_skin_outer_layers_ex(
    grid: &mut VoxelGrid,
    image: &RgbaImage,
    slim_arms: bool,
    voxel_unit: u32,
    overlay: SkinOuterMode,
    skeleton_limbs: bool,
) {
    if overlay == SkinOuterMode::None {
        return;
    }
    let Ok((scale, legacy)) = skin_atlas(image.width(), image.height()) else {
        return;
    };
    let hat_only = overlay == SkinOuterMode::Hat || legacy;
    let unit = voxel_unit.max(1) as i32;
    let arm_w = if skeleton_limbs {
        2 * unit
    } else if slim_arms {
        3 * unit
    } else {
        4 * unit
    };
    let m = OUTER_MARGIN * unit;
    let body_x = arm_w + m;
    let head_x = arm_w + m;
    let right_arm_x = m;
    let left_arm_x = arm_w + 8 * unit + m;
    let right_leg_x = arm_w + m;
    let left_leg_x = arm_w + 4 * unit + m;
    let body_y = 12 * unit + m;
    let head_y = 24 * unit + m;
    let limb_z = 2 * unit + m;
    let head_z = m;

    let hat_expand = inflate_voxels(HAT_INFLATE, voxel_unit.max(1));
    let limb_expand = limb_overlay_expand(voxel_unit.max(1));

    let head = Cuboid {
        x: head_x,
        y: head_y,
        z: head_z,
        w: 8 * unit,
        h: 8 * unit,
        d: 8 * unit,
    };
    extrude_overlay(
        grid,
        image,
        scale,
        head,
        FaceUvs {
            right: uv(32, 8, 8, 8),
            front: uv(40, 8, 8, 8),
            left: uv(48, 8, 8, 8),
            back: uv(56, 8, 8, 8),
            top: uv(40, 0, 8, 8),
            bottom: uv(48, 0, 8, 8),
        },
        hat_expand,
    );

    if hat_only {
        return;
    }

    let body = Cuboid {
        x: body_x,
        y: body_y,
        z: limb_z,
        w: 8 * unit,
        h: 12 * unit,
        d: 4 * unit,
    };
    extrude_overlay(
        grid,
        image,
        scale,
        body,
        FaceUvs {
            right: uv(16, 36, 4, 12),
            front: uv(20, 36, 8, 12),
            left: uv(28, 36, 4, 12),
            back: uv(32, 36, 8, 12),
            top: uv(20, 32, 8, 4),
            bottom: uv(28, 32, 8, 4),
        },
        limb_expand,
    );

    let right_arm = Cuboid {
        x: right_arm_x,
        y: body_y,
        z: limb_z,
        w: arm_w,
        h: 12 * unit,
        d: 4 * unit,
    };
    let left_arm = Cuboid {
        x: left_arm_x,
        y: body_y,
        z: limb_z,
        w: arm_w,
        h: 12 * unit,
        d: 4 * unit,
    };
    paint_arm_outers(grid, image, scale, slim_arms, right_arm, left_arm, limb_expand);

    let right_leg = Cuboid {
        x: right_leg_x,
        y: m,
        z: limb_z,
        w: 4 * unit,
        h: 12 * unit,
        d: 4 * unit,
    };
    let left_leg = Cuboid {
        x: left_leg_x,
        y: m,
        z: limb_z,
        w: 4 * unit,
        h: 12 * unit,
        d: 4 * unit,
    };
    paint_leg_outers(grid, image, scale, right_leg, left_leg, limb_expand);
}

fn inflate_voxels(inflate: f32, unit: u32) -> i32 {
    // 3D Skin Layers: at least 1 voxel so overlay details read at native size.
    (inflate * unit as f32).round().max(1.0) as i32
}

/// How far overlay pixels extrude from the inner surface (pose claim padding).
pub fn limb_overlay_expand(voxel_unit: u32) -> i32 {
    inflate_voxels(0.25, voxel_unit)
}

fn paint_arm_outers(
    grid: &mut VoxelGrid,
    image: &RgbaImage,
    scale: u32,
    slim: bool,
    right_arm: Cuboid,
    left_arm: Cuboid,
    expand: i32,
) {
    let right = if slim {
        FaceUvs {
            right: uv(40, 36, 4, 12),
            front: uv(44, 36, 3, 12),
            left: uv(47, 36, 4, 12),
            back: uv(51, 36, 3, 12),
            top: uv(44, 32, 3, 4),
            bottom: uv(47, 32, 3, 4),
        }
    } else {
        FaceUvs {
            right: uv(40, 36, 4, 12),
            front: uv(44, 36, 4, 12),
            left: uv(48, 36, 4, 12),
            back: uv(52, 36, 4, 12),
            top: uv(44, 32, 4, 4),
            bottom: uv(48, 32, 4, 4),
        }
    };
    extrude_overlay(grid, image, scale, right_arm, right, expand);

    let left = if slim {
        FaceUvs {
            right: uv(48, 52, 4, 12),
            front: uv(52, 52, 3, 12),
            left: uv(55, 52, 4, 12),
            back: uv(59, 52, 3, 12),
            top: uv(52, 48, 3, 4),
            bottom: uv(55, 48, 3, 4),
        }
    } else {
        FaceUvs {
            right: uv(48, 52, 4, 12),
            front: uv(52, 52, 4, 12),
            left: uv(56, 52, 4, 12),
            back: uv(60, 52, 4, 12),
            top: uv(52, 48, 4, 4),
            bottom: uv(56, 48, 4, 4),
        }
    };
    extrude_overlay(grid, image, scale, left_arm, left, expand);
}

fn paint_leg_outers(
    grid: &mut VoxelGrid,
    image: &RgbaImage,
    scale: u32,
    right_leg: Cuboid,
    left_leg: Cuboid,
    expand: i32,
) {
    extrude_overlay(
        grid,
        image,
        scale,
        right_leg,
        FaceUvs {
            right: uv(0, 36, 4, 12),
            front: uv(4, 36, 4, 12),
            left: uv(8, 36, 4, 12),
            back: uv(12, 36, 4, 12),
            top: uv(4, 32, 4, 4),
            bottom: uv(8, 32, 4, 4),
        },
        expand,
    );
    extrude_overlay(
        grid,
        image,
        scale,
        left_leg,
        FaceUvs {
            right: uv(0, 52, 4, 12),
            front: uv(4, 52, 4, 12),
            left: uv(8, 52, 4, 12),
            back: uv(12, 52, 4, 12),
            top: uv(4, 48, 4, 4),
            bottom: uv(8, 48, 4, 4),
        },
        expand,
    );
}

#[derive(Clone, Copy)]
struct Cuboid {
    x: i32,
    y: i32,
    z: i32,
    w: i32,
    h: i32,
    d: i32,
}

#[derive(Clone, Copy)]
struct UvRect {
    u: u32,
    v: u32,
    w: u32,
    h: u32,
}

#[derive(Clone, Copy)]
struct FaceUvs {
    right: UvRect,
    front: UvRect,
    left: UvRect,
    back: UvRect,
    top: UvRect,
    bottom: UvRect,
}

fn uv(u: u32, v: u32, w: u32, h: u32) -> UvRect {
    UvRect { u, v, w, h }
}

fn mirror_arm_uvs(right: FaceUvs, slim: bool) -> FaceUvs {
    let front_w = if slim { 3 } else { 4 };
    FaceUvs {
        right: right.left,
        left: right.right,
        front: UvRect {
            u: right.front.u,
            v: right.front.v,
            w: front_w,
            h: 12,
        },
        back: UvRect {
            u: right.back.u,
            v: right.back.v,
            w: front_w,
            h: 12,
        },
        top: UvRect {
            u: right.top.u,
            v: right.top.v,
            w: front_w,
            h: 4,
        },
        bottom: UvRect {
            u: right.bottom.u,
            v: right.bottom.v,
            w: front_w,
            h: 4,
        },
    }
}

fn mirror_leg_uvs(right: FaceUvs) -> FaceUvs {
    FaceUvs {
        right: right.left,
        left: right.right,
        front: right.front,
        back: right.back,
        top: right.top,
        bottom: right.bottom,
    }
}

fn empty_grid(width: u32, height: u32, length: u32) -> VoxelGrid {
    VoxelGrid::empty(width, height, length)
}

fn paint_box(grid: &mut VoxelGrid, image: &RgbaImage, scale: u32, box_: Cuboid, uvs: FaceUvs) {
    // Faces first with real skin colours, then fill the solid interior from those
    // surfaces. (A flat grey fill used to dominate upscaled statues and wreck matching.)
    paint_faces(grid, image, scale, box_, uvs);
    fill_interior_from_surface(grid, box_);
}

/// Flood each interior cell with the colour of the nearest painted face voxel.
fn fill_interior_from_surface(grid: &mut VoxelGrid, box_: Cuboid) {
    if box_.w <= 2 || box_.h <= 2 || box_.d <= 2 {
        return;
    }
    let mut surface: Vec<(i32, i32, i32, [u8; 3])> = Vec::new();
    for dy in 0..box_.h {
        for dz in 0..box_.d {
            for dx in 0..box_.w {
                let on_face = dx == 0
                    || dy == 0
                    || dz == 0
                    || dx == box_.w - 1
                    || dy == box_.h - 1
                    || dz == box_.d - 1;
                if !on_face {
                    continue;
                }
                let Some(rgb) = grid.rgb_at(
                    (box_.x + dx) as u32,
                    (box_.y + dy) as u32,
                    (box_.z + dz) as u32,
                ) else {
                    continue;
                };
                surface.push((dx, dy, dz, rgb));
            }
        }
    }
    if surface.is_empty() {
        return;
    }
    for dy in 1..box_.h - 1 {
        for dz in 1..box_.d - 1 {
            for dx in 1..box_.w - 1 {
                let mut best = surface[0].3;
                let mut best_d = i32::MAX;
                for &(sx, sy, sz, rgb) in &surface {
                    let dist = (dx - sx).abs() + (dy - sy).abs() + (dz - sz).abs();
                    if dist < best_d {
                        best_d = dist;
                        best = rgb;
                    }
                }
                set_cell(
                    grid,
                    box_.x + dx,
                    box_.y + dy,
                    box_.z + dz,
                    [best[0] as f32, best[1] as f32, best[2] as f32],
                );
            }
        }
    }
}

/// Extrude opaque overlay texels along each face normal (3D Skin Layers).
fn extrude_overlay(
    grid: &mut VoxelGrid,
    image: &RgbaImage,
    scale: u32,
    box_: Cuboid,
    uvs: FaceUvs,
    expand: i32,
) {
    let e = expand.max(1);
    let fy = |ty: i32| box_.h - 1 - ty;
    for ty in 0..box_.h {
        for tx in 0..box_.w {
            if let Some(rgb) = sample(
                image,
                scale,
                uvs.front,
                tx as u32,
                ty as u32,
                box_.w as u32,
                box_.h as u32,
                false,
            ) {
                for k in 1..=e {
                    set_cell(grid, box_.x + tx, box_.y + fy(ty), box_.z + box_.d - 1 + k, rgb);
                }
            }
            if let Some(rgb) = sample(
                image,
                scale,
                uvs.back,
                tx as u32,
                ty as u32,
                box_.w as u32,
                box_.h as u32,
                true,
            ) {
                for k in 1..=e {
                    set_cell(grid, box_.x + tx, box_.y + fy(ty), box_.z - k, rgb);
                }
            }
        }
    }
    for ty in 0..box_.h {
        for tz in 0..box_.d {
            if let Some(rgb) = sample(
                image,
                scale,
                uvs.right,
                tz as u32,
                ty as u32,
                box_.d as u32,
                box_.h as u32,
                false,
            ) {
                for k in 1..=e {
                    set_cell(grid, box_.x - k, box_.y + fy(ty), box_.z + tz, rgb);
                }
            }
            if let Some(rgb) = sample(
                image,
                scale,
                uvs.left,
                tz as u32,
                ty as u32,
                box_.d as u32,
                box_.h as u32,
                true,
            ) {
                for k in 1..=e {
                    set_cell(grid, box_.x + box_.w - 1 + k, box_.y + fy(ty), box_.z + tz, rgb);
                }
            }
        }
    }
    for tz in 0..box_.d {
        for tx in 0..box_.w {
            if let Some(rgb) = sample(
                image,
                scale,
                uvs.top,
                tx as u32,
                tz as u32,
                box_.w as u32,
                box_.d as u32,
                false,
            ) {
                for k in 1..=e {
                    set_cell(grid, box_.x + tx, box_.y + box_.h - 1 + k, box_.z + tz, rgb);
                }
            }
            if let Some(rgb) = sample(
                image,
                scale,
                uvs.bottom,
                tx as u32,
                tz as u32,
                box_.w as u32,
                box_.d as u32,
                false,
            ) {
                for k in 1..=e {
                    set_cell(grid, box_.x + tx, box_.y - k, box_.z + tz, rgb);
                }
            }
        }
    }
}

fn paint_faces(grid: &mut VoxelGrid, image: &RgbaImage, scale: u32, box_: Cuboid, uvs: FaceUvs) {
    // Top/bottom first. Front last so the 8×8 face (eyebrows, chin) is not
    // overwritten by scalp/neck on the shared edges — that was a 1px-off head.
    let stamp = |grid: &mut VoxelGrid,
                  rect: UvRect,
                  lx: i32,
                  ly: i32,
                  face_w: i32,
                  face_h: i32,
                  mirror: bool,
                  x: i32,
                  y: i32,
                  z: i32| {
        if let Some(rgb) = sample(
            image,
            scale,
            rect,
            lx as u32,
            ly as u32,
            face_w as u32,
            face_h as u32,
            mirror,
        ) {
            set_cell(grid, x, y, z, rgb);
        }
    };

    for dz in 0..box_.d {
        for dx in 0..box_.w {
            stamp(
                grid,
                uvs.top,
                dx,
                dz,
                box_.w,
                box_.d,
                false,
                box_.x + dx,
                box_.y + box_.h - 1,
                box_.z + dz,
            );
            stamp(
                grid,
                uvs.bottom,
                dx,
                dz,
                box_.w,
                box_.d,
                false,
                box_.x + dx,
                box_.y,
                box_.z + dz,
            );
        }
    }
    for dy in 0..box_.h {
        for dz in 0..box_.d {
            stamp(
                grid,
                uvs.right,
                dz,
                dy,
                box_.d,
                box_.h,
                false,
                box_.x,
                box_.y + (box_.h - 1 - dy),
                box_.z + dz,
            );
            stamp(
                grid,
                uvs.left,
                dz,
                dy,
                box_.d,
                box_.h,
                true,
                box_.x + box_.w - 1,
                box_.y + (box_.h - 1 - dy),
                box_.z + dz,
            );
        }
    }
    for dy in 0..box_.h {
        for dx in 0..box_.w {
            stamp(
                grid,
                uvs.back,
                dx,
                dy,
                box_.w,
                box_.h,
                true,
                box_.x + dx,
                box_.y + (box_.h - 1 - dy),
                box_.z,
            );
            stamp(
                grid,
                uvs.front,
                dx,
                dy,
                box_.w,
                box_.h,
                false,
                box_.x + dx,
                box_.y + (box_.h - 1 - dy),
                box_.z + box_.d - 1,
            );
        }
    }
}

fn sample(
    image: &RgbaImage,
    scale: u32,
    rect: UvRect,
    local_x: u32,
    local_y: u32,
    face_w: u32,
    face_h: u32,
    mirror_x: bool,
) -> Option<[f32; 3]> {
    if rect.w == 0 || rect.h == 0 || face_w == 0 || face_h == 0 {
        return None;
    }
    let fx = if mirror_x {
        face_w - 1 - local_x.min(face_w - 1)
    } else {
        local_x.min(face_w - 1)
    };
    let fy = local_y.min(face_h - 1);
    // Centre of this voxel's span in vanilla UV space, then into PNG pixels.
    // Integer `u * scale` snapped to the top-left of each layout cell, so HD
    // shirt pixels inside a cell (and extra voxels on 2×/4× statues) vanished.
    let u = rect.u as f32 + (fx as f32 + 0.5) * (rect.w as f32) / (face_w as f32);
    let v = rect.v as f32 + (fy as f32 + 0.5) * (rect.h as f32) / (face_h as f32);
    let max_x = image.width().saturating_sub(1) as f32;
    let max_y = image.height().saturating_sub(1) as f32;
    let px = (u * scale as f32).floor().clamp(0.0, max_x) as u32;
    let py = (v * scale as f32).floor().clamp(0.0, max_y) as u32;
    let pixel = image.get_pixel(px, py).0;
    if pixel[3] < 16 {
        return None;
    }
    Some([pixel[0] as f32, pixel[1] as f32, pixel[2] as f32])
}

fn set_cell(grid: &mut VoxelGrid, x: i32, y: i32, z: i32, color: [f32; 3]) {
    if x < 0 || y < 0 || z < 0 {
        return;
    }
    let (x, y, z) = (x as u32, y as u32, z as u32);
    if x >= grid.width || y >= grid.height || z >= grid.length {
        return;
    }
    grid.put_rgb(x, y, z, color);
}

#[cfg(test)]
pub fn validate_skin_bytes(data: &[u8]) -> Result<()> {
    let image = image::load_from_memory(data).context("failed to decode skin PNG")?;
    skin_atlas(image.width(), image.height())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn solid_skin(width: u32, height: u32) -> Vec<u8> {
        let mut image = RgbaImage::from_pixel(width, height, Rgba([200, 100, 50, 255]));
        image.put_pixel(0, 0, Rgba([0, 0, 0, 0]));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn hat_skin() -> Vec<u8> {
        let mut image = RgbaImage::from_pixel(64, 64, Rgba([200, 100, 50, 255]));
        // Transparent second layer by default…
        for y in 0..16 {
            for x in 32..64 {
                image.put_pixel(x, y, Rgba([0, 0, 0, 0]));
            }
        }
        // …except an opaque hat top + front so extrusion is measurable.
        for y in 0..8 {
            for x in 40..48 {
                image.put_pixel(x, y, Rgba([20, 180, 40, 255])); // hat top
            }
        }
        for y in 8..16 {
            for x in 40..48 {
                image.put_pixel(x, y, Rgba([20, 180, 40, 255])); // hat front
            }
        }
        let mut bytes = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn encode_png(image: &RgbaImage) -> Vec<u8> {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    /// HD skin whose RGB encodes the vanilla 64-space UV of each texel.
    fn scaled_coordinate_skin(scale: u32) -> Vec<u8> {
        let w = 64 * scale;
        let mut image = RgbaImage::new(w, w);
        for y in 0..w {
            for x in 0..w {
                image.put_pixel(
                    x,
                    y,
                    Rgba([(x / scale) as u8, (y / scale) as u8, 90, 255]),
                );
            }
        }
        encode_png(&image)
    }

    /// Unique RGB per texel so we can assert 1:1 UV → voxel mapping.
    fn coordinate_skin() -> Vec<u8> {
        let mut image = RgbaImage::new(64, 64);
        for y in 0..64 {
            for x in 0..64 {
                image.put_pixel(x, y, Rgba([x as u8, y as u8, 90, 255]));
            }
        }
        encode_png(&image)
    }

    fn expect_pixel(grid: &VoxelGrid, x: u32, y: u32, z: u32, u: u8, v: u8, label: &str) {
        let rgb = grid
            .rgb_at(x, y, z)
            .unwrap_or_else(|| panic!("{label}: empty voxel at ({x},{y},{z})"));
        assert_eq!(
            (rgb[0], rgb[1]),
            (u, v),
            "{label}: voxel ({x},{y},{z}) mapped to UV ({},{}), want ({u},{v})",
            rgb[0],
            rgb[1]
        );
    }

    #[test]
    fn head_and_body_uvs_match_vanilla_layout() {
        // No overlay — inner faces only, 1 voxel per skin pixel.
        let grid = skin_to_voxels(&coordinate_skin(), false, false).unwrap();
        let m = 1_u32;
        let arm_w = 4_u32;
        let head_x = arm_w + m;
        let head_y = 24 + m;
        let head_z = m;
        let body_x = arm_w + m;
        let body_y = 12 + m;
        let limb_z = 2 + m;

        // Head front (8,8) sits on +Z, looking at the camera.
        for dy in 0..8_u32 {
            for dx in 0..8_u32 {
                expect_pixel(
                    &grid,
                    head_x + dx,
                    head_y + 7 - dy,
                    head_z + 7,
                    8 + dx as u8,
                    8 + dy as u8,
                    "head front",
                );
            }
        }
        // Head back (24,8) on −Z, mirrored in U.
        for dy in 0..8_u32 {
            for dx in 0..8_u32 {
                expect_pixel(
                    &grid,
                    head_x + dx,
                    head_y + 7 - dy,
                    head_z,
                    24 + (7 - dx) as u8,
                    8 + dy as u8,
                    "head back",
                );
            }
        }
        // Head right (0,8) on −X. Front/back columns belong to those faces.
        for dy in 1..7_u32 {
            for dz in 1..7_u32 {
                expect_pixel(
                    &grid,
                    head_x,
                    head_y + 7 - dy,
                    head_z + dz,
                    dz as u8,
                    8 + dy as u8,
                    "head right",
                );
            }
        }
        // Head left (16,8) on +X, U mirrored.
        for dy in 1..7_u32 {
            for dz in 1..7_u32 {
                expect_pixel(
                    &grid,
                    head_x + 7,
                    head_y + 7 - dy,
                    head_z + dz,
                    16 + (7 - dz) as u8,
                    8 + dy as u8,
                    "head left",
                );
            }
        }
        // Head top (8,0): interior only — edges belong to front/back/sides.
        for dz in 1..7_u32 {
            for dx in 1..7_u32 {
                expect_pixel(
                    &grid,
                    head_x + dx,
                    head_y + 7,
                    head_z + dz,
                    8 + dx as u8,
                    dz as u8,
                    "head top",
                );
            }
        }
        // Body front (20,20) 8×12 on +Z.
        for dy in 0..12_u32 {
            for dx in 0..8_u32 {
                expect_pixel(
                    &grid,
                    body_x + dx,
                    body_y + 11 - dy,
                    limb_z + 3,
                    20 + dx as u8,
                    20 + dy as u8,
                    "body front",
                );
            }
        }
        // Right arm front (44,20) 4×12 — character's right, −X.
        let right_arm_x = m;
        for dy in 0..12_u32 {
            for dx in 0..4_u32 {
                expect_pixel(
                    &grid,
                    right_arm_x + dx,
                    body_y + 11 - dy,
                    limb_z + 3,
                    44 + dx as u8,
                    20 + dy as u8,
                    "right arm front",
                );
            }
        }
        // Left arm front (36,52) 4×12 — character's left, +X.
        let left_arm_x = arm_w + 8 + m;
        for dy in 0..12_u32 {
            for dx in 0..4_u32 {
                expect_pixel(
                    &grid,
                    left_arm_x + dx,
                    body_y + 11 - dy,
                    limb_z + 3,
                    36 + dx as u8,
                    52 + dy as u8,
                    "left arm front",
                );
            }
        }
    }

    #[test]
    fn slim_arm_front_uses_three_texels() {
        let grid = skin_to_voxels(&coordinate_skin(), true, false).unwrap();
        let m = 1_u32;
        let arm_w = 3_u32;
        let body_y = 12 + m;
        let limb_z = 2 + m;
        let right_arm_x = m;
        for dy in 0..12_u32 {
            for dx in 0..3_u32 {
                expect_pixel(
                    &grid,
                    right_arm_x + dx,
                    body_y + 11 - dy,
                    limb_z + 3,
                    44 + dx as u8,
                    20 + dy as u8,
                    "slim right arm front",
                );
            }
        }
        let left_arm_x = arm_w + 8 + m;
        for dy in 0..12_u32 {
            for dx in 0..3_u32 {
                expect_pixel(
                    &grid,
                    left_arm_x + dx,
                    body_y + 11 - dy,
                    limb_z + 3,
                    36 + dx as u8,
                    52 + dy as u8,
                    "slim left arm front",
                );
            }
        }
        assert_eq!(grid.width, 16);
    }

    #[test]
    fn classic_skin_fills_expected_bounds() {
        let grid = skin_to_voxels(&solid_skin(64, 64), false, true).unwrap();
        assert_eq!((grid.width, grid.height, grid.length), (18, 34, 10));
        let occupied = grid.occupied_count();
        assert!(occupied >= 1500, "occupied={occupied}");
        assert!(grid.rgb_at(9, 29, 5).is_some()); // head center-ish (with margin)
        assert!(grid.rgb_at(9, 19, 5).is_some()); // body
        assert!(grid.rgb_at(12, 7, 5).is_some()); // left leg (+X)
        assert!(grid.rgb_at(15, 19, 5).is_some()); // left arm (+X)
    }

    #[test]
    fn slim_skin_is_narrower() {
        let classic = skin_to_voxels(&solid_skin(64, 64), false, true).unwrap();
        let slim = skin_to_voxels(&solid_skin(64, 64), true, true).unwrap();
        assert_eq!(slim.width, 16);
        assert!(slim.width < classic.width);
    }

    #[test]
    fn second_layer_hat_protrudes_outside_head() {
        let grid = skin_to_voxels(&hat_skin(), false, true).unwrap();
        // Head top is at y = 24+margin+7 = 32; extruded hat top sits at y = 33.
        assert!(
            grid.rgb_at(9, 33, 5).is_some(),
            "hat top should protrude above the head"
        );
        // Head front is at z = margin+7 = 8; extruded hat front sits at z = 9.
        assert!(
            grid.rgb_at(9, 29, 9).is_some(),
            "hat front should protrude in front of the head"
        );
        // Per-pixel extrusion does not fill the diagonal corner cube.
    }

    #[test]
    fn limb_outer_stays_flush_at_1x_like_modelbench_025() {
        // Opaque jacket front (UV 20,36 8×12) in green; body stays orange.
        let mut image = RgbaImage::from_pixel(64, 64, Rgba([200, 100, 50, 255]));
        for y in 0..16 {
            for x in 32..64 {
                image.put_pixel(x, y, Rgba([0, 0, 0, 0]));
            }
        }
        for y in 32..64 {
            for x in 0..64 {
                image.put_pixel(x, y, Rgba([0, 0, 0, 0]));
            }
        }
        for y in 36..48 {
            for x in 20..28 {
                image.put_pixel(x, y, Rgba([10, 220, 30, 255]));
            }
        }
        let mut bytes = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let grid = skin_to_voxels(&bytes.into_inner(), false, true).unwrap();
        // Inner body front stays at z=6; overlay jacket extrudes to z=7.
        let inner = grid.rgb_at(9, 20, 6).expect("body front");
        assert!(
            inner[0] > 150 && inner[1] < 150,
            "inner body should stay skin orange, got {inner:?}"
        );
        let jacket = grid.rgb_at(9, 20, 7).expect("extruded jacket");
        assert!(
            jacket[1] > 150,
            "opaque jacket overlay should extrude one voxel, got {jacket:?}"
        );
    }

    #[test]
    fn outer_3d_can_be_disabled() {
        let with = skin_to_voxels(&hat_skin(), false, true).unwrap();
        let without = skin_to_voxels(&hat_skin(), false, false).unwrap();
        assert!(with.rgb_at(9, 33, 5).is_some());
        assert!(
            without.rgb_at(9, 33, 5).is_none(),
            "hat should not extrude when 3D outer layer is off"
        );
    }

    #[test]
    fn skin_atlas_accepts_vanilla_and_hd() {
        assert_eq!(skin_atlas(64, 64).unwrap(), (1, false));
        assert_eq!(skin_atlas(64, 32).unwrap(), (1, true));
        assert_eq!(skin_atlas(128, 128).unwrap(), (2, false));
        assert_eq!(skin_atlas(128, 64).unwrap(), (2, true));
        assert_eq!(skin_atlas(192, 192).unwrap(), (3, false));
        assert_eq!(skin_atlas(256, 256).unwrap(), (4, false));
        assert_eq!(skin_atlas(256, 128).unwrap(), (4, true));
        assert_eq!(skin_atlas(512, 512).unwrap(), (8, false));
        assert_eq!(skin_atlas(1024, 1024).unwrap(), (16, false));
        assert_eq!(skin_atlas(2048, 2048).unwrap(), (32, false));
        assert_eq!(skin_atlas(2048, 1024).unwrap(), (32, true));
        assert_eq!(skin_atlas(4096, 4096).unwrap(), (64, false));
        assert_eq!(skin_atlas(8192, 8192).unwrap(), (128, false));
        assert!(skin_atlas(32, 32).is_err());
        assert!(skin_atlas(100, 100).is_err());
        assert!(skin_atlas(256, 64).is_err());
        assert!(skin_atlas(16384, 16384).is_err());
    }

    #[test]
    fn hd_256_skin_matches_64_layout_and_bounds() {
        let vanilla = skin_to_voxels(&solid_skin(64, 64), false, false).unwrap();
        let hd128 = skin_to_voxels(&solid_skin(128, 128), false, false).unwrap();
        let hd = skin_to_voxels(&solid_skin(256, 256), false, false).unwrap();
        assert_eq!(
            (vanilla.width, vanilla.height, vanilla.length),
            (hd.width, hd.height, hd.length)
        );
        assert_eq!(
            (vanilla.width, vanilla.height, vanilla.length),
            (hd128.width, hd128.height, hd128.length)
        );
        assert!(skin_to_voxels(&solid_skin(64, 32), false, false).is_ok());
        let grid = skin_to_voxels(&scaled_coordinate_skin(4), false, false).unwrap();
        let m = 1_u32;
        let head_x = 4 + m;
        let head_y = 24 + m;
        let head_z = m;
        expect_pixel(
            &grid,
            head_x,
            head_y + 7,
            head_z + 7,
            8,
            8,
            "hd head front origin",
        );
        expect_pixel(
            &grid,
            head_x + 7,
            head_y + 7,
            head_z + 7,
            15,
            8,
            "hd head front corner",
        );
    }

    #[test]
    fn hd_256_at_4x_keeps_shirt_edge_pixels() {
        // Unique colours on the first, second, and last HD columns of the body
        // front (layout 20,20 8×12 → PNG 80..112 × 80..128 at scale 4).
        let mut image = RgbaImage::from_pixel(256, 256, Rgba([200, 100, 50, 255]));
        for y in 80..128 {
            image.put_pixel(80, y, Rgba([255, 0, 0, 255]));
            image.put_pixel(81, y, Rgba([0, 255, 0, 255]));
            image.put_pixel(111, y, Rgba([0, 0, 255, 255]));
        }
        let grid = skin_to_voxels_at_unit(&encode_png(&image), false, false, false, 4).unwrap();
        let m = 4_u32;
        let arm_w = 16_u32;
        let body_x = arm_w + m;
        let body_y = 12 * 4 + m;
        let limb_z = 2 * 4 + m;
        let front_z = limb_z + 16 - 1;
        let y = body_y + 47;
        assert_eq!(
            grid.rgb_at(body_x, y, front_z),
            Some([255, 0, 0]),
            "left HD shirt column"
        );
        assert_eq!(
            grid.rgb_at(body_x + 1, y, front_z),
            Some([0, 255, 0]),
            "second HD shirt column must not collapse into the first"
        );
        assert_eq!(
            grid.rgb_at(body_x + 31, y, front_z),
            Some([0, 0, 255]),
            "right HD shirt column"
        );
        assert_eq!(native_skin_grid_size(false, false), (18, 34, 10));
        assert_eq!(native_skin_grid_size(true, false), (16, 34, 10));
    }

    fn solid_cape(width: u32, height: u32) -> Vec<u8> {
        let mut image = RgbaImage::from_pixel(width, height, Rgba([0, 0, 0, 0]));
        let scale = width / 64;
        for y in 0..(17 * scale) {
            for x in 0..(22 * scale) {
                image.put_pixel(x, y, Rgba([20, 80, 180, 255]));
            }
        }
        // Distinct outside face (1,1) 10×16 so 1-thick sampling keeps this colour.
        for y in (1 * scale)..(17 * scale) {
            for x in (1 * scale)..(11 * scale) {
                image.put_pixel(x, y, Rgba([200, 40, 40, 255]));
            }
        }
        encode_png(&image)
    }

    #[test]
    fn cape_hangs_behind_body_with_outside_colour() {
        let mut grid = skin_to_voxels(&solid_skin(64, 64), false, true).unwrap();
        let cape = image::load_from_memory(&solid_cape(64, 32))
            .unwrap()
            .into_rgba8();
        paint_cape_on_grid(&mut grid, &cape, false, 1, false, true).unwrap();
        let m = 1_i32;
        let body_x = 4 + m;
        let limb_z = 2 + m;
        let cape_z = limb_z - 1 - 1; // overlay then 1-thick cape
        let cape_x = body_x - 1;
        let rgb = grid
            .rgb_at(cape_x as u32, (8 + m + 15) as u32, cape_z as u32)
            .expect("cape voxel");
        assert!(
            rgb[0] > 150 && rgb[1] < 80,
            "outside cape face should be red, got {rgb:?}"
        );
        assert!(cape_z < limb_z);
    }

    #[test]
    fn rejects_non_skin_png_size() {
        assert!(skin_to_voxels(&solid_skin(100, 100), false, false).is_err());
        assert!(validate_skin_bytes(&solid_skin(32, 32)).is_err());
    }

    #[test]
    fn interior_uses_skin_colour_not_grey() {
        let grid = skin_to_voxels(&solid_skin(64, 64), false, false).unwrap();
        // Head interior (with margin) should match the solid skin orange, not grey fill.
        let rgb = grid.rgb_at(9, 28, 5).expect("head interior");
        assert!(
            rgb[0] > 150 && rgb[1] > 50 && rgb[1] < 150,
            "expected skin orange interior, got {rgb:?}"
        );
    }

    #[test]
    fn skin_colours_are_not_washed_white() {
        let grid = skin_to_voxels(&solid_skin(64, 64), false, true).unwrap();
        let rgb = grid.rgb_at(9, 28, 5).expect("head");
        assert!(
            rgb[0] < 250 || rgb[1] > 20,
            "skin should not collapse to pure white, got {rgb:?}"
        );
        assert_ne!(rgb, [255, 255, 255]);
    }
}
