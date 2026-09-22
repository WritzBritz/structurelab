/**
 * Independent check of the player-skin voxel mapping (same rules as skin.rs).
 * Run: node scripts/skin-uv-check.mjs
 */

function sample(u, v, w, h, lx, ly, faceW, faceH, mirror) {
  const fx = mirror ? faceW - 1 - Math.min(lx, faceW - 1) : Math.min(lx, faceW - 1)
  const fy = Math.min(ly, faceH - 1)
  return [u + Math.floor((fx * w) / faceW), v + Math.floor((fy * h) / faceH)]
}

function paintFaces(box, uvs) {
  const cells = new Map()
  const set = (x, y, z, uv) => cells.set(`${x},${y},${z}`, uv)
  const stamp = (rect, lx, ly, fw, fh, mirror, x, y, z) => {
    set(x, y, z, sample(rect.u, rect.v, rect.w, rect.h, lx, ly, fw, fh, mirror))
  }
  for (let dz = 0; dz < box.d; dz++) {
    for (let dx = 0; dx < box.w; dx++) {
      stamp(uvs.top, dx, dz, box.w, box.d, false, box.x + dx, box.y + box.h - 1, box.z + dz)
      stamp(uvs.bottom, dx, dz, box.w, box.d, false, box.x + dx, box.y, box.z + dz)
    }
  }
  for (let dy = 0; dy < box.h; dy++) {
    for (let dz = 0; dz < box.d; dz++) {
      stamp(uvs.right, dz, dy, box.d, box.h, false, box.x, box.y + (box.h - 1 - dy), box.z + dz)
      stamp(uvs.left, dz, dy, box.d, box.h, true, box.x + box.w - 1, box.y + (box.h - 1 - dy), box.z + dz)
    }
  }
  for (let dy = 0; dy < box.h; dy++) {
    for (let dx = 0; dx < box.w; dx++) {
      stamp(uvs.back, dx, dy, box.w, box.h, true, box.x + dx, box.y + (box.h - 1 - dy), box.z)
      stamp(uvs.front, dx, dy, box.w, box.h, false, box.x + dx, box.y + (box.h - 1 - dy), box.z + box.d - 1)
    }
  }
  return cells
}

function get(cells, x, y, z) {
  return cells.get(`${x},${y},${z}`)
}

function eq(a, b) {
  return a && a[0] === b[0] && a[1] === b[1]
}

let failed = 0
function expect(cells, x, y, z, u, v, label) {
  const got = get(cells, x, y, z)
  if (!eq(got, [u, v])) {
    failed += 1
    console.error(`FAIL ${label} (${x},${y},${z}): got ${got} want ${u},${v}`)
  }
}

const m = 1
const armW = 4
const head = { x: armW + m, y: 24 + m, z: m, w: 8, h: 8, d: 8 }
const headUvs = {
  right: { u: 0, v: 8, w: 8, h: 8 },
  front: { u: 8, v: 8, w: 8, h: 8 },
  left: { u: 16, v: 8, w: 8, h: 8 },
  back: { u: 24, v: 8, w: 8, h: 8 },
  top: { u: 8, v: 0, w: 8, h: 8 },
  bottom: { u: 16, v: 0, w: 8, h: 8 },
}
const cells = paintFaces(head, headUvs)

for (let dy = 0; dy < 8; dy++) {
  for (let dx = 0; dx < 8; dx++) {
    expect(cells, head.x + dx, head.y + 7 - dy, head.z + 7, 8 + dx, 8 + dy, 'head front')
  }
}
for (let dy = 0; dy < 8; dy++) {
  for (let dx = 0; dx < 8; dx++) {
    expect(cells, head.x + dx, head.y + 7 - dy, head.z, 24 + (7 - dx), 8 + dy, 'head back')
  }
}
for (let dy = 1; dy < 7; dy++) {
  for (let dz = 1; dz < 7; dz++) {
    expect(cells, head.x, head.y + 7 - dy, head.z + dz, dz, 8 + dy, 'head right')
    expect(cells, head.x + 7, head.y + 7 - dy, head.z + dz, 16 + (7 - dz), 8 + dy, 'head left')
  }
}
for (let dz = 1; dz < 7; dz++) {
  for (let dx = 1; dx < 7; dx++) {
    expect(cells, head.x + dx, head.y + 7, head.z + dz, 8 + dx, dz, 'head top')
  }
}

const body = { x: armW + m, y: 12 + m, z: 2 + m, w: 8, h: 12, d: 4 }
const bodyUvs = {
  right: { u: 16, v: 20, w: 4, h: 12 },
  front: { u: 20, v: 20, w: 8, h: 12 },
  left: { u: 28, v: 20, w: 4, h: 12 },
  back: { u: 32, v: 20, w: 8, h: 12 },
  top: { u: 20, v: 16, w: 8, h: 4 },
  bottom: { u: 28, v: 16, w: 8, h: 4 },
}
const bodyCells = paintFaces(body, bodyUvs)
for (let dy = 0; dy < 12; dy++) {
  for (let dx = 0; dx < 8; dx++) {
    expect(bodyCells, body.x + dx, body.y + 11 - dy, body.z + 3, 20 + dx, 20 + dy, 'body front')
  }
}

const rightArm = { x: m, y: 12 + m, z: 2 + m, w: 4, h: 12, d: 4 }
const rightArmUvs = {
  right: { u: 40, v: 20, w: 4, h: 12 },
  front: { u: 44, v: 20, w: 4, h: 12 },
  left: { u: 48, v: 20, w: 4, h: 12 },
  back: { u: 52, v: 20, w: 4, h: 12 },
  top: { u: 44, v: 16, w: 4, h: 4 },
  bottom: { u: 48, v: 16, w: 4, h: 4 },
}
const ra = paintFaces(rightArm, rightArmUvs)
for (let dy = 0; dy < 12; dy++) {
  for (let dx = 0; dx < 4; dx++) {
    expect(ra, rightArm.x + dx, rightArm.y + 11 - dy, rightArm.z + 3, 44 + dx, 20 + dy, 'right arm front')
  }
}

const slimRight = { ...rightArm, w: 3 }
const slimUvs = {
  right: { u: 40, v: 20, w: 4, h: 12 },
  front: { u: 44, v: 20, w: 3, h: 12 },
  left: { u: 47, v: 20, w: 4, h: 12 },
  back: { u: 51, v: 20, w: 3, h: 12 },
  top: { u: 44, v: 16, w: 3, h: 4 },
  bottom: { u: 47, v: 16, w: 4, h: 4 },
}
const sr = paintFaces(slimRight, slimUvs)
for (let dy = 0; dy < 12; dy++) {
  for (let dx = 0; dx < 3; dx++) {
    expect(sr, slimRight.x + dx, slimRight.y + 11 - dy, slimRight.z + 3, 44 + dx, 20 + dy, 'slim right arm front')
  }
}

if (failed) {
  console.error(`${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('skin UV mapping: all assertions passed (head, body, classic arm, slim arm)')
