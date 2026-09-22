import { fetchCapeTexture } from '../../api'
import { decodeImageRgba, type RgbaImage } from './decodeImage'
import { SKIN_MAX_EDGE } from './skinModel'

/** Vanilla cape atlas is 64×32. HD capes are integer multiples (128×64, 256×128, …). */
export const CAPE_LAYOUT_W = 64
export const CAPE_LAYOUT_H = 32

export type CapeAtlas = {
  scale: number
  width: number
  height: number
  layoutH: 32 | 64
}

export type OfficialCapeGroup = 'popular' | 'minecon' | 'staff' | 'awarded'

export type OfficialCape = {
  id: string
  name: string
  group: OfficialCapeGroup
  /** SHA of the PNG on textures.minecraft.net */
  hash: string
}

export const OFFICIAL_CAPE_GROUPS: { id: OfficialCapeGroup; label: string }[] = [
  { id: 'popular', label: 'Popular' },
  { id: 'minecon', label: 'MINECON' },
  { id: 'staff', label: 'Mojang' },
  { id: 'awarded', label: 'Awarded' },
]

/**
 * Official Java / cross-platform cape textures from textures.minecraft.net.
 * Hashes are Mojang’s public CDN ids (same files the launcher uses).
 */
export const OFFICIAL_CAPES: OfficialCape[] = [
  { id: 'migrator', name: 'Migrator', group: 'popular', hash: '2340c0e03dd24a11b15a8b33c2a7e9e32abb2051b2481d0ba7defd635ca7a933' },
  { id: 'vanilla', name: 'Vanilla', group: 'popular', hash: 'f9a76537647989f9a0b6d001e320dac591c359e9e61a31f4ce11c88f207f0ad4' },
  { id: 'cherry-blossom', name: 'Cherry Blossom', group: 'popular', hash: 'afd553b39358a24edfe3b8a9a939fa5fa4faa4d9a9c3d6af8eafb377fa05c2bb' },
  { id: '15th-anniversary', name: '15th Anniversary', group: 'popular', hash: 'cd9d82ab17fd92022dbd4a86cde4c382a7540e117fae7b9a2853658505a80625' },
  { id: 'pan', name: 'Pan', group: 'popular', hash: '28de4a81688ad18b49e735a273e086c18f1e3966956123ccb574034c06f5d336' },
  { id: 'followers', name: "Follower's", group: 'popular', hash: '569b7f2a1d00d26f30efe3f9ab9ac817b1e6d35f4f3cfb0324ef2d328223d350' },
  { id: 'purple-heart', name: 'Purple Heart', group: 'popular', hash: 'cb40a92e32b57fd732a00fc325e7afb00a7ca74936ad50d8e860152e482cfbde' },
  { id: 'yearn', name: 'Yearn', group: 'popular', hash: '308b32a9e303155a0b4262f9e5483ad4a22e3412e84fe8385a0bdd73dc41fa89' },
  { id: 'menace', name: 'Menace', group: 'popular', hash: 'dbc21e222528e30dc88445314f7be6ff12d3aeebc3c192054fba7e3b3f8c77b1' },
  { id: 'home', name: 'Home', group: 'popular', hash: '1de21419009db483900da6298a1e6cbf9f1bc1523a0dcdc16263fab150693edd' },
  { id: 'copper', name: 'Copper', group: 'popular', hash: '5e6f3193e74cd16cdd6637d9bae5484e3a37ff2a14c2d157c659a07810b1bdca' },
  { id: 'founders', name: "Founder's", group: 'popular', hash: '99aba02ef05ec6aa4d42db8ee43796d6cd50e4b2954ab29f0caeb85f96bf52a1' },
  { id: 'minecraft-experience', name: 'Minecraft Experience', group: 'popular', hash: '7658c5025c77cfac7574aab3af94a46a8886e3b7722a895255fbf22ab8652434' },

  { id: 'minecon-2011', name: 'MINECON 2011', group: 'minecon', hash: '953cac8b779fe41383e675ee2b86071a71658f2180f56fbce8aa315ea70e2ed6' },
  { id: 'minecon-2012', name: 'MINECON 2012', group: 'minecon', hash: '8aa33788951727e898caff71bc70098d120b1f65d7ee4eed84d85e96cf351738' },
  { id: 'minecon-2013', name: 'MINECON 2013', group: 'minecon', hash: '153b1a0dfcbae953cdeb6f2c2bf6bf79943239b1372780da44bcbb29273131da' },
  { id: 'minecon-2015', name: 'MINECON 2015', group: 'minecon', hash: 'b0cc08840700447322d953a02b965f1d65a13a603bf64b17c803c21446fe1635' },
  { id: 'minecon-2016', name: 'MINECON 2016', group: 'minecon', hash: 'e7dfea16dc83c97df01a12fabbd1216359c0cd0ea42f9999b6e97c584963e980' },

  { id: 'mojang-classic', name: 'Mojang Classic', group: 'staff', hash: '8f120319222a9f4a104e2f5cb97b2cda93199a2ee9e1585cb8d09d6f687cb761' },
  { id: 'mojang', name: 'Mojang', group: 'staff', hash: '5786fe99be377dfb6858859f926c4dbc995751e91cee373468c5fbf4865e7151' },
  { id: 'mojang-studios', name: 'Mojang Studios', group: 'staff', hash: '9e507afc56359978a3eb3e32367042b853cddd0995d17d0da995662913fb00f7' },

  { id: 'prismarine', name: 'Prismarine', group: 'awarded', hash: 'd8f8d13a1adf9636a16c31d47f3ecc9bb8d8533108aa5ad2a01b13b1a0c55eac' },
  { id: 'turtle', name: 'Turtle', group: 'awarded', hash: '5048ea61566353397247d2b7d946034de926b997d5e66c86483dfb1e031aee95' },
  { id: 'millionth', name: 'Millionth Customer', group: 'awarded', hash: '70efffaf86fe5bc089608d3cb297d3e276b9eb7a8f9f2fe6659c23a2d8b18edf' },
  { id: 'cobalt', name: 'Cobalt', group: 'awarded', hash: '4fdbc899e4ca958d118223e9b1a2a1f59be5b36693cdd9dfcb5b624c4c8b13d8' },
  { id: 'scrolls', name: 'Scrolls Champion', group: 'awarded', hash: '29bf0f478b2e089449a0b6216b5ee862383b007c599541a0a9100f378ad04047' },
  { id: 'birthday', name: 'Birthday', group: 'awarded', hash: '336ae7f00f2154064f91190a131eee2251d51612d38bece47a497f96ebcfebb1' },
  { id: 'valentine', name: 'Valentine', group: 'awarded', hash: '45b8891ca563d5c774afad642fe3048c4147b347e970004ffa45a4ad0c64143b' },
  { id: 'dannybstyle', name: "dannyBstyle's", group: 'awarded', hash: '66b7361b97dd9b10080c627dea3109d7dabe20286ef64c396dfd3cc0d38b7ff0' },
  { id: 'julianclark', name: "JulianClark's", group: 'awarded', hash: '40155f104c0dc8cdeaadff2c44ab3a45ca306a3bcb8a66ef669f8d5426a5a2f3' },
  { id: 'cheapshot', name: "cheapsh0t's", group: 'awarded', hash: '2e002d5e1758e79ba51d08d92a0f3a95119f2f435ae7704916507b6c565a7da8' },
  { id: 'oxeye', name: 'Oxeye', group: 'awarded', hash: 'ffdec184ef9b53d0a8f7886922e9b4adb23d9963f1df6b34985b37bf07e7baba' },
  { id: 'blueprint', name: 'Blueprint', group: 'awarded', hash: '15501578fe1dd925ccd322b2ff7045be36613085a13f11481ccb29486bae89dc' },
]

