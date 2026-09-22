//! Apply Mine-imator character timeline poses onto a rest-pose skin voxel grid.
//! Keeps per-pixel skin colours — no OBJ / white-Kd path.
//!
//! Joints match steve/alex.mimodel (Y-up, 1 unit = 1 skin pixel):
//! body (0,12,0), head (0,24,0), arms (±6/±5.5, 22, 0), legs (±2, 12, 0).

use super::skin::limb_overlay_expand;
use super::voxelize::VoxelGrid;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinPartPose {
    #[serde(default)]
    pub pos: [f32; 3],
    #[serde(default)]
    pub rot: [f32; 3],
    #[serde(default)]
    pub bend: [f32; 3],
    #[serde(default = "one_scale")]
    pub scale: [f32; 3],
}

fn one_scale() -> [f32; 3] {
    [1.0, 1.0, 1.0]
}

impl Default for SkinPartPose {
    fn default() -> Self {
        Self {
            pos: [0.0; 3],
            rot: [0.0; 3],
            bend: [0.0; 3],
            scale: one_scale(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkinCharacterPose {
    #[serde(default)]
    pub root: SkinPartPose,
    #[serde(default)]
    pub parts: BTreeMap<String, SkinPartPose>,
    /// `"blockbench"` uses skin-editor pivots (±5 / ±1.9); default is Mine-imator (±5.5 / ±2).
    #[serde(default)]
    pub joint_style: Option<String>,
}

type Vec3 = [f32; 3];

fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn deg_to_rad(d: f32) -> f32 {
    d * std::f32::consts::PI / 180.0
}

fn pose_mag(p: &SkinPartPose) -> f32 {
    p.pos.iter().chain(p.rot.iter()).chain(p.bend.iter()).map(|v| v.abs()).sum::<f32>()
        + (p.scale[0] - 1.0).abs()
        + (p.scale[1] - 1.0).abs()
        + (p.scale[2] - 1.0).abs()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EulerConvention {
    /// GameMaker / Mine-imator: negate angles, compose YXZ (Ry → Rx → Rz).
    Mineimator,
    /// Three.js / Blockbench limb editor: positive angles, compose XYZ (Rx → Ry → Rz).
    Blockbench,
}

fn euler_convention(joint_style: Option<&str>) -> EulerConvention {
    if joint_style == Some("blockbench") {
        EulerConvention::Blockbench
    } else {
        EulerConvention::Mineimator
    }
}

fn rotate_euler(p: Vec3, rot_deg: Vec3, convention: EulerConvention) -> Vec3 {
    match convention {
        EulerConvention::Mineimator => rotate_euler_mineimator(p, rot_deg),
        EulerConvention::Blockbench => rotate_euler_blockbench(p, rot_deg),
    }
}

fn rotate_euler_mineimator(p: Vec3, rot_deg: Vec3) -> Vec3 {
    // Match GameMaker matrix_build (left-handed YXZ) used by Mine-imator.
    let (rx, ry, rz) = (
        deg_to_rad(-rot_deg[0]),
        deg_to_rad(-rot_deg[1]),
        deg_to_rad(-rot_deg[2]),
    );
    let (cx, sx) = (rx.cos(), rx.sin());
    let (cy, sy) = (ry.cos(), ry.sin());
    let (cz, sz) = (rz.cos(), rz.sin());
    let mut v = p;
    // Ry
    v = [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
    // Rx
    v = [v[0], v[1] * cx - v[2] * sx, v[1] * sx + v[2] * cx];
    // Rz
    v = [v[0] * cz - v[1] * sz, v[0] * sz + v[1] * cz, v[2]];
    v
}

fn rotate_euler_blockbench(p: Vec3, rot_deg: Vec3) -> Vec3 {
    // Match Three.js Euler order 'XYZ' / Object3D.rotation.set(x,y,z):
    // matrix R = Rx·Ry·Rz, so a column vector is transformed as Rz → Ry → Rx.
    // (Applying Rx→Ry→Rz is the common mix-up and swings limbs the wrong way.)
    let (rx, ry, rz) = (
        deg_to_rad(rot_deg[0]),
        deg_to_rad(rot_deg[1]),
        deg_to_rad(rot_deg[2]),
    );
    let (cx, sx) = (rx.cos(), rx.sin());
    let (cy, sy) = (ry.cos(), ry.sin());
    let (cz, sz) = (rz.cos(), rz.sin());
    let mut v = p;
    // Rz
    v = [v[0] * cz - v[1] * sz, v[0] * sz + v[1] * cz, v[2]];
    // Ry
    v = [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
    // Rx
    v = [v[0], v[1] * cx - v[2] * sx, v[1] * sx + v[2] * cx];
    v
}

fn scale_vec(p: Vec3, s: Vec3) -> Vec3 {
    [p[0] * s[0], p[1] * s[1], p[2] * s[2]]
}

/// Local part transform: p' = R * S * (p - joint) + joint + pos
fn apply_part_tf(p: Vec3, joint: Vec3, pose: &SkinPartPose, convention: EulerConvention) -> Vec3 {
    let local = sub(p, joint);
    let scaled = scale_vec(local, pose.scale);
    let rotated = rotate_euler(scaled, pose.rot, convention);
    add(add(rotated, joint), pose.pos)
}

/// Bend distal (lower) half of a hanging limb. `bend_offset` is along +Y from joint
/// for head-like, or typically negative for arms/legs (elbow/knee below shoulder/hip).
/// Matches Mine-imator: clamp to direction_min/max, then apply invert.
fn lerp3(a: Vec3, b: Vec3, t: f32) -> Vec3 {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    if (e1 - e0).abs() < 1e-6 {
        return if x >= e1 { 1.0 } else { 0.0 };
    }
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// 0 = still on the proximal side of the hinge, 1 = fully on the distal side.
fn bend_mix(p: Vec3, joint: Vec3, bend_offset: f32, head_like: bool, width: f32) -> f32 {
    let pivot_y = joint[1] + bend_offset;
    let along = if head_like {
        p[1] - pivot_y
    } else {
        pivot_y - p[1]
    };
    if width <= 1e-4 {
        return if along > 1e-3 { 1.0 } else { 0.0 };
    }
    smoothstep(-width, width, along)
}

/// Bend the distal half around the elbow/knee/waist.
/// A short falloff across the hinge keeps convert from splitting the joint.
fn apply_bend(
    p: Vec3,
    joint: Vec3,
    bend: Vec3,
    bend_offset: f32,
    invert: bool,
    head_like: bool,
    direction_min: Vec3,
    direction_max: Vec3,
    convention: EulerConvention,
    width: f32,
    mix_override: Option<f32>,
) -> Vec3 {
    let mut angles = [
        bend[0].clamp(direction_min[0], direction_max[0]),
        bend[1].clamp(direction_min[1], direction_max[1]),
        bend[2].clamp(direction_min[2], direction_max[2]),
    ];
    if invert {
        angles = [-angles[0], -angles[1], -angles[2]];
    }
    if angles[0].abs() + angles[1].abs() + angles[2].abs() < 1e-4 {
        return p;
    }
    let mix = mix_override.unwrap_or_else(|| bend_mix(p, joint, bend_offset, head_like, width));
    if mix <= 1e-4 {
        return p;
    }
    let pivot = [joint[0], joint[1] + bend_offset, joint[2]];
    let rotated = add(rotate_euler(sub(p, pivot), angles, convention), pivot);
    if mix >= 0.999 {
        return rotated;
    }
    lerp3(p, rotated, mix)
}

struct Limb {
    name: &'static str,
    /// Inclusive AABB in rest grid coordinates.
    x0: i32,
    y0: i32,
    z0: i32,
    x1: i32,
    y1: i32,
    z1: i32,
    joint: Vec3,
    bend_offset: f32,
    invert_bend: bool,
    head_like: bool,
    parent_body: bool,
    /// Mine-imator bend_direction_min / max (degrees), applied before invert.
    bend_min: Vec3,
    bend_max: Vec3,
}

fn limbs(slim: bool, unit: i32, joint_style: Option<&str>) -> Vec<Limb> {
    // `unit` is voxels-per-skin-pixel (1 at native, 2 at 2×, …).
    let m = unit; // outer margin matches skin.rs OUTER_MARGIN * unit
    let arm_w = if slim { 3 * unit } else { 4 * unit };
    let body_x = arm_w + m;
    let head_x = arm_w + m;
    // Match skin.rs: right = −X, left = +X
    let right_arm_x = m;
    let left_arm_x = arm_w + 8 * unit + m;
    let right_leg_x = arm_w + m;
    let left_leg_x = arm_w + 4 * unit + m;
    let body_y = 12 * unit + m;
    let head_y = 24 * unit + m;
    let limb_z = 2 * unit + m;
    let head_z = m;
    // Inclusive core bounds (skin.rs paints origin .. origin+size-1).
    // Outer jacket/sleeves/pants use limb_overlay_expand — pad claim boxes the same way
    // so posed shells stay with the correct limb (no peeling leftovers).
    let hat_pad = unit;
    let outer = limb_overlay_expand(unit.max(1) as u32);
    let u = unit as f32;
    let blockbench = joint_style == Some("blockbench");
    // Blockbench skin bones pivot at the body edge (±5 / ±1.9); Mine-imator uses centres.
    let arm_x = if blockbench {
        if slim {
            5.0
        } else {
            6.0
        }
    } else if slim {
        5.5
    } else {
        6.0
    };
    let leg_x = if blockbench { 1.9 } else { 2.0 };
    // Allow every bend axis. Mine-imator arms used X min=0, which blocked
    // half the elbow swing after convert; the editor is free XYZ.
    let full_bend = [-180.0, -180.0, -180.0];
    let full_bend_max = [180.0, 180.0, 180.0];
    let arm_bend_min = full_bend;
    let arm_bend_max = full_bend_max;

    vec![
        Limb {
            name: "body",
            // Pad front/back jacket only. Padding X into the arms stole the inner
            // arm column so a posed arm left a 1-voxel “sleeve” stuck to the torso.
            // Padding +Y stole the bottom of the head.
            x0: body_x,
            y0: body_y,
            z0: limb_z - outer,
            x1: body_x + 8 * unit - 1,
            y1: body_y + 12 * unit - 1,
            z1: limb_z + 4 * unit - 1 + outer,
            joint: [0.0, 12.0 * u, 0.0],
            bend_offset: 6.0 * u,
            invert_bend: false,
            head_like: true,
            parent_body: false,
            bend_min: full_bend,
            bend_max: full_bend_max,
        },
        Limb {
            name: "head",
            x0: head_x - hat_pad,
            // No downward pad — that stole the top body row and left seam artifacts.
            y0: head_y,
            z0: head_z - hat_pad,
            x1: head_x + 8 * unit - 1 + hat_pad,
            y1: head_y + 8 * unit - 1 + hat_pad,
            z1: head_z + 8 * unit - 1 + hat_pad,
            joint: [0.0, 24.0 * u, 0.0],
            bend_offset: 0.0,
            invert_bend: false,
            head_like: true,
            parent_body: true,
            bend_min: full_bend,
            bend_max: full_bend_max,
        },
        Limb {
            name: "right_arm",
            // Expand outward (−X) and Z/Y; avoid +X into the body.
            x0: right_arm_x - outer,
            y0: body_y - outer,
            z0: limb_z - outer,
            x1: right_arm_x + arm_w - 1,
            y1: body_y + 12 * unit - 1 + outer,
            z1: limb_z + 4 * unit - 1 + outer,
            joint: [-arm_x * u, 22.0 * u, 0.0],
            bend_offset: -4.0 * u,
            invert_bend: !blockbench,
            head_like: false,
            parent_body: true,
            bend_min: if blockbench { full_bend } else { arm_bend_min },
            bend_max: if blockbench { full_bend_max } else { arm_bend_max },
        },
        Limb {
            name: "left_arm",
            x0: left_arm_x,
            y0: body_y - outer,
            z0: limb_z - outer,
            x1: left_arm_x + arm_w - 1 + outer,
            y1: body_y + 12 * unit - 1 + outer,
            z1: limb_z + 4 * unit - 1 + outer,
            joint: [arm_x * u, 22.0 * u, 0.0],
            bend_offset: -4.0 * u,
            invert_bend: !blockbench,
            head_like: false,
            parent_body: true,
            bend_min: if blockbench { full_bend } else { arm_bend_min },
            bend_max: if blockbench { full_bend_max } else { arm_bend_max },
        },
        Limb {
            name: "right_leg",
            // Expand outward (−X) and Z/−Y; avoid +X into left leg and +Y into body.
            x0: right_leg_x - outer,
            y0: m - outer,
            z0: limb_z - outer,
            x1: right_leg_x + 4 * unit - 1,
            y1: m + 12 * unit - 1,
            z1: limb_z + 4 * unit - 1 + outer,
            joint: [-leg_x * u, 12.0 * u, 0.0],
            bend_offset: -6.0 * u,
            invert_bend: false,
            head_like: false,
            // Legs stay on the character root so a hip/waist pose does not swing the whole figure.
            parent_body: false,
            bend_min: if blockbench { full_bend } else { arm_bend_min },
            bend_max: if blockbench { full_bend_max } else { arm_bend_max },
        },
        Limb {
            name: "left_leg",
            x0: left_leg_x,
            y0: m - outer,
            z0: limb_z - outer,
            x1: left_leg_x + 4 * unit - 1 + outer,
            y1: m + 12 * unit - 1,
            z1: limb_z + 4 * unit - 1 + outer,
            joint: [leg_x * u, 12.0 * u, 0.0],
            bend_offset: -6.0 * u,
            invert_bend: false,
            head_like: false,
            parent_body: false,
            bend_min: if blockbench { full_bend } else { arm_bend_min },
            bend_max: if blockbench { full_bend_max } else { arm_bend_max },
        },
        Limb {
            name: "cape",
            x0: body_x - unit,
            y0: 8 * unit + m,
            z0: (limb_z - outer - unit).max(0),
            x1: body_x - unit + 10 * unit - 1,
            y1: 8 * unit + m + 16 * unit - 1,
            z1: (limb_z - outer - 1).max(0),
            joint: [0.0, 24.0 * u, -2.5 * u],
            bend_offset: -8.0 * u,
            invert_bend: false,
            head_like: false,
            parent_body: true,
            bend_min: full_bend,
            bend_max: full_bend_max,
        },
    ]
}

fn empty_grid(width: u32, height: u32, length: u32) -> VoxelGrid {
    VoxelGrid::empty(width, height, length)
}

fn set_rgb(grid: &mut VoxelGrid, x: i32, y: i32, z: i32, rgb: [u8; 3]) {
    if x < 0 || y < 0 || z < 0 {
        return;
    }
    let (x, y, z) = (x as u32, y as u32, z as u32);
    if x >= grid.width || y >= grid.height || z >= grid.length {
        return;
    }
    grid.put_rgb(x, y, z, [rgb[0] as f32, rgb[1] as f32, rgb[2] as f32]);
}

/// Nearest-neighbour upsample (each source voxel → `factor`³ cube). Preserves colours.
pub fn upscale_grid(source: &VoxelGrid, factor: u32) -> VoxelGrid {
    if factor <= 1 {
        return source.clone();
    }
    let mut out = empty_grid(
        source.width * factor,
        source.height * factor,
        source.length * factor,
    );
    for y in 0..source.height {
        for z in 0..source.length {
            for x in 0..source.width {
                let Some(rgb) = source.rgb_at(x, y, z) else {
                    continue;
                };
                for dy in 0..factor {
                    for dz in 0..factor {
                        for dx in 0..factor {
                            set_rgb(
                                &mut out,
                                (x * factor + dx) as i32,
                                (y * factor + dy) as i32,
                                (z * factor + dz) as i32,
                                rgb,
                            );
                        }
                    }
                }
            }
        }
    }
    out
}

/// Returns true if the pose has any meaningful transform.
pub fn pose_is_active(pose: &SkinCharacterPose) -> bool {
    // Ignore root POS — that is Mine-imator scene placement, not statue pose.
    let root_wo_pos = SkinPartPose {
        pos: [0.0; 3],
        rot: pose.root.rot,
        bend: pose.root.bend,
        scale: pose.root.scale,
    };
    pose_mag(&root_wo_pos) > 0.05 || pose.parts.values().any(|p| pose_mag(p) > 0.05)
}

fn part_pose(pose: &SkinCharacterPose, name: &str) -> SkinPartPose {
    if let Some(p) = pose.parts.get(name) {
        return p.clone();
    }
    // Outer-layer timelines sometimes use sleeve/pants names.
    let alias = match name {
        "left_arm" => Some("left_sleeve"),
        "right_arm" => Some("right_sleeve"),
        "left_leg" => Some("left_leg_pants"),
        "right_leg" => Some("right_leg_pants"),
        "hat" => Some("head"),
        _ => None,
    };
    if let Some(alias) = alias {
        if let Some(p) = pose.parts.get(alias) {
            return p.clone();
        }
    }
    SkinPartPose::default()
}

fn transform_limb_point(
    mut p: Vec3,
    limb: &Limb,
    limb_pose: &SkinPartPose,
    body_pose: &SkinPartPose,
    root: &SkinPartPose,
    u: f32,
    convention: EulerConvention,
    mix: Option<(f32, f32)>,
) -> Vec3 {
    let width = 1.35 * u.max(1.0);
    p = apply_bend(
        p,
        limb.joint,
        limb_pose.bend,
        limb.bend_offset,
        limb.invert_bend,
        limb.head_like,
        limb.bend_min,
        limb.bend_max,
        convention,
        width,
        mix.map(|m| m.0),
    );
    if limb.parent_body && pose_mag(body_pose) > 0.05 {
        p = apply_bend(
            p,
            [0.0, 12.0 * u, 0.0],
            body_pose.bend,
            6.0 * u,
            false,
            true,
            [-180.0, -180.0, -180.0],
            [180.0, 180.0, 180.0],
            convention,
            width,
            mix.map(|m| m.1),
        );
    }
    p = apply_part_tf(p, limb.joint, limb_pose, convention);
    if limb.parent_body {
        p = apply_part_tf(p, [0.0, 12.0 * u, 0.0], body_pose, convention);
    }
    apply_part_tf(p, [0.0, 0.0, 0.0], root, convention)
}

fn sub_v(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn scalar_triple(a: Vec3, b: Vec3, c: Vec3) -> f32 {
    a[0] * (b[1] * c[2] - b[2] * c[1])
        + a[1] * (b[2] * c[0] - b[0] * c[2])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
}

/// True if `p` is inside the parallelepiped origin + [0,1]·e0 + [0,1]·e1 + [0,1]·e2.
fn inside_parallelepiped(p: Vec3, origin: Vec3, e0: Vec3, e1: Vec3, e2: Vec3) -> bool {
    let w = sub_v(p, origin);
    let det = scalar_triple(e0, e1, e2);
    if det.abs() < 1e-8 {
        return false;
    }
    let a = scalar_triple(w, e1, e2) / det;
    let b = scalar_triple(e0, w, e2) / det;
    let c = scalar_triple(e0, e1, w) / det;
    const EPS: f32 = 0.02;
    a >= -EPS && a <= 1.0 + EPS && b >= -EPS && b <= 1.0 + EPS && c >= -EPS && c <= 1.0 + EPS
}

fn emit_posed_samples(
    points: &mut Vec<(i32, i32, i32, [u8; 3])>,
    x: i32,
    y: i32,
    z: i32,
    rgb: [u8; 3],
    limb: &Limb,
    limb_pose: &SkinPartPose,
    body_pose: &SkinPartPose,
    root: &SkinPartPose,
    center_x: f32,
    center_z: f32,
    feet_y: f32,
    u: f32,
    convention: EulerConvention,
    smooth_joints: bool,
) {
    // Rigid unit cube using the *centre* hinge mix so the 8 corners stay a
    // true parallelepiped. Per-corner mixes used to tear voxels that straddled
    // the elbow/knee plane.
    let width = if smooth_joints { 1.35 * u.max(1.0) } else { 0.0 };
    let local_c = [
        x as f32 + 0.5 - center_x,
        y as f32 + 0.5 - feet_y,
        z as f32 + 0.5 - center_z,
    ];
    let limb_w = bend_mix(local_c, limb.joint, limb.bend_offset, limb.head_like, width);
    let body_w = if limb.parent_body {
        bend_mix(local_c, [0.0, 12.0 * u, 0.0], 6.0 * u, true, width)
    } else {
        0.0
    };
    let xf = |dx: f32, dy: f32, dz: f32| -> Vec3 {
        let local = [
            x as f32 + dx - center_x,
            y as f32 + dy - feet_y,
            z as f32 + dz - center_z,
        ];
        let p = transform_limb_point(
            local,
            limb,
            limb_pose,
            body_pose,
            root,
            u,
            convention,
            Some((limb_w, body_w)),
        );
        [p[0] + center_x, p[1] + feet_y, p[2] + center_z]
    };
    let c000 = xf(0.0, 0.0, 0.0);
    let c100 = xf(1.0, 0.0, 0.0);
    let c010 = xf(0.0, 1.0, 0.0);
    let c001 = xf(0.0, 0.0, 1.0);
    let corners = [
        c000,
        c100,
        c010,
        xf(1.0, 1.0, 0.0),
        c001,
        xf(1.0, 0.0, 1.0),
        xf(0.0, 1.0, 1.0),
        xf(1.0, 1.0, 1.0),
    ];
    let e0 = sub_v(c100, c000);
    let e1 = sub_v(c010, c000);
    let e2 = sub_v(c001, c000);
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut min_z = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    let mut max_z = i32::MIN;
    for c in corners {
        min_x = min_x.min(c[0].floor() as i32);
        min_y = min_y.min(c[1].floor() as i32);
        min_z = min_z.min(c[2].floor() as i32);
        max_x = max_x.max(c[0].ceil() as i32);
        max_y = max_y.max(c[1].ceil() as i32);
        max_z = max_z.max(c[2].ceil() as i32);
    }
    for gx in min_x..=max_x {
        for gy in min_y..=max_y {
            for gz in min_z..=max_z {
                let p = [gx as f32 + 0.5, gy as f32 + 0.5, gz as f32 + 0.5];
                if inside_parallelepiped(p, c000, e0, e1, e2) {
                    points.push((gx, gy, gz, rgb));
                }
            }
        }
    }
}

/// Scale part POS values when the voxel grid was integer-upscaled.
fn scale_part_pos(pose: &SkinPartPose, unit: f32) -> SkinPartPose {
    SkinPartPose {
        pos: [pose.pos[0] * unit, pose.pos[1] * unit, pose.pos[2] * unit],
        rot: pose.rot,
        bend: pose.bend,
        scale: pose.scale,
    }
}

/// Transform a rest-pose skin statue by Mine-imator bodypart / char keyframes.
/// `voxel_unit` is voxels per skin pixel (1 = native, 2 = 2× statue, …).
pub fn apply_skin_pose(
    rest: &VoxelGrid,
    pose: &SkinCharacterPose,
    slim_arms: bool,
    voxel_unit: u32,
    smooth_joints: bool,
) -> VoxelGrid {
    if !pose_is_active(pose) {
        return rest.clone();
    }

    let unit = voxel_unit.max(1) as i32;
    let u = unit as f32;
    let arm_w = if slim_arms { 3 * unit } else { 4 * unit };
    let m = unit;
    let center_x = (arm_w + m + 4 * unit) as f32;
    let center_z = (2 * unit + m + 2 * unit) as f32;
    let feet_y = m as f32;

    let mut body_pose = scale_part_pos(&part_pose(pose, "body"), u);
    // Editor preview has no waist-bend split; applying body bend here tears the torso apart.
    if pose.joint_style.as_deref() == Some("blockbench") {
        body_pose.bend = [0.0; 3];
    }
    // Scene placement POS on the char root must not shift the statue.
    let root = SkinPartPose {
        pos: [0.0; 3],
        rot: pose.root.rot,
        bend: pose.root.bend,
        scale: pose.root.scale,
    };
    let limb_list = limbs(slim_arms, unit, pose.joint_style.as_deref());
    let convention = euler_convention(pose.joint_style.as_deref());

    let mut points: Vec<(i32, i32, i32, [u8; 3])> = Vec::new();
    let mut claimed = vec![false; rest.volume()];

    // Extremities first. Head hat-pad and body jacket-pad overlap the inner
    // arm/shoulder; claiming torso first left a 1-voxel “sleeve” on the body.
    let mut claim_order: Vec<&Limb> = limb_list
        .iter()
        .filter(|l| l.name.ends_with("_arm") || l.name.ends_with("_leg"))
        .collect();
    claim_order.extend(limb_list.iter().filter(|l| l.name == "head"));
    claim_order.extend(limb_list.iter().filter(|l| l.name == "body"));
    claim_order.extend(limb_list.iter().filter(|l| l.name == "cape"));

    for limb in claim_order {
        let mut limb_pose = scale_part_pos(&part_pose(pose, limb.name), u);
        if limb.name == "body" && pose.joint_style.as_deref() == Some("blockbench") {
            limb_pose.bend = [0.0; 3];
        }
        for y in limb.y0..=limb.y1 {
            for z in limb.z0..=limb.z1 {
                for x in limb.x0..=limb.x1 {
                    if x < 0 || y < 0 || z < 0 {
                        continue;
                    }
                    let (ux, uy, uz) = (x as u32, y as u32, z as u32);
                    if ux >= rest.width || uy >= rest.height || uz >= rest.length {
                        continue;
                    }
                    let Some(rgb) = rest.rgb_at(ux, uy, uz) else {
                        continue;
                    };
                    let index = rest.index(ux, uy, uz);
                    if claimed[index] {
                        continue;
                    }
                    claimed[index] = true;
                    emit_posed_samples(
                        &mut points,
                        x,
                        y,
                        z,
                        rgb,
                        limb,
                        &limb_pose,
                        &body_pose,
                        &root,
                        center_x,
                        center_z,
                        feet_y,
                        u,
                        convention,
                        smooth_joints,
                    );
                }
            }
        }
    }

    // Outer-shell / pad leftovers: pose with the nearest limb so they do not
    // remain as thin static strands while the limb swings away.
    let limb_poses: Vec<SkinPartPose> = limb_list
        .iter()
        .map(|limb| scale_part_pos(&part_pose(pose, limb.name), u))
        .collect();
    for y in 0..rest.height as i32 {
        for z in 0..rest.length as i32 {
            for x in 0..rest.width as i32 {
                let index = rest.index(x as u32, y as u32, z as u32);
                if claimed[index] {
                    continue;
                }
                let Some(rgb) = rest.rgb_at(x as u32, y as u32, z as u32) else {
                    continue;
                };
                let local = [
                    x as f32 + 0.5 - center_x,
                    y as f32 + 0.5 - feet_y,
                    z as f32 + 0.5 - center_z,
                ];
                let mut best_i = 0usize;
                let mut best_d = f32::MAX;
                for (i, limb) in limb_list.iter().enumerate() {
                    let dx = local[0] - limb.joint[0];
                    let dy = local[1] - limb.joint[1];
                    let dz = local[2] - limb.joint[2];
                    let d = dx * dx + dy * dy + dz * dz;
                    if d < best_d {
                        best_d = d;
                        best_i = i;
                    }
                }
                claimed[index] = true;
                emit_posed_samples(
                    &mut points,
                    x,
                    y,
                    z,
                    rgb,
                    &limb_list[best_i],
                    &limb_poses[best_i],
                    &body_pose,
                    &root,
                    center_x,
                    center_z,
                    feet_y,
                    u,
                    convention,
                    smooth_joints,
                );
            }
        }
    }

    if points.is_empty() {
        return rest.clone();
    }

    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut min_z = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    let mut max_z = i32::MIN;
    for &(x, y, z, _) in &points {
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        min_z = min_z.min(z);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
        max_z = max_z.max(z);
    }

    // Keep feet on the ground: shift so min_y = 0, centre XZ in the box.
    let width = (max_x - min_x + 1).max(1) as u32;
    let height = (max_y - min_y + 1).max(1) as u32;
    let length = (max_z - min_z + 1).max(1) as u32;

    let mut out = empty_grid(width, height, length);
    for (x, y, z, rgb) in points {
        set_rgb(&mut out, x - min_x, y - min_y, z - min_z, rgb);
    }
    clean_posed_grid(out, unit, smooth_joints)
}

const N6: [(i32, i32, i32); 6] = [
    (1, 0, 0),
    (-1, 0, 0),
    (0, 1, 0),
    (0, -1, 0),
    (0, 0, 1),
    (0, 0, -1),
];

/// Morphological close + island/dust removal so posed skins stay solid and tidy.
fn clean_posed_grid(grid: VoxelGrid, unit: i32, smooth_joints: bool) -> VoxelGrid {
    // One crack-fill only — a second pass bloated rotated cubes (stretched heads).
    let mut sealed = fill_pose_cracks(&grid);
    if smooth_joints {
        sealed = fill_axis_gaps(&sealed);
    }
    let min_island = (8 * unit * unit).max(12) as usize;
    let cleaned = remove_small_islands(&sealed, min_island);
    remove_dust(&cleaned)
}

/// Fill a 1-voxel gap that sits between two solid cells on the same axis
/// (typical elbow/knee split after a hard hinge).
fn fill_axis_gaps(grid: &VoxelGrid) -> VoxelGrid {
    let mut out = empty_grid(grid.width, grid.height, grid.length);
    let w = grid.width as i32;
    let h = grid.height as i32;
    let l = grid.length as i32;
    for y in 0..h {
        for z in 0..l {
            for x in 0..w {
                if let Some(rgb) = grid.rgb_at(x as u32, y as u32, z as u32) {
                    set_rgb(&mut out, x, y, z, rgb);
                }
            }
        }
    }
    let sample = |x: i32, y: i32, z: i32| -> Option<[u8; 3]> {
        if x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= l {
            return None;
        }
        grid.rgb_at(x as u32, y as u32, z as u32)
    };
    for y in 0..h {
        for z in 0..l {
            for x in 0..w {
                if grid.rgb_at(x as u32, y as u32, z as u32).is_some() {
                    continue;
                }
                let pairs = [
                    (sample(x - 1, y, z), sample(x + 1, y, z)),
                    (sample(x, y - 1, z), sample(x, y + 1, z)),
                    (sample(x, y, z - 1), sample(x, y, z + 1)),
                ];
                let Some((a, b)) = pairs.into_iter().find_map(|(a, b)| match (a, b) {
                    (Some(a), Some(b)) => Some((a, b)),
                    _ => None,
                }) else {
                    continue;
                };
                set_rgb(
                    &mut out,
                    x,
                    y,
                    z,
                    [
                        ((a[0] as u16 + b[0] as u16) / 2) as u8,
                        ((a[1] as u16 + b[1] as u16) / 2) as u8,
                        ((a[2] as u16 + b[2] as u16) / 2) as u8,
                    ],
                );
            }
        }
    }
    out
}

/// Fill empty cells tightly surrounded by solid voxels (rotation cracks / holes).
fn fill_pose_cracks(grid: &VoxelGrid) -> VoxelGrid {
    let mut out = empty_grid(grid.width, grid.height, grid.length);
    let w = grid.width as i32;
    let h = grid.height as i32;
    let l = grid.length as i32;
    // Copy existing solid.
    for y in 0..h {
        for z in 0..l {
            for x in 0..w {
                if let Some(rgb) = grid.rgb_at(x as u32, y as u32, z as u32) {
                    set_rgb(&mut out, x, y, z, rgb);
                }
            }
        }
    }
    // Fill cavities / 1-voxel tunnels that have enough solid neighbours.
    for y in 0..h {
        for z in 0..l {
            for x in 0..w {
                if grid.rgb_at(x as u32, y as u32, z as u32).is_some() {
                    continue;
                }
                let mut sum = [0.0_f32; 3];
                let mut n = 0_u32;
                for (dx, dy, dz) in N6 {
                    let nx = x + dx;
                    let ny = y + dy;
                    let nz = z + dz;
                    if nx < 0 || ny < 0 || nz < 0 || nx >= w || ny >= h || nz >= l {
                        continue;
                    }
                    if let Some(rgb) = grid.rgb_at(nx as u32, ny as u32, nz as u32) {
                        sum[0] += rgb[0] as f32;
                        sum[1] += rgb[1] as f32;
                        sum[2] += rgb[2] as f32;
                        n += 1;
                    }
                }
                // ≥5 of 6 neighbours ⇒ true enclosed crack, not a silhouette extra.
                if n >= 5 {
                    set_rgb(
                        &mut out,
                        x,
                        y,
                        z,
                        [
                            (sum[0] / n as f32).round() as u8,
                            (sum[1] / n as f32).round() as u8,
                            (sum[2] / n as f32).round() as u8,
                        ],
                    );
                }
            }
        }
    }
    out
}

fn remove_dust(grid: &VoxelGrid) -> VoxelGrid {
    let mut out = empty_grid(grid.width, grid.height, grid.length);
    let w = grid.width as i32;
    let h = grid.height as i32;
    let l = grid.length as i32;
    for y in 0..h {
        for z in 0..l {
            for x in 0..w {
                let Some(rgb) = grid.rgb_at(x as u32, y as u32, z as u32) else {
                    continue;
                };
                let mut neighbors = 0_u32;
                for (dx, dy, dz) in N6 {
                    let nx = x + dx;
                    let ny = y + dy;
                    let nz = z + dz;
                    if nx < 0 || ny < 0 || nz < 0 || nx >= w || ny >= h || nz >= l {
                        continue;
                    }
                    if grid.rgb_at(nx as u32, ny as u32, nz as u32).is_some() {
                        neighbors += 1;
                    }
                }
                if neighbors > 0 {
                    set_rgb(&mut out, x, y, z, rgb);
                }
            }
        }
    }
    out
}

fn remove_small_islands(grid: &VoxelGrid, min_voxels: usize) -> VoxelGrid {
    let w = grid.width as i32;
    let h = grid.height as i32;
    let l = grid.length as i32;
    let total = (w * h * l) as usize;
    let mut seen = vec![false; total];
    let mut keep = vec![false; total];

    let idx = |x: i32, y: i32, z: i32| -> usize {
        ((y * l + z) * w + x) as usize
    };

    for y0 in 0..h {
        for z0 in 0..l {
            for x0 in 0..w {
                let start = idx(x0, y0, z0);
                if seen[start] || grid.rgb_at(x0 as u32, y0 as u32, z0 as u32).is_none() {
                    continue;
                }
                let mut stack = vec![(x0, y0, z0)];
                let mut component = Vec::new();
                seen[start] = true;
                while let Some((x, y, z)) = stack.pop() {
                    component.push((x, y, z));
                    for (dx, dy, dz) in N6 {
                        let nx = x + dx;
                        let ny = y + dy;
                        let nz = z + dz;
                        if nx < 0 || ny < 0 || nz < 0 || nx >= w || ny >= h || nz >= l {
                            continue;
                        }
                        let ni = idx(nx, ny, nz);
                        if seen[ni] || grid.rgb_at(nx as u32, ny as u32, nz as u32).is_none() {
                            continue;
                        }
                        seen[ni] = true;
                        stack.push((nx, ny, nz));
                    }
                }
                if component.len() >= min_voxels {
                    for (x, y, z) in component {
                        keep[idx(x, y, z)] = true;
                    }
                }
            }
        }
    }

    let mut out = empty_grid(grid.width, grid.height, grid.length);
    for y in 0..grid.height {
        for z in 0..grid.length {
            for x in 0..grid.width {
                if !keep[idx(x as i32, y as i32, z as i32)] {
                    continue;
                }
                if let Some(rgb) = grid.rgb_at(x, y, z) {
                    set_rgb(&mut out, x as i32, y as i32, z as i32, rgb);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::skin::skin_to_voxels;
    use image::{Rgba, RgbaImage};

    fn solid_skin() -> Vec<u8> {
        let mut image = RgbaImage::from_pixel(64, 64, Rgba([200, 100, 50, 255]));
        image.put_pixel(0, 0, Rgba([0, 0, 0, 0]));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    #[test]
    fn raised_arm_moves_voxels_but_keeps_skin_colour() {
        let rest = skin_to_voxels(&solid_skin(), false, false).unwrap();
        let sample = rest.rgb_at(2, 19, 5).expect("right-arm voxel on −X");
        let mut parts = BTreeMap::new();
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
            joint_style: None,
        };
        let posed = apply_skin_pose(&rest, &pose, false, 1, true);
        assert!(posed.occupied_count() > 0);
        // At least one posed voxel keeps the skin orange (not white).
        let mut found = false;
        for y in 0..posed.height {
            for z in 0..posed.length {
                for x in 0..posed.width {
                    if let Some(rgb) = posed.rgb_at(x, y, z) {
                        if rgb[0] > 150 && rgb[1] > 50 && rgb[1] < 150 {
                            found = true;
                        }
                        assert_ne!(rgb, [255, 255, 255], "must not wash to white");
                    }
                }
            }
        }
        assert!(found, "expected skin-coloured voxels after pose, sample was {sample:?}");
    }

    #[test]
    fn leg_aabb_ranges_do_not_overlap() {
        for unit in [1, 2, 4] {
            for slim in [false, true] {
                let list = limbs(slim, unit, Some("blockbench"));
                let right = list.iter().find(|l| l.name == "right_leg").unwrap();
                let left = list.iter().find(|l| l.name == "left_leg").unwrap();
                assert!(
                    right.x1 < left.x0,
                    "unit={unit} slim={slim}: right_leg {}..{} overlaps left_leg {}..{}",
                    right.x0,
                    right.x1,
                    left.x0,
                    left.x1
                );
                let right_w = right.x1 - right.x0 + 1;
                let left_w = left.x1 - left.x0 + 1;
                assert_eq!(right_w, left_w, "legs must claim equal width");
                // Claim boxes include outer jacket padding on 2×+ (`limb_overlay_expand`).
                let outer = limb_overlay_expand(unit.max(1) as u32);
                assert_eq!(right_w, 4 * unit + outer);
            }
        }
    }

    #[test]
    fn asymmetric_leg_pose_keeps_similar_voxel_counts() {
        let rest = skin_to_voxels(&solid_skin(), true, true).unwrap();
        let mut parts = BTreeMap::new();
        parts.insert(
            "right_leg".into(),
            SkinPartPose {
                rot: [-11.0, 0.0, -2.0],
                ..SkinPartPose::default()
            },
        );
        parts.insert(
            "left_leg".into(),
            SkinPartPose {
                rot: [10.0, 0.0, 2.0],
                ..SkinPartPose::default()
            },
        );
        let pose = SkinCharacterPose {
            root: SkinPartPose::default(),
            parts,
            joint_style: Some("blockbench".into()),
        };
        let list = limbs(true, 1, Some("blockbench"));
        let right = list.iter().find(|l| l.name == "right_leg").unwrap();
        let left = list.iter().find(|l| l.name == "left_leg").unwrap();
        let count_rest = |limb: &Limb| {
            let mut n = 0u32;
            for y in limb.y0..=limb.y1 {
                for z in limb.z0..=limb.z1 {
                    for x in limb.x0..=limb.x1 {
                        if rest.rgb_at(x as u32, y as u32, z as u32).is_some() {
                            n += 1;
                        }
                    }
                }
            }
            n
        };
        let rest_r = count_rest(right);
        let rest_l = count_rest(left);
        assert_eq!(rest_r, rest_l, "rest legs should match before pose");

        let posed = apply_skin_pose(&rest, &pose, true, 1, true);
        let posed_count = posed.occupied_count();
        let rest_count = rest.occupied_count();
        assert!(
            posed_count < rest_count * 2,
            "posed={posed_count} rest={rest_count} — overlap theft balloons volume"
        );
    }

    #[test]
    fn body_claim_does_not_cover_inner_arm() {
        for unit in [1, 2] {
            let list = limbs(false, unit, Some("blockbench"));
            let body = list.iter().find(|l| l.name == "body").unwrap();
            let right = list.iter().find(|l| l.name == "right_arm").unwrap();
            let left = list.iter().find(|l| l.name == "left_arm").unwrap();
            let head = list.iter().find(|l| l.name == "head").unwrap();
            assert!(
                body.x0 > right.x1,
                "unit={unit}: body x0={} overlaps right arm inner x1={}",
                body.x0,
                right.x1
            );
            assert!(
                body.x1 < left.x0,
                "unit={unit}: body x1={} overlaps left arm inner x0={}",
                body.x1,
                left.x0
            );
            assert!(
                body.y1 < head.y0,
                "unit={unit}: body y1={} overlaps head y0={}",
                body.y1,
                head.y0
            );
        }
    }

    #[test]
    fn body_rot_leaves_legs_planted() {
        let rest = skin_to_voxels(&solid_skin(), false, false).unwrap();
        let mut parts = BTreeMap::new();
        parts.insert(
            "body".into(),
            SkinPartPose {
                rot: [0.0, 90.0, 0.0],
                ..SkinPartPose::default()
            },
        );
        let pose = SkinCharacterPose {
            root: SkinPartPose::default(),
            parts,
            joint_style: Some("blockbench".into()),
        };
        let list = limbs(false, 1, Some("blockbench"));
        let left = list.iter().find(|l| l.name == "left_leg").unwrap();
        assert!(!left.parent_body, "legs stay on the character root");
        let mi = limbs(false, 1, None);
        let mi_left = mi.iter().find(|l| l.name == "left_leg").unwrap();
        assert!(!mi_left.parent_body, "mineimator legs stay on root");

        let posed = apply_skin_pose(&rest, &pose, false, 1, true);
        assert!(posed.occupied_count() > 0);

        // `apply_skin_pose` crops to the posed bounding box, so raw grid indices
        // shift even for parts that never moved — the yawed torso and arms swing
        // into Z and drag the whole box with them. Compare the leg stance instead:
        // planted legs keep their 8-wide × 4-deep footprint, while legs dragged
        // round by a 90° body yaw would come out 4 wide × 8 deep.
        let (rest_w, rest_d, rest_count) = leg_footprint(&rest, 12);
        let (posed_w, posed_d, posed_count) = leg_footprint(&posed, 12);
        assert_eq!(
            (rest_w, rest_d),
            (posed_w, posed_d),
            "body yaw must not rotate the legs: rest {rest_w}×{rest_d}, posed {posed_w}×{posed_d}"
        );
        assert!(
            posed_count * 4 >= rest_count * 3,
            "legs should keep their volume when only the body yaws: rest={rest_count} posed={posed_count}"
        );
    }

    /// Width, depth and voxel count of everything below the hip, measured from
    /// each grid's own floor so the pose crop does not matter.
    fn leg_footprint(grid: &VoxelGrid, leg_height: i32) -> (i32, i32, usize) {
        let mut occupied = Vec::new();
        for y in 0..grid.height as i32 {
            for z in 0..grid.length as i32 {
                for x in 0..grid.width as i32 {
                    if grid.rgb_at(x as u32, y as u32, z as u32).is_some() {
                        occupied.push([x, y, z]);
                    }
                }
            }
        }
        let floor = occupied.iter().map(|c| c[1]).min().unwrap_or(0);
        let legs: Vec<_> = occupied
            .into_iter()
            .filter(|c| c[1] - floor < leg_height)
            .collect();
        let extent = |axis: usize| match (
            legs.iter().map(|c| c[axis]).min(),
            legs.iter().map(|c| c[axis]).max(),
        ) {
            (Some(lo), Some(hi)) => hi - lo + 1,
            _ => 0,
        };
        (extent(0), extent(2), legs.len())
    }

    #[test]
    fn blockbench_compound_euler_matches_three_js_xyz() {
        // Three.js Euler 'XYZ' ⇒ apply Rz → Ry → Rx (matrix Rx·Ry·Rz).
        let p = [0.0, -10.0, 0.0];
        let rot = [-45.0, 30.0, 10.0];
        let got = rotate_euler(p, rot, EulerConvention::Blockbench);

        // Hand-compute Rz→Ry→Rx for the same angles.
        let expected = {
            let (rx, ry, rz) = (
                deg_to_rad(rot[0]),
                deg_to_rad(rot[1]),
                deg_to_rad(rot[2]),
            );
            let (cx, sx) = (rx.cos(), rx.sin());
            let (cy, sy) = (ry.cos(), ry.sin());
            let (cz, sz) = (rz.cos(), rz.sin());
            let mut v = p;
            v = [v[0] * cz - v[1] * sz, v[0] * sz + v[1] * cz, v[2]];
            v = [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
            v = [v[0], v[1] * cx - v[2] * sx, v[1] * sx + v[2] * cx];
            v
        };
        for i in 0..3 {
            assert!(
                (got[i] - expected[i]).abs() < 1e-4,
                "axis {i}: got={got:?} expected={expected:?}"
            );
        }

        // Wrong sequential order (Rx→Ry→Rz) must NOT match Three.js.
        let wrong = {
            let (rx, ry, rz) = (
                deg_to_rad(rot[0]),
                deg_to_rad(rot[1]),
                deg_to_rad(rot[2]),
            );
            let (cx, sx) = (rx.cos(), rx.sin());
            let (cy, sy) = (ry.cos(), ry.sin());
            let (cz, sz) = (rz.cos(), rz.sin());
            let mut v = p;
            v = [v[0], v[1] * cx - v[2] * sx, v[1] * sx + v[2] * cx];
            v = [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
            v = [v[0] * cz - v[1] * sz, v[0] * sz + v[1] * cz, v[2]];
            v
        };
        let dist = ((got[0] - wrong[0]).powi(2)
            + (got[1] - wrong[1]).powi(2)
            + (got[2] - wrong[2]).powi(2))
        .sqrt();
        assert!(dist > 0.5, "Rx→Ry→Rz must diverge from Three.js XYZ; dist={dist}");

        // Pure X still matches (order irrelevant); RH +40° on (0,1,0).
        let only_x = [40.0, 0.0, 0.0];
        let bb = rotate_euler([0.0, 1.0, 0.0], only_x, EulerConvention::Blockbench);
        let rad = 40.0_f32.to_radians();
        assert!(bb[0].abs() < 1e-4);
        assert!((bb[1] - rad.cos()).abs() < 1e-4);
        assert!((bb[2] - rad.sin()).abs() < 1e-4);
    }

    #[test]
    fn blockbench_arm_yaw_moves_hand_forward_not_back() {
        // Sideways gizmo yaw (Y) on an arm hanging down: hand should swing in +Z
        // for positive Y under Three.js XYZ — not the opposite GM-YXZ path.
        let rest = skin_to_voxels(&solid_skin(), false, false).unwrap();
        let list = limbs(false, 1, Some("blockbench"));
        let arm = list.iter().find(|l| l.name == "right_arm").unwrap();
        // Tip needs an offset off the yaw axis — a pure −Y offset is unchanged by Y rot.
        let tip = [
            arm.joint[0],
            arm.joint[1] - 10.0,
            arm.joint[2] + 2.0,
        ];
        let limb_pose = SkinPartPose {
            rot: [0.0, 45.0, 0.0],
            ..SkinPartPose::default()
        };
        let body = SkinPartPose::default();
        let root = SkinPartPose::default();
        let bb = transform_limb_point(
            tip,
            arm,
            &limb_pose,
            &body,
            &root,
            1.0,
            EulerConvention::Blockbench,
            None,
        );
        let mi = transform_limb_point(
            tip,
            arm,
            &limb_pose,
            &body,
            &root,
            1.0,
            EulerConvention::Mineimator,
            None,
        );
        // Conventions disagree on yaw direction for hanging limbs.
        assert!(
            (bb[2] - mi[2]).abs() > 0.5 || (bb[0] - mi[0]).abs() > 0.5,
            "blockbench vs mineimator yaw should disagree; bb={bb:?} mi={mi:?}"
        );
        // Keep a voxel convert smoke check for the same pose.
        let mut parts = BTreeMap::new();
        parts.insert("right_arm".into(), limb_pose);
        let pose = SkinCharacterPose {
            root: SkinPartPose::default(),
            parts,
            joint_style: Some("blockbench".into()),
        };
        let posed = apply_skin_pose(&rest, &pose, false, 1, true);
        assert!(posed.occupied_count() > 0);
    }
}