export function officialCapeById(id: string): OfficialCape | undefined {
  return OFFICIAL_CAPES.find((cape) => cape.id === id)
}

export function officialCapeTextureUrl(cape: OfficialCape): string {
  return `https://textures.minecraft.net/texture/${cape.hash}`
}

/**
 * Vanilla cape UVs live on a 64×32 sheet (the elytra uses the right half).
 * Square PNGs (64×64, 128×128, …) are accepted as padded HD sheets.
 */
export function parseCapeLayout(width: number, height: number): CapeAtlas | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  if (width < CAPE_LAYOUT_W || width % CAPE_LAYOUT_W !== 0) return null
  const scale = width / CAPE_LAYOUT_W
  if (scale < 1) return null
  if (height === width / 2) {
    return { scale, width, height, layoutH: 32 }
  }
  if (height === width) {
    return { scale, width, height, layoutH: 64 }
  }
  return null
}

export function parseCapeAtlas(width: number, height: number): CapeAtlas | null {
  const atlas = parseCapeLayout(width, height)
  if (!atlas) return null
  if (atlas.width > SKIN_MAX_EDGE || atlas.height > SKIN_MAX_EDGE) return null
  return atlas
}

export function capeSizeHint(width: number, height: number): string {
  const layout = parseCapeLayout(width, height)
  if (layout && (layout.width > SKIN_MAX_EDGE || layout.height > SKIN_MAX_EDGE)) {
    return `${width}×${height} is too large to load. HD capes can go up to ${SKIN_MAX_EDGE}×${SKIN_MAX_EDGE / 2} (or square).`
  }
  return `${width}×${height} is not a Minecraft cape (need 64×32, or an HD scale of that layout).`
}

export async function inspectCapePng(
  bytes: Uint8Array,
): Promise<{ atlas: CapeAtlas }> {
  const image = await decodeImageRgba(bytes)
  if (!image) throw new Error('Could not decode the cape PNG')
  const atlas = parseCapeAtlas(image.width, image.height)
  if (!atlas) throw new Error(capeSizeHint(image.width, image.height))
  return { atlas }
}

const fetchedCapes = new Map<string, Uint8Array>()

export function capePngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (!width || !height) return null
  return { width, height }
}

export async function fetchOfficialCape(cape: OfficialCape): Promise<Uint8Array> {
  const hit = fetchedCapes.get(cape.id)
  if (hit) return hit
  let bytes: Uint8Array
  try {
    bytes = await fetchCapeTexture(cape.hash)
  } catch (nativeError) {
    try {
      const response = await fetch(officialCapeTextureUrl(cape))
      if (!response.ok) {
        throw new Error(`Could not download ${cape.name} cape (${response.status})`)
      }
      bytes = new Uint8Array(await response.arrayBuffer())
    } catch (browserError) {
      const message =
        nativeError instanceof Error ? nativeError.message : String(nativeError)
      const extra = browserError instanceof Error ? browserError.message : String(browserError)
      throw new Error(message.includes('download') ? message : extra)
    }
  }
  if (bytes.length < 64) throw new Error(`${cape.name} cape download was empty`)
  await inspectCapePng(bytes)
  fetchedCapes.set(cape.id, bytes)
  return bytes
}

/** Vanilla cape box: 10×16×1 at texOffs(0,0). Outside face people see from behind is (1,1). */
export function capeFaceLayoutRect(): { u: number; v: number; w: number; h: number } {
  return { u: 1, v: 1, w: 10, h: 16 }
}

export function capeHdNote(atlas: CapeAtlas): string | null {
  return atlas.scale > 1 ? `${atlas.width}×${atlas.height}` : null
}

export function blitCapeFace(
  image: RgbaImage,
  dest: HTMLCanvasElement,
  displayW = 40,
  displayH = 64,
): void {
  const atlas = parseCapeAtlas(image.width, image.height)
  const scale = atlas?.scale ?? Math.max(1, Math.floor(image.width / CAPE_LAYOUT_W))
  const { u, v, w, h } = capeFaceLayoutRect()
  dest.width = displayW
  dest.height = displayH
  const ctx = dest.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  const pixels = ctx.createImageData(displayW, displayH)
  for (let dy = 0; dy < displayH; dy += 1) {
    for (let dx = 0; dx < displayW; dx += 1) {
      const sx = Math.min(
        image.width - 1,
        Math.floor(u * scale + (dx * w * scale) / displayW),
      )
      const sy = Math.min(
        image.height - 1,
        Math.floor(v * scale + (dy * h * scale) / displayH),
      )
      const si = (sy * image.width + sx) * 4
      const di = (dy * displayW + dx) * 4
      pixels.data[di] = image.data[si]!
      pixels.data[di + 1] = image.data[si + 1]!
      pixels.data[di + 2] = image.data[si + 2]!
      pixels.data[di + 3] = image.data[si + 3]!
    }
  }
  ctx.putImageData(pixels, 0, 0)
}
